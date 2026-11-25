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


def test_delete_has_a_permanent_terminal_fence(tmp_path):
    feed = queue(tmp_path)
    source = snapshot()
    feed.enqueue(source, generation=0)
    pending = feed.next_job()
    feed.invalidate(source.session_id)
    feed.enqueue(snapshot("session-b"), generation=0)
    feed.invalidate("session-c")
    key = feed.terminal(source.session_id, "delete")

    recovered = queue(tmp_path)
    assert recovered.terminal(source.session_id, "delete") == key
    job = recovered.next_job()
    assert (job.kind, job.session_id, job.reason, job.idempotency_key) == ("terminal", "session-a", "delete", key)
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
    assert keys == tuple(reopened.terminal(session, "delete") for session in sessions)
    assert [reopened.next_job(session).kind for session in sessions] == ["terminal", "terminal"]


def removal(sequence_id, kind="rewind", session="session-a", *, removed=None):
    event = {"sequence": sequence_id, "event_id": f"event-{sequence_id}", "session_id": session, "kind": kind}
    if kind == "rewind":
        identities = ["message-b"] if removed is None else removed
        event.update(last_surviving_message_uid="message-a", previous_head_message_uid=identities[-1],
                     removed_message_uids=identities)
    return event


def test_removal_cursor_and_ordered_jobs_survive_reopen_until_ack(tmp_path):
    feed = queue(tmp_path)
    source = snapshot()
    feed.enqueue(source, generation=0)
    stale = feed.next_job()
    before = feed.disclosure_cut()
    rewind = removal(1)
    feed.apply_committed_removals([rewind])
    first = feed.next_job(fence_only=True)
    assert not feed.is_current(stale)
    assert feed.capture_state(source.session_id) == (1, outbox.REMOVAL_PENDING)
    with pytest.raises(SourceOutboxError, match=outbox.REMOVAL_PENDING):
        feed.disclosure_cut()
    with pytest.raises(SourceOutboxError, match=outbox.REMOVAL_PENDING):
        feed.enqueue(source, generation=1)

    recovered = queue(tmp_path)
    newer = removal(2, removed=["message-c"])
    deleted = removal(3, "delete")
    recovered.apply_committed_removals([rewind, newer, deleted])
    assert recovered.removal_cursor() == (3, "event-3")
    assert recovered.next_job(fence_only=True) == first
    assert recovered.next_job(terminal_only=True) is None
    arguments = decode(first.removal_json)
    assert first.idempotency_key == content_digest([
        "hermes-source-outbox-v1", "profile-a", "principal-a", source.session_id, "rewind", 1,
        content_digest(arguments),
    ])
    assert recovered.acknowledge(first, RECEIPT)
    second = recovered.next_job(fence_only=True)
    assert decode(second.removal_json)["event_id"] == "event-2"
    assert recovered.acknowledge(second, RECEIPT)
    terminal = recovered.next_job(fence_only=True)
    assert (terminal.kind, terminal.reason) == ("terminal", "delete")
    assert recovered.acknowledge(terminal, RECEIPT)
    assert recovered.next_job(fence_only=True) is None
    assert recovered.disclosure_cut() != before


def test_accepted_rewind_resumes_copy_and_bounded_proof_keeps_prior_tail(tmp_path):
    feed = queue(tmp_path)
    head = snapshot(uid="old-copied-tail")
    feed.enqueue(head, generation=0)
    assert feed.acknowledge(feed.next_job(), RECEIPT)
    later = [f"row-{index}" for index in range(outbox.MAX_REWIND_UIDS + 1)]
    feed.apply_committed_removals([removal(1, removed=["old-copied-tail", *later])])
    pending = feed.next_job()
    proof = decode(pending.removal_json)
    assert proof["removed_uids_complete"] is False
    assert proof["removed_message_uids"][0] == "old-copied-tail"
    assert proof["removed_message_uids"][-1] == proof["previous_head_message_uid"]
    assert feed.acknowledge(pending, RECEIPT)
    assert feed.capture_state(head.session_id) == (1, None)
    assert feed.cursor(head.session_id).last_message_uid == "message-a"
    assert feed.enqueue(snapshot(uid="new-tail"), generation=1)


