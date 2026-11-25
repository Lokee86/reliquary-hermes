from io import BytesIO
from types import ModuleType
from subprocess import CompletedProcess
import sys

import pytest

from reliquary_hermes.client import HostClient
from reliquary_hermes.inference_worker import HostedInferenceWorker
from reliquary_hermes.settings import TOKEN_VAR, read_native_decision_key, read_token
from reliquary_hermes import setup
from reliquary_hermes.validation import ContractError


@pytest.fixture
def scoped_provider_key(monkeypatch, tmp_path):
    home = tmp_path / "routed-profile"
    home.mkdir()
    key = "synthetic-profile-provider-api-key"
    values = {TOKEN_VAR: "synthetic-profile-scoped-local-host-token"}
    monkeypatch.setenv("RELIQUARY_PROVIDER_API_KEY", key)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-foreign-process-api-key")
    agent = ModuleType("agent")
    agent.__path__ = []
    secret_scope = ModuleType("agent.secret_scope")
    secret_scope.current_secret_scope_home = lambda: str(home)
    secret_scope.get_secret = lambda name: values.get(name)
    constants = ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: str(home)
    constants.get_routing_process_hermes_home = lambda: str(home)
    monkeypatch.setitem(sys.modules, "agent", agent)
    monkeypatch.setitem(sys.modules, "agent.secret_scope", secret_scope)
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    yield home, key, values


def test_profile_secret_uses_scoped_get_secret_and_rejects_foreign_home(scoped_provider_key):
    home, _, values = scoped_provider_key
    other_home = home.parent / "other-profile"
    other_home.mkdir()

    assert read_token(home) == values[TOKEN_VAR]
    with pytest.raises(ContractError, match="profile_scope_mismatch"):
        read_token(other_home)


def test_native_decision_requires_a_literal_route_and_scoped_credential(scoped_provider_key, monkeypatch):
    home, key, values = scoped_provider_key
    config = ModuleType("hermes_cli.config")
    selected = {"decisions_url": "https://fixture.invalid/decisions", "credential_env": "JEV_API_KEY"}
    config.read_raw_config_readonly = lambda: {"reliquary": {"perception": selected}}
    cli = ModuleType("hermes_cli")
    cli.__path__ = []
    monkeypatch.setitem(sys.modules, "hermes_cli", cli)
    monkeypatch.setitem(sys.modules, "hermes_cli.config", config)
    constants = sys.modules["hermes_constants"]
    constants.set_hermes_home_override = lambda home: home
    constants.reset_hermes_home_override = lambda home: None
    monkeypatch.setenv("JEV_API_KEY", "foreign-process-jev-key")

    worker = HostedInferenceWorker(object(), str(home))
    assert worker._configured_native_route() is None
    values["JEV_API_KEY"] = key
    route = worker._configured_native_route()
    assert route.url == selected["decisions_url"] and route.credential_env == "JEV_API_KEY"
    assert read_native_decision_key(home, route) == key

    other = home.parent / "other-profile"
    other.mkdir()
    with pytest.raises(ContractError, match="profile_scope_mismatch"):
        read_native_decision_key(other, route)

    selected["decisions_url"] = "http://fixture.invalid/decisions"
    assert worker._configured_native_route() is None
    selected["decisions_url"] = "https://fixture.invalid/decisions?token=secret"
    assert worker._configured_native_route() is None
    selected["decisions_url"] = "https://fixture.invalid/decisions"
    selected["credential_env"] = TOKEN_VAR
    assert worker._configured_native_route() is None


def test_host_launch_never_exports_provider_credentials(scoped_provider_key, monkeypatch):
    home, _, _ = scoped_provider_key
    state = home / "reliquary"
    state.mkdir()
    binary = home / "host"
    binary.touch()
    captured = {}

    class Process:
        stdin = BytesIO()

        @staticmethod
        def poll():
            return None

    def popen(args, **kwargs):
        captured.update(kwargs)
        return Process()

    monkeypatch.setattr("reliquary_hermes.client.subprocess.Popen", popen)
    client = HostClient(state, "profile", "principal", "synthetic-local-service-auth-token",
                        binary=binary)
    client._launch()

    assert set(captured["env"]) <= {"SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"}


def test_setup_host_never_exports_provider_credentials(scoped_provider_key, monkeypatch):
    home, _, _ = scoped_provider_key
    binary = home / "host"
    binary.touch()
    captured = {}

    def run(args, **kwargs):
        captured.update(kwargs)
        return CompletedProcess(args, 0, stdout=b"{}", stderr=b"")

    monkeypatch.setattr(setup.subprocess, "run", run)
    setup._host_setup(home, binary, "setup-validate", {})

    assert set(captured["env"]) <= {"SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"}


def test_setup_host_omits_an_unconfigured_provider_key(scoped_provider_key, monkeypatch):
    home, _, values = scoped_provider_key
    values.clear()
    binary = home / "host"
    binary.touch()
    captured = {}

    def run(args, **kwargs):
        captured.update(kwargs)
        return CompletedProcess(args, 0, stdout=b"{}", stderr=b"")

    monkeypatch.setattr(setup.subprocess, "run", run)
    setup._host_setup(home, binary, "setup-validate", {})

    assert "RELIQUARY_PROVIDER_API_KEY" not in captured["env"]
