import copy
import json

import pytest

from reliquary_hermes.authority import AuthorGrant, Discovery, ProfileGrant
from reliquary_hermes import HERMES_REVISION
from reliquary_hermes.protocol import Request, Response
from reliquary_hermes.consumption import confirmation_key
from reliquary_hermes.source import SourceSnapshot
from reliquary_hermes.validation import ContractError, MAX_WIRE_BYTES, canonical, content_digest


def request(operation="memory_query", arguments=None):
    mutation = operation in {"snapshot_submit", "consumption_confirm", "edit_memory"}
    key = confirmation_key(arguments["delivery_id"], arguments["manifest_digest"]) if operation == "consumption_confirm" else "idem-1"
    return {"protocol_version": 1, "request_id": "req-1", "operation": operation,
            "profile_id": "profile-a", "principal_id": "principal-a", "session_id": "session-1", "turn_id": "turn-1",
            "expected_revision": "host-rev-1" if mutation else None,
            "idempotency_key": key if mutation else None,
            "arguments": {"query": "remember", "limit": 5} if arguments is None else arguments}


def snapshot():
    body = {"profile_id": "profile-a", "session_id": "session-1", "branch_id": None, "source_revision": None,
            "messages": [{"message_uid": "logical-1", "role": "user", "timestamp": 1794000000.25,
                          "content": "private filtered text", "author": {"id": None, "is_bot": None}}]}
    return {"authority": "hermes_source_copied_snapshot", **body, "snapshot_digest": content_digest(body), "availability": "current"}


def response(operation="memory_query", status="ok", result=None):
    return {"protocol_version": 1, "request_id": "req-1", "operation": operation, "status": status,
            "revision": None, "cut": "cut-1", "result": result if result is not None else {
                "search_id": "search-1", "delivery_id": "delivery-1", "manifest_digest": "a"*64,
                "context": "source content", "memory_ids": ["memory-1"]}}


def test_request_roundtrip_is_immutable_and_has_no_authority_fields():
    wire = request()
    parsed = Request.parse(canonical(wire))
    wire["arguments"]["query"] = "changed"
    assert json.loads(parsed.arguments_json)["query"] == "remember"
    assert parsed.expected_revision is None


@pytest.mark.parametrize("change", [
    {"protocol_version": 2}, {"protocol_version": True}, {"principal_id": ""}, {"principal_id": None},
    {"profile_id": "../profile"}, {"operation": "sql"}, {"owner_id": "someone-else"},
    {"token": "do-not-echo"}, {"path": "C:/secret"}, {"idempotency_key": "unneeded"},
    {"arguments": {"query": "x", "limit": True}}, {"arguments": {"query": "x", "limit": 51}},
    {"arguments": {"query": "x", "limit": 0}}, {"arguments": {"query": "x"}},
    {"arguments": {"query": "x"*4097, "limit": 5}},
])
def test_request_rejects_tampering_and_limits(change):
    wire = request()
    wire.update(change)
    with pytest.raises(ContractError):
        Request.parse(canonical(wire))


@pytest.mark.parametrize("raw", [b'{"protocol_version":1,"protocol_version":1}', b'{"x":NaN}',
                                  b'[]', b'\xff', b'{', b' '* (MAX_WIRE_BYTES+1)], ids=['duplicates', 'nan', 'array', 'utf8', 'malformed', 'oversize'])
def test_json_rejects_duplicates_nonfinite_malformed_and_oversize(raw):
    with pytest.raises(ContractError):
        Request.parse(raw)


@pytest.mark.parametrize("op,args", [
    ("snapshot_submit", snapshot()),
    ("refine_query", {"query": "x", "limit": 1, "search_id": "search-1", "selected_ids": ["memory-1"]}),
    ("traverse_graph", {"seed_ids": ["memory-1"], "depth": 3, "limit": 50, "cut": "cut-1"}),
    ("consumption_confirm", {"delivery_id": "delivery-1", "manifest_digest": "a"*64, "handoff_event_id": "event-1"}),
    ("owner_status", {}), ("inspect_memory", {"memory_id": "memory-1", "cut": "cut-1"}),
    ("edit_memory", {"memory_id": "memory-1", "action": "replace", "content": "edited", "origin": "authenticated_user"}),
])
def test_all_named_operation_requests(op, args):
    assert Request.parse(canonical(request(op, args))).operation == op


@pytest.mark.parametrize("field", ["expected_revision", "idempotency_key"])
def test_mutation_requires_revision_and_idempotency(field):
    wire = request("snapshot_submit", snapshot())
    wire[field] = None
    with pytest.raises(ContractError):
        Request.parse(canonical(wire))


