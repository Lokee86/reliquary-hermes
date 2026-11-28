"""Build a bounded source view from the pinned Hermes provider's redacted callback."""

from hashlib import sha256

from .source import SourceSnapshot
from .validation import ContractError, MAX_WIRE_BYTES, canonical, choice, identifier, require, sequence, text


# Product Archive times are nonnegative i64 nanoseconds.
_EPOCH_SECONDS_LIMIT = (1 << 63) / 1_000_000_000


def turn_attribution_supported():
    from agent import memory_provider

    version = getattr(memory_provider, "COPIED_TURN_ATTRIBUTION_VERSION", None)
    return type(version) is int and version == 1


def _completed_author(source_turn, turn_author, principal_id, rows):
    if not turn_attribution_supported() or type(source_turn) is not dict:
        return None
    uid = source_turn.get("message_uid")
    if not any(row["message_uid"] == uid and row["role"] == "user" for row in rows):
        return None
    author = turn_author if type(turn_author) is dict else {}
    bot = author.get("is_bot")
    if source_turn.get("profile_owner") is True and bot is not True:
        return {"message_uid": uid, "id": identifier(principal_id),
                "is_bot": False, "profile_owner": True}
    try:
        actor = identifier(author.get("id"))
    except ContractError:
        actor = None
    return {"message_uid": uid, "id": actor, "is_bot": bot if type(bot) is bool else None,
            "profile_owner": False}


def capture_snapshot(profile_id: str, session_id: str, messages, *, after=None, source_turn=None,
                     turn_author=None, principal_id=None) -> SourceSnapshot:
    """Copy one callback's text and logical markers without inventing source evidence."""
    profile_id, session_id = identifier(profile_id), identifier(session_id)
    rows = []
    for message in sequence(messages, 128, nonempty=True):
        require(type(message) is dict, "invalid_source_message")
        content = text(message.get("content"), 32768, blank=True)
        # Hermes provider egress deliberately passes inline media data URLs through.
        require(not content.lstrip().lower().startswith("data:"), "unsupported_source_content")
        timestamp = message.get("timestamp")
        require(type(timestamp) in {int, float} and 0 <= timestamp < _EPOCH_SECONDS_LIMIT,
                "invalid_source_timestamp")
        if after is not None:
            # A detached compression segment may contain a newly timestamped
            # summary of historical rows. Hermes supplies the summary marker.
            require(timestamp > after and not message.get("_compressed_summary"),
                    "source_capture_historical")
        rows.append({
            "message_uid": identifier(message.get("message_uid")),
            "role": choice(message.get("role"), {"user", "assistant", "system", "tool"}),
            "timestamp": timestamp,
            "content": content,
            # A separate witness identifies only the current committed turn.
            # Historical rows are copied in the same form on later callbacks.
            "author": {"id": None, "is_bot": None},
        })
    source = {"profile_id": profile_id, "session_id": session_id, "branch_id": None,
              "source_revision": None, "messages": rows}
    witness = _completed_author(source_turn, turn_author, principal_id, rows)
    if witness is not None:
        source["turn_author"] = witness
    source_json = canonical(source)
    snapshot_digest = sha256(source_json).hexdigest()
    candidate = {**source, "authority": "hermes_source_copied_snapshot", "availability": "current",
                 "snapshot_digest": snapshot_digest}
    arguments = {"source_json": source_json.decode("utf-8"), "snapshot_digest": snapshot_digest}
    # The private source wire embeds the canonical view as a string. Bound its
    # escaped representation as well as the durable outbox payload.
    require(max(len(canonical(candidate)), len(canonical(arguments))) <= MAX_WIRE_BYTES - 4096,
            "source_copy_limit")
    return SourceSnapshot.parse(candidate)
