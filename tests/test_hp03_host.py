from contextlib import ExitStack
from hashlib import sha256
import json
import os
from pathlib import Path
from shutil import copy
import subprocess

import pytest

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.settings import TOKEN_VAR, save_settings
from reliquary_hermes.setup import packaged_host_path
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN, status_request
from test_hp03_provider import _settled, pinned_provider


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


def owner(cli, kind, path):
    args = [str(cli), kind, "create", str(path)]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    assert result.returncode == 0, "synthetic Root owner creation failed"
    return decode(result.stdout)["owner"]["owner_id"]


def legacy_rel(path, scope):
    fixtures = Path(__file__).resolve().parents[1] / "host/tests/support/legacy-rel-2.1.json"
    row = next(row for row in json.loads(fixtures.read_bytes()) if row["scope"] == scope)
    path.write_bytes(bytes.fromhex(row["hex"]))
    return row["owner_id"]


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
    installed = packaged_host_path(home)
    installed.parent.mkdir(parents=True, exist_ok=True)
    copy(binary, installed)
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
    main_id = legacy_rel(main_rel, "organization")
    project_id = legacy_rel(project_rel, "connection")
    original = {path: sha256(path.read_bytes()).digest() for path in (main_rel, project_rel)}
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
    assert {path: sha256(path.read_bytes()).digest() for path in original} == original


