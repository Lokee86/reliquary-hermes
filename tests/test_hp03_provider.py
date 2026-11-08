"""HP03 provider behavior against the pinned Hermes lifecycle and setup APIs."""

import importlib
import json
from threading import Event
from time import monotonic, sleep
from types import SimpleNamespace

import pytest

from reliquary_hermes import register
from reliquary_hermes.settings import TOKEN_VAR, read_token, save_settings


def _profile(home, name):
    home.mkdir()
    values = {"profile_id": name, "principal_id": f"{name}-operator"}
    for key, filename in (
        ("main_rel", "main.rel"),
        ("active_phy", "active.phy"),
        ("binary", "host.exe"),
    ):
        path = home / filename
        path.touch()
        values[key] = str(path)
    return values


def _settled(provider, expected):
    until = monotonic() + 3
    while provider.lifecycle_status != expected and monotonic() < until:
        sleep(0.01)
    assert provider.lifecycle_status == expected


@pytest.fixture
def pinned_provider(monkeypatch, pinned_checkout, tmp_path):
    monkeypatch.syspath_prepend(str(pinned_checkout))
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv(TOKEN_VAR, "inherited-credential-must-not-be-used")
    return importlib.import_module("reliquary_hermes.provider")


def test_pinned_entry_point_produces_fresh_provider_instances(pinned_provider):
    from importlib.metadata import EntryPoint

    from agent.memory_provider import MemoryProvider
    from plugins.memory import _load_provider_from_entry_point

    entry_point = EntryPoint(
        "reliquary", "reliquary_hermes:register", "hermes_agent.memory_providers",
    )
    first = _load_provider_from_entry_point(entry_point, register_skills=False)
    second = _load_provider_from_entry_point(entry_point, register_skills=False)
    assert isinstance(first, MemoryProvider)
    assert first.name == "reliquary"
    assert first is not second
    assert first.get_tool_schemas() == []
    assert first.recall_status() is None


def test_pinned_setup_activates_and_keeps_token_in_profile_dotenv(
    pinned_provider, monkeypatch, tmp_path, capsys,
):
    from hermes_cli.config import load_config
    from hermes_cli.memory_setup import _post_setup_hook
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home = tmp_path / "setup"
    values = _profile(home, "setup-profile")
    prompts = iter(values[key] for key, _ in pinned_provider.PROMPTS)
    monkeypatch.setattr("builtins.input", lambda _: next(prompts))
    provider = pinned_provider.ReliquaryMemoryProvider()
    scope = set_hermes_home_override(home)
    try:
        assert _post_setup_hook(provider, {})
        assert load_config()["memory"]["provider"] == "reliquary"
        assert provider.is_available()
        token = read_token(home)
        assert len(token) == 43
        assert token != "inherited-credential-must-not-be-used"
        assert token in (home / ".env").read_text(encoding="utf-8")
        for path in (home / "config.yaml", *sorted((home / "reliquary").glob("*.json"))):
            assert token not in path.read_text(encoding="utf-8")
        captured = capsys.readouterr()
        assert token not in captured.out + captured.err

        owner_config = home / "reliquary" / "owners.json"
        owner_values = json.loads(owner_config.read_text(encoding="utf-8"))
        project = home / "project.rel"
        project.touch()
        owner_values["projects"] = {"project": str(project)}
        owner_values["session_projects"] = {"project-session": "project"}
        owner_config.write_text(json.dumps(owner_values), encoding="utf-8")
        monkeypatch.setattr("builtins.input", lambda _: "")
        assert _post_setup_hook(provider, {})
        assert read_token(home) == token
        assert json.loads(owner_config.read_text(encoding="utf-8")) == owner_values
    finally:
        reset_hermes_home_override(scope)


def test_provider_uses_explicit_profile_and_context_and_discards_stale_attach(
    pinned_provider, monkeypatch, tmp_path,
):
    from agent.secret_scope import current_secret_scope_home, reset_secret_scope, set_secret_scope
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home = tmp_path / "bound"
    values = _profile(home, "bound-profile")
    save_settings(home, values)
    token = "bound-profile-private-test-credential"
    entered, release = Event(), Event()
    captured = []

    class Client:
        def __init__(self, state_dir, profile_id, principal_id, credential, *, binary):
            assert state_dir == home / "reliquary"
            assert profile_id == values["profile_id"]
            assert principal_id == values["principal_id"]
            assert credential == token
            assert str(binary) == values["binary"]

        def attach(self, session_id):
            captured.append((session_id, current_secret_scope_home()))
            if session_id == "main-session":
                entered.set()
                assert release.wait(3)
            return SimpleNamespace(session_id=session_id, rel_id=session_id + "-rel", user_id="stable-phy")

    monkeypatch.setattr(pinned_provider, "HostClient", Client)
    collector = SimpleNamespace(register_memory_provider=lambda provider: setattr(collector, "provider", provider))
    register(collector)
    provider = collector.provider
    scope = set_hermes_home_override(home)
    secrets = set_secret_scope({TOKEN_VAR: token}, profile_home=str(home))
    try:
        assert provider.is_available()
        assert captured == []
        provider.initialize("main-session", hermes_home=str(home), agent_identity="bot-a", user_id="untrusted")
        assert entered.wait(3)
        assert provider.binding is None
        provider.on_session_switch("skipped-session")
        provider.on_session_switch("project-session", project_id="caller-project")
        provider.sync_turn("private source", "private answer", session_id="project-session")
        assert provider.sync_status == "source_ingestion_unavailable"
        assert provider.prefetch("private prompt") == ""
        release.set()
        _settled(provider, "attached")
        assert provider.binding.session_id == "project-session"
        assert provider.binding.user_id == "stable-phy"
        assert captured == [("main-session", str(home)), ("project-session", str(home))]
        provider.shutdown()
        assert provider.binding is None
        assert provider.lifecycle_status == "stopped"
    finally:
        release.set()
        reset_secret_scope(secrets)
        reset_hermes_home_override(scope)


