"""The shared setup interface owns activation, provisioning and rollback."""

import json

import pytest

from reliquary_hermes import setup
from reliquary_hermes.settings import TOKEN_VAR, read_token
from reliquary_hermes.validation import ContractError
from test_hp03_provider import pinned_provider


@pytest.fixture
def setup_profile(pinned_provider, monkeypatch, tmp_path):
    home = tmp_path / "setup-profile"
    host = home / "plugins/reliquary/host/reliquary-hermes-host.exe"
    host.parent.mkdir(parents=True)
    host.touch()
    candidate = {}
    for field, name in (("main_rel", "main.rel"), ("active_phy", "active.phy"), ("config_path", "reliquary.cfg")):
        path = home / name
        path.touch()
        candidate[field] = str(path)
    monkeypatch.setenv("RELIQUARY_CONFIG_PATH", candidate["config_path"])
    monkeypatch.setattr(setup, "_preflight", lambda home, binary, request: {"valid": True})
    monkeypatch.setattr(setup.HostClient, "connect_dashboard", lambda self, session: {})
    return home, candidate


def test_fresh_setup_derives_private_values_and_preserves_existing_processing(setup_profile):
    home, candidate = setup_profile
    state = home / "reliquary"
    before = setup.status(home)
    assert not before["configured"] and before["runtime_detected"]
    assert before["config_path"] == candidate["config_path"]
    assert setup.validate(home, candidate)["valid"]
    assert not state.exists() and not (home / ".env").exists()

    assert setup.apply(home, candidate)["configured"]
    assert setup.status(home)["configured"]
    token = read_token(home)
    assert len(token) == 43 and token in (home / ".env").read_text(encoding="utf-8")
    for name in ("owners.json", "provider.json", "processing.json"):
        assert token not in (state / name).read_text(encoding="utf-8")
    assert TOKEN_VAR not in (home / "config.yaml").read_text(encoding="utf-8")

    processing = state / "processing.json"
    prior = processing.read_bytes() + b"\n"
    processing.write_bytes(prior)
    candidate.pop("config_path")
    assert setup.apply(home, candidate)["configured"]
    assert processing.read_bytes() == prior
    assert read_token(home) == token


def test_failure_never_activates_and_can_be_retried(setup_profile, monkeypatch):
    home, candidate = setup_profile
    state = home / "reliquary"
    activate = setup._activate

    def fail(_home):
        raise OSError("private diagnostic")

    monkeypatch.setattr(setup, "_activate", fail)
    with pytest.raises(OSError):
        setup.apply(home, candidate)
    assert not setup.status(home)["configured"]
    assert not list(state.glob("*.json"))

    monkeypatch.setattr(setup, "_activate", activate)
    assert setup.apply(home, candidate)["configured"]
    assert setup.status(home)["configured"]


def test_setup_rejects_authority_and_keeps_project_session_mappings(setup_profile):
    home, candidate = setup_profile
    with pytest.raises(ContractError, match="invalid_fields"):
        setup.validate(home, {**candidate, "profile_id": "foreign"})
    project = home / "project.rel"
    project.touch()
    candidate["projects"] = {"project": str(project)}
    assert setup.apply(home, candidate)["configured"]
    owner_file = home / "reliquary/owners.json"
    owners = json.loads(owner_file.read_bytes())
    owners["session_projects"] = {"session": "project"}
    owner_file.write_text(json.dumps(owners), encoding="utf-8")
    assert setup.apply(home, candidate)["configured"]
    assert json.loads(owner_file.read_bytes()) == owners
