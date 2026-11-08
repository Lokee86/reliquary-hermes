"""Build a bounded source view from the pinned Hermes provider's redacted callback."""

from .source import SourceSnapshot
from .validation import MAX_WIRE_BYTES, canonical, choice, content_digest, identifier, require, sequence, text


# Product Archive times are nonnegative i64 nanoseconds.
_EPOCH_SECONDS_LIMIT = (1 << 63) / 1_000_000_000


def capture_snapshot(profile_id: str, session_id: str, messages) -> SourceSnapshot:
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
        rows.append({
            "message_uid": identifier(message.get("message_uid")),
            "role": choice(message.get("role"), {"user", "assistant", "system", "tool"}),
            "timestamp": timestamp,
            "content": content,
            # The pinned persistence callback has no trusted per-row author field.
            "author": {"id": None, "is_bot": None},
        })
    source = {"profile_id": profile_id, "session_id": session_id, "branch_id": None,
              "source_revision": None, "messages": rows}
    candidate = {**source, "authority": "hermes_source_copied_snapshot", "availability": "current",
                 "snapshot_digest": content_digest(source)}
    # Leave space for the bounded provider request envelope and scoped IDs.
    require(len(canonical(candidate)) <= MAX_WIRE_BYTES - 2048, "source_copy_limit")
    return SourceSnapshot.parse(candidate)
