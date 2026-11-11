"""Authentication, scoping and raw binary framing for prepared render reads."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from reliquary_hermes.client import HostUnavailable, _response
from reliquary_hermes.graph_render_api import graph_selector, read_render
from reliquary_hermes.validation import ContractError, canonical


SCOPE = {
    "owner_id": "rel-a", "generation": "mount-a", "cut": "cut-a", "session_id": None,
}
FILTERS = {"include_archived": False, "query": "lantern", "category": "Reference"}


@pytest.mark.parametrize("selector", [
    {**SCOPE, "principal_id": "forged"},
    {**SCOPE, "chunk_id": 0},
    {**SCOPE, "generation": ""},
    {**SCOPE, "owner_id": "../foreign"},
])
def test_render_prepare_selectors_cannot_carry_authority(selector):
    with pytest.raises(ContractError):
        graph_selector(canonical({"filters": FILTERS, **selector}), "prepare")


def test_render_filters_and_inspection_selectors_are_operation_bound():
    assert graph_selector(canonical({**SCOPE, "filters": FILTERS}), "prepare")["filters"] == FILTERS
    inspection = {**SCOPE, "generation_id": "1", "render_id": 4}
    for operation in ("inspect", "neighborhood"):
        assert graph_selector(canonical(inspection), operation) == inspection
        with pytest.raises(ContractError):
            graph_selector(canonical({**inspection, "filters": FILTERS}), operation)
    assert graph_selector(canonical({**SCOPE, "memory_id": "a" * 64, "filters": FILTERS}),
                          "eligible")["memory_id"] == "a" * 64
    for invalid in ({**FILTERS, "principal_id": "forged"}, {**FILTERS, "include_archived": 0},
                    {**FILTERS, "community_id": "not-a-digest"}):
        with pytest.raises(ContractError):
            graph_selector(canonical({**SCOPE, "filters": invalid}), "prepare")


def test_render_scope_uses_active_profile_principal_and_cut(monkeypatch):
    from reliquary_hermes import graph_render_api as api

    home = Path("profile")
    settings = SimpleNamespace(state_dir=home / "reliquary", profile_id="profile-a", principal_id="integration-a")
    monkeypatch.setattr(api, "read_settings", lambda value: settings if value == home else None)
    monkeypatch.setattr(api, "read_token", lambda value: "signed-host-test")
    calls = []

    class Client:
        def __init__(self, state, profile, principal, token):
            assert (state, profile, principal, token) == (
                settings.state_dir, settings.profile_id, settings.principal_id, "signed-host-test",
            )

        def read_dashboard_topology(self, session):
            return {"session_id": session, "session_owner_id": "different-rel", "active_phy_id": "phy-a", "owners": [
                {**SCOPE, "owner_kind": "REL", "capabilities": {"view": True}},
                {**SCOPE, "owner_id": "phy-b", "owner_kind": "PHY", "capabilities": {"view": True}},
            ]}

        def graph_render(self, operation, selector):
            calls.append((operation, selector))
            return b"\x00\xff\xfe"

    monkeypatch.setattr(api, "HostClient", Client)
    selector = graph_selector(canonical({**SCOPE, "generation_id": "1", "chunk_id": 0}), "node-chunk")
    assert read_render(home, "node-chunk", selector) == b"\x00\xff\xfe"
    assert calls == [("node-chunk", {
        "owner_id": "rel-a", "generation": "mount-a", "cut": "cut-a",
        "generation_id": "1", "chunk_id": 0, "principal_id": "phy-a", "session_id": None,
    })]
    for foreign in ({"owner_id": "foreign"}, {"owner_id": "phy-b"}, {"session_id": "different-session"}):
        with pytest.raises(HostUnavailable, match="host_denied"):
            read_render(home, "prepare", {**SCOPE, **foreign})
    with pytest.raises(HostUnavailable, match="host_conflict"):
        read_render(home, "prepare", {**SCOPE, "cut": "old"})
    assert len(calls) == 1


def test_signed_host_response_reader_enforces_media_and_limit():
    from time import monotonic
    from io import BytesIO

    class Connection(BytesIO):
        settimeout = lambda self, timeout: None
        recv = BytesIO.read

    body = b"\x00\x01\xff\x80"
    message = (b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 4\r\n\r\n" + body)
    deadline = monotonic() + 10
    assert _response(Connection(message), deadline, media_type="application/octet-stream", response_limit=4)[2] == body
    with pytest.raises(ContractError, match="invalid_http"):
        _response(Connection(message), deadline)
    with pytest.raises(ContractError, match="wire_limit"):
        _response(Connection(message), deadline, media_type="application/octet-stream", response_limit=3)
    with pytest.raises(HostUnavailable, match="incomplete_response"):
        _response(Connection(message[:-1]), deadline, media_type="application/octet-stream", response_limit=4)


def test_pinned_graph_route_emits_raw_bytes_for_admitted_profile(tmp_path, pinned_checkout):
    import os
    import subprocess
    import sys
    from test_hu03_dashboard import _stage_plugin

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    home = tmp_path / "hermes"
    _stage_plugin(home)
    script = r"""
from pathlib import Path
import os
from fastapi.testclient import TestClient
from hermes_cli import web_server
from plugins.memory import import_provider_module

api = import_provider_module("reliquary", "dashboard_api")
home = Path(os.environ["HERMES_HOME"]).resolve()
wire = bytes(range(256))
selector = {"owner_id": "rel-a", "generation": "mount-a", "cut": "cut-a",
            "session_id": None, "generation_id": "1", "chunk_id": 0}
calls = []

def render(scoped, operation, parsed):
    assert scoped == home
    assert parsed == selector and operation == "node-chunk"
    calls.append(parsed)
    return wire

api.read_render = render
headers = {web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN}
path = "/api/plugins/reliquary/graph-render-v1/node-chunk"
with TestClient(web_server.app) as client:
    assert client.post(path, json=selector).status_code in (401, 403)
    assert client.post(path, headers=headers, json={**selector, "principal_id": "forged"}).status_code == 400
    result = client.post(path, headers=headers, json=selector)
    assert result.status_code == 200, result.text
    assert result.headers["content-type"] == "application/octet-stream"
    assert result.headers["cache-control"] == "no-store"
    assert result.content == wire
assert calls == [selector]
"""
    environment = {
        **os.environ, "HERMES_HOME": str(home), "PYTHONPATH": str(pinned_checkout),
        "TEMP": str(tmp_path), "TMP": str(tmp_path), "TMPDIR": str(tmp_path),
    }
    log = tmp_path / "graph-route.log"
    with log.open("w", encoding="utf-8") as output:
        result = subprocess.run([sys.executable, "-B", "-c", script], cwd=tmp_path, env=environment,
                                stdout=output, stderr=subprocess.STDOUT, timeout=90)
    assert result.returncode == 0, log.read_text(encoding="utf-8", errors="replace")
