"""Explicit selected-session delivery through the signed host source lane."""

from .client import HostUnavailable
from .outbox import SourceOutbox, SourceOutboxError
from .source import SourceSnapshot
from .source_worker import SourceWorker
from .validation import ContractError, identifier, require, sequence
from threading import Lock

_MAX_IMPORTS = 16
_MAX_WORKERS = 8
_WORKERS = {}
_WORKERS_LOCK = Lock()


def ensure_manual_worker(settings, client):
    """Start or reuse one profile-owned queue worker; it only drains durable jobs."""
    key = (str(settings.state_dir), settings.profile_id, settings.principal_id)
    with _WORKERS_LOCK:
        worker = _WORKERS.get(key)
        if worker is not None:
            return worker
        if len(_WORKERS) >= _MAX_WORKERS:
            raise RuntimeError("manual_worker_limit")
        worker = SourceWorker(settings, client.independent(), manual_only=True)
        _WORKERS[key] = worker
        return worker


def _outbox(settings):
    return SourceOutbox(settings.state_dir, settings.profile_id, settings.principal_id)


def _result(session_id, status, *, reason=None, retryable=False, receipt=None, import_id=None):
    return {"session_id": session_id, "status": status, "reason": reason,
            "retryable": retryable, "receipt": receipt, "import_id": import_id}


def queue_imports(settings, client, owner_id: str, snapshots: list[SourceSnapshot]) -> dict[str, dict]:
    """Durably queue explicit, server-trusted snapshots for one configured REL.

    The authenticated dashboard adapter must build the snapshots from the active
    Hermes profile and verify their source provenance before calling this method.
    This method never attaches or switches a live session route.
    """
    owner = identifier(owner_id)
    selected = sequence(snapshots, _MAX_IMPORTS, nonempty=True)
    require(len({snapshot.session_id for snapshot in selected if type(snapshot) is SourceSnapshot}) == len(selected),
            "duplicate_manual_import")
    outbox = _outbox(settings)
    delivery_client = client.independent()
    results = {}
    queued_any = False
    for snapshot in selected:
        session = getattr(snapshot, "session_id", "")
        try:
            require(type(snapshot) is SourceSnapshot, "invalid_source_snapshot")
            require(snapshot.profile_id == settings.profile_id, "source_scope_mismatch")
            snapshot.require_current()
            prior = outbox.manual_status(snapshot.session_id)
            if prior is not None and prior["receipt"] is not None:
                if prior["owner_id"] == owner and prior["snapshot_digest"] == snapshot.snapshot_digest:
                    results[session] = _result(session, "already_imported", receipt=prior["receipt"],
                                               import_id=prior.get("import_id"))
                    continue
                results[session] = _result(session, "unavailable", reason="manual_import_conflict")
                continue
            lease_id, reconciliation = delivery_client.add_runtime_scope(snapshot.session_id)
            outbox.enqueue_manual(snapshot, owner_id=owner, lease_id=lease_id,
                                  fence_epoch=reconciliation.get(snapshot.session_id))
            results[session] = _result(session, "queued")
            queued_any = True
        except (SourceOutboxError, ContractError, HostUnavailable) as error:
            reason = str(error)
            results[session] = _result(session, "unavailable", reason=reason,
                                       retryable=reason in {"source_outbox_unavailable", "source_outbox_full",
                                                           "host_unavailable", "host_timeout"})
    if queued_any:
        try:
            ensure_manual_worker(settings, delivery_client)
        except RuntimeError:
            for session, status in results.items():
                if status["status"] == "queued":
                    results[session] = _result(session, "unavailable", reason="manual_worker_unavailable", retryable=True)
    return results


def import_status(settings, client, session_ids: list[str]) -> dict[str, dict]:
    """Read durable outbox receipts for selected sessions without enqueueing work."""
    sessions = sequence(session_ids, _MAX_IMPORTS, nonempty=True)
    require(len({identifier(session) for session in sessions}) == len(sessions), "duplicate_manual_import")
    outbox = _outbox(settings)
    results = {}
    for session in sessions:
        session = identifier(session)
        try:
            status = outbox.manual_status(session)
            if status is None:
                results[session] = _result(session, "available")
            elif status["receipt"] is None and status["status"] == "failed":
                results[session] = _result(session, "failed", reason=status["reason"],
                                           retryable=status["retryable"])
            elif status["receipt"] is None:
                try:
                    ensure_manual_worker(settings, client)
                    results[session] = _result(session, "queued", reason=status["reason"],
                                               retryable=status["retryable"])
                except RuntimeError:
                    results[session] = _result(session, "unavailable", reason="manual_worker_unavailable", retryable=True)
            else:
                try:
                    remote = client.read_source_status(session)
                except (HostUnavailable, AttributeError):
                    remote = {"state": "staged", "receipt": status["receipt"], "import_id": None}
                if remote["state"] in {"none", "unavailable", "tombstoned"}:
                    results[session] = _result(session, "unavailable", reason="source_status_unavailable", retryable=True)
                elif remote.get("receipt") not in {None, status["receipt"]}:
                    results[session] = _result(session, "unavailable", reason="source_receipt_mismatch")
                else:
                    state = {"staged": "staged", "processing": "processing", "complete": "complete",
                             "failed": "failed"}.get(remote["state"], "unavailable")
                    results[session] = _result(session, state, receipt=status["receipt"],
                                               import_id=remote.get("import_id"))
        except (SourceOutboxError, ContractError) as error:
            results[session] = _result(session, "unavailable", reason=str(error), retryable=True)
    return results
