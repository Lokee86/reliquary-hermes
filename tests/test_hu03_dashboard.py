"""Live dashboard authority proof against the pinned Hermes and Rust host."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from reliquary_hermes import HERMES_REVISION
from reliquary_hermes.client import HostClient
from reliquary_hermes.ui_contract import UIResponse
from reliquary_hermes.validation import canonical
from test_hp03_host import binaries, config, owner, stop


REPO = Path(__file__).resolve().parents[1]


def _stage_plugin(home, enabled=True):
    dashboard = home / "plugins/reliquary-hermes/dashboard"
    dashboard.mkdir(parents=True)
    for name in ("manifest.json", "plugin_api.py"):
        shutil.copyfile(REPO / "dashboard" / name, dashboard / name)
    consent = "enabled" if enabled else "disabled"
    (home / "config.yaml").write_text(f"plugins:\n  {consent}: [reliquary-hermes]\n", encoding="utf-8")


def _start_profile(home, profile_id, binaries, cleanup, *, project):
    binary, cli = binaries
    _stage_plugin(home)
    main, phy = home / "main.rel", home / "active.phy"
    ids = {"main": owner(cli, "rel", main, "unspecified"), "phy": owner(cli, "phy", phy)}
    project_rel = home / "project.rel" if project else None
    if project_rel:
        ids["project"] = owner(cli, "rel", project_rel, "project")
    state = home / "reliquary"
    config(state, main, phy, profile=profile_id, project_rel=project_rel)
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    token = f"isolated-hu03-service-credential-{profile_id}"
    (home / ".env").write_text(f"RELIQUARY_HERMES_TOKEN={token}\n", encoding="utf-8")
    client = HostClient(state, profile_id, "principal-a", token, binary=binary)
    try:
        client.attach(f"session-{profile_id}")
    finally:
        if client._process is not None:
            cleanup.callback(stop, client._process)
    return ids, token


def _request(**overrides):
    return {
        "protocol_version": 1, "request_id": "topology-test", "operation": "ui.owner_sessions",
        "profile_id": "forged-profile", "principal_id": "forged-principal", "session_id": None,
        "owner_id": None, "generation": None, "cut": None, "expected_revision": None,
        "idempotency_key": None, "arguments": {"cursor": None, "limit": 128}, **overrides,
    }


def _probe(home, pin, scratch, cases):
    script = """
import json
import os
import sys
from fastapi.testclient import TestClient
from hermes_cli import web_server

route = "/api/plugins/reliquary-hermes/dashboard-v1"
headers = {web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN}
responses = {}
with TestClient(web_server.app) as client:
    for label, profile, body in json.load(sys.stdin):
        params = {"profile": profile} if profile is not None else {}
        response = client.post(route, headers={} if label == "unauthenticated" else headers,
                               params=params, json=body)
        responses[label] = [response.status_code, response.json()]
os.write(1, json.dumps(responses).encode("utf-8"))
"""
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(HERMES_HOME=str(home), HERMES_KANBAN_HOME=str(scratch / "kanban"),
               USERPROFILE=str(scratch), APPDATA=str(scratch), LOCALAPPDATA=str(scratch),
               TEMP=str(scratch), TMP=str(scratch), TMPDIR=str(scratch), PYTHONDONTWRITEBYTECODE="1",
               HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0",
               PYTHONPATH=os.pathsep.join((str(pin), str(REPO / "src"))))
    result = subprocess.run([sys.executable, "-B", "-c", script], cwd=scratch, env=env,
                            input=json.dumps(cases), capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip(), result.stderr
    return json.loads(result.stdout)


def test_pinned_dashboard_scope_does_not_follow_browser_identity(tmp_path, binaries):
    checkout = os.environ.get("HP01_HERMES_CHECKOUT")
    if not checkout:
        pytest.skip("Set HP01_HERMES_CHECKOUT for the pinned dashboard proof")
    pin = Path(checkout).resolve()
    actual = subprocess.check_output(["git", "-C", str(pin), "rev-parse", "HEAD"], text=True).strip()
    assert actual == HERMES_REVISION

    home = tmp_path / "hermes"
    secondary = home / "profiles/secondary"
    _stage_plugin(home / "profiles/disabled", enabled=False)
    with ExitStack() as cleanup:
        primary_ids, primary_token = _start_profile(home, "primary", binaries, cleanup, project=True)
        secondary_ids, secondary_token = _start_profile(secondary, "secondary", binaries, cleanup, project=False)
        cases = [
            ("unauthenticated", None, _request()),
            ("primary", None, _request(session_id="session-project")),
            ("secondary", "secondary", _request(profile_id="primary", principal_id=primary_ids["phy"])),
            ("foreign_session", "secondary", _request(session_id="session-project")),
            ("unknown_profile", "missing-profile", _request()),
            ("owner_hint", None, _request(owner_id=secondary_ids["main"])),
            ("unsupported", None, _request(operation="ui.operational_status", owner_id=primary_ids["main"],
                                            generation="0", cut="browser-cut", arguments={})),
            ("disabled", "disabled", _request()),
        ]
        replies = _probe(home, pin, tmp_path, cases)

    assert replies["unauthenticated"][0] == 401
    assert replies["owner_hint"][0] == 400
    assert replies["disabled"][0] == 404
    assert replies["unknown_profile"][0] == 404
    for label, ids in (("primary", primary_ids), ("secondary", secondary_ids)):
        status, payload = replies[label]
        assert status == 200, (label, payload)
        result = UIResponse.parse(canonical(payload)).value["result"]
        assert {row["owner_id"] for row in result["owners"]["items"]} == set(ids.values())
        assert result["active_phy_id"] == ids["phy"]
        assert all(row["capabilities"]["view"] and sum(row["capabilities"].values()) == 1
                   for row in result["owners"]["items"])
    assert replies["primary"][1]["result"]["session_owner_id"] == primary_ids["project"]
    assert replies["secondary"][1]["result"]["session_owner_id"] is None
    assert replies["foreign_session"][0] == 200
    assert replies["foreign_session"][1]["status"] == "denied"
    assert replies["unsupported"][0] == 200
    assert replies["unsupported"][1]["status"] == "unsupported"
    wire = json.dumps(replies)
    assert all(secret not in wire for secret in (primary_token, secondary_token, "principal-a"))
    assert json.dumps(str(home))[1:-1] not in wire
