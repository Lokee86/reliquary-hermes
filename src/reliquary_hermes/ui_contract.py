"""Typed dashboard DTO/correlation fixtures. No dashboard route or authentication implementation."""

import json
from dataclasses import dataclass
from jsonschema import Draft202012Validator

from .ui_schema import MUTATIONS, OP_CAPABILITY, SCHEMA
from .validation import canonical, content_digest, decode, identifier, require, text


def _validate(name, value):
    schema = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/" + name}
    require(next(Draft202012Validator(schema).iter_errors(value), None) is None, "invalid_ui_schema")
    _utf8(value)


def _utf8(value):
    if type(value) is str:
        text(value, 32768, blank=True)
    elif type(value) is dict:
        for child in value.values():
            _utf8(child)
    elif type(value) is list:
        for child in value:
            _utf8(child)


def _unique(values, key):
    require(len({v[key] for v in values}) == len(values), "duplicate_ui_id")


def _sources(values):
    for source in values:
        if source["kind"] == "hermes_snapshot":
            r = source["range"]
            require(int(r["end_byte"]) - int(r["start_byte"]) == len(r["text"].encode("utf-8")), "source_range_mismatch")


def _summary(memory):
    if memory["body_id"] is None:
        require(memory["lifecycle"] == "tombstoned" and memory["title"] is None, "invalid_terminal_memory")
    if memory["title"] is None:
        require(memory["lifecycle"] != "active" and memory["excerpt"] == "", "payload_availability_mismatch")


def _detail(value):
    memory, body = value["memory"], value["body"]
    _summary(memory)
    require((body["revision"], body["body_id"]) == (memory["revision"], memory["body_id"]), "body_revision_mismatch")
    require((body["availability"] == "available") == (type(body["content"]) is str), "payload_availability_mismatch")
    require((body["availability"] == "terminal") == (body["body_id"] is None), "invalid_terminal_memory")
    if body["availability"] == "terminal":
        require(value["tombstone"], "invalid_terminal_memory")
    _sources(value["provenance"])


def _user_body(detail, arguments, principal):
    require(detail["memory"]["title"] == arguments["title"] and detail["body"]["content"] == arguments["body"],
            "ui_committed_content_mismatch")
    require(bool(detail["provenance"]) and all(source["kind"] == "user_origin" and source["principal_id"] == principal
            for source in detail["provenance"]), "forged_manual_provenance")


def _page(value, request):
    require(len(value["items"]) <= request.arguments["limit"], "ui_page_limit")
    require(value["next_cursor"] is None or value["truncated"], "cursor_truncation_mismatch")
    require(value["next_cursor"] is None or value["next_cursor"] != request.arguments["cursor"], "cursor_not_advanced")


@dataclass(frozen=True)
class UIRequest:
    value_json: bytes

    @classmethod
    def parse(cls, raw):
        v = decode(raw)
        _validate("UIRequest", v)
        require(type(v["protocol_version"]) is int, "unsupported_protocol")
        owner_selection = v["operation"] == "ui.owner_sessions"
        require(owner_selection == (v["owner_id"] is None and v["generation"] is None and v["cut"] is None), "invalid_ui_scope")
        if not owner_selection:
            require(v["owner_id"] is not None and v["generation"] is not None and v["cut"] is not None, "invalid_ui_scope")
        op, args = v["operation"], v["arguments"]
        if op in MUTATIONS:
            identifier(v["idempotency_key"])
            if op == "ui.memory_create":
                require(v["expected_revision"] is None, "invalid_ui_revision")
            elif op == "ui.relation_change":
                is_new = args["edge_id"] is None
                require((v["expected_revision"] is None) == is_new and (not is_new or args["action"] == "link"),
                        "invalid_ui_revision")
            else:
                require(v["expected_revision"] is not None, "missing_ui_revision")
        else:
            require(v["expected_revision"] is None and v["idempotency_key"] is None, "unexpected_ui_mutation_fields")
        if op == "ui.memory_list":
            text(args["filters"]["query"], 4096, blank=True)
        for key in ("title", "name"):
            if key in args:
                text(args[key], 512)
        return cls(canonical(v))

    @property
    def value(self):
        return json.loads(self.value_json)

    @property
    def arguments(self):
        return self.value["arguments"]

    def __getattr__(self, key):
        if key in {"request_id", "operation", "profile_id", "principal_id", "session_id", "owner_id", "generation", "cut", "expected_revision", "idempotency_key"}:
            return self.value[key]
        raise AttributeError(key)


