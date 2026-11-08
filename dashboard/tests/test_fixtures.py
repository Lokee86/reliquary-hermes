"""Validate dashboard DTO fixtures at the Python contract boundary."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from reliquary_hermes.ui_contract import UIRequest, UIResponse, VerifiedUIContext
from reliquary_hermes.validation import canonical


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "dashboard/fixtures/mock-responses.json").read_text(encoding="utf-8"))
SCHEMA = Draft202012Validator(json.loads((ROOT / "contracts/dashboard-v1.schema.json").read_text(encoding="utf-8")))
DISCOVERY = FIXTURES["owner_sessions"]
REL_SESSIONS = {"fixture-rel": "fixture-session", "fixture-project-rel": "fixture-project-session"}
BINDINGS = {
    owner["owner_id"]: owner
    for scenarios in DISCOVERY.values()
    for response in scenarios
    for owner in response["result"]["owners"]["items"]
}


def cases():
    for session, scenarios in DISCOVERY.items():
        for response in scenarios:
            yield pytest.param(None, session, response, id=response["request_id"])
    for group, records in FIXTURES.items():
        if group == "owner_sessions":
            continue
        for owner_id, value in records.items():
            for response in value if isinstance(value, list) else [value]:
                session = REL_SESSIONS.get(owner_id) if response["operation"] == "ui.operational_status" else None
                yield pytest.param(owner_id, session, response, id=response["request_id"])


def arguments(response):
    operation, result = response["operation"], response["result"]
    page = {"cursor": None, "limit": 128}
    if operation == "ui.memory_detail":
        return {"memory_id": result["memory"]["memory_id"], "revision": result["body"]["revision"]}
    if operation == "ui.provenance":
        return {"memory_id": result["memory_id"], "revision": result["revision"]}
    if operation == "ui.memory_history":
        return {**page, "memory_id": result["memory_id"]}
    if operation == "ui.community_members":
        return {**page, "community_id": result["community_id"], "expected_generation": result["generation"]}
    return {
        "ui.owner_sessions": page,
        "ui.memory_list": {**page, "filters": {"query": "", "category": None, "memory_type": None,
                                             "lifecycle": None, "community_id": None}},
        "ui.graph_page": {"seed_ids": [], "community_id": None, "depth": 1, "node_limit": 500,
                          "edge_limit": 1000, "cursor": None},
        "ui.community_list": page,
        "ui.operational_status": {},
    }[operation]


@pytest.mark.parametrize(("owner_id", "session", "response"), list(cases()))
def test_bundled_fixture_matches_current_contract(owner_id, session, response):
    SCHEMA.validate(response)
    binding = BINDINGS.get(owner_id, {})
    if response["operation"] == "ui.owner_sessions":
        active_phy = response["result"]["active_phy_id"]
    else:
        active_phy = owner_id if binding.get("owner_kind") == "PHY" else "fixture-phy"
    context = VerifiedUIContext(
        profile_id="fixture-profile",
        principal_id="fixture-principal",
        owner_bindings_json=canonical(list(BINDINGS.values())),
        authenticated_by_hermes=True,
        same_origin=True,
        session_rel_bindings=tuple((session_id, rel) for rel, session_id in REL_SESSIONS.items()),
        active_session_id="fixture-session",
        active_phy_id=active_phy,
    )
    request = UIRequest.parse(canonical({
        "protocol_version": 1, "request_id": response["request_id"], "operation": response["operation"],
        "profile_id": context.profile_id, "principal_id": context.principal_id, "session_id": session,
        "owner_id": owner_id, "generation": binding.get("generation"), "cut": binding.get("cut"),
        "expected_revision": None, "idempotency_key": None, "arguments": arguments(response),
    }))
    context.check_response(UIResponse.parse(canonical(response)), request)
