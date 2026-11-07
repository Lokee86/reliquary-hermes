from dataclasses import replace

from fakes import FakeImports
from reliquary_hermes.protocol import Request
from reliquary_hermes.validation import canonical
from test_protocol import request, snapshot


def import_request():
    return Request.parse(canonical(request("snapshot_submit", snapshot())))


def test_no_checkpoint_or_clock_before_durable_acceptance():
    host = FakeImports()
    assert host.submit(import_request(), durable=False) == ("unavailable", None)
    assert not host.idempotency and not host.snapshots and host.revision == 1
    assert host.submit(import_request(), durable=True) == ("ok", "import-1")
    assert host.revision == 2


def test_replay_and_new_request_id_return_same_receipt_without_clock_duplication():
    host = FakeImports()
    first = import_request()
    assert host.submit(first, durable=True) == host.submit(first, durable=True)
    retry = replace(first, request_id="retry-request")
    assert host.submit(retry, durable=True) == ("ok", "import-1")
    assert len(host.snapshots) == 1 and host.revision == 2


def test_different_idempotency_key_same_snapshot_does_not_double_publish():
    host = FakeImports()
    first = import_request()
    host.submit(first, durable=True)
    replay = replace(first, request_id="new-request", idempotency_key="new-key", expected_revision="host-rev-2")
    assert host.submit(replay, durable=True) == ("ok", "import-1")
    assert len(host.snapshots) == 1 and host.revision == 2


def test_idempotency_key_cannot_change_turn_or_payload():
    host = FakeImports()
    first = import_request()
    host.submit(first, durable=True)
    assert host.submit(replace(first, turn_id="other-turn"), durable=True) == ("conflict", None)
    assert host.revision == 2 and len(host.snapshots) == 1


def test_stale_revision_conflicts_before_durable_acceptance():
    host = FakeImports()
    stale = replace(import_request(), expected_revision="host-rev-0")
    assert host.submit(stale, durable=True) == ("conflict", None)
    assert not host.snapshots and host.revision == 1
