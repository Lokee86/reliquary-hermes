"""HU01-consumable DTO fixtures, not real route/auth/service or UI acceptance."""

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from reliquary_hermes.authority import ProfileGrant
from reliquary_hermes.ui_contract import CursorBinding, UIRequest, UIResponse, VerifiedUIContext, verify_expected_revisions
from reliquary_hermes.ui_schema import CAPABILITIES, MUTATIONS, SCHEMA
from reliquary_hermes.validation import ContractError, canonical


def owner(owner_id="rel-a", kind="REL", *, generation="9007199254740993", cut="cut-1", manage=True):
    return {"owner_id": owner_id, "owner_kind": kind, "display_label": "Private owner",
            "generation": generation, "cut": cut, "capabilities": {name: manage or name not in
            {"manage", "memory_create", "memory_edit", "memory_retire", "relation_edit", "community_rename"} for name in CAPABILITIES}}


def summary(revision="1", lifecycle="active"):
    return {"memory_id": "memory-1", "revision": revision, "body_id": "body-"+revision, "title": "Memory title",
            "excerpt": "excerpt", "category": "fact", "memory_type": "semantic", "lifecycle": lifecycle,
            "canonical_status": "canonical", "freshness": None, "community_id": "community-1"}


def source():
    return {"kind": "hermes_snapshot", "label": "Hermes source / copied snapshot", "profile_namespace": "profile-a",
            "session_id": "session-1", "message_uid": "logical-1", "branch_id": None, "source_revision": None,
            "content_digest": "a"*64, "range": {"start_byte": "2", "end_byte": "7", "text": "café"}}


def detail(revision="1", lifecycle="active", availability="available"):
    return {"memory": summary(revision, lifecycle), "body": {"revision": revision, "body_id": "body-"+revision,
            "availability": availability, "content": "Body" if availability == "available" else None},
            "retained_revisions": ["1"], "superseded_by": None, "tombstone": False, "provenance": [source()]}


def node(number=1):
    return {"node_id": "node-"+str(number), "kind": "memory", "memory_id": "memory-"+str(number),
            "community_id": None, "label": "Memory", "origin": "source", "revision": "1", "cut": "cut-1"}


def edge(number=1):
    return {"edge_id": "edge-"+str(number), "kind": "user_association", "origin": "user", "source_id": "node-1",
            "target_id": "node-2", "revision": "2", "cut": "cut-1", "active": True}


def community():
    return {"community_id": "community-1", "generation": "1", "member_count": "9007199254740993",
            "name": "A community", "name_origin": "user", "cursor": None}


def recall():
    return {"state": "none", "search_id": None, "delivery_id": None, "candidate_ids": [], "selected_ids": [], "injected_ids": [], "receipt_id": None}


def arguments(op):
    return {
        "ui.owner_sessions": {"cursor": None, "limit": 20},
        "ui.memory_list": {"cursor": None, "limit": 20, "filters": {"query": "", "category": None, "memory_type": None, "lifecycle": None, "community_id": None}},
        "ui.memory_detail": {"memory_id": "memory-1", "revision": "1"},
        "ui.memory_history": {"memory_id": "memory-1", "cursor": None, "limit": 20},
        "ui.provenance": {"memory_id": "memory-1", "revision": "1"},
        "ui.graph_page": {"seed_ids": ["memory-1"], "community_id": None, "depth": 1, "node_limit": 500, "edge_limit": 1000, "cursor": None},
        "ui.community_list": {"cursor": None, "limit": 20}, "ui.operational_status": {},
        "ui.memory_create": {"title": "Memory title", "body": "Body", "category": "fact", "memory_type": "semantic"},
        "ui.memory_edit": {"memory_id": "memory-1", "title": "Memory title", "body": "Body"},
        "ui.memory_retire": {"memory_id": "memory-1", "effect": "retire"},
        "ui.relation_change": {"source_id": "node-1", "target_id": "node-2", "source_revision": "1", "target_revision": "1",
                               "action": "link", "relation_kind": "user_association", "edge_id": None},
        "ui.community_rename": {"community_id": "community-1", "name": "A community"},
    }[op]


