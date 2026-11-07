"""Proposed handoff-v1 fixture reducer. It is NOT a current Hermes hook or receipt writer."""

from dataclasses import dataclass

from .validation import content_digest, digest, identifier, require, text


def confirmation_key(delivery_id: str, manifest_digest: str) -> str:
    """The reserved receipt key is stable for one exact prepared batch."""
    identifier(delivery_id)
    digest(manifest_digest)
    return content_digest({"delivery_id": delivery_id, "manifest_digest": manifest_digest})


@dataclass(frozen=True)
class TurnScope:
    profile_id: str
    principal_id: str
    session_id: str
    turn_id: str
    epoch: int

    def __post_init__(self) -> None:
        from .validation import integer
        for v in (self.profile_id, self.principal_id, self.session_id, self.turn_id):
            identifier(v)
        integer(self.epoch)


@dataclass(frozen=True)
class PreparedDelivery:
    delivery_id: str
    scope: TurnScope
    cut: str
    memory_ids: tuple[str, ...]
    context: str
    source_snapshot_digests: tuple[str, ...]

    def __post_init__(self) -> None:
        identifier(self.delivery_id)
        identifier(self.cut)
        require(type(self.scope) is TurnScope, "invalid_scope")
        require(type(self.memory_ids) is tuple and 0 < len(self.memory_ids) <= 50, "invalid_manifest")
        require(len(set(self.memory_ids)) == len(self.memory_ids), "duplicate_id")
        for v in self.memory_ids:
            identifier(v)
        text(self.context, 32768)
        require(type(self.source_snapshot_digests) is tuple and 0 < len(self.source_snapshot_digests) <= 50, "invalid_manifest")
        for v in self.source_snapshot_digests:
            digest(v)

    @property
    def manifest_digest(self) -> str:
        from dataclasses import asdict
        return content_digest(asdict(self))


@dataclass(frozen=True)
class HandoffEvent:
    """Trusted adapter-only terminal callback proposal, never a model/tool result.

    content_part is the exact decoded UTF-8 component presented to the model after
    transport transforms. Span offsets are bytes, not characters. Unknown acceptance,
    incomplete payload visibility, or a later replacement requires outcome=uncertain.
    """
    event_id: str
    attempt_id: str
    scope: TurnScope
    outcome: str
    final_request_digest: str | None
    delivery_id: str
    manifest_digest: str
    content_part: bytes
    span_start: int
    span_end: int


@dataclass(frozen=True)
class Decision:
    status: str
    receipt_key: str | None = None


def evaluate_handoff(prepared: PreparedDelivery, event: HandoffEvent, *, active_scope: TurnScope,
                     hook_api_version: int | None, active_cut: str | None, source_available: bool = True) -> Decision:
    """Return a pure decision; host must durably deduplicate its receipt key atomically.

    Callers may not enable the proposal for the pinned host. The fake uses version 1
    only to specify future required behavior, independently of any Hermes core work.
    """
    if type(hook_api_version) is not int or hook_api_version != 1:
        return Decision("unavailable")
    if type(source_available) is not bool or not source_available:
        return Decision("source_unavailable")
    if type(event) is not HandoffEvent or type(event.scope) is not TurnScope:
        return Decision("invalid")
    if prepared.scope != active_scope or event.scope != active_scope or prepared.cut != active_cut:
        return Decision("stale")
    if type(event.outcome) is not str or event.outcome not in {"accepted", "failed", "cancelled", "uncertain", "replaced", "omitted"}:
        return Decision("invalid")
    if event.outcome != "accepted":
        return Decision(event.outcome)
    from .validation import ContractError
    try:
        identifier(event.event_id)
        identifier(event.attempt_id)
        digest(event.final_request_digest)
        digest(event.manifest_digest)
    except ContractError:
        return Decision("invalid")
    if (event.delivery_id, event.manifest_digest) != (prepared.delivery_id, prepared.manifest_digest):
        return Decision("manifest_mismatch")
    start, end, part = event.span_start, event.span_end, event.content_part
    if (type(part) is not bytes or len(part) > 262144 or type(start) is not int or type(end) is not int or
            not 0 <= start < end <= len(part)):
        return Decision("invalid")
    try:
        part.decode("utf-8")
    except UnicodeDecodeError:
        return Decision("invalid")
    if part[start:end] != prepared.context.encode("utf-8"):
        return Decision("content_mismatch")
    # Stable across retries/events: one prepared manifest earns at most one receipt.
    return Decision("confirmed", confirmation_key(prepared.delivery_id, prepared.manifest_digest))