@dataclass(frozen=True)
class UIResponse:
    value_json: bytes

    @classmethod
    def parse(cls, raw):
        v = decode(raw)
        _validate("UIResponse", v)
        require(type(v["protocol_version"]) is int, "unsupported_protocol")
        if v["status"] == "ok":
            op, r = v["operation"], v["result"]
            if op == "ui.memory_detail":
                _detail(r)
            elif op == "ui.memory_create":
                _detail(r["committed"])
            elif op == "ui.memory_edit":
                _detail(r["committed"]["replacement"])
            elif op == "ui.provenance":
                _sources(r["sources"])
            elif op == "ui.operational_status":
                recall = r["latest_recall"]
                state = recall["state"]
                candidates = set(recall["candidate_ids"])
                selected = set(recall["selected_ids"])
                returned = set(recall["returned_ids"])
                require(selected <= candidates, "recall_selection_mismatch")
                has_search = state != "none"
                has_delivery = state == "returned"
                require((recall["search_id"] is not None) == has_search and bool(candidates) == has_search, "invalid_recall_state")
                require(bool(selected) == (state in {"selected", "returned"}), "invalid_recall_state")
                require((recall["delivery_id"] is not None) == has_delivery and bool(returned) == has_delivery, "invalid_recall_state")
                if has_delivery:
                    require(returned == selected, "recall_return_mismatch")
                if r["session_id"] is None:
                    require(r["source_state"] == "none", "invalid_source_state")
        return cls(canonical(v))

    @property
    def value(self):
        return json.loads(self.value_json)

    def for_request(self, request):
        require(type(request) is UIRequest, "invalid_ui_request")
        v, q, a = self.value, request.value, request.arguments
        require((v["request_id"], v["operation"]) == (q["request_id"], q["operation"]), "ui_response_mismatch")
        if v["status"] != "ok":
            return self
        op, r, b = q["operation"], v["result"], v["binding"]
        if op == "ui.owner_sessions":
            _page(r["owners"], request)
            _unique(r["owners"]["items"], "owner_id")
            if q["session_id"] is not None:
                require(r["active_session_id"] == q["session_id"], "ui_session_mismatch")
            return self
        require(b["owner_id"] == q["owner_id"], "ui_owner_mismatch")
        require(b["capabilities"]["view"] and b["capabilities"][OP_CAPABILITY[op]], "ui_capability_mismatch")
        if op not in MUTATIONS:
            require((b["generation"], b["cut"]) == (q["generation"], q["cut"]), "ui_stale_resync")
        else:
            require(b["owner_kind"] == "REL", "ui_denied")
            require(b["capabilities"]["manage"], "ui_capability_mismatch")
            require(r["request_id"] == q["request_id"] and r["idempotency_key"] == q["idempotency_key"], "ui_receipt_mismatch")
            require(b["generation"] == q["generation"], "ui_stale_resync")
            if r["changed"]:
                require(b["cut"] != q["cut"], "ui_uncommitted_result")
        if op == "ui.memory_list":
            _page(r, request)
            _unique(r["items"], "memory_id")
            for item in r["items"]:
                _summary(item)
                if item["freshness"] is not None:
                    require(item["freshness"]["as_of_cut"] == b["cut"], "ui_stale_resync")
        elif op == "ui.memory_detail":
            require(r["memory"]["memory_id"] == a["memory_id"], "ui_target_mismatch")
            if a["revision"] is not None:
                require(r["body"]["revision"] == a["revision"], "historical_revision_mismatch")
        elif op == "ui.memory_history":
            require(r["memory_id"] == a["memory_id"], "ui_target_mismatch")
            _page(r["revisions"], request)
            _unique(r["revisions"]["items"], "revision")
        elif op == "ui.provenance":
            require((r["memory_id"], r["revision"]) == (a["memory_id"], a["revision"]), "historical_revision_mismatch")
        elif op == "ui.graph_page":
            require(len(r["nodes"]) <= a["node_limit"] and len(r["edges"]) <= a["edge_limit"], "ui_graph_limit")
            _unique(r["nodes"], "node_id")
            _unique(r["edges"], "edge_id")
            ids = {node["node_id"] for node in r["nodes"]}
            for node in r["nodes"]:
                require(node["cut"] == b["cut"], "ui_stale_resync")
                require((node["memory_id"] is not None) == (node["kind"] == "memory") and
                        (node["community_id"] is not None) == (node["kind"] == "community"), "ui_node_identity")
            for edge in r["edges"]:
                require(edge["cut"] == b["cut"] and edge["source_id"] in ids and edge["target_id"] in ids, "ui_graph_binding")
            require(r["next_cursor"] is None or r["truncated"], "cursor_truncation_mismatch")
            require(r["next_cursor"] is None or r["next_cursor"] != a["cursor"], "cursor_not_advanced")
        elif op == "ui.community_list":
            _page(r["communities"], request)
            _unique(r["communities"]["items"], "community_id")
        elif op == "ui.community_members":
            require((r["community_id"], r["generation"]) == (a["community_id"], a["expected_generation"]), "ui_community_mismatch")
            _page(r["members"], request)
            members = r["members"]["items"]
            require(len(set(members)) == len(members), "duplicate_ui_id")
        elif op == "ui.operational_status":
            require(r["session_id"] == q["session_id"], "ui_session_mismatch")
        elif op in MUTATIONS:
            committed = r["committed"]
            if op == "ui.memory_create":
                _user_body(committed, a, q["principal_id"])
            elif op == "ui.memory_edit":
                replacement = committed["replacement"]
                require(committed["original_memory_id"] == a["memory_id"], "ui_target_mismatch")
                require(replacement["memory"]["memory_id"] != a["memory_id"], "ui_immutable_memory_id")
                require(r["changed"] and int(committed["original_revision"]) > int(q["expected_revision"])
                        and replacement["memory"]["lifecycle"] == "active" and not replacement["tombstone"],
                        "ui_uncommitted_result")
                _user_body(replacement, a, q["principal_id"])
            elif op == "ui.memory_retire":
                require(committed["memory_id"] == a["memory_id"], "ui_target_mismatch")
                require(r["changed"] and int(committed["revision"]) > int(q["expected_revision"]), "ui_uncommitted_result")
            if op == "ui.relation_change":
                require(committed["origin"] == "user" and committed["kind"] == "user_association" and
                        (committed["source_id"], committed["target_id"]) == (a["source_id"], a["target_id"]) and committed["cut"] == b["cut"], "ui_relation_mismatch")
                require(committed["active"] == (a["action"] == "link"), "ui_uncommitted_result")
                if a["edge_id"] is not None:
                    require(committed["edge_id"] == a["edge_id"], "ui_target_mismatch")
                    revision = int(committed["revision"])
                    require(revision > int(q["expected_revision"]) if r["changed"] else revision == int(q["expected_revision"]), "ui_uncommitted_result")
            if op == "ui.community_rename":
                require(committed["community_id"] == a["community_id"] and committed["name"] == a["name"] and committed["name_origin"] == "user", "ui_target_mismatch")
                revision = int(committed["generation"])
                require(revision > int(q["expected_revision"]) if r["changed"] else revision == int(q["expected_revision"]), "ui_uncommitted_result")
        return self