def request(op="ui.memory_list"):
    selection = op == "ui.owner_sessions"
    return {"protocol_version": 1, "request_id": "ui-request-1", "operation": op, "profile_id": "profile-a",
            "principal_id": "principal-a", "session_id": "session-1", "owner_id": None if selection else "rel-a",
            "generation": None if selection else "9007199254740993", "cut": None if selection else "cut-1",
            "expected_revision": "1" if op in {"ui.memory_edit", "ui.memory_retire", "ui.community_rename"} else None,
            "idempotency_key": "ui-idem-1" if op in MUTATIONS else None, "arguments": arguments(op)}


def page(items):
    return {"items": items, "next_cursor": None, "truncated": False}


def response(op="ui.memory_list"):
    r = {
        "ui.owner_sessions": {"owners": page([owner()]), "active_session_id": "session-1", "session_owner_id": "rel-a"},
        "ui.memory_list": page([summary()]), "ui.memory_detail": detail(),
        "ui.memory_history": {"memory_id": "memory-1", "revisions": page([{"revision": "1", "body_id": "body-1", "availability": "pruned", "created_at_ms": "9007199254740993", "content_digest": None}])},
        "ui.provenance": {"memory_id": "memory-1", "revision": "1", "sources": [source()]},
        "ui.graph_page": {"routing_state": "available", "nodes": [node(1), node(2)], "edges": [edge()], "next_cursor": None, "truncated": False},
        "ui.community_list": {"metadata_state": "available", "communities": page([community()])},
        "ui.operational_status": {"session_id": "session-1", "accepted_source_cursor": "source-cursor-1", "last_completed_receipt": "import-1",
                                  "pending_count": "3", "held_count": "2", "error_count": "1", "worker_state": "held", "latest_recall": recall()},
    }
    if op in MUTATIONS:
        committed = {"ui.memory_create": detail("2"), "ui.memory_edit": detail("2"), "ui.memory_retire": detail("2", "retired"),
                     "ui.relation_change": edge(), "ui.community_rename": community()}[op]
        if op == "ui.memory_create":
            committed["provenance"] = [{"kind": "user_origin", "principal_id": "principal-a", "created_at_ms": "1794000000000"}]
        if op == "ui.relation_change":
            committed["cut"] = "cut-2"
        if op == "ui.community_rename":
            committed["generation"] = "2"
        result = {"receipt_id": "ui-receipt-1", "request_id": "ui-request-1", "idempotency_key": "ui-idem-1", "changed": True, "committed": committed}
    else:
        result = r[op]
    return {"protocol_version": 1, "request_id": "ui-request-1", "operation": op, "status": "ok",
            "binding": None if op == "ui.owner_sessions" else owner(generation="9007199254740994", cut="cut-2") if op in MUTATIONS else owner(), "result": result}


def parse_request(value):
    return UIRequest.parse(canonical(value))


def check(req, resp):
    return UIResponse.parse(canonical(resp)).for_request(parse_request(req))


def context(*, manage=True, authenticated=True, same_origin=True):
    return VerifiedUIContext("profile-a", "principal-a", canonical([owner(manage=manage)]), authenticated, same_origin, (("session-1", "rel-a"),), "session-1")


OPS = ["ui.owner_sessions", "ui.memory_list", "ui.memory_detail", "ui.memory_history", "ui.provenance", "ui.graph_page",
       "ui.community_list", "ui.operational_status", "ui.memory_create", "ui.memory_edit", "ui.memory_retire", "ui.relation_change", "ui.community_rename"]


@pytest.mark.parametrize("op", OPS)
def test_all_required_ui_operations_have_strict_typed_mock_contracts(op):
    req, resp = request(op), response(op)
    assert check(req, resp).value["status"] == "ok"
    context().authorize(parse_request(req))


def test_exported_schema_is_the_canonical_standard_schema():
    exported = json.loads((Path(__file__).parents[1]/"contracts/dashboard-v1.schema.json").read_text(encoding="utf-8"))
    assert exported == SCHEMA
    Draft202012Validator.check_schema(exported)
    validator = Draft202012Validator(exported)
    for op in OPS:
        validator.validate(request(op))
        validator.validate(response(op))


