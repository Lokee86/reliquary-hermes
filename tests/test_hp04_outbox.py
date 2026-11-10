from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import sqlite3
from types import SimpleNamespace

import pytest

from reliquary_hermes import manual_delivery, outbox
from reliquary_hermes.outbox import BACKPRESSURE, STALE, TERMINAL, UNAVAILABLE, SourceOutbox, SourceOutboxError
from reliquary_hermes.source import SourceSnapshot
from reliquary_hermes.validation import ContractError, content_digest, decode


RECEIPT = "a" * 64


def snapshot(session="session-a", *, profile="profile-a", content="A private synthetic source body", uid="message-a"):
    data = {
        "profile_id": profile, "session_id": session, "branch_id": None, "source_revision": None,
        "messages": [{"message_uid": uid, "role": "user", "timestamp": 1720000000.125,
                      "content": content, "author": {"id": None, "is_bot": None}}],
    }
    return SourceSnapshot.parse({"authority": "hermes_source_copied_snapshot", "availability": "current",
                                 "snapshot_digest": content_digest(data), **data})


def queue(tmp_path, profile="profile-a", principal="principal-a"):
    return SourceOutbox(tmp_path, profile, principal)


def test_pending_snapshot_and_receipt_survive_reopen(tmp_path):
    source = snapshot()
    first = queue(tmp_path)
    assert first.generation(source.session_id) == 0
    key = first.enqueue(source, generation=0)
    pending = first.next_job(source.session_id)
    assert pending is not None and pending.idempotency_key == key
    assert first.cursor(source.session_id) is None
    assert "private synthetic" not in repr(pending)

    reopened = queue(tmp_path)
    assert reopened.next_job() == pending
    assert reopened.enqueue(source, generation=0) == key
    assert pending.snapshot == source
    message = decode(pending.snapshot_json)["messages"][0]
    assert message["message_uid"] == "message-a" and message["timestamp"] == 1720000000.125
    assert reopened.acknowledge(pending, RECEIPT)
    assert reopened.acknowledge(pending, RECEIPT)
    assert not reopened.acknowledge(pending, "different-receipt")
    assert not reopened.is_current(pending)

    recovered = queue(tmp_path)
    cursor = recovered.cursor(source.session_id)
    assert (cursor.generation, cursor.snapshot_digest, cursor.last_message_uid, cursor.receipt) == (
        0, source.snapshot_digest, "message-a", RECEIPT,
    )
    assert recovered.enqueue(source, generation=0) == key and recovered.next_job() is None
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        assert db.execute("SELECT payload FROM source_jobs").fetchone() == (None,)


def test_invalidation_fences_older_work_and_coalesces_pending_fences(tmp_path):
    feed = queue(tmp_path)
    source = snapshot()
    feed.enqueue(source, generation=0)
    old_copy = feed.next_job()
    assert feed.invalidate(source.session_id) == 1
    old_fence = feed.next_job()
    assert (old_fence.kind, old_fence.generation) == ("invalidate", 1)
    assert feed.invalidate(source.session_id) == 2
    with pytest.raises(SourceOutboxError, match=STALE):
        feed.enqueue(source, generation=0)
    assert not feed.is_current(old_copy) and not feed.acknowledge(old_copy, RECEIPT)
    assert not feed.is_current(old_fence) and not feed.acknowledge(old_fence, RECEIPT)

    feed.enqueue(source, generation=2)
    recovered = queue(tmp_path)
    fence = recovered.next_job(source.session_id)
    assert (fence.kind, fence.generation) == ("invalidate", 2)
    assert recovered.acknowledge(fence, RECEIPT)
    assert recovered.cursor(source.session_id).kind == "invalidate"
    current = recovered.next_job(source.session_id)
    assert (current.kind, current.generation) == ("snapshot", 2)
    assert recovered.acknowledge(current, "b" * 64)
    assert recovered.cursor(source.session_id).idempotency_key == current.idempotency_key


def test_archive_and_delete_share_a_permanent_terminal_fence(tmp_path):
    feed = queue(tmp_path)
    source = snapshot()
    feed.enqueue(source, generation=0)
    pending = feed.next_job()
    feed.invalidate(source.session_id)
    feed.enqueue(snapshot("session-b"), generation=0)
    feed.invalidate("session-c")
    key = feed.terminal(source.session_id, "archive")

    recovered = queue(tmp_path)
    assert recovered.terminal(source.session_id, "delete") == key
    job = recovered.next_job()
    assert (job.kind, job.session_id, job.reason, job.idempotency_key) == ("terminal", "session-a", "archive", key)
    assert not recovered.acknowledge(pending, RECEIPT)
    assert recovered.acknowledge(job, RECEIPT)
    assert recovered.next_job().kind == "invalidate"
    assert recovered.next_job("session-a") is None
    assert recovered.next_job("session-b").kind == "snapshot"
    assert recovered.invalidate("session-a") == 1
    with pytest.raises(SourceOutboxError, match=TERMINAL):
        recovered.enqueue(source, generation=1)
    assert recovered.cursor(source.session_id).kind == "terminal"


