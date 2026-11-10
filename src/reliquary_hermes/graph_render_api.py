"""Strict browser graph selectors and authenticated, non-mutating render reads."""

from pathlib import Path

from .client import HostClient, HostUnavailable
from .settings import read_settings, read_token
from .validation import decode, identifier, integer, obj, require


GRAPH_OPERATIONS = frozenset({"prepare", "node-chunk", "edge-chunk", "resolve"})
BINARY_OPERATIONS = frozenset({"node-chunk", "edge-chunk"})


def graph_selector(raw: bytes, operation: str) -> dict:
    fields = {"owner_id", "generation", "cut", "session_id"}
    if operation != "prepare":
        fields.add("generation_id")
    if operation in BINARY_OPERATIONS:
        fields.add("chunk_id")
    elif operation == "resolve":
        fields.add("render_id")
    selector = obj(decode(raw), fields)
    for field in fields:
        value = selector[field]
        if field in {"chunk_id", "render_id"}:
            integer(value, 0, (1 << 32) - 1)
        elif field != "session_id" or value is not None:
            identifier(value)
    return selector


def read_render(home: Path, operation: str, selector: dict) -> bytes:
    settings = read_settings(home)
    client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, read_token(home))
    topology = client.read_dashboard_topology(selector["session_id"])
    principal = topology["active_phy_id"]
    owner = next((entry for entry in topology["owners"]
                  if entry["owner_id"] == selector["owner_id"] and entry["capabilities"]["view"]), None)
    if (not principal or owner is None or
            (owner["owner_kind"] == "PHY" and owner["owner_id"] != principal) or
            (selector["session_id"] is not None and
             (topology["session_id"] != selector["session_id"] or topology["session_owner_id"] != owner["owner_id"]))):
        raise HostUnavailable("host_denied")
    if owner["generation"] != selector["generation"] or owner["cut"] != selector["cut"]:
        raise HostUnavailable("host_conflict")
    require(operation in GRAPH_OPERATIONS, "invalid_graph_operation")
    return client.graph_render(operation, {
        **{field: value for field, value in selector.items() if field != "session_id"},
        "principal_id": principal,
    })