@pytest.mark.parametrize("field,value", [("owner_id", "foreign-phy"), ("generation", "9007199254740994"), ("cut", "old-cut")])
def test_late_or_foreign_owner_read_result_is_rejected(field, value):
    req, resp = request(), response()
    resp["binding"][field] = value
    with pytest.raises(ContractError):
        check(req, resp)


@pytest.mark.parametrize("field,value", [("profile_id", "profile-b"), ("principal_id", "other"), ("owner_id", "foreign-phy"), ("cut", "old-cut")])
def test_authenticated_hermes_context_does_not_widen_owner_grants(field, value):
    req = request()
    req[field] = value
    with pytest.raises(ContractError):
        context().authorize(parse_request(req))


@pytest.mark.parametrize("op", sorted(MUTATIONS))
def test_viewer_cross_origin_and_unauthenticated_ui_mutations_are_denied(op):
    req = parse_request(request(op))
    for auth in (context(manage=False), context(authenticated=False), context(same_origin=False)):
        with pytest.raises(ContractError, match="ui_denied"):
            auth.authorize(req)
    provider = ProfileGrant("profile-a", "principal-a", "rel-a", (), "a"*32)
    with pytest.raises(ContractError):
        provider.authorize(req, "a"*32)


@pytest.mark.parametrize("field,value", [("owner_id", "foreign-phy"), ("generation", "2"), ("cut", "cut-2"), ("principal_id", "other")])
def test_cursor_is_bound_to_owner_generation_cut_and_principal(field, value):
    req = request()
    cursor = CursorBinding.issue_fixture("cursor-1", parse_request(req))
    req["arguments"]["cursor"] = "cursor-1"
    cursor.for_request(parse_request(req))
    req[field] = value
    with pytest.raises(ContractError, match="stale_cursor_resync"):
        cursor.for_request(parse_request(req))


def test_cursor_is_bound_to_filters_and_operation():
    req = request()
    cursor = CursorBinding.issue_fixture("cursor-1", parse_request(req))
    req["arguments"]["cursor"] = "cursor-1"
    req["arguments"]["filters"]["query"] = "different"
    with pytest.raises(ContractError, match="stale_cursor_resync"):
        cursor.for_request(parse_request(req))
    other = request("ui.community_list")
    other["arguments"]["cursor"] = "cursor-1"
    with pytest.raises(ContractError, match="stale_cursor_resync"):
        cursor.for_request(parse_request(other))


@pytest.mark.parametrize("availability", ["missing", "unauthorized", "pruned", "corrupt"])
def test_unavailable_historical_body_is_never_replaced_by_current_content(availability):
    req, resp = request("ui.memory_detail"), response("ui.memory_detail")
    resp["result"] = detail(availability=availability)
    assert check(req, resp).value["result"]["body"]["content"] is None
    resp["result"]["body"]["content"] = "current content fallback"
    with pytest.raises(ContractError, match="payload_availability_mismatch"):
        check(req, resp)


def test_detail_and_provenance_bind_exact_requested_revision_and_source_range():
    req, resp = request("ui.memory_detail"), response("ui.memory_detail")
    resp["result"] = detail("2")
    with pytest.raises(ContractError, match="historical_revision_mismatch"):
        check(req, resp)
    req, resp = request("ui.provenance"), response("ui.provenance")
    resp["result"]["sources"][0]["range"]["end_byte"] = "6"
    with pytest.raises(ContractError, match="source_range_mismatch"):
        check(req, resp)


def test_source_denial_is_typed_and_does_not_disclose_source_identity():
    req, resp = request("ui.provenance"), response("ui.provenance")
    resp["result"]["sources"] = [{"kind": "source_unavailable", "reason": "unauthorized"}]
    assert check(req, resp).value["result"]["sources"][0] == {"kind": "source_unavailable", "reason": "unauthorized"}
    resp["result"]["sources"][0]["session_id"] = "private-existence"
    with pytest.raises(ContractError):
        check(req, resp)