def test_snapshot_keeps_real_uid_and_explicit_unknown_revision_branch():
    parsed = SourceSnapshot.parse(snapshot())
    assert parsed.branch_id is None and parsed.source_revision is None
    assert json.loads(parsed.messages_json)[0]["message_uid"] == "logical-1"


@pytest.mark.parametrize("mutate", [
    lambda s: s["messages"][0].update({"_row_id": 123}),
    lambda s: s["messages"][0].update({"message_uid": ""}),
    lambda s: s["messages"][0].update({"content": [{"type": "image", "url": "private"}]}),
    lambda s: s["messages"][0].update({"timestamp": None}),
    lambda s: s["messages"].append(copy.deepcopy(s["messages"][0])),
    lambda s: s.update({"authority": "live_gateway_turn"}),
    lambda s: s.update({"snapshot_digest": "0"*64}),
    lambda s: s.update({"availability": "deleted"}),
])
def test_bad_copied_snapshot_never_acknowledged(mutate):
    value = snapshot()
    mutate(value)
    with pytest.raises(ContractError):
        SourceSnapshot.parse(value)


def test_cross_profile_source_binding_denied():
    value = request("snapshot_submit", snapshot())
    value["profile_id"] = "profile-b"
    with pytest.raises(ContractError, match="source_scope_mismatch"):
        Request.parse(canonical(value))


def test_response_matches_request_and_rejects_model_result_guess():
    parsed = Response.parse(canonical(response()))
    assert parsed.for_request(Request.parse(canonical(request()))) is parsed
    malformed = response(result={"answer": "I remembered everything"})
    with pytest.raises(ContractError):
        Response.parse(canonical(malformed))
    wire = response()
    wire["request_id"] = "another-request"
    with pytest.raises(ContractError, match="response_mismatch"):
        Response.parse(canonical(wire)).for_request(Request.parse(canonical(request())))


@pytest.mark.parametrize("status", ["unavailable", "conflict", "denied", "invalid", "unsupported"])
def test_typed_error_response_has_no_payload_or_credential_echo(status):
    value = response(status=status, result={"code": "service_unavailable", "retryable": False})
    assert Response.parse(canonical(value)).status == status
    value["result"]["detail"] = "private data"
    with pytest.raises(ContractError):
        Response.parse(canonical(value))


def test_fake_durable_checkpoint_rejected():
    value = response("snapshot_submit", result={"import_receipt": "import-1", "snapshot_digest": "a"*64, "durable": False})
    value["revision"] = "host-rev-2"
    with pytest.raises(ContractError, match="not_durable"):
        Response.parse(canonical(value))


def grant():
    return ProfileGrant("profile-a", "principal-a", "rel-a", (AuthorGrant("alice", "phy-alice"),), "a"*32)


def test_credentials_never_grant_caller_owner_or_other_profile():
    auth = grant()
    parsed = Request.parse(canonical(request()))
    auth.authorize(parsed, "a"*32)
    assert "a"*32 not in repr(auth)
    for token in ("wrong", "", "b"*32):
        with pytest.raises(ContractError, match="denied"):
            auth.authorize(parsed, token)
    for field in ("principal_id", "profile_id"):
        wire = request()
        wire[field] = "other"
        with pytest.raises(ContractError, match="denied"):
            auth.authorize(Request.parse(canonical(wire)), "a"*32)


@pytest.mark.parametrize("actor,is_bot,expected", [
    (None, None, ("rel-a",)), ("", False, ("rel-a",)), ("stranger", False, ("rel-a",)),
    ("bot", True, ("rel-a",)), ("alice", False, ("rel-a", "phy-alice")),
])
def test_actor_is_resolved_per_turn_not_from_operator(actor, is_bot, expected):
    assert grant().owners_for(actor, is_bot) == expected


def test_bot_requires_its_own_authenticated_mapping():
    auth = ProfileGrant("profile-a", "principal-a", "rel-a", (AuthorGrant("bot", "phy-authorized-bot"),), "a"*32)
    assert auth.owners_for("bot", True) == ("rel-a", "phy-authorized-bot")
    assert auth.owners_for("someone-else", False) == ("rel-a",)


def discovery(endpoint="http://127.0.0.1:43123", **changes):
    values = dict(endpoint=endpoint, instance_id="instance-1", profile_id="profile-a", protocol_version=1,
                  hermes_revision=HERMES_REVISION, lease_id="lease-1")
    values.update(changes)
    return Discovery(**values)


def test_loopback_discovery_requires_all_pins():
    for endpoint in ("http://127.0.0.1:43123", "http://[::1]:43123/"):
        discovery(endpoint).validate(expected_profile="profile-a", expected_instance="instance-1", expected_lease="lease-1")