def test_copy_backpressure_does_not_prevent_terminal_events_or_cross_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(outbox, "_MAX_PENDING", 1)
    feed = queue(tmp_path)
    other = queue(tmp_path, principal="principal-b")
    foreign = queue(tmp_path, profile="profile-b")
    source = snapshot()
    key = feed.enqueue(source, generation=0)
    assert feed.enqueue(source, generation=0) == key
    with pytest.raises(SourceOutboxError, match=BACKPRESSURE):
        feed.enqueue(snapshot("session-b"), generation=0)
    with pytest.raises(ContractError, match="source_scope_mismatch"):
        foreign.enqueue(source, generation=0)
    assert foreign.next_job() is None
    assert other.enqueue(source, generation=0) != key
    assert not other.acknowledge(feed.next_job(), RECEIPT)
    terminal = feed.terminal("session-b", "delete")
    assert feed.next_job().idempotency_key == terminal
    assert other.next_job().kind == "snapshot"


def test_concurrent_exact_enqueue_commits_one_copy(tmp_path):
    feed = queue(tmp_path)
    second = queue(tmp_path)
    source = snapshot()
    with ThreadPoolExecutor(max_workers=2) as workers:
        first_job = workers.submit(feed.enqueue, source, generation=0)
        second_job = workers.submit(second.enqueue, source, generation=0)
        assert first_job.result() == second_job.result()
    assert feed.acknowledge(second.next_job(), RECEIPT)
    assert feed.next_job() is None


def test_failed_bulk_terminal_commit_leaves_all_original_jobs_pending(tmp_path, monkeypatch):
    feed = queue(tmp_path)
    sessions = ["session-a", "session-b"]
    for session in sessions:
        feed.enqueue(snapshot(session), generation=0)
    original = [feed.next_job(session) for session in sessions]
    real_key = feed._key
    with monkeypatch.context() as changes:
        def fail_on_second(kind, session, generation):
            if session == "session-b":
                raise SourceOutboxError(UNAVAILABLE)
            return real_key(kind, session, generation)

        changes.setattr(feed, "_key", fail_on_second)
        with pytest.raises(SourceOutboxError, match=UNAVAILABLE):
            feed.terminal_many(sessions, "delete")
    reopened = queue(tmp_path)
    assert [reopened.next_job(session) for session in sessions] == original

    keys = reopened.terminal_many(sessions, "delete")
    assert keys == tuple(reopened.terminal(session, "archive") for session in sessions)
    assert [reopened.next_job(session).kind for session in sessions] == ["terminal", "terminal"]


def test_foreign_database_fails_closed(tmp_path):
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        db.execute("CREATE TABLE foreign_data (id INTEGER)")
    with pytest.raises(SourceOutboxError, match=UNAVAILABLE):
        queue(tmp_path)


def test_reopened_queue_rejects_a_payload_under_the_wrong_scope(tmp_path):
    feed = queue(tmp_path)
    foreign = queue(tmp_path, profile="profile-b")
    key = feed.enqueue(snapshot(), generation=0)
    foreign.enqueue(snapshot(profile="profile-b"), generation=0)
    foreign_payload = foreign.next_job().snapshot_json
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        db.execute("UPDATE source_jobs SET payload=? WHERE key=?", (foreign_payload, key))
        db.commit()
    with pytest.raises(SourceOutboxError, match=UNAVAILABLE):
        queue(tmp_path).next_job()


def test_manual_receipts_preserve_prior_automatic_work_and_skip_permanent_failures(tmp_path):
    feed = queue(tmp_path)
    refused = snapshot("history-refused")
    selected = snapshot("history-selected")
    feed.enqueue_manual(refused, owner_id="rel-a")
    live_key = feed.enqueue(selected, generation=0)
    selected_key = feed.enqueue_manual(selected, owner_id="rel-b")
    first = feed.next_job(manual_only=True)
    assert first.session_id == refused.session_id
    assert feed.fail_manual(first, "manual_import_conflict")
    assert feed.manual_status(refused.session_id)["status"] == "failed"
    assert not feed.manual_status(refused.session_id)["retryable"]
    selected_job = feed.next_job(manual_only=True)
    assert selected_job.idempotency_key == selected_key
    assert selected_job.lease_id is None
    assert feed.rebind_manual(selected_job, lease_id="history-lease", fence_epoch=None)
    rebound = feed.next_job(manual_only=True)
    assert rebound.lease_id == "history-lease" and rebound.idempotency_key == selected_key
    assert feed.acknowledge(rebound, RECEIPT)
    assert feed.next_job(selected.session_id).idempotency_key == live_key
    assert feed.manual_status(selected.session_id)["receipt"] == RECEIPT
    assert not feed.has_pending_manual()
    assert feed.enqueue_manual(selected, owner_id="rel-b") == selected_key
    with pytest.raises(SourceOutboxError, match="manual_import_conflict"):
        feed.enqueue_manual(selected, owner_id="rel-a")


def test_missing_native_history_is_unavailable_even_with_a_local_receipt(tmp_path):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    selected = snapshot("history-selected")
    feed = queue(tmp_path)
    feed.enqueue_manual(selected, owner_id="rel-a")
    assert feed.acknowledge(feed.next_job(manual_only=True), RECEIPT)

    client = SimpleNamespace(read_source_status=lambda _session_id: {"state": "unavailable"})
    result = manual_delivery.queue_imports(settings, client, "rel-a", [selected])

    assert result[selected.session_id]["status"] == "unavailable"
    assert result[selected.session_id]["reason"] == "source_status_unavailable"
    assert feed.manual_status(selected.session_id)["receipt"] == RECEIPT
    assert not feed.has_pending_manual()
