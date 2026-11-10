"""Long selected histories use bounded source extensions, not conversation caps."""

from types import SimpleNamespace

import pytest

from reliquary_hermes import history, manual_delivery
from reliquary_hermes.outbox import SourceOutbox, SourceOutboxError
from reliquary_hermes.validation import decode


def _messages(count):
    return [
        {"message_uid": f"message-{index:06d}", "timestamp": 1000.0 + index,
         "role": "user" if index % 2 == 0 else "assistant",
         "content": f"original content {index}"}
        for index in range(count)
    ]


def _outbox(tmp_path):
    return SourceOutbox(tmp_path, "profile-a", "principal-a")


def test_300_messages_are_queued_as_ordered_overlap_extensions(tmp_path):
    original = _messages(300)
    windows = history._snapshot_windows("profile-a", "history-long", original)
    batches = [decode(b'{"messages":' + window.messages_json + b'}')["messages"]
               for window in windows]
    assert all(1 < len(batch) <= 32 for batch in batches[1:])
    assert len(batches[0]) <= 32
    combined = [*batches[0], *(message for batch in batches[1:] for message in batch[1:])]
    assert [{key: row[key] for key in ("message_uid", "timestamp", "role", "content")} for row in combined] == original
    assert len(batches) > 3

    outbox = _outbox(tmp_path)
    first = outbox.enqueue_manual_series(windows, owner_id="owner-a")
    assert outbox.manual_status("history-long")["status"] == "queued"
    for index, window in enumerate(windows):
        if index == 1:
            outbox = _outbox(tmp_path)  # resume durable windows after a worker restart
        job = outbox.next_job(manual_only=True)
        assert job is not None and job.snapshot.snapshot_digest == window.snapshot_digest
        assert job.manual_owner_id == "owner-a"
        assert outbox.acknowledge(job, f"receipt-{index}")
        if index < len(windows) - 1:
            assert outbox.manual_status("history-long")["status"] == "queued"
        else:
            assert outbox.manual_status("history-long")["status"] == "staged"
    assert not outbox.has_pending_manual()
    assert outbox.enqueue_manual_series(windows, owner_id="owner-a") == first
    with pytest.raises(SourceOutboxError, match="manual_import_conflict"):
        outbox.enqueue_manual_series(windows, owner_id="owner-b")
    altered = _messages(300)
    altered[143]["content"] = "different previously imported content"
    with pytest.raises(SourceOutboxError, match="manual_import_conflict"):
        outbox.enqueue_manual_series(history._snapshot_windows("profile-a", "history-long", altered),
                                     owner_id="owner-a")


def test_extensions_wait_for_predecessor_and_do_not_exhaust_processing_retry_budget(tmp_path):
    outbox = _outbox(tmp_path)
    windows = history._snapshot_windows("profile-a", "history-long", _messages(260))
    outbox.enqueue_manual_series(windows, owner_id="owner-a")
    job = outbox.next_job(manual_only=True)
    assert outbox.fail_manual(job, "source_import_pending")
    assert outbox.manual_status("history-long")["status"] == "queued"
    assert outbox.next_job(manual_only=True) is None
    # The first window's wait must not allow the second window to overtake it.
    with outbox._transaction() as db:
        state = db.execute("SELECT manual_attempts FROM source_jobs WHERE key=?", (job.idempotency_key,)).fetchone()
    assert state[0] == 0
    assert outbox.has_pending_manual()


def test_manual_delivery_queue_accepts_more_than_one_window(tmp_path, monkeypatch):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="principal-a")
    client = SimpleNamespace(read_source_status=lambda _sid: {
        "state": "none", "owner_id": None, "snapshot_digest": None, "receipt": None
    })
    monkeypatch.setattr(manual_delivery, "ensure_manual_worker", lambda *_: None)
    windows = history._snapshot_windows("profile-a", "history-long", _messages(300))
    result = manual_delivery.queue_imports(settings, client, "owner-a", [windows])
    assert result["history-long"]["status"] == "queued"
    assert _outbox(tmp_path).manual_status("history-long")["status"] == "queued"
