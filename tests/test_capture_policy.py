"""HU08 capture-policy regressions against the pinned Hermes session store."""

import json
import os
import stat
from types import SimpleNamespace

import pytest

from reliquary_hermes import capture_policy
from reliquary_hermes.capture_policy import capture_cutoff, capture_eligibility
from reliquary_hermes.settings import profile_setup_lock
from reliquary_hermes.source_capture import capture_snapshot
from reliquary_hermes.validation import ContractError


def _home(tmp_path):
    home = tmp_path / ".hermes" / "profiles" / "owner-a"
    home.mkdir(parents=True)
    return home


def _db(home, checkout, monkeypatch, started_at):
    monkeypatch.syspath_prepend(str(checkout))
    import hermes_state_worker_lifecycle as lifecycle
    from hermes_state import SessionDB

    # Deterministic persisted started_at values; production API has no started_at override.
    ticks = iter(started_at)
    monkeypatch.setattr(lifecycle, "time", SimpleNamespace(time=lambda: next(ticks)))
    return SessionDB(home / "state.db")


def _enroll(home, monkeypatch, cutoff=100.0):
    (home / "reliquary").mkdir(exist_ok=True)
    monkeypatch.setattr(capture_policy, "time", lambda: cutoff)
    with profile_setup_lock(home):
        enrolled = capture_cutoff(home, enroll=True)
    monkeypatch.setattr(capture_policy, "time", lambda: 500.0)
    return enrolled


@pytest.fixture(autouse=True)
def isolated_home(request, tmp_path, monkeypatch):
    fixture = "history_checkout" if os.environ.get("HU08_HERMES_INSTALLED_CHECKOUT") else "pinned_checkout"
    monkeypatch.syspath_prepend(str(request.getfixturevalue(fixture)))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))


def test_enrollment_is_profile_private_atomic_and_preserved(tmp_path, monkeypatch):
    home = _home(tmp_path)
    first = _enroll(home, monkeypatch, 100.0)
    path = home / "reliquary" / "capture-enrollment-v1.json"
    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 1, "cutoff": first}
    assert first == 100.0
    assert capture_cutoff(home) == first
    assert _enroll(home, monkeypatch, 200.0) == first
    assert not list(path.parent.glob("*.tmp"))
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


@pytest.mark.parametrize("payload", [b"", b"{}", b'{"version":2,"cutoff":1}',
                                       b'{"version":1,"cutoff":true}',
                                       b'{"version":1,"cutoff":NaN}'])
def test_missing_or_corrupt_enrollment_fails_closed(tmp_path, payload):
    home = _home(tmp_path)
    with pytest.raises(ContractError, match="source_capture_setup_required"):
        capture_cutoff(home)
    path = home / "reliquary" / "capture-enrollment-v1.json"
    path.parent.mkdir()
    path.write_bytes(payload)
    with pytest.raises(ContractError, match="source_capture_setup_required"):
        capture_cutoff(home)


def test_export_v1_keeps_auto_capture_but_requires_v2_for_unbounded_manual(monkeypatch):
    from hermes_state import SessionDB

    monkeypatch.setattr(SessionDB, "HISTORY_EXPORT_VERSION", 1)
    assert capture_policy.history_supported()
    assert not capture_policy.unbounded_history_supported()
    monkeypatch.setattr(SessionDB, "HISTORY_EXPORT_VERSION", 2)
    assert capture_policy.history_supported()
    assert capture_policy.unbounded_history_supported()


def test_fresh_root_and_strict_cutoff_use_real_started_at(tmp_path, history_checkout, monkeypatch):
    home = _home(tmp_path)
    cutoff = _enroll(home, monkeypatch)
    db = _db(home, history_checkout, monkeypatch, (100.0, 100.001))
    try:
        db.create_session("equal", source="cli")
        db.create_session("fresh", source="cli")
        assert db.get_session("equal")["started_at"] == 100.0
        assert db.get_session("fresh")["started_at"] == 100.001
        assert capture_eligibility(home, "equal", cutoff) == "source_capture_historical"
        assert capture_eligibility(home, "fresh", cutoff) is None
    finally:
        db.close()


def test_new_reset_root_is_eligible_but_old_branch_and_compression_child_are_not(
        tmp_path, history_checkout, monkeypatch):
    home = _home(tmp_path)
    cutoff = _enroll(home, monkeypatch)
    db = _db(home, history_checkout, monkeypatch, (99.0, 100.001, 120.0, 130.0))
    try:
        db.create_session("old-root", source="cli")  # 99, pre-cutoff
        db.create_session("fresh-reset", source="cli", model_config={"_reset_from": "old-root"},
                          parent_session_id="old-root")
        db.create_session("old-branch", source="cli", model_config={"_branched_from": "old-root"},
                          parent_session_id="old-root")
        db.end_session("old-root", "compression")
        db.create_session("compression-child", source="cli", parent_session_id="old-root")
        assert capture_eligibility(home, "fresh-reset", cutoff) is None
        assert capture_eligibility(home, "old-branch", cutoff) == "source_capture_historical"
        assert capture_eligibility(home, "compression-child", cutoff) == "source_capture_historical"
    finally:
        db.close()


def test_archive_hidden_foreign_profile_and_missing_rows_are_unavailable(
        tmp_path, history_checkout, monkeypatch):
    home = _home(tmp_path)
    other = tmp_path / ".hermes" / "profiles" / "owner-b"
    other.mkdir(parents=True)
    cutoff = _enroll(home, monkeypatch)
    db = _db(home, history_checkout, monkeypatch, (101.0, 102.0, 103.0))
    try:
        db.create_session("archived", source="cli")
        db.set_session_archived("archived", True)
        db.create_session("hidden", source="subagent")
        db.create_session("foreign", source="cli", profile_name="owner-b")
        assert capture_eligibility(home, "archived", cutoff) == "source_capture_session_unavailable"
        assert capture_eligibility(home, "hidden", cutoff) == "source_capture_session_unavailable"
        assert capture_eligibility(home, "foreign", cutoff) == "source_capture_session_unavailable"
        assert capture_eligibility(home, "missing", cutoff) == "source_capture_session_unavailable"
        assert capture_eligibility(other, "foreign", cutoff) == "source_capture_session_unavailable"
    finally:
        db.close()


@pytest.mark.parametrize("historical_evidence", [{"timestamp": 100.0}, {"_compressed_summary": True}])
def test_historical_callback_rows_cannot_be_copied(historical_evidence):
    rows = [{"message_uid": "old-uid", "role": "user", "timestamp": 100.5, "content": "old",
             **historical_evidence},
            {"message_uid": "new-uid", "role": "assistant", "timestamp": 101.0, "content": "new"}]
    with pytest.raises(ContractError, match="source_capture_historical"):
        capture_snapshot("profile", "old-resumed", rows, after=100.0)
    copied = capture_snapshot("profile", "new-root", [rows[1]], after=100.0)
    assert copied.messages_json.find(b"new-uid") >= 0
    assert copied.messages_json.find(b"old-uid") < 0
