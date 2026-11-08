from contextlib import ExitStack
import os
from pathlib import Path
import subprocess

import pytest

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN, status_request


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
        project = existing.attach("session-project")
        assert (project.rel_id, project.user_id) == (project_id, user_id)
        assert existing._process is None
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
