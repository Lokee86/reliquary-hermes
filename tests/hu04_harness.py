"""Isolated real-process fixtures and a client for the published dashboard contract."""

from contextlib import ExitStack
from dataclasses import dataclass
from http.client import HTTPConnection
from itertools import count
import json
import os
from pathlib import Path
import re
import secrets
from shutil import copyfile, copytree
import subprocess
import sys
import time
from urllib.parse import urlencode

from reliquary_hermes.client import HostClient
from reliquary_hermes.ui_contract import UIRequest, UIResponse
from reliquary_hermes.validation import MAX_WIRE_BYTES, canonical, decode
from test_hp04_host import _cli
from test_hp03_host import config, owner, stop
from test_hu03_dashboard import _stage_plugin


REPO = Path(__file__).resolve().parents[1]
ROUTE = "/api/plugins/reliquary-hermes/dashboard-v1"
SERVICE_PRINCIPAL = "principal-a"  # The existing isolated HP03 config fixture.

SERVE = """
import socket
import sys
from threading import Thread

from hermes_cli import web_server
import uvicorn

web_server.app.state.bound_host = "127.0.0.1"
server = uvicorn.Server(uvicorn.Config(web_server.app, log_level="warning", access_log=False))

def shutdown_on_eof():
    sys.stdin.buffer.read(1)
    server.should_exit = True

with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    print(f"HU04_PORT={listener.getsockname()[1]}", flush=True)
    Thread(target=shutdown_on_eof, daemon=True).start()
    server.run(sockets=[listener])
"""


def _shutdown_dashboard(process):
    process.stdin.close()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        stop(process)


@dataclass
class Profile:
    home: Path
    ids: dict
    token: str
    client: HostClient
    general_session: str
    cleanup: ExitStack
    seeded_memory_id: str | None

    def attach(self):
        previous = self.client._process
        try:
            general = self.client.attach(self.general_session)
            assert (general.rel_id, general.user_id) == (self.ids["main"], self.ids["phy"])
            if "project" in self.ids:
                project = self.client.attach("session-project")
                assert (project.rel_id, project.user_id) == (self.ids["project"], self.ids["phy"])
        finally:
            process = self.client._process
            if process is not None and process is not previous:
                self.cleanup.callback(stop, process)

    def restart(self):
        state = self.home / "reliquary"
        original = decode((state / "discovery.json").read_bytes())["instance_id"]
        process = self.client._process
        assert process is not None and process.poll() is None
        stop(process)
        self.attach()
        assert self.client._process is not process
        assert decode((state / "discovery.json").read_bytes())["instance_id"] != original


def start_profile(home, profile_id, binaries, cleanup, *, project=False, seed_main=None, project_snapshot=None):
    binary, cli = binaries
    _stage_plugin(home)
    copytree(REPO / "dashboard" / "dist", home / "plugins/reliquary-hermes/dashboard/dist")
    main_rel, active_phy = home / "main.rel", home / "active.phy"
    ids = {"main": owner(cli, "rel", main_rel, "unspecified"), "phy": owner(cli, "phy", active_phy)}
    seeded_memory_id = seed_main(cli, main_rel) if seed_main is not None else None
    project_rel = home / "project.rel" if project else None
    if project_rel is not None:
        if project_snapshot is None:
            ids["project"] = owner(cli, "rel", project_rel, "project")
        else:
            copyfile(project_snapshot, project_rel)
            ids["project"] = _cli(cli, "rel", "verify", project_rel)["owner"]["owner_id"]
    state = home / "reliquary"
    config(state, main_rel, active_phy, profile=profile_id, project_rel=project_rel)
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    token = secrets.token_hex(32)
    (home / ".env").write_text(f"RELIQUARY_HERMES_TOKEN={token}\n", encoding="utf-8")
    client = HostClient(state, profile_id, SERVICE_PRINCIPAL, token, binary=binary)
    profile = Profile(home, ids, token, client, f"session-{profile_id}", cleanup, seeded_memory_id)
    profile.attach()
    return profile


def start_dashboard(primary, foreign, checkout, scratch, cleanup):
    token = secrets.token_urlsafe(32)
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(
        HERMES_HOME=str(primary.home), HERMES_KANBAN_HOME=str(scratch / "kanban"),
        USERPROFILE=str(scratch), APPDATA=str(scratch), LOCALAPPDATA=str(scratch),
        TEMP=str(scratch), TMP=str(scratch), TMPDIR=str(scratch), PYTHONDONTWRITEBYTECODE="1",
        HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0",
        HERMES_DASHBOARD_SESSION_TOKEN=token,
        **({"HERMES_WEB_DIST": os.environ["HERMES_WEB_DIST"]} if "HERMES_WEB_DIST" in os.environ else {}),
        PYTHONPATH=os.pathsep.join((str(checkout), str(REPO / "src"))),
    )
    log = scratch / "dashboard.log"
    with log.open("wb") as stream:
        process = subprocess.Popen(
            [sys.executable, "-B", "-c", SERVE], cwd=scratch, env=env,
            stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT,
        )
    cleanup.callback(_shutdown_dashboard, process)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and process.poll() is None:
        ready = re.search(rb"^HU04_PORT=(\d+)\r?$", log.read_bytes(), flags=re.MULTILINE)
        if ready:
            port = int(ready[1])
            private = (primary.token, foreign.token, getattr(primary, "principal_id", SERVICE_PRINCIPAL),
                       SERVICE_PRINCIPAL, str(primary.home))
            return (DashboardClient(port, token, private, primary.ids, "primary", None),
                    DashboardClient(port, token, private, foreign.ids, "secondary", "secondary"))
        time.sleep(0.05)
    raise AssertionError(f"pinned Hermes dashboard did not bind. See {log}")