def test_provider_outage_isolated_and_nonprimary_does_not_bind(pinned_provider, monkeypatch, tmp_path):
    from agent.secret_scope import reset_secret_scope, set_secret_scope
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home = tmp_path / "outage"
    save_settings(home, _profile(home, "outage-profile"))
    provider = pinned_provider.ReliquaryMemoryProvider()
    scope = set_hermes_home_override(home)
    token = "outage-private-credential-test-value"
    calls = []
    entered, release = Event(), Event()

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def attach(self, session_id):
            calls.append(session_id)
            if len(calls) == 3:
                entered.set()
                assert release.wait(3)
            if len(calls) in {1, 3}:
                raise pinned_provider.HostUnavailable("host_unavailable")
            return SimpleNamespace(session_id=session_id, rel_id="existing-rel", user_id="existing-phy")

    monkeypatch.setattr(pinned_provider, "HostClient", Client)
    try:
        # Ambient credentials cannot make this explicit profile available.
        assert not provider.is_available()
        wrong = set_secret_scope({TOKEN_VAR: token}, profile_home=str(tmp_path))
        try:
            assert not provider.is_available()
        finally:
            reset_secret_scope(wrong)
        secrets = set_secret_scope({TOKEN_VAR: token}, profile_home=str(home))
        try:
            child = pinned_provider.ReliquaryMemoryProvider()
            child.initialize("delegate", hermes_home=str(home), agent_context="subagent")
            child.sync_turn("private source", "private answer", session_id="delegate")
            assert child.sync_status == "non_primary"
            assert calls == []

            provider.initialize("resume", hermes_home=str(home))
            _settled(provider, "unavailable")
            assert provider.binding is None
            provider.on_turn_start(1, "ordinary turn")
            _settled(provider, "attached")
            assert provider.binding.rel_id == "existing-rel"
            assert calls == ["resume", "resume"]
            original = provider.binding

            provider.on_turn_start(2, "host went away")
            assert entered.wait(3)
            assert provider.binding is None
            for _ in range(3):
                provider.on_turn_start(2, "coalesced tick")
            assert len(calls) == 3
            release.set()
            _settled(provider, "unavailable")
            assert provider.binding is None

            provider.on_turn_start(3, "host restarted")
            _settled(provider, "attached")
            assert provider.binding == original
            assert calls == ["resume"] * 4
        finally:
            release.set()
            reset_secret_scope(secrets)
    finally:
        provider.shutdown()
        reset_hermes_home_override(scope)


def test_availability_rejects_non_regular_config(pinned_provider, tmp_path):
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home = tmp_path / "invalid"
    save_settings(home, _profile(home, "invalid-profile"))
    config = home / "reliquary" / "owners.json"
    config.unlink()
    config.mkdir()
    scope = set_hermes_home_override(home)
    try:
        assert not pinned_provider.ReliquaryMemoryProvider().is_available()
    finally:
        reset_hermes_home_override(scope)


def test_shutdown_drops_an_in_flight_attachment(pinned_provider, monkeypatch, tmp_path):
    home = tmp_path / "shutdown"
    save_settings(home, _profile(home, "shutdown-profile"))
    (home / ".env").write_text(
        f"{TOKEN_VAR}=isolated-shutdown-test-profile-token\n", encoding="utf-8",
    )
    started, release = Event(), Event()
    workers = []

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def attach(self, session_id):
            started.set()
            assert release.wait(3)
            return SimpleNamespace(session_id=session_id, rel_id="late-rel", user_id="late-phy")

    spawn = pinned_provider.spawn_context_thread

    def capture_worker(*args, **kwargs):
        worker = spawn(*args, **kwargs)
        workers.append(worker)
        return worker

    monkeypatch.setattr(pinned_provider, "HostClient", Client)
    monkeypatch.setattr(pinned_provider, "spawn_context_thread", capture_worker)
    provider = pinned_provider.ReliquaryMemoryProvider()
    provider.initialize("session", hermes_home=str(home))
    try:
        assert started.wait(3)
        provider.shutdown()
        assert provider.lifecycle_status == "stopped"
        assert provider.binding is None
    finally:
        release.set()
        for worker in workers:
            worker.join(timeout=3)
            assert not worker.is_alive()
    assert provider.lifecycle_status == "stopped"
    assert provider.binding is None
