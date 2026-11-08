"""Contract checks for per-source terminal state."""

import pytest

from reliquary_hermes.validation import ContractError
from source_lifecycle import SourceTombstones


@pytest.mark.parametrize("event", ["archived", "deleted"])
def test_terminal_notice_tombstones_only_its_profile_session(event):
    tombstones = SourceTombstones()

    assert not tombstones.is_tombstoned("profile-a", "session-1")
    tombstones.record("profile-a", "session-1", event)
    tombstones.record("profile-a", "session-1", event)

    assert tombstones.is_tombstoned("profile-a", "session-1")
    assert not tombstones.is_tombstoned("profile-a", "session-2")
    assert not tombstones.is_tombstoned("profile-b", "session-1")


@pytest.mark.parametrize(
    ("profile_id", "session_id", "event", "error"),
    [
        ("profile-a", "session-1", "rewound", "invalid_choice"),
        ("", "session-1", "archived", "invalid_id"),
        ("profile-a", "", "deleted", "invalid_id"),
    ],
)
def test_invalid_notice_does_not_record_terminal_state(profile_id, session_id, event, error):
    tombstones = SourceTombstones()

    with pytest.raises(ContractError, match=error):
        tombstones.record(profile_id, session_id, event)

    assert not tombstones.is_tombstoned(profile_id, session_id)
