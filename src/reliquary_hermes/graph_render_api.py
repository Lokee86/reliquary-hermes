"""Strict browser graph selectors and authenticated, non-mutating render reads."""

from pathlib import Path

from .client import HostClient, HostUnavailable
from .settings import read_settings, read_token
from .validation import decode, digest, identifier, integer, obj, require, text


GRAPH_OPERATIONS = frozenset({
    "prepare", "node-chunk", "edge-chunk", "resolve", "inspect", "neighborhood", "locate", "eligible",
})
BINARY_OPERATIONS = frozenset({"node-chunk", "edge-chunk"})


def graph_selector(raw: bytes, operation: str) -> dict:
    require(operation in GRAPH_OPERATIONS, "invalid_graph_operation")
    fields = {"owner_id", "generation", "cut", "session_id"}
    if operation in {"prepare", "eligible"}:
        fields.add("filters")
    else:
        fields.add("generation_id")
    if operation in BINARY_OPERATIONS:
        fields.add("chunk_id")
    elif operation in {"resolve", "inspect", "neighborhood"}:
        fields.add("render_id")
    elif operation in {"locate", "eligible"}:
        fields.add("memory_id")
    selector = obj(decode(raw), fields)
    for field in fields:
        value = selector[field]
        if field in {"chunk_id", "render_id"}:
            integer(value, 0, (1 << 32) - 1)
        elif field == "memory_id":
            digest(value)
        elif field == "filters":
            _validate_filters(value)
        elif field != "session_id" or value is not None:
            identifier(value)
    return selector


def _validate_filters(value: object) -> None:
    optional = {"query", "community_id", "category", "memory_type"}
    require(type(value) is dict and value.keys() <= optional | {"include_archived"}
            and type(value.get("include_archived")) is bool, "invalid_graph_filters")
    if "query" in value:
        text(value["query"], 4096, blank=True)
    if "community_id" in value:
        digest(value["community_id"])
    for field in ("category", "memory_type"):
        if field in value:
            text(value[field], 128)


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
        **selector,
        "principal_id": principal,
    })
