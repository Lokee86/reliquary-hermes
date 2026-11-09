"""Admit new automatic captures using the active Hermes profile's session metadata."""

import json
from math import isfinite
from sqlite3 import Error as SessionStoreError
from stat import S_ISREG
from time import time

from .settings import _read_object, _state_dir
from .validation import ContractError, identifier, obj, require


ENROLLMENT_FILE = "capture-enrollment-v1.json"
_SETUP_REQUIRED = "source_capture_setup_required"
_SESSION_UNAVAILABLE = "source_capture_session_unavailable"
_HISTORICAL = "source_capture_historical"


def capture_cutoff(home, *, enroll=False):
    """Read the private cutoff. Enrollment callers hold the profile setup lock."""
    try:
        path = _state_dir(home) / ENROLLMENT_FILE
        try:
            record = _read_object(path)
        except FileNotFoundError:
            require(enroll, _SETUP_REQUIRED)
            from utils import atomic_json_write

            record = {"version": 1, "cutoff": time()}
            atomic_json_write(path, record, mode=0o600, fsync_dir=True)
            record = _read_object(path)
        obj(record, {"version", "cutoff"})
        cutoff = record["cutoff"]
        require(type(record["version"]) is int and record["version"] == 1, _SETUP_REQUIRED)
        require(type(cutoff) in (int, float) and 0 < cutoff <= time(), _SETUP_REQUIRED)
        return cutoff
    except (OSError, RuntimeError, ValueError):
        raise ContractError(_SETUP_REQUIRED) from None


def capture_eligibility(home, session_id, cutoff):
    """Check one exact session row without reading any transcript content."""
    try:
        from hermes_constants import profile_name_for_home
        from hermes_state import SessionDB

        owner = profile_name_for_home(home)
        path = home / "state.db"
        if not owner or not S_ISREG(path.lstat().st_mode) or path.resolve(strict=True) != path:
            return _SESSION_UNAVAILABLE
        with SessionDB(path, read_only=True) as db:
            row = db.get_session(session_id)
        if row is None or row["id"] != session_id or row["profile_name"] != owner:
            return _SESSION_UNAVAILABLE
        if row["hidden"] or row["archived"] or row["source"] in {"import", "subagent", "recovered"}:
            return _SESSION_UNAVAILABLE

        started_at = row["started_at"]
        if type(started_at) not in (int, float) or not isfinite(started_at) or not 0 < started_at <= time():
            return _SESSION_UNAVAILABLE
        if started_at <= cutoff:
            return _HISTORICAL

        # A Hermes reset explicitly starts a new conversation. Other parent links
        # can carry earlier messages. The branch/delegate markers survive detachment.
        config = json.loads(row["model_config"]) if row["model_config"] is not None else {}
        require(type(config) is dict, _SESSION_UNAVAILABLE)
        if {"_branched_from", "_delegate_from"} & config.keys():
            return _HISTORICAL
        parent = row["parent_session_id"]
        if "_reset_from" in config:
            reset_from = identifier(config["_reset_from"])
            if reset_from == session_id or parent not in (None, reset_from):
                return _SESSION_UNAVAILABLE
        elif parent is not None:
            return _HISTORICAL
        return None
    except (ImportError, KeyError, OSError, OverflowError, RuntimeError, SessionStoreError, TypeError, ValueError):
        return _SESSION_UNAVAILABLE
