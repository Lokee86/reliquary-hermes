"""HP03 provider behavior against the pinned Hermes lifecycle and setup APIs."""

from hashlib import sha256
import importlib
import json
from threading import Event, Thread
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
    return _provider_for_checkout(monkeypatch, pinned_checkout, tmp_path)


@pytest.fixture
def history_provider(monkeypatch, history_checkout, tmp_path):
    provider = _provider_for_checkout(monkeypatch, history_checkout, tmp_path)
    from hermes_state import SessionDB

    assert SessionDB.HISTORY_EXPORT_VERSION == 2
    return provider


def _provider_for_checkout(monkeypatch, checkout, tmp_path):
    monkeypatch.syspath_prepend(str(checkout))
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv(TOKEN_VAR, "inherited-credential-must-not-be-used")
    monkeypatch.delenv("RELIQUARY_CONFIG_PATH", raising=False)
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
    assert {tool["name"] for tool in first.get_tool_schemas()} == {
        "memory_query", "refine_query", "traverse_graph",
    }
    assert first.recall_status() is None


def test_pinned_setup_activates_and_keeps_token_in_profile_secret_scope(
    pinned_provider, monkeypatch, tmp_path, capsys,
):
    from agent.secret_scope import get_secret, reset_secret_scope, set_secret_scope
    from hermes_cli.config import load_config
    from hermes_cli.memory_setup import _post_setup_hook
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    from reliquary_hermes import setup

    home = tmp_path / "setup"
    values = _profile(home, "setup-profile")
    installed = home / "plugins/reliquary/host/reliquary-hermes-host.exe"
    installed.parent.mkdir(parents=True)
    installed.touch()

    class SetupHost:
        def __init__(self, state, profile_id, principal_id, token, *, binary):
            assert state == home / "reliquary"
            assert principal_id == profile_id + "-operator"
            assert token == read_token(home)
            assert binary == installed

        def connect_dashboard(self, session_id, *, owners_fingerprint):
            assert session_id is None
            raw = (home / "reliquary/owners.json").read_bytes()
            assert owners_fingerprint == sha256(raw).hexdigest()
            projects = json.loads(raw)["projects"]
            return {"owners": [{"owner_id": owner} for owner in ("general", "identity", *projects)],
                    "active_phy_id": "identity"}

    def preflight(home, binary, request):
        return {"valid": True, "main_rel": {"owner_id": "general"}, "active_phy": {"owner_id": "identity"},
                "projects": {key: {"owner_id": key} for key in request["owners"]["projects"]}}

    monkeypatch.setattr(setup, "_preflight", preflight)
    monkeypatch.setattr(setup, "HostClient", SetupHost)
    prompts = iter((values["main_rel"], values["active_phy"], "", ""))
    monkeypatch.setattr("builtins.input", lambda _: next(prompts))
    provider = pinned_provider.ReliquaryMemoryProvider()
    scope = set_hermes_home_override(home)
    secrets = set_secret_scope({}, profile_home=str(home))
    try:
        assert _post_setup_hook(provider, {})
        assert load_config()["memory"]["provider"] == "reliquary"
        assert provider.is_available()
        token = read_token(home)
        assert len(token) == 43
        assert token != "inherited-credential-must-not-be-used"
        assert get_secret(TOKEN_VAR) == token
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
        reset_secret_scope(secrets)
        reset_hermes_home_override(scope)


