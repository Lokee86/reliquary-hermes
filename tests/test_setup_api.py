"""Setup admission through the audited Hermes dashboard and native HTTP gates."""

import os
import subprocess
import sys

import pytest

from test_hu03_dashboard import _stage_plugin


def test_pinned_setup_api_admits_only_scoped_same_origin_or_native_requests(tmp_path, pinned_checkout):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    home = tmp_path / "hermes"
    _stage_plugin(home)
    _stage_plugin(home / "profiles/disabled", enabled=False)
    (home / "profiles/foreign").mkdir()
    script = """
from pathlib import Path
import os
from types import SimpleNamespace

from fastapi.testclient import TestClient
from gateway.runtime_bootstrap import TicketStore
from hermes_cli import projects_db, web_server as web
from hermes_cli.dashboard_auth.native_http import HEADER
from plugins.memory import import_provider_module

provider = import_provider_module("reliquary")
ContractError = import_provider_module("reliquary", "validation").ContractError

home = Path(os.environ["HERMES_HOME"]).resolve()
assert not (home / "reliquary/owners.json").exists()
project_root = home.parent / "project-folder"
project_root.mkdir()
(project_root / "first.rel").touch()
(project_root / "active.phy").touch()
(project_root / "private.txt").touch()
folder_two = home.parent / "project-other"
folder_two.mkdir()
with projects_db.connect_closing(db_path=home / "projects.db") as db:
    project = projects_db.create_project(db, name="Active Project", folders=[str(project_root), str(folder_two)])
    fallback = projects_db.create_project(db, name="General Fallback")
    archive = projects_db.create_project(db, name="Archived")
    projects_db.archive_project(db, archive)
setup = import_provider_module("reliquary", "setup")
inventory = setup.projects
path = "/api/plugins/reliquary-hermes/setup-v1"
candidate = {"main_rel": "C:/owners/main.rel", "active_phy": "C:/owners/user.phy"}
defaults = {"main_rel": None, "active_phy": None, "projects": {}, "config_path": None}
owner = {"accepted": True, "opened": True, "error": None}
report = {
    "valid": True, "topology_error": None, "projects": {}, "config": owner,
    "main_rel": {**owner, "kind": "REL", "owner_id": "rel-test", "scope": "unspecified"},
    "active_phy": {**owner, "kind": "PHY", "owner_id": "phy-test", "scope": None},
}
calls = []

def status(selected):
    assert selected == home
    return {"configured": "apply" in calls, "runtime_detected": True,
            "config_path": None, "defaults": defaults}

def validate(selected, value, *, project_aware):
    assert selected == home and project_aware
    if value["main_rel"] == "busy":
        raise ContractError("service_restart_required")
    if value["main_rel"] == "private-diagnostic":
        raise OSError("private internal path")
    assert value == candidate
    calls.append("validate")
    return report

def apply(selected, value, *, project_aware):
    assert selected == home and value == candidate and project_aware
    calls.append("apply")
    return {**report, "configured": True}

def create(selected, value):
    assert selected == home and value == {"kind": "project_rel", "path": str(project_root / "new.rel"),
                                         "project_id": project}
    return {"created": True}

provider.setup = SimpleNamespace(status=status, validate=validate, apply=apply,
                                 projects=inventory, create=create)

# Exercise the real native middleware and one-use ticket store. TestClient
# substitutes the TCP scope the gateway otherwise supplies for loopback.
instance = "hu05-setup-api"
store = TicketStore(instance, frozenset({str(home)}))
web.app.state.gateway_runner = SimpleNamespace(
    _draining=False, session_ticket_store=store,
    session_authority=SimpleNamespace(instance_id=instance, profile_id=str(home),
                                      db=SimpleNamespace(db_path=home / "state.db")),
    session_runtime_descriptor={"state": "ready", "instance_id": instance,
                                "served_profiles": [{"profile_id": str(home), "home": str(home)}]},
)

async def loopback_app(scope, receive, send):
    await web.app({**scope, "hermes.gateway_socket_peer": ("127.0.0.1", 12345)}, receive, send)

def grant():
    return {HEADER: store.mint(profile_id=str(home), subject="hu05-test", purpose="native-http")}

with TestClient(loopback_app) as client:
    auth = {web._SESSION_HEADER_NAME: web._SESSION_TOKEN}
    same = {**auth, "Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
    dialog_route = "/dialog"
    retired_route = "/browse"
    for method, route in (("GET", "/status"), ("GET", "/projects"),
                          ("POST", "/validate"), ("POST", "/apply"), ("POST", "/create")):
        assert client.request(method, path + route, json=candidate).status_code == 401
    assert client.post(path + dialog_route, json={"mode": "open_rel"}).status_code == 401
    found = client.get(path + "/projects", headers=auth)
    assert found.status_code == 200 and found.headers["Cache-Control"] == "no-store"
    assert {item["id"]: item["name"] for item in found.json()["projects"]} == {
        project: "Active Project", fallback: "General Fallback"}
    assert client.get(path + retired_route, headers=auth, params={"kind": "rel"}).status_code == 404
    assert client.post(path + dialog_route, headers=auth, json={"mode": "open_rel"}).status_code == 403
    assert client.post(path + dialog_route, headers=same, json={"mode": "open_rel"}).json() == {
        "status": "unavailable"}
    assert client.post(path + dialog_route, headers={**same, "Origin": "http://other"},
                       json={"mode": "open_rel"}).status_code == 403
    assert client.post(path + dialog_route, headers=same,
                       data={"mode": "open_rel"}).status_code == 415
    assert client.post(path + dialog_route, headers=grant(), params={"profile": "foreign"},
                       json={"mode": "open_rel"}).status_code == 403
    for bad_dialog in ({"mode": "browse"}, {"mode": "open_rel", "path": "C:/secret.rel"},
                       {"mode": "save_config"}, {}):
        response = client.post(path + dialog_route, headers=same, json=bad_dialog)
        assert response.status_code == 400 and response.json() == {"detail": "invalid_dialog_mode"}
    body = {"kind": "project_rel", "path": str(project_root / "new.rel"), "project_id": project}
    assert client.post(path + "/create", headers=auth, json=body).status_code == 403
    assert client.post(path + "/create", headers=same, json=body).json() == {"created": True}
    assert client.post(path + "/create", headers=grant(), json=body).json() == {"created": True}
    response = client.get(path + "/status", headers=auth)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {**status(home), "desktop_native_mutations": False,
                               "local_dialogs_available": False}
    assert client.get(path + "/status", headers=same).json()["desktop_native_mutations"] is False
    assert client.request("GET", path + "/status",
                          headers={**auth, "hosted_native_http_authenticated": "true"},
                          params={"desktop_native_mutations": "true"},
                          json={"desktop_native_mutations": True}).json() == response.json()
    status_ticket = grant()
    native_status = client.get(path + "/status", headers=status_ticket)
    assert native_status.status_code == 200, native_status.text
    assert native_status.json() == {**status(home), "desktop_native_mutations": True,
                                   "local_dialogs_available": False}
    assert client.get(path + "/status", headers=status_ticket).status_code == 401
    assert client.get(path + "/status", headers={**grant(), "Origin": ""}).status_code == 401
    assert client.get(path + "/status", headers=grant(), params={"profile": "foreign"}).status_code == 403
    assert client.get(path + "/status", headers=auth, params={"profile": "disabled"}).status_code == 404
    assert client.get(path + "/status", headers=auth, params={"profile": "missing"}).status_code == 404
    for bad in (auth, {**same, "Origin": "http://other"}, {**same, "Origin": "null"}):
        assert client.post(path + "/apply", headers=bad, json=candidate).status_code == 403
    assert client.post(path + "/apply", headers={**auth, HEADER: "fake"}, json=candidate).status_code == 401
    for authority in ("profile", "profile_id", "principal_id", "token", "binary", "desktop_native_mutations"):
        response = client.post(path + "/apply", headers=same, json={**candidate, authority: "foreign"})
        assert response.status_code == 400 and response.json() == {"detail": "invalid_setup_request"}
    assert client.post(path + "/apply", headers=same, data=candidate).status_code == 415
    body = b'{"main_rel":"a","main_rel":"b","active_phy":"c"}'
    headers = {**same, "Content-Type": "application/json"}
    assert client.post(path + "/apply", headers=headers, content=body).status_code == 400
    assert client.post(path + "/apply", headers=headers, content=b"x" * 65537).status_code == 413
    assert client.post(path + "/apply", headers={**grant(), "Origin": "http://testserver"},
                       json=candidate).status_code == 401
    assert client.post(path + "/apply", headers=grant(), params={"profile": "foreign"},
                       json=candidate).status_code == 403
    assert calls == []
    for main, code, detail in (("busy", 409, "service_restart_required"),
                               ("private-diagnostic", 503, "setup_unavailable")):
        response = client.post(path + "/validate", headers=same, json={**candidate, "main_rel": main})
        assert response.status_code == code and response.json() == {"detail": detail}
    response = client.post(path + "/validate", headers=same, json=candidate)
    assert response.status_code == 200 and response.json() == report
    assert client.get(path + "/status", headers=auth).json()["configured"] is False
    ticket = grant()
    response = client.post(path + "/apply", headers=ticket, json=candidate)
    assert response.status_code == 200 and response.json() == {**report, "configured": True}
    assert client.post(path + "/apply", headers=ticket, json=candidate).status_code == 401
    assert client.get(path + "/status", headers=auth).json()["configured"] is True
    assert calls == ["validate", "apply"]
"""
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(HERMES_HOME=str(home), HERMES_KANBAN_HOME=str(tmp_path / "kanban"),
               USERPROFILE=str(tmp_path), APPDATA=str(tmp_path), LOCALAPPDATA=str(tmp_path),
               TEMP=str(tmp_path), TMP=str(tmp_path), TMPDIR=str(tmp_path), PYTHONDONTWRITEBYTECODE="1",
               HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0",
               PYTHONPATH=str(pinned_checkout))
    result = subprocess.run([sys.executable, "-B", "-c", script], cwd=tmp_path, env=env,
                            capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr
