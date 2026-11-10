"""Profile-owned metadata and explicitly selected Hermes source exports."""

from math import isfinite
from threading import BoundedSemaphore
from time import sleep

from .capture_policy import capture_cutoff, history_supported, open_session_store
from .client import HostClient, HostUnavailable
from .settings import read_settings, read_token
from .source_capture import capture_snapshot
from .validation import ContractError, identifier, integer, obj, require, sequence, text


_PAGE_SIZE = 16
_OFFSET_LIMIT = 10_000
_SELECTION_LIMIT = 8
_MESSAGE_LIMIT = 128
_INTERNAL_SOURCES = frozenset({"cron", "kanban", "oneshot", "recovered", "subagent", "tool"})
_EMPTY_PAGE = {"available": False, "destinations": [], "sessions": [], "next_offset": None}
_STATUS = {"available", "queued", "staged", "processing", "complete", "failed", "already_imported", "unavailable"}
_EXPORT_SLOTS = BoundedSemaphore(2)


def _client(home):
    from .setup import status

    require(status(home)["configured"], "sources_setup_required")
    settings = read_settings(home)
    return settings, HostClient(settings.state_dir, settings.profile_id, settings.principal_id,
                                read_token(home), binary=settings.binary)


def _destinations(client):
    # A manual-only runtime can cleanly detach just as the dashboard refreshes.
    # Each attempt still requires a fresh signed topology from the profile host.
    for attempt in range(4):
        try:
            owners = client.connect_dashboard(None)["owners"]
            break
        except HostUnavailable as error:
            if attempt == 3 or str(error) not in {"host_closing", "host_unavailable", "invalid_host_response"}:
                raise
            sleep(0.15 * (attempt + 1))
    return [{"owner_id": owner["owner_id"],
             "label": "General REL" if owner["display_label"] == "Main REL" else owner["display_label"]}
            for owner in owners if owner["owner_kind"] == "REL"
            and owner["capabilities"]["view"] and owner["capabilities"]["manage"]]


def _epoch(value):
    return type(value) in (int, float) and isfinite(value) and 0 < value < (1 << 63) / 1_000_000_000


def _visible(row, owner, session_id, cutoff):
    return (row is not None and row["id"] == session_id and row["profile_name"] == owner
            and row["source"] not in _INTERNAL_SOURCES and not row["hidden"] and not row["archived"]
            and _epoch(row["started_at"]) and row["started_at"] <= cutoff)


def _view(session_id, status, reason=None, *, retryable=False):
    return {"session_id": session_id, "status": status, "reason": reason, "retryable": retryable}


def _status_view(session_id, value):
    if value is None:
        return _view(session_id, "available")
    require(value["session_id"] == session_id and value["status"] in _STATUS
            and type(value["retryable"]) is bool, "invalid_source_status")
    reason = value["reason"]
    if reason is not None:
        identifier(reason)
    return _view(session_id, value["status"], reason, retryable=value["retryable"])


def _list_row(row, owner, cutoff):
    try:
        session_id = identifier(row["id"])
        if not _visible(row, owner, session_id, cutoff):
            return None
        if row["parent_session_id"] and row.get("_reset_from") != row["parent_session_id"]:
            return None
        if row.get("_branched_from") or row.get("_delegate_from"):
            return None
        count = integer(row["message_count"])
        if count == 0:
            return None
        title = row["title"]
        title = title[:160].strip() if type(title) is str else ""
        last_active = row.get("last_active")
        return {"session_id": session_id, "title": text(title or "Untitled session", 640),
                "started_at": row["started_at"],
                "last_activity_at": last_active if _epoch(last_active) else row["started_at"],
                "message_count": count, "project_name": None}
    except (ContractError, KeyError, OverflowError):
        return None