class DashboardClient:
    def __init__(self, port, token, private, ids, profile_id, profile_selector):
        self.port = port
        self.token = token
        self.private = private
        self.ids = ids
        self.profile_id = profile_id
        self.profile_selector = profile_selector
        self.bindings = {}
        self.default_owner_id = ids["main"]
        self.request_ids = count(1)

    def request(self, operation, arguments, *, binding=None, session_id=None,
                revision=None, key=None, browser_identity=None):
        profile_id, principal_id = browser_identity or (self.profile_id, self.ids["phy"])
        return {
            "protocol_version": 1, "request_id": f"hu04-{self.profile_id}-{next(self.request_ids)}",
            "operation": operation, "profile_id": profile_id, "principal_id": principal_id,
            "session_id": session_id, "owner_id": binding["owner_id"] if binding else None,
            "generation": binding["generation"] if binding else None,
            "cut": binding["cut"] if binding else None, "expected_revision": revision,
            "idempotency_key": key, "arguments": arguments,
        }

    def send(self, request, *, authenticated=True, cross_origin=False):
        route = ROUTE
        if self.profile_selector is not None:
            route += "?" + urlencode({"profile": self.profile_selector})
        headers = {
            "Content-Type": "application/json",
            "Origin": "http://foreign.invalid" if cross_origin else f"http://127.0.0.1:{self.port}",
            "Sec-Fetch-Site": "cross-site" if cross_origin else "same-origin",
        }
        if authenticated:
            headers["X-Hermes-Session-Token"] = self.token
        connection = HTTPConnection("127.0.0.1", self.port, timeout=35)
        try:
            connection.request("POST", route, body=canonical(request), headers=headers)
            response = connection.getresponse()
            raw = response.read(MAX_WIRE_BYTES + 1)
            assert len(raw) <= MAX_WIRE_BYTES, "dashboard response exceeds wire limit"
            observed = raw + canonical(response.getheaders())
            assert all(secret.encode() not in observed and canonical(secret)[1:-1] not in observed
                       for secret in self.private), "dashboard exposed a private service value"
            return response.status, raw
        finally:
            connection.close()

    def validate(self, request, raw, status):
        wire_request = UIRequest.parse(canonical(request))
        response = UIResponse.parse(raw).for_request(wire_request).value
        assert response["status"] == status, (
            f'{request["operation"]} expected {status}, received {response["status"]}'
            + (f' ({response["result"]["code"]})' if response["status"] != "ok" else "")
        )
        binding = response["binding"]
        if binding is not None:
            enumerated = self.bindings[request["owner_id"]]
            assert all(binding[k] == enumerated[k] for k in ("owner_id", "owner_kind", "display_label"))
            assert all(not allowed or enumerated["capabilities"][name]
                       for name, allowed in binding["capabilities"].items())
        return response

    def exchange(self, request, *, status="ok"):
        http_status, raw = self.send(request)
        assert http_status == 200, f'{request["operation"]} returned HTTP {http_status}'
        return self.validate(request, raw, status)

    def rejected(self, request, *, cross_origin=False):
        http_status, raw = self.send(request, cross_origin=cross_origin)
        if http_status == 200:
            self.validate(request, raw, "denied")
        else:
            assert http_status == 403, f'{request["operation"]} returned HTTP {http_status}'
            assert set(json.loads(raw)) == {"detail"}

    def topology(self, *, session_id=None, cursor=None, limit=128, browser_identity=None, status="ok"):
        request = self.request("ui.owner_sessions", {"cursor": cursor, "limit": limit},
                               session_id=session_id, browser_identity=browser_identity)
        return self.exchange(request, status=status)["result"]

    def refresh(self):
        topology = self.topology()
        page = topology["owners"]
        assert not page["truncated"] and page["next_cursor"] is None
        assert topology["active_phy_id"] == self.ids["phy"]
        self.bindings = {row["owner_id"]: row for row in page["items"]}
        assert set(self.bindings) == set(self.ids.values())

    def binding(self, owner_id=None):
        return self.bindings[owner_id or self.default_owner_id]

    def read(self, operation, args, *, owner_id=None, session_id=None, status="ok", binding=None):
        request = self.request(operation, args, binding=binding or self.binding(owner_id),
                               session_id=session_id)
        return self.exchange(request, status=status)

    def mutate(self, operation, args, *, key, revision=None, owner_id=None, session_id=None,
               status="ok", binding=None):
        request = self.request(operation, args, binding=binding or self.binding(owner_id),
                               session_id=session_id, key=key, revision=revision)
        return self.exchange(request, status=status)
