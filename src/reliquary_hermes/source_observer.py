"""Durable capture of Hermes post-commit source lifecycle notifications."""

import logging

from .outbox import MAX_TERMINAL_BATCH, SourceOutbox, SourceOutboxError
from .settings import OWNER_FIELDS, _read_object, _state_dir, profile_home
from .validation import ContractError, identifier, require, sequence


OBSERVER_NAME = "reliquary-source-observer"
_LOG = logging.getLogger(__name__)


def register(context):
    """Install the observer even in Hermes commands with no active conversation."""
    context.register_hook("on_session_delete", on_session_delete)


def on_session_delete(*, session_id, reason, profile, deleted_ids=None, **_):
    """Record a terminal source fence in the affected Hermes profile before returning."""
    if type(reason) is not str or reason not in {"archive", "delete"}:
        return
    try:
        from hermes_constants import get_hermes_home, profile_name_for_home

        home = profile_home(get_hermes_home())
        require(type(profile) is str and profile == profile_name_for_home(home), "profile_scope_mismatch")
        state = _state_dir(home)
        owners = _read_object(state / "owners.json")
        require(OWNER_FIELDS <= set(owners) <= OWNER_FIELDS | {"session_projects"}, "invalid_owner_config")
        primary = identifier(session_id)
        ids = [primary] if deleted_ids is None else sequence(deleted_ids, MAX_TERMINAL_BATCH, nonempty=True)
        require(primary in ids, "invalid_terminal_sessions")
        outbox = SourceOutbox(state, identifier(owners["profile_id"]), identifier(owners["principal_id"]))
        outbox.terminal_many(ids, reason)
    except (ContractError, OSError, SourceOutboxError):
        # No transcript, filesystem path, or private profile data enters Hermes logs.
        _LOG.warning("Reliquary source lifecycle could not persist an archive or delete notice")
