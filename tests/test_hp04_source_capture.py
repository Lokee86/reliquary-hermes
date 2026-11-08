"""Pinned Hermes source capture and cold lifecycle delivery evidence."""

import importlib.metadata
from types import SimpleNamespace

import pytest

from reliquary_hermes.outbox import SourceOutbox, SourceOutboxError
from reliquary_hermes.source_capture import capture_snapshot
from reliquary_hermes.source_observer import OBSERVER_NAME, on_session_delete
from reliquary_hermes.validation import ContractError, canonical, content_digest


def message(uid="row-a", **changes):
    return {"message_uid": uid, "role": "user", "timestamp": 1700000000.25,
            "content": "provider-filtered text", **changes}


def test_capture_preserves_source_identity_and_drops_unproven_attribution():
    rows = [message(author={"id": "unproven", "is_bot": False}, reasoning="not source text"),
            message("row-b", role="assistant", content="exact response\n", timestamp=1700000000.5)]
    snapshot = capture_snapshot("profile", "session", rows)
    expected = [
        {**{k: row[k] for k in ("message_uid", "role", "timestamp", "content")},
         "author": {"id": None, "is_bot": None}}
        for row in rows
    ]
    assert (snapshot.branch_id, snapshot.source_revision, snapshot.availability) == (None, None, "current")
    assert snapshot.messages_json == canonical(expected)
    assert snapshot.snapshot_digest == content_digest({"profile_id": "profile", "session_id": "session",
        "branch_id": None, "source_revision": None, "messages": expected})
    rows[0]["content"] = "changed after capture"
    assert snapshot.messages_json == canonical(expected)


@pytest.mark.parametrize("rows", [
    None, [], [message(None)], [message(timestamp=True)], [message(timestamp=float("nan"))],
    [message(timestamp=10**20)], [message(content=[{"type": "text", "text": "multimodal"}])],
    [message(content="data:image/png;base64,AQID")], [message(), message()],
    [message(f"row-{i}", content="a" * 32768) for i in range(8)],
    [message(f"row-{i}", content=chr(92) * 32768) for i in range(3)],
])
def test_unsupported_or_unbound_source_bytes_fail_closed(rows):
    with pytest.raises(ContractError):
        capture_snapshot("profile", "session", rows)


def _configure_scope(home, profile_id):
    state = home / "reliquary"
    state.mkdir(parents=True)
    # Intentionally offline. Terminal intake uses the private owner scope even if owner files
    # and the host executable are currently unavailable.
    (state / "owners.json").write_bytes(canonical({"profile_id": profile_id, "principal_id": "operator",
        "main_rel": str(home / "missing.rel"), "active_phy": str(home / "missing.phy"), "projects": {}}))
    return SourceOutbox(state, profile_id, "operator")


def test_pinned_cold_plugin_discovery_fences_committed_archive_and_delete(pinned_checkout, tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(pinned_checkout))
    from hermes_cli.config import save_config
    from hermes_cli.plugins import get_plugin_manager
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from hermes_state import SessionDB

    home = tmp_path / "profiles" / "affected"
    outbox = _configure_scope(home, "mapped-profile")
    entry = importlib.metadata.EntryPoint(OBSERVER_NAME, "reliquary_hermes.source_observer:register",
                                         "hermes_agent.plugins")
    monkeypatch.setattr(importlib.metadata, "entry_points", lambda: importlib.metadata.EntryPoints([entry]))
    scope = set_hermes_home_override(home)
    try:
        save_config({"plugins": {"enabled": [OBSERVER_NAME]}}, merge_existing=True)
        manager = get_plugin_manager()
        assert not manager._discovered
        # Keep the real ordinary entry-point discovery and dispatcher. Other plugin roots are irrelevant.
        monkeypatch.setattr(manager, "_scan_directory", lambda *args, **kwargs: [])
        for session, archive in (("archived-session", True), ("deleted-session", False)):
            snapshot = capture_snapshot("mapped-profile", session, [message()])
            outbox.enqueue(snapshot, generation=outbox.generation(session))
            with SessionDB(home / "state.db") as db:
                db.create_session(session, source="cli")
                assert (db.set_session_archived(session, True) if archive else db.delete_session(session))
            job = outbox.next_job(session)
            assert (job.kind, job.session_id) == ("terminal", session)
            if archive:
                with SessionDB(home / "state.db") as db:
                    assert db.delete_session(session)
                assert outbox.next_job(session) == job
            with pytest.raises(SourceOutboxError):
                outbox.enqueue(snapshot, generation=outbox.generation(session))
        assert manager._discovered
        on_session_delete(session_id="other", reason="delete", profile="different-hermes-home")
        assert outbox.next_job("other") is None
    finally:
        reset_hermes_home_override(scope)


def test_pinned_manager_egress_keeps_durable_markers_and_scrubs_copied_rows(pinned_checkout, tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(pinned_checkout))
    from agent.memory_manager import MemoryManager
    from agent.memory_provider import MemoryProvider
    from agent.session_persistence import _db_flush_row, _db_flush_write
    from hermes_cli.session_export_md import redact_session_data
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from hermes_state import SessionDB

    home = tmp_path / "profiles" / "capture"
    home.mkdir(parents=True)
    session = "source-1"
    secret = "opaque-hp04-test-bearer-91f3a97c"
    messages = [message(None, content=f"Repeated value {secret}"),
                message(None, role="assistant", content=f"Authorization: Bearer {secret}", timestamp=1700000000.5)]
    captures = []

    class Capture(MemoryProvider):
        name = "hp04-capture-probe"

        def is_available(self):
            return True

        def initialize(self, session_id, **kwargs):
            pass

        def get_tool_schemas(self):
            return []

        def sync_turn(self, user_content, assistant_content, *, session_id="", messages=None, turn_author=None):
            captures.append(capture_snapshot("mapped-profile", session_id, messages))

    scope = set_hermes_home_override(home)
    try:
        with SessionDB(home / "state.db") as db:
            db.create_session(session, source="cli")
            agent = SimpleNamespace(_session_db=db, session_id=session)
            _db_flush_write(agent, [_db_flush_row(agent, row, False) for row in messages], messages, messages)
            durable = db.get_messages(session)
            # Backup export redaction does not learn the bearer value across rows.
            exported = redact_session_data(db.export_session(session, include_inactive=True))
            assert secret.encode() in canonical(exported["messages"])
            manager = MemoryManager()
            manager.add_provider(Capture())
            manager.initialize_all(session, hermes_home=str(home))
            try:
                manager.sync_all(messages[0]["content"], messages[1]["content"], session_id=session,
                                 messages=messages, turn_author={"id": "unverified", "is_bot": False})
                assert manager.flush_pending(timeout=5)
            finally:
                manager.shutdown_all()
    finally:
        reset_hermes_home_override(scope)
    assert len(captures) == 1
    raw = captures[0].messages_json
    assert secret.encode() not in raw and b"unverified" not in raw
    for row in durable:
        assert row["message_uid"].encode() in raw
        assert str(row["timestamp"]).encode() in raw
