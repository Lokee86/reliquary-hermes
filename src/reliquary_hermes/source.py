"""Hermes-source copied snapshots, never live Gateway turns or resume authority."""

from dataclasses import dataclass
from typing import Any

from .validation import choice, content_digest, digest, identifier, obj, require, sequence, text


@dataclass(frozen=True)
class SourceSnapshot:
    """Untrusted shape-checked snapshot candidate, not verified Hermes provenance.

    The authority marker, availability claim and digest confer no source authority.
    Only the future supported trusted source adapter can verify/register a candidate.
    """
    profile_id: str
    session_id: str
    branch_id: str | None
    source_revision: str | None
    snapshot_digest: str
    messages_json: bytes
    availability: str

    @classmethod
    def parse(cls, value: Any) -> "SourceSnapshot":
        from .validation import canonical
        v = obj(value, {"authority", "profile_id", "session_id", "branch_id", "source_revision",
                        "snapshot_digest", "availability", "messages"})
        require(v["authority"] == "hermes_source_copied_snapshot", "invalid_authority")
        profile, session = identifier(v["profile_id"]), identifier(v["session_id"])
        branch = None if v["branch_id"] is None else identifier(v["branch_id"])
        revision = None if v["source_revision"] is None else identifier(v["source_revision"])
        availability = choice(v["availability"], {"current", "unavailable", "stale", "deleted"})
        messages = sequence(v["messages"], 128)
        ids = set()
        for message in messages:
            m = obj(message, {"message_uid", "role", "timestamp", "content", "author"})
            uid = identifier(m["message_uid"])
            require(uid not in ids, "duplicate_source_id")
            ids.add(uid)
            choice(m["role"], {"user", "assistant", "system", "tool"})
            # Keep the host's original epoch value, with no invented wall-clock conversion.
            require(type(m["timestamp"]) in {int, float}, "missing_source_timestamp")
            canonical(m["timestamp"])
            require(m["timestamp"] >= 0, "invalid_source_timestamp")
            text(m["content"], 32768, blank=True)  # text-only v1; never coerce multimodal
            a = obj(m["author"], {"id", "is_bot"})
            if a["id"] is not None:
                identifier(a["id"])
            require(type(a["is_bot"]) is bool or a["is_bot"] is None, "invalid_actor")
        expected = content_digest({"profile_id": profile, "session_id": session, "branch_id": branch,
                                   "source_revision": revision, "messages": messages})
        require(digest(v["snapshot_digest"]) == expected, "source_digest_mismatch")
        require(availability == "current" or not messages, "unavailable_source_content")
        return cls(profile, session, branch, revision, expected, canonical(messages), availability)

    def require_current(self) -> None:
        """Check the claimed state only; this does not authenticate current source data."""
        require(self.availability == "current", "source_unavailable")