@pytest.mark.parametrize("changes", [
    {"endpoint": "http://localhost:1234"}, {"endpoint": "http://0.0.0.0:1234"},
    {"endpoint": "http://example.com:1234"}, {"endpoint": "http://127.0.0.1:1234/?token=secret"},
    {"endpoint": "http://user:secret@127.0.0.1:1234"}, {"endpoint": "http://127.0.0.1:1234/path"},
    {"endpoint": "http://127.0.0.1"}, {"hermes_revision": "wrong"}, {"profile_id": "other"},
    {"instance_id": "other"}, {"lease_id": "other"}, {"protocol_version": 2},
])
def test_discovery_does_not_guess_endpoint_instance_lease_or_host(changes):
    with pytest.raises(ContractError):
        discovery(**changes).validate(expected_profile="profile-a", expected_instance="instance-1", expected_lease="lease-1")


def test_provider_credential_cannot_claim_authenticated_user_edit_origin():
    value = request("edit_memory", {"memory_id": "memory-1", "action": "replace", "content": "x", "origin": "authenticated_user"})
    with pytest.raises(ContractError, match="user_channel_required"):
        grant().authorize(Request.parse(canonical(value)), "a"*32)


@pytest.mark.parametrize("op,result", [
    ("snapshot_submit", {"import_receipt": "import-1", "snapshot_digest": "a"*64, "durable": True}),
    ("owner_status", {"worker_state": "held", "pending_jobs": 2, "handoff_api_version": None}),
    ("inspect_memory", {"memory_id": "memory-1", "content": "x", "source_snapshot_digests": ["a"*64]}),
    ("edit_memory", {"memory_id": "memory-1", "changed": True}),
])
def test_named_success_result_dtos(op, result):
    value = response(op, result=result)
    value["revision"] = "host-rev-2"
    assert Response.parse(canonical(value)).operation == op


def test_two_source_messages_with_identical_text_keep_distinct_logical_ids():
    value = snapshot()
    second = copy.deepcopy(value["messages"][0])
    second["message_uid"] = "logical-2"
    value["messages"].append(second)
    value["snapshot_digest"] = content_digest({k: value[k] for k in
        ("profile_id", "session_id", "branch_id", "source_revision", "messages")})
    assert len(json.loads(SourceSnapshot.parse(value).messages_json)) == 2


def test_json_integer_overflow_is_a_safe_contract_error():
    with pytest.raises(ContractError, match="invalid_json"):
        Request.parse(b'{"integer":' + b'9'*10000 + b'}')


@pytest.mark.parametrize("endpoint", [None, 42, []])
def test_malformed_discovery_endpoint_type_is_a_safe_contract_error(endpoint):
    with pytest.raises(ContractError, match="invalid_endpoint"):
        discovery(endpoint).validate(expected_profile="profile-a", expected_instance="instance-1", expected_lease="lease-1")


def test_noncurrent_empty_source_view_is_explicitly_unavailable():
    value = snapshot()
    value["availability"] = "unavailable"
    value["messages"] = []
    value["snapshot_digest"] = content_digest({k: value[k] for k in
        ("profile_id", "session_id", "branch_id", "source_revision", "messages")})
    parsed = SourceSnapshot.parse(value)
    with pytest.raises(ContractError, match="source_unavailable"):
        parsed.require_current()


def test_pinned_grants_cannot_authorize_confirmation_even_with_expanded_capabilities():
    parsed = Request.parse(canonical(request("consumption_confirm", {
        "delivery_id": "delivery-1", "manifest_digest": "a"*64, "handoff_event_id": "event-1"})))
    current = grant()
    expanded = ProfileGrant("profile-a", "principal-a", "rel-a", (), "a"*32, ("consumption_confirm",))
    assert "consumption_confirm" not in current.allowed_operations
    for auth in (current, expanded):
        with pytest.raises(ContractError, match="handoff_unavailable"):
            auth.authorize(parsed, "a"*32)


def test_pinned_client_cannot_parse_fabricated_successful_confirmation():
    value = response("consumption_confirm", result={"receipt_id": "receipt-1", "delivery_id": "delivery-1", "manifest_digest": "a"*64, "confirmed": True})
    value["revision"] = "host-rev-2"
    with pytest.raises(ContractError, match="handoff_unavailable"):
        Response.parse(canonical(value))
    value.update(status="unavailable", result={"code": "handoff_unavailable", "retryable": False})
    assert Response.parse(canonical(value)).status == "unavailable"


def test_expanded_provider_grant_cannot_authorize_user_edit_channel():
    value = request("edit_memory", {"memory_id": "memory-1", "action": "replace", "content": "x", "origin": "authenticated_user"})
    expanded = ProfileGrant("profile-a", "principal-a", "rel-a", (), "a"*32, ("edit_memory",))
    with pytest.raises(ContractError, match="user_channel_required"):
        expanded.authorize(Request.parse(canonical(value)), "a"*32)