@pytest.mark.parametrize("status", ["denied", "unavailable", "stale_cursor", "conflict", "invalid", "unsupported"])
def test_ui_error_carries_no_private_owner_titles_payloads_or_counts(status):
    value = response()
    value.update(status=status, binding=None, result={"code": "resync_required", "retryable": False})
    assert check(request(), value).value["status"] == status
    value["result"]["private_title"] = "secret"
    with pytest.raises(ContractError):
        UIResponse.parse(canonical(value))


def test_management_list_and_history_limits_follow_accepted_128_item_seam():
    for op in ("ui.memory_list", "ui.memory_history", "ui.community_list", "ui.owner_sessions"):
        req = request(op)
        req["arguments"]["limit"] = 129
        with pytest.raises(ContractError):
            parse_request(req)
    req, resp = request(), response()
    req["arguments"]["limit"] = 1
    resp["result"]["items"] = [summary(), {**summary(), "memory_id": "memory-2"}]
    with pytest.raises(ContractError, match="ui_page_limit"):
        check(req, resp)


@pytest.mark.parametrize("target,count", [("nodes", 501), ("edges", 1001)])
def test_graph_hard_page_bounds(target, count):
    resp = response("ui.graph_page")
    resp["result"][target] = [node(i) if target == "nodes" else edge(i) for i in range(count)]
    with pytest.raises(ContractError):
        UIResponse.parse(canonical(resp))


def test_graph_request_limits_cut_endpoint_identity_and_explicit_unavailable_metadata():
    req, resp = request("ui.graph_page"), response("ui.graph_page")
    req["arguments"]["node_limit"] = 1
    with pytest.raises(ContractError, match="ui_graph_limit"):
        check(req, resp)
    req = request("ui.graph_page")
    resp["result"]["edges"][0]["target_id"] = "node-not-in-page"
    with pytest.raises(ContractError, match="ui_graph_binding"):
        check(req, resp)
    resp = response("ui.graph_page")
    resp["result"]["nodes"][0]["cut"] = "old-cut"
    with pytest.raises(ContractError, match="ui_stale_resync"):
        check(req, resp)
    for op,key in (("ui.graph_page", "routing_state"), ("ui.community_list", "metadata_state")):
        value = response(op)
        value["result"][key] = "unavailable"
        with pytest.raises(ContractError):
            UIResponse.parse(canonical(value))  # must use explicit unavailable error, not an empty success


def test_ui_wire_rejects_precision_loss_secret_owner_paths_and_oversized_results():
    req = request()
    assert parse_request(req).generation == "9007199254740993"
    req["generation"] = 9007199254740993
    with pytest.raises(ContractError):
        parse_request(req)
    for field in ("service_token", "owner_path", "origin"):
        req = request()
        req[field] = "untrusted"
        with pytest.raises(ContractError):
            parse_request(req)
    with pytest.raises(ContractError, match="wire_limit"):
        UIResponse.parse(b" "*262145)


def test_current_host_status_cannot_fabricate_confirmed_consumption():
    resp = response("ui.operational_status")
    resp["result"]["latest_recall"] = {"state": "confirmed", "search_id": "search-1", "delivery_id": "delivery-1",
        "candidate_ids": ["memory-1"], "selected_ids": ["memory-1"], "injected_ids": ["memory-1"], "receipt_id": "receipt-1"}
    with pytest.raises(ContractError, match="handoff_unavailable"):
        UIResponse.parse(canonical(resp))


def test_manual_create_cannot_forge_hermes_provenance_or_private_actor_identity():
    req, resp = request("ui.memory_create"), response("ui.memory_create")
    resp["result"]["committed"]["provenance"] = [source()]
    with pytest.raises(ContractError, match="forged_manual_provenance"):
        check(req, resp)
    req["arguments"]["source"] = source()
    with pytest.raises(ContractError):
        parse_request(req)