@dataclass(frozen=True)
class CursorBinding:
    """Trusted server cursor-registry entry, not an unsigned cursor accepted from a browser."""
    cursor_id: str
    request_scope_digest: str

    @classmethod
    def issue_fixture(cls, cursor_id, request):
        identifier(cursor_id)
        v = request.value
        v["request_id"] = "cursor-binding"
        v["arguments"]["cursor"] = None
        return cls(cursor_id, content_digest(v))

    def for_request(self, request):
        require(request.arguments.get("cursor") == self.cursor_id, "stale_cursor_resync")
        expected = self.issue_fixture(self.cursor_id, request)
        require(expected.request_scope_digest == self.request_scope_digest, "stale_cursor_resync")
        return self


@dataclass(frozen=True)
class VerifiedUIContext:
    """Pure authority fixture constructed ONLY by a future trusted dashboard adapter.

    This is not login verification. These booleans must never come from UI request JSON.
    It is deliberately distinct from provider ProfileGrant and has no service credential.
    """
    profile_id: str
    principal_id: str
    owner_bindings_json: bytes
    authenticated_by_hermes: bool
    same_origin: bool
    session_rel_bindings: tuple[tuple[str, str], ...]
    active_session_id: str | None = None
    active_phy_id: str | None = None

    def bindings(self):
        values = json.loads(self.owner_bindings_json)
        require(type(values) is list and len(values) <= 128, "invalid_ui_grants")
        for owner in values:
            _validate("OwnerBinding", owner)
            if owner["owner_kind"] == "PHY":
                capabilities = owner["capabilities"]
                require(not capabilities["manage"] and not any(capabilities[OP_CAPABILITY[op]] for op in MUTATIONS),
                        "invalid_ui_grants")
        _unique(values, "owner_id")
        owners = {owner["owner_id"]: owner for owner in values}
        if self.active_phy_id is not None:
            identifier(self.active_phy_id)
            active = owners.get(self.active_phy_id)
            require(active is not None and active["owner_kind"] == "PHY" and active["capabilities"]["view"], "invalid_ui_active_phy")
        return {owner_id: owner for owner_id, owner in owners.items()
                if owner["owner_kind"] == "REL" or owner_id == self.active_phy_id}

    def sessions(self, owners):
        require(type(self.session_rel_bindings) is tuple and len(self.session_rel_bindings) <= 128, "invalid_ui_sessions")
        values = {}
        for pair in self.session_rel_bindings:
            require(type(pair) is tuple and len(pair) == 2, "invalid_ui_sessions")
            session_id, rel = pair
            identifier(session_id)
            identifier(rel)
            require(session_id not in values and rel in owners and owners[rel]["owner_kind"] == "REL" and
                    owners[rel]["capabilities"]["view"], "invalid_ui_sessions")
            values[session_id] = rel
        require(self.active_session_id is None or self.active_session_id in values, "invalid_ui_sessions")
        return values

    def authorize(self, request):
        require(type(request) is UIRequest and self.authenticated_by_hermes is True, "ui_denied")
        require((request.profile_id, request.principal_id) == (self.profile_id, self.principal_id), "ui_denied")
        owners = self.bindings()
        sessions = self.sessions(owners)
        require(request.session_id is None or request.session_id in sessions, "ui_denied")
        if request.operation == "ui.owner_sessions":
            return
        owner = owners.get(request.owner_id)
        require(owner is not None and owner["capabilities"]["view"], "ui_denied")
        require((request.generation, request.cut) == (owner["generation"], owner["cut"]), "ui_stale_resync")
        require(owner["capabilities"][OP_CAPABILITY[request.operation]], "ui_denied")
        if request.operation == "ui.operational_status" and request.session_id is not None and owner["owner_kind"] == "REL":
            require(sessions[request.session_id] == request.owner_id, "ui_denied")
        if request.operation in MUTATIONS:
            require(self.same_origin is True and owner["capabilities"]["manage"], "ui_denied")

    def check_response(self, response, request):
        self.authorize(request)
        response.for_request(request)
        if response.value["status"] == "ok":
            owners = self.bindings()
            if request.operation == "ui.owner_sessions":
                result = response.value["result"]
                for owner in result["owners"]["items"]:
                    require(owner == owners.get(owner["owner_id"]) and owner["capabilities"]["view"], "ui_denied")
                sessions = self.sessions(owners)
                selected_session = request.session_id if request.session_id is not None else self.active_session_id
                require(result["active_session_id"] == selected_session and
                        result["session_owner_id"] == sessions.get(selected_session) and
                        result["active_phy_id"] == self.active_phy_id, "ui_denied")
                selected = result["session_owner_id"]
                require(selected is None or (selected in owners and owners[selected]["owner_kind"] == "REL" and
                                             owners[selected]["capabilities"]["view"]), "ui_denied")
            else:
                actual = response.value["binding"]
                authorized = owners[request.owner_id]
                require(all(actual[key] == authorized[key] for key in ("owner_id", "owner_kind", "display_label")), "ui_denied")
                require(all(not permitted or authorized["capabilities"][key]
                            for key, permitted in actual["capabilities"].items()), "ui_denied")
                if request.operation not in MUTATIONS:
                    require((actual["generation"], actual["cut"]) ==
                            (authorized["generation"], authorized["cut"]), "ui_stale_resync")
        return response


def verify_expected_revisions(request, current_revisions):
    """Fixture of the mandatory named-product CAS gate, not a mutable-store reader."""
    require(type(request) is UIRequest and request.operation in MUTATIONS, "invalid_ui_mutation")
    op, a = request.operation, request.arguments
    expected = []
    if op in {"ui.memory_edit", "ui.memory_retire"}:
        expected.append((a["memory_id"], request.expected_revision))
    elif op == "ui.community_rename":
        expected.append((a["community_id"], request.expected_revision))
    elif op == "ui.relation_change":
        expected += [(a["source_id"], a["source_revision"]), (a["target_id"], a["target_revision"])]
        if a["edge_id"] is not None:
            expected.append((a["edge_id"], request.expected_revision))
    for target, revision in expected:
        require(current_revisions.get(target) == revision, "ui_revision_conflict")
