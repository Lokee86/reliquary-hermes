"""The shared setup interface owns activation, provisioning and rollback."""

import json
import os
import subprocess

import pytest

from reliquary_hermes import setup, setup_paths
from reliquary_hermes.client import HostUnavailable
from reliquary_hermes.settings import TOKEN_VAR, read_token
from reliquary_hermes.validation import ContractError
from test_hp03_host import binaries, install_setup_host, owner, setup_hosts
from test_hp03_provider import pinned_provider


@pytest.fixture
def setup_profile(pinned_provider, monkeypatch, tmp_path):
    from agent.secret_scope import reset_secret_scope, set_secret_scope
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home = tmp_path / "setup-profile"
    host = home / "plugins/reliquary/host/reliquary-hermes-host.exe"
    host.parent.mkdir(parents=True)
    host.touch()
    candidate = {}
    for field, name in (("main_rel", "main.rel"), ("active_phy", "active.phy"), ("config_path", "reliquary.cfg")):
        path = home / name
        path.touch()
        candidate[field] = str(path)
    monkeypatch.delenv(TOKEN_VAR, raising=False)
    def preflight(home, binary, request):
        return {"valid": True, "main_rel": {"owner_id": "general"}, "active_phy": {"owner_id": "identity"},
                "projects": {key: {"owner_id": key} for key in request["owners"]["projects"]}}

    def connect(client, session, *, owners_fingerprint):
        projects = json.loads((home / "reliquary/owners.json").read_bytes())["projects"]
        return {"owners": [{"owner_id": key} for key in ("general", "identity", *projects)],
                "active_phy_id": "identity"}

    monkeypatch.setattr(setup, "_preflight", preflight)
    monkeypatch.setattr(setup.HostClient, "connect_dashboard", connect)
    profile_scope = set_hermes_home_override(home)
    secret_scope = set_secret_scope({}, profile_home=str(home))
    try:
        yield home, candidate
    finally:
        reset_secret_scope(secret_scope)
        reset_hermes_home_override(profile_scope)


def test_fresh_setup_derives_private_values_and_preserves_existing_processing(setup_profile):
    from agent.secret_scope import get_secret

    home, candidate = setup_profile
    state = home / "reliquary"
    before = setup.status(home)
    assert not before["configured"] and before["runtime_detected"]
    assert before["config_path"] is None
    assert setup.validate(home, candidate)["valid"]
    assert not state.exists() and get_secret(TOKEN_VAR) is None

    assert setup.apply(home, candidate)["configured"]
    assert setup.status(home)["configured"]
    token = read_token(home)
    assert len(token) == 43 and get_secret(TOKEN_VAR) == token
    for name in ("owners.json", "provider.json", "processing.json"):
        assert token not in (state / name).read_text(encoding="utf-8")
    assert TOKEN_VAR not in (home / "config.yaml").read_text(encoding="utf-8")

    enrollment = state / "capture-enrollment-v1.json"
    cutoff = enrollment.read_bytes()
    processing = state / "processing.json"
    prior = processing.read_bytes() + b"\n"
    processing.write_bytes(prior)
    candidate.pop("config_path")
    assert setup.apply(home, candidate)["configured"]
    assert processing.read_bytes() == prior
    assert enrollment.read_bytes() == cutoff
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
    with pytest.raises(ContractError, match="invalid_fields"):
        setup.apply(home, {**candidate, "cutoff": 1})
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


def test_destination_allows_validated_paths_and_rejects_profile_or_directory_links(tmp_path, monkeypatch):
    home = tmp_path / "hermes"
    home.mkdir()
    external = tmp_path / "private"
    external.mkdir()
    alias = home / "alias"
    if os.name == "nt":
        # Windows junctions require no developer mode or symbolic-link privilege.
        subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(alias), str(external)],
                       check=True, capture_output=True, timeout=10)
    else:
        alias.symlink_to(external, target_is_directory=True)

    monkeypatch.setattr(setup_paths, "_default_home", lambda: home)
    valid = external / "owner.rel"
    with setup_paths.destination(home, "rel", str(valid)) as path:
        assert path == valid
    with pytest.raises(ContractError, match="invalid_owner_path"):
        with setup_paths.destination(home, "rel", str(home / "profiles/foreign/owner.rel")):
            pytest.fail("accepted a destination in another Hermes profile")
    with pytest.raises(ContractError, match="invalid_owner_path"):
        with setup_paths.destination(home, "rel", str(alias / "new.rel")):
            pytest.fail("accepted creation through a directory link")
    assert not (external / "new.rel").exists()


def test_exited_setup_host_releases_unaccepted_topology(pinned_provider, binaries, setup_hosts, tmp_path):
    binary, cli = binaries
    home = tmp_path / "retry-profile"
    state = home / "reliquary"
    state.mkdir(parents=True)
    install_setup_host(home, binary)
    main, replacement, phy = (home / name for name in ("main.rel", "replacement.rel", "active.phy"))
    owner(cli, "rel", main, "unspecified")
    owner(cli, "rel", replacement, "unspecified")
    owner(cli, "phy", phy)
    runtime_registry = state / "integration-runtimes-v1.json"
    runtime_registry.write_bytes(b"corrupt startup state")
    candidate = {"main_rel": str(main), "active_phy": str(phy)}

    with pytest.raises(HostUnavailable):
        setup.apply(home, candidate)
    assert setup_hosts[0]._process.poll() is not None
    assert not setup.status(home)["configured"]
    assert not (state / "topology-v1.json").exists()

    runtime_registry.unlink()
    assert setup.apply(home, {**candidate, "main_rel": str(replacement)})["configured"]