@pytest.mark.parametrize("op", sorted(MUTATIONS))
def test_user_mutations_require_exact_receipt_and_committed_generation(op):
    req, resp = request(op), response(op)
    resp["result"]["idempotency_key"] = "other"
    with pytest.raises(ContractError, match="ui_receipt_mismatch"):
        check(req, resp)
    resp = response(op)
    resp["binding"] = owner()
    with pytest.raises(ContractError, match="ui_uncommitted_result"):
        check(req, resp)


def test_user_relation_schema_excludes_canonical_closure_and_raw_edge_mutation():
    req = request("ui.relation_change")
    for kind in ("supersession", "duplicate", "canonical"):
        req["arguments"]["relation_kind"] = kind
        with pytest.raises(ContractError):
            parse_request(req)


def test_owner_discovery_never_authorizes_foreign_phy_or_ambient_merge():
    req, resp = request("ui.owner_sessions"), response("ui.owner_sessions")
    resp["result"]["owners"]["items"].append(owner("foreign-phy", "PHY"))
    with pytest.raises(ContractError, match="ui_denied"):
        context().check_response(UIResponse.parse(canonical(resp)), parse_request(req))


def test_unlink_is_user_origin_exact_edge_and_committed_inactive():
    req, resp = request("ui.relation_change"), response("ui.relation_change")
    req["expected_revision"] = "1"
    req["arguments"].update(action="unlink", edge_id="edge-1")
    resp["result"]["committed"]["active"] = False
    assert check(req, resp).value["result"]["committed"]["active"] is False
    resp["result"]["committed"]["active"] = True
    with pytest.raises(ContractError, match="ui_uncommitted_result"):
        check(req, resp)


@pytest.mark.parametrize("op,target", [("ui.memory_edit", "memory-1"), ("ui.memory_retire", "memory-1"), ("ui.community_rename", "community-1")])
def test_user_update_expected_revision_is_mandatory_and_conflicts_safely(op, target):
    req = parse_request(request(op))
    verify_expected_revisions(req, {target: "1"})
    with pytest.raises(ContractError, match="ui_revision_conflict"):
        verify_expected_revisions(req, {target: "2"})
    value = request(op)
    value["expected_revision"] = None
    with pytest.raises(ContractError, match="missing_ui_revision"):
        parse_request(value)


def test_relation_both_endpoint_revisions_are_checked_by_named_product_gate():
    req = parse_request(request("ui.relation_change"))
    verify_expected_revisions(req, {"node-1": "1", "node-2": "1"})
    with pytest.raises(ContractError, match="ui_revision_conflict"):
        verify_expected_revisions(req, {"node-1": "1", "node-2": "2"})


@pytest.mark.parametrize("op", OPS)
def test_response_is_bound_to_authenticated_owner_record(op):
    req, resp = request(op), response(op)
    assert context().check_response(UIResponse.parse(canonical(resp)), parse_request(req)).value["status"] == "ok"


@pytest.mark.parametrize("field,value", [("owner_kind", "PHY"), ("display_label", "Forged owner")])
@pytest.mark.parametrize("op", ["ui.memory_list", "ui.memory_edit"])
def test_response_cannot_relabel_authenticated_owner(field, value, op):
    req, resp = request(op), response(op)
    resp["binding"][field] = value
    with pytest.raises(ContractError, match="ui_denied"):
        context().check_response(UIResponse.parse(canonical(resp)), parse_request(req))


@pytest.mark.parametrize("capability", ["manage", "memory_retire", "community_rename"])
def test_read_response_cannot_widen_viewer_capabilities(capability):
    req, resp = request(), response()
    resp["binding"] = owner(manage=False)
    resp["binding"]["capabilities"][capability] = True
    with pytest.raises(ContractError, match="ui_denied"):
        context(manage=False).check_response(UIResponse.parse(canonical(resp)), parse_request(req))


def test_mutation_response_preserves_authority_while_allowing_committed_cut_advance():
    req, resp = request("ui.memory_edit"), response("ui.memory_edit")
    trusted = owner()
    trusted["capabilities"]["community_rename"] = False
    auth = VerifiedUIContext("profile-a", "principal-a", canonical([trusted]), True, True, (("session-1", "rel-a"),), "session-1")
    with pytest.raises(ContractError, match="ui_denied"):
        auth.check_response(UIResponse.parse(canonical(resp)), parse_request(req))
    resp["binding"]["capabilities"]["community_rename"] = False
    assert auth.check_response(UIResponse.parse(canonical(resp)), parse_request(req)).value["binding"]["cut"] == "cut-2"