@pytest.mark.parametrize("op,args,result", [
    ("traverse_graph", {"seed_ids": ["memory-1"], "depth": 1, "limit": 5, "cut": "cut-1"},
     {"search_id": "search-1", "delivery_id": "delivery-1", "manifest_digest": "a"*64, "context": "x", "memory_ids": ["memory-1"]}),
    ("inspect_memory", {"memory_id": "memory-1", "cut": "cut-1"},
     {"memory_id": "memory-1", "content": "x", "source_snapshot_digests": ["a"*64]}),
])
def test_cut_bound_success_requires_exact_requested_cut(op, args, result):
    req = Request.parse(canonical(request(op, args)))
    value = response(op, result=result)
    assert Response.parse(canonical(value)).for_request(req).cut == "cut-1"
    value["cut"] = "cut-old"
    with pytest.raises(ContractError, match="response_cut_mismatch"):
        Response.parse(canonical(value)).for_request(req)


def test_inspection_success_cannot_substitute_another_memory_target():
    req = Request.parse(canonical(request("inspect_memory", {"memory_id": "memory-1", "cut": "cut-1"})))
    value = response("inspect_memory", result={"memory_id": "other", "content": "x", "source_snapshot_digests": ["a"*64]})
    with pytest.raises(ContractError, match="response_target_mismatch"):
        Response.parse(canonical(value)).for_request(req)


def test_import_success_requires_the_exact_requested_copied_digest():
    req = Request.parse(canonical(request("snapshot_submit", snapshot())))
    value = response("snapshot_submit", result={"import_receipt": "import-1", "snapshot_digest": "b"*64, "durable": True})
    value["revision"] = "host-rev-2"
    with pytest.raises(ContractError, match="response_source_mismatch"):
        Response.parse(canonical(value)).for_request(req)


def test_cut_bound_error_is_explicit_unavailable_not_a_successful_stale_read():
    req = Request.parse(canonical(request("inspect_memory", {"memory_id": "memory-1", "cut": "cut-1"})))
    value = response("inspect_memory", status="unavailable", result={"code": "source_unavailable", "retryable": False})
    value["cut"] = None
    assert Response.parse(canonical(value)).for_request(req).status == "unavailable"


def test_confirmation_key_must_bind_the_exact_delivery_and_manifest():
    value = request("consumption_confirm", {"delivery_id": "delivery-1", "manifest_digest": "a"*64, "handoff_event_id": "event-1"})
    assert value["idempotency_key"] == confirmation_key("delivery-1", "a"*64)
    value["idempotency_key"] = "caller-invented-key"
    with pytest.raises(ContractError, match="confirmation_key_mismatch"):
        Request.parse(canonical(value))


def test_proposed_confirmation_response_binds_exact_manifest(monkeypatch):
    # Schema-only hypothetical capability: no actual host/hook or provider grant is enabled.
    import reliquary_hermes.protocol as protocol
    monkeypatch.setattr(protocol, "PINNED_HANDOFF_API_VERSION", 1)
    req = Request.parse(canonical(request("consumption_confirm", {
        "delivery_id": "delivery-1", "manifest_digest": "a"*64, "handoff_event_id": "event-1"})))
    value = response("consumption_confirm", result={"receipt_id": "receipt-1", "delivery_id": "delivery-1",
                                                      "manifest_digest": "a"*64, "confirmed": True})
    value["revision"] = "host-rev-2"
    assert Response.parse(canonical(value)).for_request(req).status == "ok"
    value["result"]["manifest_digest"] = "b"*64
    with pytest.raises(ContractError, match="response_manifest_mismatch"):
        Response.parse(canonical(value)).for_request(req)


@pytest.mark.parametrize("op,args", [
    ("memory_query", {"query": "x", "limit": 1}),
    ("refine_query", {"query": "x", "limit": 1, "search_id": "search-1", "selected_ids": ["memory-1"]}),
    ("traverse_graph", {"seed_ids": ["memory-1"], "depth": 1, "limit": 1, "cut": "cut-1"}),
])
def test_retrieval_response_cannot_exceed_the_requested_limit(op, args):
    req = Request.parse(canonical(request(op, args)))
    value = response(op)
    assert Response.parse(canonical(value)).for_request(req).status == "ok"
    value["result"]["memory_ids"] = ["memory-1", "memory-2"]
    with pytest.raises(ContractError, match="response_limit_mismatch"):
        Response.parse(canonical(value)).for_request(req)


def test_refinement_response_requires_the_registered_search_identity():
    req = Request.parse(canonical(request("refine_query", {
        "query": "x", "limit": 5, "search_id": "search-1", "selected_ids": ["memory-1"]})))
    value = response("refine_query")
    value["result"]["search_id"] = "another-search"
    with pytest.raises(ContractError, match="response_search_mismatch"):
        Response.parse(canonical(value)).for_request(req)