def test_stock_provider_preserves_accepted_project_route_after_downgrade(
        tmp_path, binaries, pinned_provider, monkeypatch):
    from agent import memory_provider
    from agent.memory_manager import MemoryManager
    from hermes_cli.projects_db import connect_closing, create_project

    binary, cli = binaries
    main_rel, project_rel, active_phy = (tmp_path / name for name in ("main.rel", "lantern.rel", "active.phy"))
    main_id = owner(cli, "rel", main_rel)
    dedicated_id = owner(cli, "rel", project_rel)
    phy_id = owner(cli, "phy", active_phy)
    project_folder = tmp_path / "lantern"
    project_folder.mkdir()
    with connect_closing(tmp_path / "projects.db") as registry:
        project_id = create_project(registry, name="Lantern", folders=[str(project_folder)])
    save_settings(tmp_path, {"profile_id": "profile-a", "principal_id": "principal-a",
                             "main_rel": str(main_rel), "active_phy": str(active_phy),
                             "projects": {project_id: str(project_rel)}, "binary": str(binary)})
    (tmp_path / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
    state = tmp_path / "reliquary"

    with ExitStack() as cleanup:
        def start(session_id, **metadata):
            manager = MemoryManager()
            provider = pinned_provider.ReliquaryMemoryProvider()
            manager.add_provider(provider)

            def close():
                client = provider._client
                manager.shutdown_all()
                if client is not None and client._process is not None:
                    stop(client._process)

            cleanup.callback(close)
            manager.initialize_all(session_id, hermes_home=str(tmp_path), cwd=str(project_folder), **metadata)
            _settled(provider, "attached", timeout=10)
            process = provider._client._process
            assert process is not None
            return manager, provider, process

        with monkeypatch.context() as capable:
            capable.setattr(memory_provider, "SESSION_PROJECT_ATTRIBUTION_VERSION", 1, raising=False)
            manager, provider, process = start("existing-project", session_project_id=project_id)
            accepted = provider.binding
            assert (accepted.rel_id, accepted.user_id) == (dedicated_id, phy_id)
            manager.shutdown_all()
            assert process.wait(timeout=10) == 0

        [route] = (state / "sessions-v1").glob("*.json")
        saved = {path: path.read_bytes() for path in (route, state / "topology-v1.json", state / "owners.json")}

        assert not pinned_provider.routing_available()
        manager, provider, process = start("fresh-project")
        assert (provider.binding.rel_id, provider.binding.user_id) == (main_id, phy_id)
        client = provider._client
        assert client.read_dashboard_topology("fresh-project")["session_owner_id"] == main_id
        manager.on_session_switch("existing-project")
        _settled(provider, "attached", timeout=10)
        assert provider.binding == accepted
        assert client.read_dashboard_topology("existing-project")["session_owner_id"] == dedicated_id
        manager.shutdown_all()
        assert process.wait(timeout=10) == 0

    assert {path: path.read_bytes() for path in saved} == saved


def test_reviewed_switch_keeps_the_process_and_pins_session_and_source_owners(
        tmp_path, binaries, pinned_provider, monkeypatch):
    from agent import memory_provider
    from agent.secret_scope import reset_secret_scope, set_secret_scope
    from hermes_cli.projects_db import connect_closing, create_project
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from reliquary_hermes import dashboard_api, setup
    from reliquary_hermes.outbox import SourceOutbox
    from reliquary_hermes.validation import ContractError
    from test_hp04_outbox import snapshot

    binary, cli = binaries
    home = tmp_path / "profile"
    home.mkdir()
    general, project, next_general, next_project, phy, next_phy = (
        tmp_path / name for name in ("main.rel", "project.rel", "new-main.rel", "new-project.rel",
                                     "active.phy", "new-active.phy"))
    owners = {path: owner(cli, "rel", path) for path in (general, project, next_general, next_project)}
    owners.update({path: owner(cli, "phy", path) for path in (phy, next_phy)})
    headers = {path: path.read_bytes()[:40] for path in owners}
    with connect_closing(home / "projects.db") as database:
        project_id = create_project(database, name="Lantern", folders=[str(tmp_path)])
    monkeypatch.setattr(memory_provider, "SESSION_PROJECT_ATTRIBUTION_VERSION", 1, raising=False)
    save_settings(home, {"profile_id": "profile-a", "principal_id": "principal-a", "binary": str(binary),
                         "main_rel": str(general), "active_phy": str(phy),
                         "projects": {project_id: str(project)}})
    state = home / "reliquary"
    (state / "topology-v1.json").write_bytes(canonical({
        "version": 1, "profile_id": "profile-a", "principal_id": "principal-a",
        "main_rel": owners[general], "active_phy": owners[phy],
        "projects": {project_id: {"parent_id": owners[general], "rel_id": owners[project]}},
    }))
    routes = state / "sessions-v1"
    routes.mkdir()
    original_route = routes / (sha256(b"legacy-session").hexdigest() + ".json")
    original_route.write_bytes(canonical({"session_id": "legacy-session", "project_id": None,
                                          "rel_id": owners[general]}))
    original_route_bytes = original_route.read_bytes()

    profile_scope = set_hermes_home_override(home)
    secret_scope = set_secret_scope({TOKEN_VAR: TOKEN}, profile_home=str(home))
    try:
        with ExitStack() as cleanup:
            client = HostClient(state, "profile-a", "principal-a", TOKEN, binary=binary)
            try:
                legacy = client.attach("legacy-session")
            finally:
                if client._process is not None:
                    cleanup.callback(stop, client._process)
            dedicated = client.attach("existing-project", project_id=project_id)
            assert (legacy.rel_id, legacy.user_id) == (owners[general], owners[phy])
            assert (dedicated.rel_id, dedicated.user_id) == (owners[project], owners[phy])
            running = client._read_discovery()
            foreign = HostClient(state, "profile-a", "foreign-principal", TOKEN)
            with pytest.raises(HostUnavailable, match="host_denied"):
                foreign.switch_status()
            queue = SourceOutbox(state, "profile-a", "principal-a")
            key = queue.enqueue_manual(snapshot("prior-history"), owner_id=owners[general],
                                       phy_id=owners[phy])
            job = queue.next_job("prior-history", manual_only=True)
            assert job.idempotency_key == key

            def review(changes):
                response = setup.validate(home, changes, project_aware=True)
                assert response["valid"]
                return {**changes, "switch_review": response["switch_review"]}

            changes = {"main_rel": str(next_general), "projects": {project_id: str(next_project)}}
            # Supply the profile scope of an admitted Hermes request. The
            # dashboard still checks same origin and uses real Setup and native calls.
            monkeypatch.setattr(dashboard_api, "_host_home", lambda _request: home)
            monkeypatch.setattr(dashboard_api, "_require_hermes_auth", lambda *_: None)
            app = FastAPI()
            app.include_router(dashboard_api.router)
            with TestClient(app) as dashboard:
                origin = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
                checked = dashboard.post("/setup-v1/validate", json=changes, headers=origin)
                assert checked.status_code == 200, checked.text
                rel_switch = {**changes, "switch_review": checked.json()["switch_review"]}
                denied = dashboard.post("/setup-v1/apply", json=rel_switch)
                assert denied.status_code == 403
                applied = dashboard.post("/setup-v1/apply", json=rel_switch, headers=origin)
                assert applied.status_code == 200 and applied.json()["configured"], applied.text
            assert client._read_discovery() == running
            assert client.attach("legacy-session") == legacy
            assert client.attach("existing-project") == dedicated
            assert client.read_dashboard_topology("legacy-session")["session_owner_id"] == legacy.rel_id
            assert client.attach("new-general").rel_id == owners[next_general]
            assert client.attach("new-project", project_id=project_id).rel_id == owners[next_project]
            with pytest.raises(ContractError, match="^owner_switch_stale$"):
                setup.apply(home, rel_switch, project_aware=True)

            assert setup.apply(home, review({"active_phy": str(next_phy)}))["configured"]
            assert client._read_discovery() == running
            scoped = client.attach("new-phy-session")
            assert (scoped.rel_id, scoped.user_id) == (owners[next_general], owners[next_phy])
            with pytest.raises(HostUnavailable, match="session_phy_inactive"):
                client.attach("legacy-session")
            with pytest.raises(HostUnavailable, match="source_phy_inactive"):
                client.deliver_source_job(job)
            assert queue.next_job("prior-history", manual_only=True).idempotency_key == key
            topology = client.read_dashboard_topology(None)
            assert topology["active_phy_id"] == owners[next_phy]
            assert owners[phy] not in {row["owner_id"] for row in topology["owners"]}

            assert setup.apply(home, review({"active_phy": str(phy)}))["configured"]
            assert client.attach("legacy-session") == legacy
            assert client.deliver_source_job(job)
            assert client.read_source_status("prior-history")["owner_id"] == owners[general]
            assert original_route.read_bytes() == original_route_bytes

            stop(client._process)
            assert {path: path.read_bytes()[:40] for path in owners} == headers
            configured = setup.status(home)
            assert Path(configured["defaults"]["main_rel"]) == next_general
            assert Path(configured["defaults"]["projects"][project_id]) == next_project
            restarted = HostClient(state, "profile-a", "principal-a", TOKEN, binary=binary)
            try:
                assert restarted.attach("legacy-session") == legacy
            finally:
                if restarted._process is not None:
                    cleanup.callback(stop, restarted._process)
            assert restarted.attach("existing-project") == dedicated
            assert restarted.attach("post-restart").rel_id == owners[next_general]
            assert restarted.attach("post-restart-project", project_id=project_id).rel_id == owners[next_project]
            with pytest.raises(HostUnavailable, match="session_phy_inactive"):
                restarted.attach("new-phy-session")
    finally:
        reset_secret_scope(secret_scope)
        reset_hermes_home_override(profile_scope)


def test_two_profiles_can_explicitly_select_the_same_read_only_phy(tmp_path, binaries):
    binary, cli = binaries
    active_phy = tmp_path / "active.phy"
    user_id = owner(cli, "phy", active_phy)
    with ExitStack() as cleanup:
        bindings = []
        for name in ("profile-a", "profile-b"):
            rel = tmp_path / f"{name}.rel"
            owner(cli, "rel", rel)
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
    from agent.secret_scope import load_env_file, reset_secret_scope, set_secret_scope
    from hermes_cli.memory_setup import _post_setup_hook
    from hermes_cli.projects_db import connect_closing, create_project
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    from reliquary_hermes import setup, setup_paths

    binary, cli = binaries
    home = tmp_path / "hermes-profile"
    home.mkdir()
    main_rel, active_phy = tmp_path / "main.rel", tmp_path / "active.phy"
    rel_id = legacy_rel(main_rel, "project")
    user_id = owner(cli, "phy", active_phy)
    initial_rel = main_rel.read_bytes()
    provider = pinned_provider.ReliquaryMemoryProvider()
    install_setup_host(home, binary)
    with connect_closing(home / "projects.db") as registry:
        project = create_project(registry, name="Lantern", folders=[str(tmp_path)])
    monkeypatch.setattr(setup_paths, "_default_home", lambda: home)
    values = iter((str(main_rel), str(active_phy), "", ""))
    monkeypatch.setattr("builtins.input", lambda _: next(values))

    def settled():
        from time import monotonic, sleep

        deadline = monotonic() + 8
        while provider.lifecycle_status == "connecting" and monotonic() < deadline:
            sleep(0.01)
        assert provider.lifecycle_status == "attached"

    scope = set_hermes_home_override(home)
    secret_scope = set_secret_scope(load_env_file(home / ".env"), profile_home=str(home))
    try:
        dedicated = tmp_path / "new-dedicated.rel"
        created = setup.create(home, {"kind": "project_rel", "path": str(dedicated), "project_id": project})
        assert created["scope"] == "unspecified"
        cross_role = setup.validate(home, {"main_rel": str(dedicated), "active_phy": str(active_phy)})
        assert cross_role["valid"]
        assert cross_role["main_rel"]["owner_id"] == created["owner_id"]

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
            assert provider.sync_status == "source_capture_session_unavailable"
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
        reset_secret_scope(secret_scope)
        reset_hermes_home_override(scope)
    assert main_rel.read_bytes() == initial_rel
