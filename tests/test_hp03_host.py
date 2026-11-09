from contextlib import ExitStack
from hashlib import sha256
import os
from pathlib import Path
from shutil import copyfile
import subprocess

import pytest

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN, status_request
from test_hp03_provider import pinned_provider


@pytest.fixture(scope="module")
def binaries():
    names = ("HP03_HOST_BINARY", "HP03_RELIQUARY_CLI")
    values = [os.environ.get(name) for name in names]
    if not any(values):
        pytest.skip("Set HP03_HOST_BINARY and HP03_RELIQUARY_CLI for local process proofs")
    assert all(values), "both HP03 process proof binaries are required"
    paths = tuple(Path(value).resolve() for value in values)
    assert all(path.is_file() for path in paths), "build both HP03 process proof binaries first"
    return paths


def owner(cli, kind, path, scope=None):
    args = [str(cli), kind, "create", str(path)]
    if scope:
        args += ["--scope", scope]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    assert result.returncode == 0, "synthetic Root owner creation failed"
    return decode(result.stdout)["owner"]["owner_id"]


def config(state, main_rel, active_phy, *, profile="profile-a", project_rel=None):
    state.mkdir()
    projects, session_projects = {}, {}
    if project_rel:
        projects["lantern"] = str(project_rel)
        session_projects["session-project"] = "lantern"
    (state / "owners.json").write_bytes(canonical({
        "profile_id": profile, "principal_id": "principal-a", "main_rel": str(main_rel),
        "active_phy": str(active_phy), "projects": projects, "session_projects": session_projects,
    }))


def stop(process):
    if process.poll() is None:
        process.terminate()
    process.wait(timeout=10)


def install_setup_host(home, binary):
    installed = home / "plugins/reliquary/host/reliquary-hermes-host.exe"
    installed.parent.mkdir(parents=True, exist_ok=True)
    copyfile(binary, installed)
    return installed


@pytest.fixture
def setup_hosts(monkeypatch):
    """Track processes launched by the real setup hook for deterministic cleanup."""
    from reliquary_hermes import setup

    clients = []

    def client(*args, **kwargs):
        result = HostClient(*args, **kwargs)
        clients.append(result)
        return result

    monkeypatch.setattr(setup, "HostClient", client)
    yield clients
    for host in clients:
        if host._process is not None:
            stop(host._process)


def candidate(binary, state):
    return subprocess.run([str(binary), "--state-dir", str(state)], input=canonical({"token": TOKEN}),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)


def test_live_host_start_attach_scope_leases_outage_and_restart(tmp_path, binaries):
    binary, cli = binaries
    main_rel, project_rel = tmp_path / "general.rel", tmp_path / "lantern.rel"
    active_phy = tmp_path / "active.phy"
    main_id = owner(cli, "rel", main_rel, "unspecified")
    project_id = owner(cli, "rel", project_rel, "project")
    user_id = owner(cli, "phy", active_phy)
    state = tmp_path / "profile-a"
    config(state, main_rel, active_phy, project_rel=project_rel)

    with ExitStack() as cleanup:
        starter = HostClient(state, "profile-a", "principal-a", TOKEN, binary=binary)
        try:
            general = starter.attach("session-a")
        finally:
            if starter._process is not None:
                cleanup.callback(stop, starter._process)
        assert (general.rel_id, general.user_id) == (main_id, user_id)
        assert starter._process is not None and starter._process.poll() is None
        first_discovery = decode((state / "discovery.json").read_bytes())
        assert TOKEN.encode() not in (state / "discovery.json").read_bytes()
        status = starter.request(status_request())
        assert status.status == "ok" and decode(status.result_json)["pending_jobs"] == 0

        existing = HostClient(state, "profile-a", "principal-a", TOKEN)
        project = existing.attach("session-project", project_id="lantern")
        assert (project.rel_id, project.user_id) == (project_id, user_id)
        assert existing._process is None

        owners_path = state / "owners.json"
        loaded_owners = owners_path.read_bytes()
        fingerprint = sha256(loaded_owners).hexdigest()
        assert existing.read_dashboard_topology(None, owners_fingerprint=fingerprint)["active_phy_id"] == user_id
        owners_path.write_bytes(loaded_owners + b"\n")
        try:
            edited = sha256(owners_path.read_bytes()).hexdigest()
            with pytest.raises(HostUnavailable, match="^service_restart_required$"):
                existing.read_dashboard_topology(None, owners_fingerprint=edited)
            assert existing.read_dashboard_topology(None)["active_phy_id"] == user_id
        finally:
            owners_path.write_bytes(loaded_owners)

        assert first_discovery["hermes_revision"] == "2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19"
        discovery_path = state / "discovery.json"
        # The historical canary pin must fail through normal discovery, even with valid credentials.
        previous_pin = "cf4f3a7396814ffcaef69d9af09f7cfdade3ddbe"
        discovery_path.write_bytes(canonical({**first_discovery, "hermes_revision": previous_pin}))
        try:
            with pytest.raises(HostUnavailable, match="invalid_discovery"):
                existing.attach("session-a")
        finally:
            discovery_path.write_bytes(canonical(first_discovery))

        wrong = HostClient(state, "profile-a", "principal-a", "wrong-" + TOKEN, binary=binary)
        with pytest.raises(HostUnavailable, match="host_authentication"):
            wrong.attach("session-a")
        assert wrong._process is None
        foreign = HostClient(state, "profile-a", "foreign-principal", TOKEN)
        with pytest.raises(HostUnavailable, match="host_denied"):
            foreign.attach("session-a")

        duplicate = candidate(binary, state)
        assert duplicate.returncode != 0 and TOKEN.encode() not in duplicate.stdout + duplicate.stderr
        other_state = tmp_path / "conflicting-profile"
        config(other_state, main_rel, active_phy, profile="profile-b")
        conflict = candidate(binary, other_state)
        assert conflict.returncode != 0 and not (other_state / "discovery.json").exists()
        assert existing.attach("session-project") == project

        stop(starter._process)
        with pytest.raises(HostUnavailable):
            existing.request(status_request("session-project"))
        restart = HostClient(state, "profile-a", "principal-a", TOKEN, binary=binary)
        try:
            assert restart.attach("session-a") == general
        finally:
            if restart._process is not None:
                cleanup.callback(stop, restart._process)
        assert restart.attach("session-project") == project
        second_discovery = decode((state / "discovery.json").read_bytes())
        assert second_discovery["instance_id"] != first_discovery["instance_id"]
        assert second_discovery["lease_id"] != first_discovery["lease_id"]