def test_legacy_archive_queue_migration_keeps_only_acknowledged_tombstones(tmp_path):
    path = tmp_path / "source-outbox-v1.sqlite3"
    path.touch(mode=0o600)
    with closing(sqlite3.connect(path)) as db:
        db.execute(f"PRAGMA application_id={outbox._APPLICATION_ID}")
        db.execute("PRAGMA user_version=5")
        for statement in outbox._SCHEMA[:-1]:
            db.execute(statement.replace(", 'rewind'", ""))
        scope = ("profile-a", "principal-a")
        for session, receipt in (("undelivered", None), ("acknowledged", RECEIPT)):
            db.execute("INSERT INTO source_state VALUES (?, ?, ?, 0, 'archive')", (*scope, session))
            key = content_digest(["hermes-source-outbox-v1", *scope, session, "terminal", 0, None])
            db.execute("""INSERT INTO source_jobs(key, profile, principal, session, generation, kind, reason, receipt)
                          VALUES (?, ?, ?, ?, 0, 'terminal', 'archive', ?)""", (key, *scope, session, receipt))
        db.commit()
    feed = queue(tmp_path)
    assert feed.next_job() is None
    assert feed.capture_state("undelivered") == (0, outbox.REMOVAL_PENDING)
    assert feed.capture_state("acknowledged") == (0, TERMINAL)
    assert feed.quarantined_archive_sessions() == ["undelivered"]
    feed.release_legacy_archives(["undelivered", "acknowledged"])
    assert feed.capture_state("undelivered") == (0, None)
    assert feed.capture_state("acknowledged") == (0, TERMINAL)
    feed.apply_committed_removals([removal(1, "delete", "undelivered")])
    assert feed.next_job().reason == "delete"


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


def test_manual_jobs_keep_the_reviewed_owners_while_the_prior_phy_is_inactive(tmp_path, monkeypatch):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    monkeypatch.setattr(manual_delivery, "ensure_manual_worker", lambda *_: None)
    now = [100.0]
    monkeypatch.setattr(outbox, "time", SimpleNamespace(time=lambda: now[0]))

    roles = {
        "main_rel": {"owner_id": "rel-a"},
        "active_phy": {"owner_id": "phy-a"},
        "projects": {"demo": {"owner_id": "project-rel"}},
    }
    client = SimpleNamespace(
        switch_status=lambda: {"owners": roles},
        read_source_status=lambda _session_id: {
            "state": "none", "owner_id": None, "snapshot_digest": None, "receipt": None,
        },
    )
    earlier = snapshot("earlier")
    result = manual_delivery.queue_imports(settings, client, "project-rel", [earlier])
    assert result[earlier.session_id]["status"] == "queued"
    feed = queue(tmp_path)
    job = feed.next_job(manual_only=True)
    assert (job.manual_owner_id, job.manual_phy_id) == ("project-rel", "phy-a")
    assert feed.rebind_manual(job, lease_id="history-lease", fence_epoch=7)
    job = feed.next_job(manual_only=True)
    assert (job.manual_owner_id, job.manual_phy_id) == ("project-rel", "phy-a")

    roles["projects"]["demo"] = {"owner_id": "new-project-rel"}
    roles["active_phy"] = {"owner_id": "phy-b"}
    later = snapshot("later")
    refused = manual_delivery.queue_imports(settings, client, "project-rel", [later])
    assert refused[later.session_id]["reason"] == "unconfigured_source_owner"
    assert feed.manual_status(later.session_id) is None
    result = manual_delivery.queue_imports(settings, client, "new-project-rel", [later])
    assert result[later.session_id]["status"] == "queued"
    for _ in range(9):
        assert feed.next_job(manual_only=True) == job
        assert feed.fail_manual(job, "source_phy_inactive")
        now[0] += 2

    with feed._transaction() as db:
        attempts = db.execute("SELECT manual_attempts FROM source_jobs WHERE key=?", (job.idempotency_key,))
        assert attempts.fetchone()[0] == 0
    assert feed.fail_manual(job, "source_phy_inactive")
    assert feed.next_job(manual_only=True).manual_phy_id == "phy-b"
    now[0] += 2
    reopened = queue(tmp_path)
    assert reopened.next_job(manual_only=True) == job
    assert reopened.acknowledge(job, RECEIPT)


def test_v4_pending_manual_import_reopens_with_its_legacy_key(tmp_path):
    selected = snapshot("legacy-pending")
    feed = queue(tmp_path)
    key = feed.enqueue_manual(selected, owner_id="rel-a")
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        db.execute("ALTER TABLE source_jobs DROP COLUMN manual_phy_id")
        db.execute("DROP TABLE source_removal_cursor")
        db.execute("PRAGMA user_version = 4")
        db.commit()

    migrated = queue(tmp_path)
    job = migrated.next_job(manual_only=True)
    assert job.idempotency_key == key
    assert job.snapshot == selected
    assert job.manual_phy_id is None
    assert migrated.acknowledge(job, RECEIPT)


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


@pytest.mark.parametrize("initial_error", ["host_unavailable", "host_connection_refused", "host_incomplete_response"])
def test_completed_manual_receipt_reconnects_before_idempotent_replay(tmp_path, monkeypatch, initial_error):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    selected = snapshot("history-selected")
    feed = queue(tmp_path)
    feed.enqueue_manual(selected, owner_id="rel-a")
    assert feed.acknowledge(feed.next_job(manual_only=True), RECEIPT)

    class DetachedClient:
        def __init__(self):
            self.status_reads = 0
            self.reconnects = []

        def read_source_status(self, session_id):
            assert session_id == selected.session_id
            self.status_reads += 1
            if self.status_reads == 1:
                raise manual_delivery.HostUnavailable(initial_error)
            return {"state": "complete", "receipt": RECEIPT, "owner_id": "rel-a",
                    "snapshot_digest": selected.snapshot_digest}

        def connect_dashboard(self, session_id):
            self.reconnects.append(session_id)
            assert session_id is None

    client = DetachedClient()
    monkeypatch.setattr(manual_delivery, "ensure_manual_worker", lambda *_: None)
    result = manual_delivery.queue_imports(settings, client, "rel-a", [selected])

    assert result[selected.session_id]["status"] == "already_imported"
    assert client.reconnects == [None] and client.status_reads == 2
    assert feed.manual_status(selected.session_id)["receipt"] == RECEIPT
    assert not feed.has_pending_manual()
    assert feed.next_job() is None
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        assert db.execute("SELECT COUNT(*) FROM source_jobs").fetchone() == (1,)