def list_sessions(home, offset, q):
    offset = integer(offset, 0, _OFFSET_LIMIT)
    query = text(q, 512, blank=True).strip()
    require(len(query) <= 128, "history_query_too_long")
    if not history_supported():
        return _EMPTY_PAGE
    from .manual_delivery import import_status

    settings, client = _client(home)
    cutoff = capture_cutoff(home)
    destinations = _destinations(client)
    try:
        with open_session_store(home) as (owner, db):
            rows = db.list_sessions_rich(
                limit=_PAGE_SIZE + 1, offset=offset, search_query=query or None,
                min_message_count=1, order_by_last_active=True, project_compression_tips=False,
                exclude_sources=sorted(_INTERNAL_SOURCES),
            )
            sessions = [entry for row in rows[:_PAGE_SIZE] if (entry := _list_row(row, owner, cutoff))]
    except FileNotFoundError:
        sessions, rows = [], []
    statuses = import_status(settings, client, [row["session_id"] for row in sessions]) if sessions else {}
    for entry in sessions:
        session_id = entry["session_id"]
        entry.update(_status_view(session_id, statuses.get(session_id)))
        if entry["status"] == "available" and entry["message_count"] > _MESSAGE_LIMIT:
            entry.update(_view(session_id, "unavailable", "history_too_large"))
    next_offset = offset + _PAGE_SIZE
    return {"available": True, "destinations": destinations, "sessions": sessions,
            "next_offset": next_offset if len(rows) > _PAGE_SIZE and next_offset <= _OFFSET_LIMIT else None}


def _session_ids(value):
    ids = [identifier(session) for session in sequence(value, _SELECTION_LIMIT, nonempty=True)]
    require(len(ids) == len(set(ids)), "duplicate_session_selection")
    return ids


def _snapshot(db, owner, profile_id, session_id, cutoff):
    """Read and normalize the installed host's redacted copy, never browser content."""
    row = db.get_session(session_id)
    require(_visible(row, owner, session_id, cutoff), "history_session_unavailable")
    exported = db.export_history(session_id, profile_id=owner, max_messages=_MESSAGE_LIMIT)
    require(type(exported) is dict, "history_session_unavailable")
    if exported.get("status") != "ready":
        reason = exported.get("reason")
        require(False, reason if reason in {"history_too_large", "history_unsupported",
                                           "history_identity_unavailable", "history_session_unavailable"}
                else "history_session_unavailable")
    require(exported["profile_id"] == owner and exported["session_id"] == session_id
            and exported["started_at"] == row["started_at"], "history_session_unavailable")
    return capture_snapshot(profile_id, session_id, exported["messages"])


def queue(home, value):
    require(_EXPORT_SLOTS.acquire(blocking=False), "history_import_busy")
    try:
        return _queue(home, value)
    finally:
        _EXPORT_SLOTS.release()


def _queue(home, value):
    from .manual_delivery import queue_imports

    request = obj(value, {"session_ids", "owner_id", "confirm"})
    require(request["confirm"] is True, "history_confirmation_required")
    ids = _session_ids(request["session_ids"])
    owner_id = identifier(request["owner_id"])
    require(history_supported(), "history_export_unavailable")
    settings, client = _client(home)
    require(owner_id in {item["owner_id"] for item in _destinations(client)}, "history_destination_denied")
    cutoff = capture_cutoff(home)
    snapshots, outcomes = [], {}
    try:
        with open_session_store(home) as (owner, db):
            for session_id in ids:
                try:
                    snapshots.append(_snapshot(db, owner, settings.profile_id, session_id, cutoff))
                except ContractError as error:
                    outcomes[session_id] = _view(session_id, "unavailable", str(error))
    except FileNotFoundError:
        return {"sessions": [_view(session_id, "unavailable", "history_session_unavailable") for session_id in ids]}
    if snapshots:
        outcomes.update(queue_imports(settings, client, owner_id, snapshots))
    return {"sessions": [_status_view(session_id, outcomes[session_id]) for session_id in ids]}


def status(home, value):
    from .manual_delivery import import_status

    ids = _session_ids(obj(value, {"session_ids"})["session_ids"])
    require(history_supported(), "history_export_unavailable")
    settings, client = _client(home)
    cutoff = capture_cutoff(home)
    try:
        with open_session_store(home) as (owner, db):
            visible = {sid for sid in ids if _visible(db.get_session(sid), owner, sid, cutoff)}
    except FileNotFoundError:
        visible = set()
    statuses = import_status(settings, client, [sid for sid in ids if sid in visible], resume=True) if visible else {}
    return {"sessions": [_status_view(sid, statuses.get(sid)) if sid in visible
                         else _view(sid, "unavailable", "history_session_unavailable") for sid in ids]}