def test_two_profiles_can_explicitly_select_the_same_read_only_phy(tmp_path, binaries):
    binary, cli = binaries
    active_phy = tmp_path / "active.phy"
    user_id = owner(cli, "phy", active_phy)
    with ExitStack() as cleanup:
        bindings = []
        for name in ("profile-a", "profile-b"):
            rel = tmp_path / f"{name}.rel"
            owner(cli, "rel", rel, "unspecified")
            state = tmp_path / name
            config(state, rel, active_phy, profile=name)
            client = HostClient(state, name, "principal-a", TOKEN, binary=binary)
            try:
                bindings.append(client.attach("session-a"))
            finally:
                if client._process is not None:
                    cleanup.callback(stop, client._process)
        assert bindings[0].rel_id != bindings[1].rel_id
        assert bindings[0].user_id == bindings[1].user_id == user_id


def test_pinned_setup_provider_attaches_and_recovers_real_process(
        tmp_path, binaries, pinned_provider, monkeypatch, setup_hosts):
    from hermes_cli.memory_setup import _post_setup_hook
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    binary, cli = binaries
    home = tmp_path / "hermes-profile"
    home.mkdir()
    main_rel, active_phy = tmp_path / "main.rel", tmp_path / "active.phy"
    rel_id = owner(cli, "rel", main_rel, "unspecified")
    user_id = owner(cli, "phy", active_phy)
    initial_rel = main_rel.read_bytes()
    provider = pinned_provider.ReliquaryMemoryProvider()
    install_setup_host(home, binary)
    values = iter((str(main_rel), str(active_phy), "", ""))
    monkeypatch.setattr("builtins.input", lambda _: next(values))

    def settled():
        from time import monotonic, sleep

        deadline = monotonic() + 8
        while provider.lifecycle_status == "connecting" and monotonic() < deadline:
            sleep(0.01)
        assert provider.lifecycle_status == "attached"

    scope = set_hermes_home_override(home)
    try:
        assert _post_setup_hook(provider, {})
        [setup_host] = setup_hosts
        original = setup_host._process
        assert original is not None and original.poll() is None
        assert provider.is_available()
        provider.initialize("session-a", hermes_home=str(home), agent_identity="ignored-bot")
        try:
            settled()
            initial = provider.binding
            assert (initial.rel_id, initial.user_id) == (rel_id, user_id)
            provider.sync_turn("synthetic user", "synthetic assistant", session_id="session-a")
            assert provider.sync_status == "source_ingestion_unavailable"
            assert provider._client._process is None
            stop(original)
            provider.on_turn_start(2, "synthetic follow-up")
            settled()
            restarted = provider._client._process
            assert restarted is not None and restarted is not original and restarted.poll() is None
            assert provider.binding == initial
        finally:
            if provider._client is not None and provider._client._process is not None:
                stop(provider._client._process)
            provider.shutdown()
    finally:
        reset_hermes_home_override(scope)
    assert main_rel.read_bytes() == initial_rel
