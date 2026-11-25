"""Replay the pinned Hermes authority without reading transcript bodies."""

from sqlite3 import Error as SQLiteError

from .capture_policy import open_session_store
from .outbox import SourceOutboxError
from .validation import require


def removals_supported():
    try:
        from hermes_state import SessionDB
    except ImportError:
        return False
    return (getattr(SessionDB, "TRANSCRIPT_REMOVALS_VERSION", None) == 1
            and callable(getattr(SessionDB, "committed_transcript_removals", None)))


def reconcile_removals(outbox, home):
    """Queue committed notices in order. A missing store is empty only before the first receipt."""
    supported = removals_supported()
    legacy = outbox.quarantined_archive_sessions()
    if not supported and not legacy:
        return
    cursor, event_id = outbox.removal_cursor()
    try:
        with open_session_store(home) as (_, store):
            if supported and cursor:
                previous = store.committed_transcript_removals(after_sequence=cursor - 1, limit=1)
                require(bool(previous) and (previous[0]["sequence"], previous[0]["event_id"]) == (cursor, event_id),
                        "source_removal_stream_changed")
            while supported:
                receipts = store.committed_transcript_removals(after_sequence=cursor)
                if not receipts:
                    break
                outbox.apply_committed_removals(receipts)
                if len(receipts) < 128:
                    break
                cursor = receipts[-1]["sequence"]
            # A still-existing row distinguishes a legacy archive from a
            # potentially coalesced delete. Missing rows need committed proof.
            outbox.release_legacy_archives([session for session in legacy if store.get_session(session) is not None])
    except FileNotFoundError:
        if cursor:
            raise SourceOutboxError("source_removal_stream_changed") from None
    except (SQLiteError, OSError, RuntimeError) as error:
        if isinstance(error, SourceOutboxError):
            raise
        raise SourceOutboxError("source_removal_authority_unavailable") from None


def reconcile_configured_removals(outbox, settings):
    state = settings.state_dir
    if state.name == "reliquary":
        reconcile_removals(outbox, state.parent)
