"""Trusted manual import through the real outbox, signed host and Root processing."""

from hashlib import sha256
from time import monotonic, sleep

import pytest

from reliquary_hermes import history, setup
from reliquary_hermes.settings import read_settings
from test_hosted_desktop_api import _release_host
from test_hp03_host import binaries, install_setup_host, owner, setup_hosts
from test_hp03_provider import history_provider
from test_hp04_host import TEXT, _loopback_model, _processing_config, _turn


@pytest.mark.parametrize("live_attached", [False, True], ids=["standalone", "other-session-live"])
def test_selected_history_reaches_complete(
        tmp_path, binaries, history_provider, monkeypatch, setup_hosts, live_attached):
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from hermes_state import SessionDB

    binary, cli = binaries
    home = tmp_path
    rel, phy = home / "general.rel", home / "active.phy"
    rel_id = owner(cli, "rel", rel, "unspecified")
    owner(cli, "phy", phy)
    install_setup_host(home, binary)
    old_ids = ["manual-synthetic-one", "manual-synthetic-two"]
    live = "live-synthetic-session"
    originals = {}
    scope = set_hermes_home_override(home)
    try:
        with SessionDB(home / "state.db") as db:
            for session_id in old_ids:
                db.create_session(session_id, source="cli", profile_name="default")
                statement = f"Synthetic fixture rule for {session_id}."
                db.append_message(session_id, "user", statement)
                if session_id == old_ids[0] and not live_attached:
                    # Exercise native source extension across multiple verified epochs.
                    for index in range(2):
                        db.append_message(session_id, "assistant" if index % 2 else "user",
                                          f"Additional verified historical context {index}.")
                originals[session_id] = db.get_messages(session_id)
                for message in originals[session_id]:
                    monkeypatch.setitem(TEXT, message["message_uid"], message["content"])
        state = home / "reliquary"
        state.mkdir()
        with _loopback_model() as url:
            _processing_config(cli, state, url)
            assert setup.apply(home, {"main_rel": str(rel), "active_phy": str(phy)})["configured"]
            with SessionDB(home / "state.db") as db:
                db.create_session(live, source="cli", profile_name="default")
            provider = history_provider.ReliquaryMemoryProvider()
            if live_attached:
                provider.initialize(live, hermes_home=str(home))
            try:
                if live_attached:
                    deadline = monotonic() + 10
                    while provider.lifecycle_status == "connecting" and monotonic() < deadline:
                        sleep(0.05)
                    assert provider.binding is not None and provider.binding.session_id == live
                listed = history.list_sessions(home, 0, "")
                assert [owner["owner_id"] for owner in listed["destinations"]] == [rel_id]
                assert {row["session_id"] for row in listed["sessions"]} == set(old_ids)
                assert all(row["status"] == "available" for row in listed["sessions"])
                selection = {"session_ids": old_ids, "owner_id": rel_id, "confirm": True}
                queued = history.queue(home, selection)
                assert all(row["status"] in {"queued", "staged", "processing", "complete"}
                           for row in queued["sessions"]), queued
                check = {"session_ids": old_ids}
                deadline = monotonic() + 25
                while monotonic() < deadline:
                    result = history.status(home, check)
                    if all(row["status"] == "complete" for row in result["sessions"]):
                        break
                    sleep(0.15)
                assert all(row["status"] == "complete" for row in result["sessions"]), result
                again = history.queue(home, selection)
                assert all(row["status"] == "already_imported" for row in again["sessions"]), again
                if live_attached:
                    assert provider.binding.session_id == live
                with SessionDB(home / "state.db", read_only=True) as db:
                    for session_id, rows in originals.items():
                        assert db.get_messages(session_id) == rows
                with SessionDB(home / "state.db") as db:
                    db.append_message(old_ids[0], "user", "A later synthetic edit.")
                changed = history.queue(home, {**selection, "session_ids": old_ids[:1]})
                assert changed["sessions"][0]["status"] == "unavailable", changed
            finally:
                provider.shutdown()
                # A manual-only runtime may cleanly detach and stop the host
                # between the last status receipt and this cleanup check.
                discovery = state / "discovery.json"
                deadline = monotonic() + 5
                while discovery.exists() and monotonic() < deadline:
                    sleep(0.05)
                if discovery.exists():
                    _release_host(home)
        # Root opens the REL for archive inspection only after the service lease ends.
        # Oldest and newest original turns must remain inspectable in Root
        # after the signed source host has advanced through all windows.
        if not live_attached:
            profile = read_settings(home).profile_id.encode("ascii")
            session = old_ids[0]
            conversation = "hermes-copy:" + sha256(
                b"reliquary/hermes-copied-conversation/v1\0"
                + len(profile).to_bytes(8, "little") + profile
                + session.encode("ascii")
            ).hexdigest()
            for source_row in (originals[session][0], originals[session][-1]):
                observed = _turn(cli, rel, conversation, source_row["message_uid"])
                assert observed["availability"] == "available"
                assert observed["imported"]["message_id"] == source_row["message_uid"]
                assert observed["content"] == source_row["content"]
    finally:
        reset_hermes_home_override(scope)
