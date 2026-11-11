"""Desktop and web compatibility through real Hermes gateways and isolated plugin workers."""

from hashlib import file_digest
import json
import os
from pathlib import Path
from shutil import copyfile, copytree
import subprocess
import sys
import time

import pytest

from reliquary_hermes.client import HostClient
from reliquary_hermes.settings import TOKEN_VAR, read_settings
from test_hp03_host import binaries, install_setup_host, owner
from test_hu03_dashboard import _request, _stage_plugin


@pytest.fixture(scope="module", params=[
    pytest.param(("HU06_HERMES_STOCK_CHECKOUT", False), id="stock"),
    pytest.param(("HU05_HERMES_HOSTED_CHECKOUT", True), id="native-admission"),
])
def hosted_checkout(request):
    env_name, native_mutations = request.param
    value = os.environ.get(env_name)
    if not value:
        pytest.skip(f"Set {env_name} to the Hermes installation under test")
    checkout = Path(value).resolve()
    assert (checkout / "hermes_cli/plugin_host_child.py").is_file(), f"Hermes worker not found in {checkout}"
    return checkout, native_mutations


@pytest.fixture(scope="module")
def plugin_artifact():
    value = os.environ.get("HU06_PLUGIN_DIR")
    if not value:
        return None
    artifact = Path(value).resolve()
    for name in ("plugin.yaml", "dashboard/manifest.json", "dashboard/dist/index.js", "desktop/plugin.js"):
        assert (artifact / name).is_file(), f"Missing {name} in HU06_PLUGIN_DIR"
    return artifact


def _release_host(home):
    discovery = home / "reliquary/discovery.json"
    if not discovery.exists():
        return
    from dotenv import dotenv_values

    # Read the temporary profile without importing another Hermes checkout into pytest.
    token = dotenv_values(home / ".env", interpolate=False)[TOKEN_VAR]
    assert isinstance(token, str) and token
    settings = read_settings(home)
    guard = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, token)
    guard.attach("hu05-hosted-proof")
    guard.attach_runtime("hu05-hosted-proof")
    guard.detach_runtime()
    deadline = time.monotonic() + 10
    while discovery.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not discovery.exists()


