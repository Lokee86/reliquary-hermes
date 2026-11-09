"""Desktop mutations through Hermes' actual gateway and isolated plugin subprocesses."""

import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from reliquary_hermes.client import HostClient
from reliquary_hermes.settings import read_settings, read_token
from test_hp03_host import binaries, install_setup_host, owner
from test_hu03_dashboard import _request, _stage_plugin


@pytest.fixture(scope="module")
def hosted_checkout():
    value = os.environ.get("HU05_HERMES_HOSTED_CHECKOUT")
    if not value:
        pytest.skip("Set HU05_HERMES_HOSTED_CHECKOUT to the Hermes installation under test")
    checkout = Path(value).resolve()
    assert (checkout / "hermes_cli/plugin_host_child.py").is_file(), f"Hermes worker not found in {checkout}"
    return checkout


def _release_host(home):
    discovery = home / "reliquary/discovery.json"
    if not discovery.exists():
        return
    settings = read_settings(home)
    guard = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, read_token(home))
    guard.attach("hu05-hosted-proof")
    guard.attach_runtime("hu05-hosted-proof")
    guard.detach_runtime()
    deadline = time.monotonic() + 10
    while discovery.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not discovery.exists()


def test_native_setup_and_memory_writes_through_both_hosted_routes(tmp_path, hosted_checkout, binaries, monkeypatch):
    binary, cli = binaries
    launch = tmp_path / "hermes"
    homes = {"default": launch, "secondary": launch / "profiles/secondary"}
    owners = {}
    for profile, home in homes.items():
        _stage_plugin(home)
        install_setup_host(home, binary)
        main, phy = home / "main.rel", home / "active.phy"
        owners[profile] = {"main": owner(cli, "rel", main, "unspecified"), "phy": owner(cli, "phy", phy)}
    (launch / "config.yaml").write_text("plugins:\n  enabled: [reliquary-hermes]\n  isolation: host\n", encoding="utf-8")

    script = """
from contextlib import ExitStack
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
from gateway.runtime_bootstrap import TicketStore
from gateway.session_authorities import SessionAuthorities
from hermes_cli import plugins, profiles, web_server as web
from hermes_cli.dashboard_auth.native_http import HEADER

fixture = json.load(sys.stdin)
home = Path(os.environ["HERMES_HOME"]).resolve()
homes = {"default": home, "secondary": home / "profiles/secondary"}
profiles._get_default_hermes_home = lambda: home
profiles._get_profiles_root = lambda: home / "profiles"
instance = "hu05-hosted-desktop"
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

setup_api = "/api/plugins/reliquary-hermes/setup-v1"
dashboard = "/api/plugins/reliquary-hermes/dashboard-v1"
auth = {web._SESSION_HEADER_NAME: web._SESSION_TOKEN}
same_origin = {**auth, "Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
cross_origin = {**auth, "Origin": "http://other.test", "Sec-Fetch-Site": "cross-site"}

def reply(response):
    assert response.status_code == 200, response.text
    return response.json()

with ExitStack() as stack:
    stack.callback(plugins._reset_plugin_managers_for_tests)
    client = stack.enter_context(TestClient(loopback))
    for profile, selected in homes.items():
        params = {} if profile == "default" else {"profile": profile}
        other = "secondary" if profile == "default" else "default"
        candidate = {"main_rel": str(selected / "main.rel"), "active_phy": str(selected / "active.phy")}
        assert not reply(client.get(setup_api + "/status", headers=grant(profile), params=params))["configured"]
        assert client.post(setup_api + "/apply", params=params, json=candidate).status_code == 401
        for headers in (auth, cross_origin, {**auth, "hosted_native_http_authenticated": "true"}):
            assert client.post(setup_api + "/apply", headers=headers, params=params, json=candidate).status_code == 403
        assert client.post(setup_api + "/apply", headers={**grant(profile), "Origin": "http://testserver"},
                           params=params, json=candidate).status_code == 401
        assert client.post(setup_api + "/apply", headers=grant(profile), params={"profile": other},
                           json=candidate).status_code == 403
        assert not (selected / "reliquary/owners.json").exists()
        assert reply(client.post(setup_api + "/validate", headers=same_origin, params=params, json=candidate))["valid"]
        validation = reply(client.post(setup_api + "/validate", headers=grant(profile), params=params, json=candidate))
        assert validation["valid"] and validation["main_rel"]["owner_id"] == fixture["owners"][profile]["main"]
        ticket = grant(profile)
        assert reply(client.post(setup_api + "/apply", headers=ticket, params=params, json=candidate))["configured"]
        assert client.post(setup_api + "/apply", headers=ticket, params=params, json=candidate).status_code == 401

        discovery = reply(client.post(dashboard, headers=grant(profile), params=params, json=fixture["request"]))
        assert discovery["status"] == "ok", discovery
        owners = discovery["result"]["owners"]["items"]
        assert {row["owner_id"] for row in owners} == set(fixture["owners"][profile].values())
        main = next(row for row in owners if row["owner_kind"] == "REL")
        mutation = {**fixture["request"], "request_id": "hosted-write", "operation": "ui.memory_create",
                    **{key: main[key] for key in ("owner_id", "generation", "cut")}, "idempotency_key": "native-create",
                    "arguments": {"title": "Hosted Desktop proof", "body": "Synthetic profile-scoped note.",
                                  "category": "fact", "memory_type": "semantic"}}
        assert reply(client.post(dashboard, headers=auth, params=params, json=mutation))["status"] == "denied"
        assert reply(client.post(dashboard, headers=cross_origin, params=params, json=mutation))["status"] == "denied"
        ticket = grant(profile)
        created = reply(client.post(dashboard, headers=ticket, params=params, json=mutation))
        assert created["status"] == "ok", created
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
        edited = reply(client.post(dashboard, headers=grant(profile), params=params, json=edit))
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
        retired = reply(client.post(dashboard, headers=grant(profile), params=params, json=retire))
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

    workers = {manager.home_path: manager._plugin_host_instance for manager in plugins._known_plugin_managers()
               if getattr(manager, "_plugin_host_instance", None) is not None}
    assert set(homes.values()) <= workers.keys(), workers
    pids = {workers[home].pid for home in homes.values() if workers[home].alive}
    assert len(pids) == 2 and os.getpid() not in pids, pids
"""
    env = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(HERMES_HOME=str(launch), HERMES_KANBAN_HOME=str(tmp_path / "kanban"),
               USERPROFILE=str(tmp_path), APPDATA=str(tmp_path), LOCALAPPDATA=str(tmp_path),
               TEMP=str(tmp_path), TMP=str(tmp_path), TMPDIR=str(tmp_path), PYTHONDONTWRITEBYTECODE="1",
               HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0", PYTHONPATH=str(hosted_checkout))
    monkeypatch.syspath_prepend(str(hosted_checkout))
    try:
        # On Windows, worker descendants can keep inherited capture pipes open.
        log = tmp_path / "hosted-probe.log"
        with log.open("w", encoding="utf-8") as output:
            result = subprocess.run([sys.executable, "-B", "-c", script], cwd=tmp_path, env=env, text=True,
                                    stdout=output, stderr=subprocess.STDOUT,
                                    input=json.dumps({"owners": owners, "request": _request()}), timeout=150)
        assert result.returncode == 0, log.read_text(encoding="utf-8", errors="replace")
    finally:
        for home in homes.values():
            _release_host(home)
