"""HU08 capture with isolated Hermes state and the real signed source host."""

import importlib
import json
from pathlib import Path
from time import monotonic, sleep, time
from types import SimpleNamespace

from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import read_settings
from reliquary_hermes.source_capture import capture_snapshot
from test_hp03_host import binaries, install_setup_host, owner, setup_hosts


def _wait(predicate, *, timeout=15):
    deadline = monotonic() + timeout
    while not predicate() and monotonic() < deadline:
        sleep(0.02)
    assert predicate(), "timed out waiting for installed provider state"


def _persist_turn(db, session_id, content):
    """Persist synthetic messages through Hermes' real UID-assignment path."""
    from agent.session_persistence import _db_flush_row, _db_flush_write

    messages = [
        {"role": "user", "content": content, "timestamp": time()},
        {"role": "assistant", "content": "Synthetic acceptance acknowledgement.",
         "timestamp": time()},
    ]
    agent = SimpleNamespace(_session_db=db, session_id=session_id)
    rows = [_db_flush_row(agent, message, message["role"] == "user") for message in messages]
    _db_flush_write(agent, rows, messages, messages)
    durable = db.get_messages(session_id)[-2:]
    assert len(durable) == 2
    assert all(row.get("message_uid") for row in durable)
    assert len({row["message_uid"] for row in durable}) == 2
    assert [row["timestamp"] for row in durable] == [row["timestamp"] for row in messages]
    return durable


