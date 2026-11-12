from __future__ import annotations

from contextlib import nullcontext
import sys
import types
from dataclasses import dataclass
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi import FastAPI
from fastapi.testclient import TestClient

from reliquary_hermes import dashboard_api as api
from reliquary_hermes.validation import canonical


CAPS = {key: False for key in (
    "view", "manage", "history", "provenance", "graph", "community", "status",
    "memory_create", "memory_edit", "memory_retire", "relation_edit", "community_rename",
)}
CAPS["view"] = True


def owner(owner_id, kind):
    return {"owner_id": owner_id, "owner_kind": kind, "display_label": owner_id,
            "generation": "1", "cut": "cut-1", "capabilities": dict(CAPS)}


@dataclass
class Settings:
    state_dir: Path = Path("C:/unused/state")
    profile_id: str = "configured-profile"
    principal_id: str = "service-principal"
    binary: Path = Path("C:/unused/reliquary.exe")


class FakeClient:
    def __init__(self, state_dir, profile_id, principal_id, token, *, binary=None):
        assert (profile_id, principal_id, token) == ("configured-profile", "service-principal", "secret")
        self.session_id = None

    def connect_dashboard(self, session_id):
        self.session_id = session_id
        if session_id == "not-configured":
            raise api.HostUnavailable("host_denied")
        return {"owners": [owner("rel-main", "REL"), owner("phy-user", "PHY")],
                "active_phy_id": "phy-user", "session_id": session_id,
                "session_owner_id": "rel-main" if session_id == "session-a" else None}


def request_payload(*, session_id=None, profile="browser-profile", principal="browser-principal"):
    return {"protocol_version": 1, "request_id": "request-1", "operation": "ui.owner_sessions",
            "profile_id": profile, "principal_id": principal, "session_id": session_id,
            "owner_id": None, "generation": None, "cut": None, "expected_revision": None,
            "idempotency_key": None, "arguments": {"cursor": None, "limit": 128}}


def install_route(monkeypatch):
    home = Path("C:/hermes/profile-a")
    monkeypatch.setattr(api, "_host_home", lambda request: home)
    monkeypatch.setattr(api, "profile_setup_lock", lambda _: nullcontext())
    monkeypatch.setattr(api, "read_settings", lambda selected: Settings())
    monkeypatch.setattr(api, "read_token", lambda selected: "secret")
    monkeypatch.setattr(api, "HostClient", FakeClient)
    fake_web = types.ModuleType("hermes_cli.web_server")
    fake_web._require_token = lambda request: None
    monkeypatch.setitem(sys.modules, "hermes_cli.web_server", fake_web)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/plugins/reliquary")
    return TestClient(app)


def test_owner_sessions_rewrites_browser_identity_and_returns_server_topology(monkeypatch):
    client = install_route(monkeypatch)
    response = client.post("/api/plugins/reliquary/dashboard-v1", json=request_payload())
    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "ok"
    assert {row["owner_id"] for row in body["result"]["owners"]["items"]} == {"rel-main", "phy-user"}
    assert body["result"]["active_phy_id"] == "phy-user"


def test_unknown_session_is_a_typed_denial(monkeypatch):
    client = install_route(monkeypatch)
    response = client.post("/api/plugins/reliquary/dashboard-v1",
                           json=request_payload(session_id="not-configured"))
    body = response.json()
    assert body["status"] == "denied"
    assert body["binding"] is None


def test_owner_cursor_cannot_change_the_session_or_page_size(monkeypatch):
    client = install_route(monkeypatch)
    route = "/api/plugins/reliquary/dashboard-v1"
    request = request_payload()
    request["arguments"]["limit"] = 1
    first = client.post(route, json=request)
    assert first.headers["Cache-Control"] == "no-store"
    cursor = first.json()["result"]["owners"]["next_cursor"]
    assert cursor
    request["arguments"]["cursor"] = cursor
    assert client.post(route, json=request).json()["result"]["owners"]["items"][0]["owner_id"] == "phy-user"
    assert client.post(route, json={**request, "session_id": "session-a"}).json()["status"] == "stale_cursor"
    request["arguments"]["limit"] = 2
    assert client.post(route, json=request).json()["status"] == "stale_cursor"
