"""Explicit selected-session delivery through the signed host source lane."""

from threading import Lock

from .client import HostUnavailable
from .outbox import SourceOutbox, SourceOutboxError
from .source import SourceSnapshot
from .source_worker import SourceWorker
from .validation import ContractError, identifier, require, sequence


_MAX_IMPORTS = 16
_MAX_WORKERS = 8
_WORKERS = {}
_WORKERS_LOCK = Lock()


def _outbox(settings):
    return SourceOutbox(settings.state_dir, settings.profile_id, settings.principal_id)


def ensure_manual_worker(settings, client):
    """Resume only already-confirmed jobs, using an independent client and scoped lease."""
    if not _outbox(settings).has_pending_manual():
        return
    key = (settings.state_dir, settings.profile_id, settings.principal_id)
    with _WORKERS_LOCK:
        for prior in tuple(_WORKERS):
            if not _WORKERS[prior].running:
                del _WORKERS[prior]
        if key not in _WORKERS:
            if len(_WORKERS) >= _MAX_WORKERS:
                raise SourceOutboxError("manual_worker_unavailable")
            _WORKERS[key] = SourceWorker(settings, client.independent(), manual_only=True)


def _result(session_id, status, reason=None, *, retryable=False):
    return {"session_id": session_id, "status": status, "reason": reason, "retryable": retryable}


def _remote_status(client, session_id, *, reconnect=False):
    try:
        return client.read_source_status(session_id)
    except HostUnavailable:
        if reconnect:
            try:
                client.connect_dashboard(None)
                return client.read_source_status(session_id)
            except HostUnavailable:
                pass
        return None


def queue_imports(settings, client, owner_id: str,
                  snapshots: list[SourceSnapshot | list[SourceSnapshot]]) -> dict[str, dict]:
    """Queue complete per-session window sequences under one signed REL destination."""
    owner = identifier(owner_id)
    selected = sequence(snapshots, _MAX_IMPORTS, nonempty=True)
    batches = [item if type(item) is list else [item] for item in selected]
    require(all(batch and all(type(window) is SourceSnapshot for window in batch)
                and len({window.session_id for window in batch}) == 1 for batch in batches),
            "invalid_source_snapshot")
    require(len({batch[0].session_id for batch in batches}) == len(batches),
            "duplicate_manual_import")
    outbox = _outbox(settings)
    results = {}
    for batch in batches:
        session = batch[0].session_id
        last = batch[-1]
        try:
            require(all(window.profile_id == settings.profile_id for window in batch),
                    "source_scope_mismatch")
            prior = outbox.manual_status(session)
            remote = _remote_status(client, session)
            if remote is not None and remote["state"] == "tombstoned":
                results[session] = _result(session, "unavailable", "source_terminal")
                continue
            if remote is not None and remote["state"] == "unavailable":
                results[session] = _result(session, "unavailable", "source_status_unavailable")
                continue
            if prior is None and remote is not None and remote["receipt"] is not None:
                same = (remote["owner_id"] == owner and
                        remote["snapshot_digest"] == last.snapshot_digest)
                results[session] = (_result(session, "already_imported") if same else
                                    _result(session, "unavailable", "manual_import_conflict"))
                continue
            if prior is not None and (
                prior["owner_id"] != owner or prior["snapshot_digest"] != last.snapshot_digest
            ):
                results[session] = _result(session, "unavailable", "manual_import_conflict")
                continue
            if prior is not None and prior["receipt"] is not None:
                same = (remote is not None and remote["owner_id"] == owner and
                        remote["snapshot_digest"] == last.snapshot_digest and
                        remote["receipt"] == prior["receipt"])
                results[session] = (_result(session, "already_imported") if same else
                                    _result(session, "unavailable", "source_receipt_mismatch"))
                continue
            outbox.enqueue_manual_series(batch, owner_id=owner)
            results[session] = _result(session, "queued")
        except (SourceOutboxError, ContractError) as error:
            code = str(error)
            results[session] = _result(session, "unavailable", code,
                                       retryable=code in {"source_outbox_unavailable", "source_outbox_full"})
    try:
        ensure_manual_worker(settings, client)
    except SourceOutboxError:
        # The jobs are durable. A progress poll can resume them when a worker is available.
        pass
    return results


def import_status(settings, client, session_ids: list[str], *, resume=False) -> dict[str, dict]:
    """Read durable progress. An explicit status poll can resume confirmed queued jobs."""
    sessions = [identifier(sid) for sid in sequence(session_ids, _MAX_IMPORTS, nonempty=True)]
    require(len(set(sessions)) == len(sessions), "duplicate_manual_import")
    outbox = _outbox(settings)
    results = {}
    for session in sessions:
        local = outbox.manual_status(session)
        if local is not None and local["receipt"] is None:
            results[session] = _result(session, local["status"], local["reason"], retryable=local["retryable"])
            continue
        remote = _remote_status(client, session, reconnect=resume and local is not None)
        if remote is not None and remote["state"] in {"tombstoned", "unavailable"}:
            results[session] = _result(session, "unavailable", "source_status_unavailable")
        elif local is None:
            status = "already_imported" if remote and remote["receipt"] is not None else "available"
            results[session] = _result(session, status)
        elif remote is None:
            results[session] = _result(session, "staged")
        elif (remote["receipt"], remote["owner_id"], remote["snapshot_digest"]) != (
                local["receipt"], local["owner_id"], local["snapshot_digest"]):
            results[session] = _result(session, "unavailable", "source_receipt_mismatch")
        else:
            results[session] = _result(session, remote["state"])
    if resume and any(item["status"] == "queued" for item in results.values()):
        try:
            ensure_manual_worker(settings, client)
        except SourceOutboxError:
            pass
    return results