def test_hu08_installed_automatic_capture_is_new_root_only(
        tmp_path, binaries, history_checkout, monkeypatch, setup_hosts):
    """Old resume/branch/compression continuation stay silent; a fresh root is durable."""
    binary, cli = binaries
    home = tmp_path / "isolated-hermes-profile"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("RELIQUARY_CONFIG_PATH", raising=False)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))

    monkeypatch.syspath_prepend(str(history_checkout))
    from agent import memory_manager
    from agent.memory_manager import MemoryManager

    assert Path(memory_manager.__file__).is_relative_to(history_checkout)
    provider_module = importlib.import_module("reliquary_hermes.provider")
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from hermes_state import SessionDB

    # The old roots predate enrollment. Their children are created below after setup.
    old = "hu08-synthetic-old-root"
    compression_parent = "hu08-synthetic-compression-parent"
    rotated = "hu08-synthetic-compression-child"
    with SessionDB(home / "state.db") as db:
        db.create_session(old, source="cli", profile_name="default")
        old_rows = _persist_turn(db, old, "Synthetic pre-enrollment implementation note.")
        db.end_session(old, "branch")
        db.create_session(compression_parent, source="cli", profile_name="default")
        compression_rows = _persist_turn(db, compression_parent, "Synthetic pre-enrollment compressed root.")
        db.end_session(compression_parent, "compression")

    # Exercise the actual enrollment boundary after historical rows exist.
    rel, phy = home / "general.rel", home / "identity.phy"
    owner(cli, "rel", rel, "unspecified")
    owner(cli, "phy", phy)
    install_setup_host(home, binary)
    prompts = iter((str(rel), str(phy), "", ""))
    monkeypatch.setattr("builtins.input", lambda _: next(prompts))
    setup_provider = provider_module.ReliquaryMemoryProvider()
    scope = set_hermes_home_override(home)
    try:
        from hermes_cli.memory_setup import _post_setup_hook
        assert _post_setup_hook(setup_provider, {})
        setup_provider.shutdown()
        settings = read_settings(home)
        enrollment_path = settings.state_dir / "capture-enrollment-v1.json"
        assert enrollment_path.is_file()
        enrollment_before = enrollment_path.read_bytes()
        # Read the immutable creation evidence after setup to establish ordering.
        with SessionDB(home / "state.db") as db:
            cutoff = json.loads(enrollment_before)["cutoff"]
            assert db.get_session(old)["started_at"] <= cutoff
            assert db.get_session(compression_parent)["started_at"] <= cutoff
            old_rows += _persist_turn(db, old, "Synthetic post-enrollment follow-up on the old session.")
            # Children and new roots are created through Hermes after enrollment.
            branch = "hu08-synthetic-old-branch"
            db.create_session(branch, source="cli", parent_session_id=old, profile_name="default",
                              model_config={"_branched_from": old})
            branch_rows = old_rows + _persist_turn(db, branch, "Synthetic old-history branch.")
            db.create_session(rotated, source="cli", parent_session_id=compression_parent,
                              profile_name="default")
            rotated_rows = compression_rows + _persist_turn(db, rotated,
                                                            "Synthetic compression continuation.")
            restored = "hu08-synthetic-portable-restore"
            restored_result = db.import_sessions([{"id": restored, "source": "cli",
                                                  "messages": [{"role": "user", "content": "Restored synthetic history."}]}])
            assert restored_result["imported"] == 1
            # Resume can backfill the profile, but cannot create new-conversation evidence.
            db.create_session(restored, source="cli", profile_name="default")
            restored_rows = db.get_messages(restored) + _persist_turn(db, restored, "New turn on restored history.")
            restored_meta = db.get_session(restored)
            assert restored_meta["started_at"] > cutoff
            assert restored_meta.get("provenance_created_at") is None
            assert restored_meta["provenance_restored"] == 1
            fresh = "hu08-synthetic-new-root"
            assert db.get_session(branch)["started_at"] > cutoff
            assert db.get_session(rotated)["started_at"] > cutoff

        outbox = SourceOutbox(settings.state_dir, settings.profile_id, settings.principal_id)
        manager = MemoryManager()
        provider = provider_module.ReliquaryMemoryProvider()
        manager.add_provider(provider)
        manager.initialize_all(old, hermes_home=str(home))
        try:
            _wait(lambda: provider.lifecycle_status == "attached")
            delivered = []
            send = provider._client.deliver_source_job

            def observe(job):
                receipt = send(job)
                delivered.append(job)
                return receipt

            monkeypatch.setattr(provider._client, "deliver_source_job", observe)

            def switch(session_id):
                manager.on_session_switch(session_id)
                _wait(lambda: provider.binding is not None and provider.binding.session_id == session_id)

            def sync(session_id, rows):
                manager.sync_all(rows[-2]["content"], rows[-1]["content"],
                                 session_id=session_id, messages=rows)
                assert manager.flush_pending(timeout=10)

            for session_id, rows in ((old, old_rows), (branch, branch_rows), (rotated, rotated_rows)):
                if session_id != old:
                    switch(session_id)
                sync(session_id, rows)
                assert provider.sync_status == "source_capture_historical"
                assert outbox.cursor(session_id) is None
                assert outbox.next_job(session_id) is None

            switch(restored)
            sync(restored, restored_rows)
            assert provider.sync_status == "source_capture_session_unavailable"
            assert outbox.cursor(restored) is None and outbox.next_job(restored) is None

            # A job persisted by the old policy retains its original identity.
            previous = capture_snapshot(settings.profile_id, old, old_rows[:2])
            outbox.enqueue(previous, generation=outbox.generation(old))
            pending = outbox.next_job(old)

            switch(fresh)
            assert provider.sync_status == "source_capture_session_unavailable"
            # Hermes can persist a new session during its first turn.
            secret = "opaque-hu08-test-secret-5a7f83"
            with SessionDB(home / "state.db") as db:
                db.create_session(fresh, source="cli", profile_name="default")
                fresh_rows = _persist_turn(db, fresh, f"Synthetic rule. Authorization: Bearer {secret}")
                assert db.get_session(fresh)["started_at"] > cutoff
            sync(fresh, fresh_rows)
            _wait(lambda: outbox.cursor(fresh) is not None)
            [job] = delivered
            sent_rows = json.loads(job.snapshot.messages_json)
            assert [(row["message_uid"], row["timestamp"]) for row in sent_rows] == [
                (row["message_uid"], row["timestamp"]) for row in fresh_rows
            ]
            assert secret not in job.snapshot.messages_json.decode("utf-8")
            assert outbox.cursor(fresh).last_message_uid == fresh_rows[-1]["message_uid"]
            assert pending.snapshot.snapshot_digest == previous.snapshot_digest
            assert outbox.next_job(old) == pending
            assert enrollment_path.read_bytes() == enrollment_before
        finally:
            manager.shutdown_all()
    finally:
        reset_hermes_home_override(scope)