def test_provider_uses_explicit_profile_and_context_and_discards_stale_attach(
    pinned_provider, monkeypatch, tmp_path,
):
    from agent import memory_provider
    from agent.secret_scope import current_secret_scope_home, reset_secret_scope, set_secret_scope
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    monkeypatch.setattr(memory_provider, "SESSION_PROJECT_ATTRIBUTION_VERSION", 1, raising=False)
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

        def attach(self, session_id, *, project_id=None):
            captured.append((session_id, current_secret_scope_home(), project_id))
            if session_id == "main-session":
                entered.set()
                assert release.wait(3)
            return SimpleNamespace(session_id=session_id, rel_id=session_id + "-rel", user_id="stable-phy")

        runtime_lease_id = None

        def attach_runtime(self, session_id):
            self.runtime_lease_id = "runtime-lease"
            return self.runtime_lease_id, {}

        def add_runtime_scope(self, session_id):
            return self.runtime_lease_id or "runtime-lease", {}

        def heartbeat_runtime(self):
            pass

        def detach_runtime(self):
            self.runtime_lease_id = None

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
        provider.on_session_switch("skipped-session", project_id="caller-project")
        provider.on_session_switch("project-session", session_project_id="p_abcdef01")
        provider.sync_turn("private source", "private answer", session_id="project-session")
        assert provider.sync_status == "source_capture_session_unavailable"
        assert provider.prefetch("private prompt") == ""
        release.set()
        _settled(provider, "attached")
        assert provider.binding.session_id == "project-session"
        assert provider.binding.user_id == "stable-phy"
        assert captured == [
            ("main-session", str(home), None), ("project-session", str(home), "p_abcdef01"),
        ]
        provider.on_turn_start(1, "continue project conversation")
        _settled(provider, "attached")
        assert captured[-1] == ("project-session", str(home), "p_abcdef01")
        provider.on_session_switch("general-session", project_id="caller-project")
        _settled(provider, "attached")
        assert captured[-1] == ("general-session", str(home), None)
        monkeypatch.delattr(memory_provider, "SESSION_PROJECT_ATTRIBUTION_VERSION")
        provider.on_session_switch("stock-session", session_project_id="p_abcdef01")
        _settled(provider, "attached")
        assert captured[-1] == ("stock-session", str(home), None)
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

        def attach(self, session_id, *, project_id=None):
            calls.append(session_id)
            if len(calls) == 3:
                entered.set()
                assert release.wait(3)
            if len(calls) in {1, 3}:
                raise pinned_provider.HostUnavailable("host_unavailable")
            return SimpleNamespace(session_id=session_id, rel_id="existing-rel", user_id="existing-phy")

        runtime_lease_id = None

        def attach_runtime(self, session_id):
            self.runtime_lease_id = "runtime-lease"
            return self.runtime_lease_id, {}

        def add_runtime_scope(self, session_id):
            return self.runtime_lease_id or "runtime-lease", {}

        def heartbeat_runtime(self):
            pass

        def detach_runtime(self):
            self.runtime_lease_id = None

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
    from agent.secret_scope import reset_secret_scope, set_secret_scope

    home = tmp_path / "shutdown"
    save_settings(home, _profile(home, "shutdown-profile"))
    scope = set_secret_scope({TOKEN_VAR: "isolated-shutdown-test-profile-token"}, profile_home=str(home))
    started, release = Event(), Event()
    workers = []

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def attach(self, session_id, *, project_id=None):
            started.set()
            assert release.wait(3)
            return SimpleNamespace(session_id=session_id, rel_id="late-rel", user_id="late-phy")

        runtime_lease_id = None

        def attach_runtime(self, session_id):
            self.runtime_lease_id = "runtime-lease"
            return self.runtime_lease_id, {}

        def add_runtime_scope(self, session_id):
            return self.runtime_lease_id or "runtime-lease", {}

        def heartbeat_runtime(self):
            pass

        def detach_runtime(self):
            self.runtime_lease_id = None

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
        reset_secret_scope(scope)
    assert provider.lifecycle_status == "stopped"
    assert provider.binding is None