def test_completed_manual_receipt_retries_host_closing_during_reconnect(tmp_path, monkeypatch):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    selected = snapshot("history-selected")
    feed = queue(tmp_path)
    feed.enqueue_manual(selected, owner_id="rel-a")
    assert feed.acknowledge(feed.next_job(manual_only=True), RECEIPT)

    class ClosingClient:
        def __init__(self):
            self.status_reads = 0
            self.reconnects = 0

        def read_source_status(self, session_id):
            assert session_id == selected.session_id
            self.status_reads += 1
            if self.status_reads == 1:
                raise manual_delivery.HostUnavailable("host_unavailable")
            if self.status_reads == 2:
                raise manual_delivery.HostUnavailable("host_closing")
            return {"state": "complete", "receipt": RECEIPT, "owner_id": "rel-a",
                    "snapshot_digest": selected.snapshot_digest}

        def connect_dashboard(self, session_id):
            assert session_id is None
            self.reconnects += 1
            if self.reconnects == 1:
                raise manual_delivery.HostUnavailable("host_closing")

    client = ClosingClient()
    monkeypatch.setattr(manual_delivery, "ensure_manual_worker", lambda *_: None)
    result = manual_delivery.queue_imports(settings, client, "rel-a", [selected])

    assert result[selected.session_id]["status"] == "already_imported"
    assert client.reconnects == 3 and client.status_reads == 3
    assert feed.manual_status(selected.session_id)["receipt"] == RECEIPT
    assert not feed.has_pending_manual()
    assert feed.next_job() is None
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        assert db.execute("SELECT COUNT(*) FROM source_jobs").fetchone() == (1,)


@pytest.mark.parametrize("field,value", [
    ("owner_id", "rel-b"),
    ("snapshot_digest", "b" * 64),
    ("receipt", "b" * 64),
])
def test_completed_manual_receipt_rejects_mismatched_remote_identity(tmp_path, monkeypatch, field, value):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    selected = snapshot("history-selected")
    feed = queue(tmp_path)
    feed.enqueue_manual(selected, owner_id="rel-a")
    assert feed.acknowledge(feed.next_job(manual_only=True), RECEIPT)
    remote = {"state": "complete", "receipt": RECEIPT, "owner_id": "rel-a",
              "snapshot_digest": selected.snapshot_digest}
    remote[field] = value
    reads = []

    class MismatchedClient:
        def read_source_status(self, session_id):
            reads.append(session_id)
            return remote

        def connect_dashboard(self, session_id):
            raise AssertionError("matching signed status should not need reconnect")

    monkeypatch.setattr(manual_delivery, "ensure_manual_worker", lambda *_: None)
    result = manual_delivery.queue_imports(settings, MismatchedClient(), "rel-a", [selected])

    assert result[selected.session_id]["status"] == "unavailable"
    assert result[selected.session_id]["reason"] == "source_receipt_mismatch"
    assert reads == [selected.session_id]
    assert feed.manual_status(selected.session_id)["receipt"] == RECEIPT
    assert not feed.has_pending_manual()
    assert feed.next_job() is None
    with closing(sqlite3.connect(tmp_path / "source-outbox-v1.sqlite3")) as db:
        assert db.execute("SELECT COUNT(*) FROM source_jobs").fetchone() == (1,)


def test_pending_manual_queue_does_not_reconnect_on_host_unavailable(tmp_path, monkeypatch):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    selected = snapshot("history-pending")
    feed = queue(tmp_path)
    feed.enqueue_manual(selected, owner_id="rel-a")

    class DetachedClient:
        def read_source_status(self, session_id):
            assert session_id == selected.session_id
            raise manual_delivery.HostUnavailable("host_unavailable")

        def connect_dashboard(self, session_id):
            raise AssertionError("pending work must not reconnect through queue replay")

    monkeypatch.setattr(manual_delivery, "ensure_manual_worker", lambda *_: None)
    result = manual_delivery.queue_imports(settings, DetachedClient(), "rel-a", [selected])

    assert result[selected.session_id]["status"] == "queued"
    assert feed.manual_status(selected.session_id)["receipt"] is None
    assert feed.has_pending_manual()
    assert feed.next_job(manual_only=True).snapshot == selected