def test_hosted_desktop_compatibility(tmp_path, hosted_checkout, binaries, plugin_artifact):
    checkout, native_mutations = hosted_checkout
    binary, cli = binaries
    launch = tmp_path / "hermes"
    homes = {"default": launch, "secondary": launch / "profiles/secondary"}
    owners = {}
    community_rel = os.environ.get("HU06_COMMUNITY_REL")
    for profile, home in homes.items():
        if plugin_artifact is None:
            _stage_plugin(home)
            install_setup_host(home, binary)
        else:
            copytree(plugin_artifact, home / "plugins/reliquary")
            installed = home / "plugins/reliquary/host/reliquary-hermes-host.exe"
            with installed.open("rb") as actual, binary.open("rb") as expected:
                assert file_digest(actual, "sha256").digest() == file_digest(expected, "sha256").digest()
            (home / "config.yaml").write_text("plugins:\n  enabled: [reliquary-hermes]\n", encoding="utf-8")
        if profile == "secondary":
            continue
        main, phy = home / "main.rel", home / "active.phy"
        if community_rel:
            copyfile(community_rel, main)
            result = subprocess.check_output([str(cli), "rel", "community", "list", str(main)], timeout=10)
            page = json.loads(result)["page"]
            assert any(item["value"]["current"] for item in page["items"]), "Community fixture has no current partition"
            main_id = bytes(page["cut"]["owner_id"]).hex()
        else:
            main_id = owner(cli, "rel", main, "unspecified")
        owners[profile] = {"main": main_id, "phy": owner(cli, "phy", phy)}
    (launch / "config.yaml").write_text("plugins:\n  enabled: [reliquary-hermes]\n  isolation: host\n", encoding="utf-8")

    script = """
from contextlib import ExitStack
import json
import os
from pathlib import Path
import sys
from time import monotonic, sleep
from types import SimpleNamespace

from fastapi.testclient import TestClient
from gateway.runtime_bootstrap import TicketStore
from gateway.session_authorities import SessionAuthorities
from hermes_cli import plugins, profiles, projects_db, web_server as web
from hermes_cli.dashboard_auth.native_http import HEADER
from hermes_state import SessionDB

fixture = json.load(sys.stdin)
sys.path[:0] = [fixture["tests_root"], fixture["source_root"]]
from test_hp04_host import TEXT, _loopback_model, _processing_config

native_mutations = fixture["native_mutations"]
home = Path(os.environ["HERMES_HOME"]).resolve()
homes = {"default": home, "secondary": home / "profiles/secondary"}
profiles._get_default_hermes_home = lambda: home
profiles._get_profiles_root = lambda: home / "profiles"
instance = "hu06-hosted-desktop"
registry = SessionAuthorities(home, multiplexed=True)
for name, selected in homes.items():
    registry.add(selected, SimpleNamespace(profile_id=str(selected), instance_id=instance), name=name)
store = TicketStore(instance, registry.profile_ids())
web.app.state.gateway_runner = SimpleNamespace(
    _draining=False, session_authorities=registry, session_ticket_store=store,
    session_runtime_descriptor={"state": "ready", "instance_id": instance,
                                "served_profiles": registry.served_profiles()},
)

async def loopback(scope, receive, send):
    await web.app({**scope, "hermes.gateway_socket_peer": ("127.0.0.1", 12345)}, receive, send)

def grant(name):
    return {HEADER: store.mint(profile_id=str(homes[name]), subject="desktop", purpose="native-http")}

def writer(name):
    return grant(name) if native_mutations else same_origin

setup_api = "/api/plugins/reliquary-hermes/setup-v1"
dashboard = "/api/plugins/reliquary-hermes/dashboard-v1"
sources_api = "/api/plugins/reliquary-hermes/sources-v1"
history_supported = getattr(SessionDB, "HISTORY_EXPORT_VERSION", None) == 2
history_rows = {}
history_secret = "opaque-hu08-test-only-71de8a"
if history_supported:
    for name, selected in homes.items():
        with SessionDB(selected / "state.db") as db:
            session_id = "history-" + name
            db.create_session(session_id, source="cli", profile_name=name)
            db.set_session_title(session_id, "Synthetic saved conversation")
            db.append_message(session_id, "user", "Saved synthetic preference " + history_secret)
            db.append_message(session_id, "assistant", "Authorization: Bearer " + history_secret)
            history_rows[name] = db.get_messages(session_id)
            TEXT.update({row["message_uid"]: row["content"] for row in history_rows[name]})
auth = {web._SESSION_HEADER_NAME: web._SESSION_TOKEN}
same_origin = {**auth, "Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
cross_origin = {**auth, "Origin": "http://other.test", "Sec-Fetch-Site": "cross-site"}

def reply(response):
    assert response.status_code == 200, response.text
    return response.json()

with ExitStack() as stack:
    model_url = stack.enter_context(_loopback_model())
    stack.callback(plugins._reset_plugin_managers_for_tests)
    # Root must process the first history window before the following manual window is delivered.
    for selected in homes.values():
        processing_home = selected / "reliquary"
        processing_home.mkdir(parents=True, exist_ok=True)
        _processing_config(Path(fixture["cli"]), processing_home, model_url)
    client = stack.enter_context(TestClient(loopback))
    for profile, selected in homes.items():
        params = {} if profile == "default" else {"profile": profile}
        other = "secondary" if profile == "default" else "default"
        candidate = {"main_rel": str(selected / "main.rel"), "active_phy": str(selected / "active.phy")}
        ticket = grant(profile)
        status = client.get(setup_api + "/status", headers=ticket, params=params)
        reported = reply(status)
        assert not reported["configured"] and reported["desktop_native_mutations"] is native_mutations
        assert ticket[HEADER] not in status.text and HEADER not in status.text
        assert client.get(setup_api + "/status", headers=ticket, params=params).status_code == 401
        assert client.get(setup_api + "/status", headers=grant(profile), params={"profile": other}).status_code == 403
        assert client.get(setup_api + "/status", headers={**grant(profile), "Origin": "http://testserver"},
                          params=params).status_code == 401
        spoofed = client.request("GET", setup_api + "/status", headers={**same_origin,
                                 "hosted_native_http_authenticated": "true", "desktop_native_mutations": "true"},
                                 params={**params, "desktop_native_mutations": "true"},
                                 json={"desktop_native_mutations": True})
        assert reply(spoofed)["desktop_native_mutations"] is False
        assert client.post(setup_api + "/apply", params=params, json=candidate).status_code == 401
        assert client.get(sources_api + "/sessions", params=params).status_code == 401
        for headers in (auth, cross_origin, {**auth, "hosted_native_http_authenticated": "true"}):
            assert client.post(setup_api + "/apply", headers=headers, params=params, json=candidate).status_code == 403
        assert client.post(setup_api + "/apply", headers={**grant(profile), "Origin": "http://testserver"},
                           params=params, json=candidate).status_code == 401
        assert client.post(setup_api + "/apply", headers=grant(profile), params={"profile": other},
                           json=candidate).status_code == 403
        assert not (selected / "reliquary/owners.json").exists()
        if profile == "secondary":
            with projects_db.connect_closing(db_path=selected / "projects.db") as db:
                dedicated = projects_db.create_project(db, name="HU05 Dedicated", folders=[str(selected)])
                general = projects_db.create_project(db, name="HU05 General fallback")
                archived = projects_db.create_project(db, name="Archived")
                projects_db.archive_project(db, archived)
            listed = reply(client.get(setup_api + "/projects", headers=grant(profile), params=params))
            assert {entry["id"] for entry in listed["projects"]} == {dedicated, general}
            assert reply(client.get(setup_api + "/projects", headers=auth))["projects"] == []
            assert client.get(setup_api + "/projects", headers=grant("default"), params=params).status_code == 403
            project_file = selected / "project.rel"
            project_body = {"kind": "project_rel", "path": str(project_file), "project_id": dedicated}
            assert client.post(setup_api + "/create", headers=cross_origin, params=params,
                               json=project_body).status_code == 403
            stale = client.post(setup_api + "/create", headers=writer(profile), params=params,
                                json={**project_body, "project_id": archived})
            assert stale.status_code == 409 and stale.json()["detail"] == "unknown_hermes_project"
            assert not project_file.exists()
            created = {}
            for key, body, scope in (
                ("main", {"kind": "general_rel", "path": candidate["main_rel"]}, "unspecified"),
                ("phy", {"kind": "phy", "path": candidate["active_phy"]}, None),
                ("project", project_body, "project"),
            ):
                report = reply(client.post(setup_api + "/create", headers=writer(profile), params=params, json=body))
                assert report["accepted"] and report["opened"] and report["scope"] == scope
                assert report["path"] == body["path"]
                created[key] = report["owner_id"]
            fixture["owners"][profile] = created
            existing = client.post(setup_api + "/create", headers=writer(profile), params=params, json=project_body)
            assert existing.status_code == 409 and existing.json()["detail"] == "owner_already_exists"
            assert client.get(setup_api + "/browse", headers=auth,
                              params=params).status_code == 404
            candidate["projects"] = {dedicated: str(project_file)}
        web_validation = reply(client.post(setup_api + "/validate", headers=same_origin, params=params, json=candidate))
        assert web_validation["valid"], web_validation
        if not native_mutations:
            for action in ("validate", "apply"):
                blocked = client.post(setup_api + "/" + action, headers=grant(profile), params=params, json=candidate)
                assert blocked.status_code == 403 and blocked.json()["detail"] == "same_origin_required"
        validation = reply(client.post(setup_api + "/validate", headers=writer(profile), params=params, json=candidate))
        assert validation["valid"] and validation["main_rel"]["owner_id"] == fixture["owners"][profile]["main"]
        ticket = writer(profile)
        assert reply(client.post(setup_api + "/apply", headers=ticket, params=params, json=candidate))["configured"]
        if native_mutations:
            assert client.post(setup_api + "/apply", headers=ticket, params=params, json=candidate).status_code == 401
        status = reply(client.get(setup_api + "/status", headers=grant(profile), params=params))
        assert status["configured"] and status["desktop_native_mutations"] is native_mutations
        if profile == "secondary":
            assert status["defaults"]["projects"] == candidate["projects"]
            unchanged = reply(client.post(setup_api + "/validate", headers=writer(profile),
                                          params=params, json=candidate))
            assert unchanged["valid"] and unchanged["projects"][dedicated]["owner_id"] == created["project"]
            assert reply(client.post(setup_api + "/apply", headers=writer(profile),
                                     params=params, json=candidate))["configured"]
            saved = selected / "reliquary/owners.json"
            raw = saved.read_bytes()
            saved.write_bytes(raw + b"\\n")
            drift = client.post(setup_api + "/apply", headers=writer(profile), params=params, json=candidate)
            assert drift.status_code == 409 and drift.json()["detail"] == "service_restart_required"
            saved.write_bytes(raw)
            conflict = client.post(setup_api + "/apply", headers=writer(profile), params=params,
                                   json={**candidate, "projects": {}})
            assert conflict.status_code == 409 and conflict.json()["detail"] == "service_restart_required"

        discovery = reply(client.post(dashboard, headers=grant(profile), params=params, json=fixture["request"]))
        assert discovery["status"] == "ok", discovery
        owners = discovery["result"]["owners"]["items"]
        assert {row["owner_id"] for row in owners} == set(fixture["owners"][profile].values())
        main = next(row for row in owners if row["owner_id"] == fixture["owners"][profile]["main"])
        assert main["capabilities"]["manage"]
        if profile == "default" and fixture["community_seeded"]:
            list_communities = {**fixture["request"], "operation": "ui.community_list",
                                **{key: main[key] for key in ("owner_id", "generation", "cut")},
                                "arguments": {"cursor": None, "limit": 128}}
            listed = reply(client.post(dashboard, headers=grant(profile), params=params, json=list_communities))
            assert listed["status"] == "ok", listed
            community = listed["result"]["communities"]["items"][0]
            rename = {**list_communities, "operation": "ui.community_rename", "idempotency_key": "rename",
                      "expected_revision": community["generation"],
                      "arguments": {"community_id": community["community_id"], "name": "HU06 hosted proof"}}
            renamed = reply(client.post(dashboard, headers=writer(profile), params=params, json=rename))
            assert renamed["status"] == "ok" and renamed["result"]["committed"]["name"] == "HU06 hosted proof", renamed
            main = renamed["binding"]
        mutation = {**fixture["request"], "request_id": "hosted-write", "operation": "ui.memory_create",
                    **{key: main[key] for key in ("owner_id", "generation", "cut")}, "idempotency_key": "native-create",
                    "arguments": {"title": "Hosted Desktop proof", "body": "Synthetic profile-scoped note.",
                                  "category": "fact", "memory_type": "semantic"}}
        assert reply(client.post(dashboard, headers=auth, params=params, json=mutation))["status"] == "denied"
        assert reply(client.post(dashboard, headers=cross_origin, params=params, json=mutation))["status"] == "denied"
        if not native_mutations:
            assert reply(client.post(dashboard, headers=grant(profile), params=params, json=mutation))["status"] == "denied"
        ticket = writer(profile)
        created = reply(client.post(dashboard, headers=ticket, params=params, json=mutation))
        assert created["status"] == "ok", created
        if native_mutations:
            assert client.post(dashboard, headers=ticket, params=params, json=mutation).status_code == 401
        committed = created["result"]["committed"]["memory"]
        detail = {**mutation, "request_id": "hosted-read", "operation": "ui.memory_detail", "idempotency_key": None,
                  "cut": created["binding"]["cut"], "arguments": {"memory_id": committed["memory_id"], "revision": None}}
        observed = reply(client.post(dashboard, headers=grant(profile), params=params, json=detail))
        assert observed["status"] == "ok", observed
        assert observed["result"]["body"]["content"] == "Synthetic profile-scoped note."

        edit = {**mutation, "request_id": "hosted-edit", "operation": "ui.memory_edit", "idempotency_key": "native-edit",
                "cut": created["binding"]["cut"], "expected_revision": committed["revision"],
                "arguments": {"memory_id": committed["memory_id"], "title": "Edited Desktop proof",
                              "body": "Corrected worker-verified note."}}
        edited = reply(client.post(dashboard, headers=writer(profile), params=params, json=edit))
        assert edited["status"] == "ok", edited
        replacement = edited["result"]["committed"]["replacement"]["memory"]
        assert replacement["memory_id"] != committed["memory_id"]
        detail.update(cut=edited["binding"]["cut"], arguments={"memory_id": replacement["memory_id"], "revision": None})
        observed = reply(client.post(dashboard, headers=grant(profile), params=params, json=detail))
        assert observed["status"] == "ok", observed
        assert observed["result"]["body"]["content"] == "Corrected worker-verified note."

        retire = {**edit, "request_id": "hosted-retire", "operation": "ui.memory_retire", "idempotency_key": "native-retire",
                  "cut": edited["binding"]["cut"],
                  "expected_revision": edited["result"]["committed"]["original_revision"],
                  "arguments": {"memory_id": committed["memory_id"], "effect": "retire"}}
        retired = reply(client.post(dashboard, headers=writer(profile), params=params, json=retire))
        assert retired["status"] == "ok", retired
        assert retired["result"]["committed"]["lifecycle"] == "tombstoned"
        detail.update(cut=retired["binding"]["cut"], arguments={"memory_id": committed["memory_id"], "revision": None})
        observed = reply(client.post(dashboard, headers=grant(profile), params=params, json=detail))
        assert observed["status"] == "ok", observed
        assert observed["result"]["tombstone"] and observed["result"]["body"]["content"] is None

        web_create = {**mutation, "request_id": "hosted-web-create", "idempotency_key": "web-create",
                      "cut": retired["binding"]["cut"],
                      "arguments": {**mutation["arguments"], "title": "Same-origin dashboard proof"}}
        web_created = reply(client.post(dashboard, headers=same_origin, params=params, json=web_create))
        assert web_created["status"] == "ok", web_created
        peer = web_created["result"]["committed"]["memory"]
        link = {**mutation, "request_id": "hosted-link", "operation": "ui.relation_change", "idempotency_key": "link",
                "cut": web_created["binding"]["cut"],
                "arguments": {"source_id": replacement["memory_id"], "source_revision": replacement["revision"],
                              "target_id": peer["memory_id"], "target_revision": peer["revision"],
                              "action": "link", "relation_kind": "user_association", "edge_id": None}}
        linked = reply(client.post(dashboard, headers=writer(profile), params=params, json=link))
        assert linked["status"] == "ok" and linked["result"]["committed"]["active"], linked
        edge = linked["result"]["committed"]
        unlink = {**link, "request_id": "hosted-unlink", "idempotency_key": "unlink", "cut": linked["binding"]["cut"],
                  "expected_revision": edge["revision"],
                  "arguments": {**link["arguments"], "action": "unlink", "edge_id": edge["edge_id"]}}
        unlinked = reply(client.post(dashboard, headers=writer(profile), params=params, json=unlink))
        assert unlinked["status"] == "ok" and not unlinked["result"]["committed"]["active"], unlinked

        history_page = client.get(sources_api + "/sessions", headers=grant(profile),
                                  params={**params, "q": "Synthetic saved"})
        history = reply(history_page)
        assert history_secret not in history_page.text
        assert history["available"] is history_supported
        if history_supported:
            session_id = "history-" + profile
            [session] = history["sessions"]
            assert session["session_id"] == session_id and session["status"] == "available"
            expected_owners = {fixture["owners"][profile]["main"]}
            if profile == "secondary":
                expected_owners.add(fixture["owners"][profile]["project"])
            assert {row["owner_id"] for row in history["destinations"]} == expected_owners
            destination = fixture["owners"][profile]["project" if profile == "secondary" else "main"]
            request = {"session_ids": [session_id], "owner_id": destination, "confirm": True}
            assert client.post(sources_api + "/import", headers=cross_origin, params=params,
                               json=request).status_code == 403
            assert client.post(sources_api + "/import", headers=same_origin, params=params,
                               json={**request, "confirm": False}).status_code == 400
            assert client.post(sources_api + "/import", headers=same_origin, params=params,
                               json={**request, "owner_id": fixture["owners"][profile]["phy"]}).status_code == 403
            foreign = reply(client.post(sources_api + "/import", headers=same_origin, params=params,
                                        json={**request, "session_ids": ["history-" + other]}))
            assert foreign["sessions"][0]["status"] == "unavailable"
            check = {"session_ids": [session_id]}
            untouched = reply(client.post(sources_api + "/status", headers=grant(profile), params=params, json=check))
            assert untouched["sessions"][0]["status"] == "available"
            def submit():
                headers = writer(profile) if profile == "secondary" else same_origin
                return reply(client.post(sources_api + "/import", headers=headers, params=params, json=request))
            result = submit()
            assert result["sessions"][0]["status"] in {"queued", "staged", "processing", "complete"}, result
            deadline = monotonic() + 20
            while monotonic() < deadline:
                result = reply(client.post(sources_api + "/status", headers=grant(profile), params=params, json=check))
                if result["sessions"][0]["status"] == "complete":
                    break
                sleep(0.1)
            assert result["sessions"][0]["status"] in {"staged", "processing", "complete"}, result
            assert submit()["sessions"][0]["status"] == "already_imported"
            with SessionDB(selected / "state.db", read_only=True) as db:
                assert db.get_messages(session_id) == history_rows[profile]

    workers = {manager.home_path: manager._plugin_host_instance for manager in plugins._known_plugin_managers()
               if getattr(manager, "_plugin_host_instance", None) is not None}
    assert set(homes.values()) <= workers.keys(), workers
    pids = {workers[home].pid for home in homes.values() if workers[home].alive}
    assert len(pids) == 2 and os.getpid() not in pids, pids
"""
    env = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(HERMES_HOME=str(launch), HERMES_KANBAN_HOME=str(tmp_path / "kanban"),
               USERPROFILE=str(tmp_path), APPDATA=str(tmp_path), LOCALAPPDATA=str(tmp_path / "local-app-data"),
               TEMP=str(tmp_path), TMP=str(tmp_path), TMPDIR=str(tmp_path), PYTHONDONTWRITEBYTECODE="1",
               HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0", PYTHONPATH=str(checkout))
    try:
        # On Windows, worker descendants can keep inherited capture pipes open.
        log = tmp_path / "hosted-probe.log"
        with log.open("w", encoding="utf-8") as output:
            result = subprocess.run([sys.executable, "-B", "-c", script], cwd=tmp_path, env=env, text=True,
                                    stdout=output, stderr=subprocess.STDOUT,
                                    input=json.dumps({"owners": owners, "request": _request(),
                                                      "native_mutations": native_mutations,
                                                      "community_seeded": bool(community_rel),
                                                      "tests_root": str(Path(__file__).parent.resolve()),
                                                      "source_root": str(Path(__file__).parent.parent / "src"),
                                                      "cli": str(cli.resolve())}), timeout=150)
        assert result.returncode == 0, log.read_text(encoding="utf-8", errors="replace")
    finally:
        for home in homes.values():
            _release_host(home)
