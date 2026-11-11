from io import BytesIO
from types import ModuleType
from subprocess import CompletedProcess
import sys

import pytest

from reliquary_hermes.client import HostClient
from reliquary_hermes.settings import PROVIDER_API_KEY_VAR, TOKEN_VAR, _profile_secret, read_token
from reliquary_hermes import setup
from reliquary_hermes.validation import ContractError


@pytest.fixture
def scoped_provider_key(monkeypatch, tmp_path):
    home = tmp_path / "routed-profile"
    home.mkdir()
    key = "synthetic-profile-provider-api-key"
    values = {PROVIDER_API_KEY_VAR: key, TOKEN_VAR: "synthetic-profile-scoped-local-host-token"}
    monkeypatch.setenv(PROVIDER_API_KEY_VAR, "synthetic-foreign-process-api-key")
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
    assert _profile_secret(home, PROVIDER_API_KEY_VAR) == values[PROVIDER_API_KEY_VAR]
    with pytest.raises(ContractError, match="profile_scope_mismatch"):
        _profile_secret(other_home, PROVIDER_API_KEY_VAR)


def test_host_launch_passes_only_the_scoped_provider_key(scoped_provider_key, monkeypatch):
    home, key, _ = scoped_provider_key
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

    assert captured["env"][PROVIDER_API_KEY_VAR] == key
    assert "PATH" not in captured["env"]


def test_setup_host_passes_only_the_scoped_provider_key(scoped_provider_key, monkeypatch):
    home, key, _ = scoped_provider_key
    binary = home / "host"
    binary.touch()
    captured = {}

    def run(args, **kwargs):
        captured.update(kwargs)
        return CompletedProcess(args, 0, stdout=b"{}", stderr=b"")

    monkeypatch.setattr(setup.subprocess, "run", run)
    setup._host_setup(home, binary, "setup-validate", {})

    assert captured["env"][PROVIDER_API_KEY_VAR] == key
    assert "PATH" not in captured["env"]


def test_setup_host_omits_an_unconfigured_provider_key(scoped_provider_key, monkeypatch):
    home, _, values = scoped_provider_key
    values.pop(PROVIDER_API_KEY_VAR)
    binary = home / "host"
    binary.touch()
    captured = {}

    def run(args, **kwargs):
        captured.update(kwargs)
        return CompletedProcess(args, 0, stdout=b"{}", stderr=b"")

    monkeypatch.setattr(setup.subprocess, "run", run)
    setup._host_setup(home, binary, "setup-validate", {})

    assert PROVIDER_API_KEY_VAR not in captured["env"]