def test_session_mapping_cannot_relabel_private_phy_as_session_rel():
    req, resp = request("ui.owner_sessions"), response("ui.owner_sessions")
    phy = owner("phy-a", "PHY")
    auth = VerifiedUIContext("profile-a", "principal-a", canonical([owner(), phy]), True, True, (("session-1", "rel-a"),), "session-1")
    resp["result"]["session_owner_id"] = "phy-a"
    with pytest.raises(ContractError, match="ui_denied"):
        auth.check_response(UIResponse.parse(canonical(resp)), parse_request(req))


@pytest.mark.parametrize("op", OPS)
def test_arbitrary_session_id_does_not_grant_ui_access(op):
    req = request(op)
    req["session_id"] = "session-ungranted"
    with pytest.raises(ContractError, match="ui_denied"):
        context().authorize(parse_request(req))


def test_session_enumeration_uses_exact_authorized_selected_or_active_mapping():
    req, resp = request("ui.owner_sessions"), response("ui.owner_sessions")
    req["session_id"] = None
    assert context().check_response(UIResponse.parse(canonical(resp)), parse_request(req)).value["result"]["session_owner_id"] == "rel-a"
    resp["result"]["active_session_id"] = "session-ungranted"
    with pytest.raises(ContractError, match="ui_denied"):
        context().check_response(UIResponse.parse(canonical(resp)), parse_request(req))


def test_selected_session_status_cannot_read_another_sessions_rel():
    auth = VerifiedUIContext("profile-a", "principal-a", canonical([owner(), owner("rel-b")]), True, True,
                             (("session-1", "rel-a"), ("session-2", "rel-b")), "session-1")
    req, resp = request("ui.operational_status"), response("ui.operational_status")
    req["session_id"] = "session-2"
    with pytest.raises(ContractError, match="ui_denied"):
        auth.authorize(parse_request(req))
    req["owner_id"] = "rel-b"
    resp["binding"]["owner_id"] = "rel-b"
    resp["result"]["session_id"] = "session-2"
    assert auth.check_response(UIResponse.parse(canonical(resp)), parse_request(req)).value["status"] == "ok"


@pytest.mark.parametrize("bindings,active", [((("session-1", "foreign-rel"),), "session-1"),
    ((("session-1", "rel-a"), ("session-1", "rel-a")), "session-1"),
    ((("session-1", "rel-a"),), "session-ungranted")])
def test_invalid_trusted_session_registry_fails_closed(bindings, active):
    auth = VerifiedUIContext("profile-a", "principal-a", canonical([owner()]), True, True, bindings, active)
    with pytest.raises(ContractError, match="invalid_ui_sessions"):
        auth.authorize(parse_request(request("ui.owner_sessions")))


@pytest.mark.parametrize("op,field", [("ui.community_rename", "generation"), ("ui.relation_change", "revision")])
@pytest.mark.parametrize("changed,revision,accepted", [(True, "0", False), (True, "1", False),
    (True, "2", True), (False, "0", False), (False, "1", True), (False, "2", False)])
def test_community_and_unlink_committed_revision_matches_cas(op, field, changed, revision, accepted):
    req, resp = request(op), response(op)
    if op == "ui.relation_change":
        req["expected_revision"] = "1"
        req["arguments"].update(action="unlink", edge_id="edge-1")
        resp["result"]["committed"]["active"] = False
    resp["result"].update(changed=changed)
    resp["result"]["committed"][field] = revision
    if not changed:
        resp["binding"] = owner()
        if op == "ui.relation_change":
            resp["result"]["committed"]["cut"] = "cut-1"
    if accepted:
        assert check(req, resp).value["status"] == "ok"
    else:
        with pytest.raises(ContractError, match="ui_uncommitted_result"):
            check(req, resp)
