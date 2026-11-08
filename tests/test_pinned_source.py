"""Exercise the pinned host against synthetic history in an isolated Hermes profile."""

import inspect
import os
import subprocess
import sys


def _run_probe(probe, checkout, tmp_path):
    # Preserve only process-launch necessities. The child gets neither provider
    # credentials nor the real Hermes config, plugin directories or Python path.
    inherited = {"path", "systemroot", "windir", "comspec", "home", "userprofile", "lang", "lc_all", "pytest_current_test"}
    env = {key: value for key, value in os.environ.items() if key.lower() in inherited}
    profile = tmp_path / ".hermes" / "profiles" / "hp01-probe"
    profile.mkdir(parents=True)
    env.update(
        HERMES_HOME=str(profile),
        HP01_HERMES_CHECKOUT=str(checkout),
        PYTHONPATH=str(checkout),
        PYTHONNOUSERSITE="1",
        PYTHONIOENCODING="utf-8",
        TEMP=str(tmp_path),
        TMP=str(tmp_path),
        TMPDIR=str(tmp_path),
        XDG_CACHE_HOME=str(tmp_path / "cache"),
    )
    code = inspect.getsource(probe) + f"\n{probe.__name__}()\n"
    result = subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _live_sync_probe():
    import ast
    import os
    from pathlib import Path
    from types import SimpleNamespace
    from typing import Any

    from agent.codex_responses_adapter import _summarize_user_message_for_log
    from agent.memory_manager import MemoryManager
    from agent.memory_provider import MemoryProvider, is_trivial_prompt
    from agent.session_persistence import _db_flush_row, _db_flush_write
    from hermes_state import SessionDB

    # Execute the actual turn-to-manager adapter without booting run_agent.py.
    run_agent = Path(os.environ["HP01_HERMES_CHECKOUT"]) / "run_agent.py"
    tree = ast.parse(run_agent.read_text(encoding="utf-8"), filename=str(run_agent))
    agent_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "AIAgent")
    sync_method = next(node for node in agent_class.body if getattr(node, "name", "") == "_sync_external_memory_for_turn")
    scope = {
        "Any": Any,
        "_summarize_user_message_for_log": _summarize_user_message_for_log,
        "is_trivial_prompt": is_trivial_prompt,
    }
    exec(compile(ast.Module(body=[sync_method], type_ignores=[]), str(run_agent), "exec"), scope)

    class Recorder(MemoryProvider):
        name = "hp01-probe"

        def is_available(self):
            return True

        def initialize(self, session_id, **kwargs):
            self.calls = []

        def get_tool_schemas(self):
            return []

        def sync_turn(self, user_content, assistant_content, *, session_id="", messages=None, turn_author=None):
            self.calls.append((user_content, assistant_content, session_id, messages, turn_author))

    secret = "sk-proj-abc123def456ghi789jkl012"
    messages = [
        {"role": "user", "content": "Review the test configuration", "timestamp": 1700000000.25},
        {"role": "assistant", "content": f"Test output: OPENAI_API_KEY={secret}"},
    ]
    session_id = "hp01-live-source"
    turn_author = {"id": "author-1", "name": "Test Author", "is_bot": False}
    profile = Path(os.environ["HERMES_HOME"])
    with SessionDB(profile / "state.db") as db:
        db.create_session(session_id, source="cli")
        manager = MemoryManager()
        provider = Recorder()
        manager.add_provider(provider)
        manager.initialize_all(session_id, hermes_home=str(profile))
        agent = SimpleNamespace(
            _session_db=db, _memory_manager=manager, session_id=session_id, _turn_author=turn_author
        )
        rows = [_db_flush_row(agent, message, False) for message in messages]
        try:
            _db_flush_write(agent, rows, messages, messages)
            scope[sync_method.name](
                agent,
                original_user_message=messages[0]["content"],
                final_response=messages[1]["content"],
                interrupted=False,
                messages=messages,
            )
            assert manager.flush_pending(timeout=5)
            durable = db.get_messages(session_id)
        finally:
            manager.shutdown_all()

    assert len(provider.calls) == 1
    user, assistant, received_session, received, received_author = provider.calls[0]
    assert (received_session, received_author) == (session_id, turn_author)
    assert user == messages[0]["content"]
    assert secret not in assistant and secret not in repr(received)
    assert secret in messages[1]["content"]

    def identity(view):
        return [(item["message_uid"], item["timestamp"]) for item in view]

    assert identity(received) == identity(messages) == identity(durable)
    assert len({item["message_uid"] for item in received}) == 2
    assert all(isinstance(item["message_uid"], str) and item["message_uid"] for item in received)
    assert received[0]["timestamp"] == 1700000000.25
    assert received[1]["timestamp"] > 0


def _archive_delete_probe():
    import os
    from pathlib import Path

    from hermes_cli.plugins import get_plugin_manager
    from hermes_state import SessionDB
    from plugins.memory import _ProviderCollector

    profile = Path(os.environ["HERMES_HOME"])
    manager = get_plugin_manager()
    # The real collector/registry dispatches the observer, with unrelated
    # built-in and installed plugin discovery suppressed in this child.
    manager._discovered = True
    seen = []
    db_path = profile / "state.db"
    with SessionDB(db_path) as db, SessionDB(db_path, read_only=True) as reader:
        def observe(session_id, reason, profile, **kwargs):
            row = reader.get_session(session_id)
            seen.append((session_id, reason, profile, None if row is None else row["archived"]))

        _ProviderCollector("hp01-probe").collect(lambda ctx: ctx.register_hook("on_session_delete", observe))
        db.create_session("source-1", source="cli")
        assert db.set_session_archived("source-1", True)
        assert db.set_session_archived("source-1", True)  # Same archived state produces no event.
        assert db.delete_session("source-1")
        assert not db.delete_session("source-1")

    assert seen == [
        ("source-1", "archive", "hp01-probe", 1),
        ("source-1", "delete", "hp01-probe", None),
    ], seen


def test_pinned_persisted_identity_and_time_reach_privacy_filtered_sync_turn(pinned_checkout, tmp_path):
    _run_probe(_live_sync_probe, pinned_checkout, tmp_path)


def test_pinned_generic_observer_receives_committed_archive_and_delete(pinned_checkout, tmp_path):
    _run_probe(_archive_delete_probe, pinned_checkout, tmp_path)
