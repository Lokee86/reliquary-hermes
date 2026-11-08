"""Validate the dashboard's bundled DTO fixtures at the Python contract boundary."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from reliquary_hermes.ui_contract import UIRequest, UIResponse, VerifiedUIContext
from reliquary_hermes.validation import canonical


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "dashboard/fixtures/mock-responses.json").read_text(encoding="utf-8"))
SCHEMA = json.loads((ROOT / "contracts/dashboard-v1.schema.json").read_text(encoding="utf-8"))
DISCOVERY = FIXTURES["owner_sessions"]["result"]
BINDINGS = {owner["owner_id"]: owner for owner in DISCOVERY["owners"]["items"]}
REL_SESSIONS = {"fixture-rel": "fixture-session", "fixture-project-rel": "fixture-project-session"}
CONTEXT = VerifiedUIContext(
    profile_id="fixture-profile",
    principal_id="fixture-principal",
    owner_bindings_json=canonical(list(BINDINGS.values())),
    authenticated_by_hermes=True,
    same_origin=True,
    session_rel_bindings=tuple((session, rel) for rel, session in REL_SESSIONS.items()),
    active_session_id="fixture-session",
    active_phy_id="fixture-phy",
)


def fixture_cases():
    yield pytest.param(None, FIXTURES["owner_sessions"], id="owner_sessions")
    for group, responses in FIXTURES.items():
        if group != "owner_sessions":
            for owner_id, response in responses.items():
                yield pytest.param(owner_id, response, id=f"{group}-{owner_id}")


def arguments(operation, owner_id):
    page = {"cursor": None, "limit": 128}
    if operation in {"ui.memory_detail", "ui.provenance"}:
        memory = FIXTURES["memory_lists"][owner_id]["result"]["items"][0]
        return {"memory_id": memory["memory_id"], "revision": memory["revision"]}
    return {
        "ui.owner_sessions": page,
        "ui.memory_list": {**page, "filters": {"query": "", "category": None, "memory_type": None,
                                             "lifecycle": None, "community_id": None}},
        "ui.graph_page": {"seed_ids": [], "community_id": None, "depth": 1,
                          "node_limit": 500, "edge_limit": 1000, "cursor": None},
        "ui.operational_status": {},
    }[operation]


@pytest.mark.parametrize(("owner_id", "response"), list(fixture_cases()))
def test_bundled_fixture_matches_current_contract(owner_id, response):
    Draft202012Validator(SCHEMA).validate(response)
    operation = response["operation"]
    binding = BINDINGS[owner_id] if owner_id is not None else {}
    request = UIRequest.parse(canonical({
        "protocol_version": 1,
        "request_id": response["request_id"],
        "operation": operation,
        "profile_id": CONTEXT.profile_id,
        "principal_id": CONTEXT.principal_id,
        "session_id": REL_SESSIONS.get(owner_id) if operation == "ui.operational_status" else None,
        "owner_id": owner_id,
        "generation": binding.get("generation"),
        "cut": binding.get("cut"),
        "expected_revision": None,
        "idempotency_key": None,
        "arguments": arguments(operation, owner_id),
    }))
    CONTEXT.check_response(UIResponse.parse(canonical(response)), request)