def test_hermes_manager_keeps_profile_workers_and_hooks_isolated(pinned_provider, monkeypatch, tmp_path):
    from contextlib import contextmanager

    from agent.memory_manager import MemoryManager
    from agent.secret_scope import (
        current_secret_scope_home, get_secret, is_multiplex_active, reset_secret_scope,
        set_multiplex_active, set_secret_scope,
    )
    from hermes_constants import get_hermes_home, reset_hermes_home_override, set_hermes_home_override

    homes = {name: tmp_path / name for name in ("profile-a", "profile-b")}
    tokens = {name: f"{name}-isolated-multiplex-credential" for name in homes}
    for name, home in homes.items():
        save_settings(home, _profile(home, name))

    entered = {name: Event() for name in homes}
    release = Event()
    workers, hooks = {}, []

    class Client:
        def __init__(self, state_dir, profile_id, principal_id, credential, *, binary):
            assert state_dir == homes[profile_id] / "reliquary"
            assert principal_id == f"{profile_id}-operator"
            self.profile_id = profile_id
            self.credential = credential

        def attach(self, session_id, *, project_id=None):
            workers[self.profile_id] = (get_hermes_home(), current_secret_scope_home(),
                                        get_secret(TOKEN_VAR), self.credential)
            entered[self.profile_id].set()
            assert release.wait(5)
            return SimpleNamespace(session_id=session_id)

        runtime_lease_id = None

        def attach_runtime(self, session_id):
            self.runtime_lease_id = "runtime-lease-" + self.profile_id
            return self.runtime_lease_id, {}

        def add_runtime_scope(self, session_id):
            return self.runtime_lease_id or "runtime-lease-" + self.profile_id, {}

        def heartbeat_runtime(self):
            pass

        def detach_runtime(self):
            self.runtime_lease_id = None

    @contextmanager
    def profile_scope(name):
        home = set_hermes_home_override(homes[name])
        secrets = set_secret_scope({TOKEN_VAR: tokens[name]}, profile_home=str(homes[name]))
        try:
            yield
        finally:
            reset_secret_scope(secrets)
            reset_hermes_home_override(home)

    original_hook = pinned_provider.ReliquaryMemoryProvider.on_turn_start

    def on_turn_start(provider, turn_number, message, **kwargs):
        hooks.append((provider, message))
        return original_hook(provider, turn_number, message, **kwargs)

    monkeypatch.setattr(pinned_provider, "HostClient", Client)
    monkeypatch.setattr(pinned_provider.ReliquaryMemoryProvider, "on_turn_start", on_turn_start)
    was_multiplexed = is_multiplex_active()
    managers, providers = {}, {}
    set_multiplex_active(True)
    try:
        for name in homes:
            managers[name] = MemoryManager()
            providers[name] = pinned_provider.ReliquaryMemoryProvider()
            managers[name].add_provider(providers[name])
            with profile_scope(name):
                # The manager must inject the active home rather than falling back to process state.
                managers[name].initialize_all("same-session")
        assert all(event.wait(3) for event in entered.values())
        assert workers == {name: (home, str(home), tokens[name], tokens[name]) for name, home in homes.items()}

        managers["profile-a"].on_turn_start(1, "unresolved")
        with profile_scope("profile-b"):
            managers["profile-a"].on_turn_start(1, "foreign")
            managers["profile-b"].on_turn_start(1, "own-b")
        with profile_scope("profile-a"):
            managers["profile-a"].on_turn_start(1, "own-a")
        assert hooks == [(providers["profile-b"], "own-b"), (providers["profile-a"], "own-a")]

        release.set()
        for provider in providers.values():
            _settled(provider, "attached")
            assert provider.binding.session_id == "same-session"
    finally:
        release.set()
        for manager in managers.values():
            manager.shutdown_all()
        set_multiplex_active(was_multiplexed)
    for provider in providers.values():
        assert provider.lifecycle_status == "stopped"


def test_inflight_prefetch_discards_old_session_result(pinned_provider, monkeypatch, tmp_path):
    from agent.secret_scope import reset_secret_scope, set_secret_scope
    from reliquary_hermes.validation import canonical

    home = tmp_path / "recall"
    save_settings(home, _profile(home, "recall-profile"))
    scope = set_secret_scope({TOKEN_VAR: "isolated-recall-test-credential-value"}, profile_home=str(home))
    entered, release = Event(), Event()

    class Client:
        _principal_id = "recall-profile-operator"

        def __init__(self, *args, **kwargs):
            pass

        def attach(self, session_id, *, project_id=None):
            return SimpleNamespace(session_id=session_id)

        def attach_runtime(self, session_id):
            return "runtime-lease", {}

        def add_runtime_scope(self, session_id):
            return self.attach_runtime(session_id)

        def detach_runtime(self):
            pass

        def request(self, _raw):
            entered.set()
            assert release.wait(3)
            return SimpleNamespace(status="ok", result_json=canonical({
                "context": "Old session Memory", "memory_ids": ["memory-a"],
            }))

    monkeypatch.setattr(pinned_provider, "HostClient", Client)
    provider = pinned_provider.ReliquaryMemoryProvider()
    provider.initialize("session-a", hermes_home=str(home))
    results = []
    recall = Thread(target=lambda: results.append(provider.prefetch("Find the checklist", session_id="session-a")))
    try:
        _settled(provider, "attached")
        recall.start()
        assert entered.wait(3)
        provider.on_session_switch("session-b")
        _settled(provider, "attached")
    finally:
        release.set()
        if recall.ident is not None:
            recall.join(3)
        provider.shutdown()
        reset_secret_scope(scope)
    assert results == [""]
    assert provider.recall_status() is None
