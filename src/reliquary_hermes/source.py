"""Hermes-source copied snapshots, never live Gateway turns or resume authority."""

from dataclasses import dataclass
from typing import Any

from .validation import choice, content_digest, digest, identifier, obj, require, sequence, text


def source_document(value):
    """Return the source fields signed by the outbox digest."""
    view = {key: value[key] for key in ("profile_id", "session_id", "branch_id",
                                         "source_revision", "messages")}
    if "turn_author" in value:
        view["turn_author"] = value["turn_author"]
    return view


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
    turn_author_json: bytes | None = None

    @classmethod
    def parse(cls, value: Any) -> "SourceSnapshot":
        from .validation import canonical
        fields = {"authority", "profile_id", "session_id", "branch_id", "source_revision",
                  "snapshot_digest", "availability", "messages"}
        if type(value) is dict and "turn_author" in value:
            fields.add("turn_author")
        v = obj(value, fields)
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
        turn_author = None
        if "turn_author" in v:
            witness = obj(v["turn_author"], {"message_uid", "id", "is_bot", "profile_owner"})
            uid = identifier(witness["message_uid"])
            require(any(m["message_uid"] == uid and m["role"] == "user" for m in messages),
                    "invalid_turn_author")
            if witness["id"] is not None:
                identifier(witness["id"])
            require(type(witness["profile_owner"]) is bool
                    and (witness["is_bot"] is None or type(witness["is_bot"]) is bool)
                    and (not witness["profile_owner"]
                         or (witness["id"] is not None and witness["is_bot"] is False)),
                    "invalid_turn_author")
            turn_author = canonical(witness)
        expected = content_digest(source_document(v))
        require(digest(v["snapshot_digest"]) == expected, "source_digest_mismatch")
        require(availability == "current" or not messages, "unavailable_source_content")
        return cls(profile, session, branch, revision, expected, canonical(messages), availability, turn_author)

    def require_current(self) -> None:
        """Check the claimed state only; this does not authenticate current source data."""
        require(self.availability == "current", "source_unavailable")
