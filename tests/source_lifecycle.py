"""Host-only lifecycle state for deterministic copied-source fixtures."""

from reliquary_hermes.validation import choice, identifier


class SourceTombstones:
    """Monotone within one fake host; no durable lifecycle feed is implied."""

    def __init__(self) -> None:
        self._sources: set[tuple[str, str]] = set()

    def record(self, profile_id: str, session_id: str, event: str) -> None:
        choice(event, {"archived", "deleted"})
        self._sources.add((identifier(profile_id), identifier(session_id)))

    def is_tombstoned(self, profile_id: str, session_id: str) -> bool:
        return (profile_id, session_id) in self._sources
