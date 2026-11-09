"""Canonical JSON Schema source for the HP01 web dashboard contract, not a service."""


def obj(fields):
    return {"type": "object", "properties": fields, "required": list(fields), "additionalProperties": False}


def arr(item, maximum, minimum=0):
    return {"type": "array", "items": item, "minItems": minimum, "maxItems": maximum}


def nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


def ref(name):
    return {"$ref": "#/$defs/" + name}


def enum(*values):
    return {"enum": list(values)}


ID = {"type": "string", "minLength": 1, "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$"}
DECIMAL = {"type": "string", "maxLength": 39, "pattern": "^(0|[1-9][0-9]{0,38})$"}
ID["not"] = {"pattern": "[" + chr(13) + chr(10) + "]"}
DECIMAL["not"] = dict(ID["not"])
DIGEST = {"type": "string", "pattern": "^[0-9a-f]{64}$", "minLength": 64, "maxLength": 64}
TEXT = {"type": "string", "maxLength": 32768}
LABEL = {"type": "string", "minLength": 1, "maxLength": 128}
BOOL = {"type": "boolean"}
IDS = {**arr(ID, 50), "uniqueItems": True}
AVAILABILITY = enum("available", "missing", "unauthorized", "pruned", "corrupt")
CAPABILITIES = ("view", "manage", "history", "provenance", "graph", "community", "status",
                "memory_create", "memory_edit", "memory_retire", "relation_edit", "community_rename")
MUTATIONS = frozenset({"ui.memory_create", "ui.memory_edit", "ui.memory_retire", "ui.relation_change", "ui.community_rename"})
PAGED = frozenset({"ui.owner_sessions", "ui.memory_list", "ui.memory_history", "ui.community_list", "ui.community_members"})
OP_CAPABILITY = {"ui.memory_list": "view", "ui.memory_detail": "view", "ui.memory_history": "history",
                 "ui.provenance": "provenance", "ui.graph_page": "graph", "ui.community_list": "community",
                 "ui.community_members": "community",
                 "ui.operational_status": "status", "ui.memory_create": "memory_create", "ui.memory_edit": "memory_edit",
                 "ui.memory_retire": "memory_retire", "ui.relation_change": "relation_edit", "ui.community_rename": "community_rename"}


def page(item):
    return obj({"items": arr(item, 128), "next_cursor": nullable(ID), "truncated": BOOL})


def build_schema():
    d = {}
    d["Capabilities"] = obj({name: BOOL for name in CAPABILITIES})
    d["OwnerBinding"] = obj({"owner_id": ID, "owner_kind": enum("REL", "PHY"), "display_label": LABEL,
                             "generation": DECIMAL, "cut": ID, "capabilities": ref("Capabilities")})
    d["MemorySummary"] = obj({"memory_id": ID, "revision": DECIMAL, "body_id": nullable(ID), "title": nullable(LABEL),
        "excerpt": {"type": "string", "maxLength": 512}, "category": ID, "memory_type": ID,
        "lifecycle": enum("active", "retired", "tombstoned", "superseded", "unavailable"),
        "canonical_status": enum("canonical", "duplicate", "superseded", "unknown"),
        "freshness": nullable(obj({"native_value": {"type": "string", "maxLength": 128, "pattern": "^-?[0-9]+([.][0-9]+)?$"}, "as_of_cut": ID})), "community_id": nullable(ID)})
    d["Payload"] = obj({"revision": DECIMAL, "body_id": nullable(ID),
        "availability": enum(*AVAILABILITY["enum"], "terminal"), "content": nullable(TEXT)})
    d["UserProvenance"] = obj({"kind": {"const": "user_origin"}, "principal_id": ID, "created_at_ms": DECIMAL})
    d["HermesProvenance"] = obj({"kind": {"const": "hermes_snapshot"}, "label": {"const": "Hermes source / copied snapshot"},
        "profile_namespace": ID, "session_id": ID, "message_uid": ID, "branch_id": nullable(ID),
        "source_revision": nullable(ID), "content_digest": DIGEST,
        "range": nullable(obj({"start_byte": DECIMAL, "end_byte": DECIMAL, "text": TEXT}))})
    d["UnavailableProvenance"] = obj({"kind": {"const": "source_unavailable"},
        "reason": enum("unauthorized", "deleted", "stale", "missing", "pruned", "corrupt")})
    d["Provenance"] = {"oneOf": [ref("UserProvenance"), ref("HermesProvenance"), ref("UnavailableProvenance")]}
    d["MemoryDetail"] = obj({"memory": ref("MemorySummary"), "body": ref("Payload"),
        "retained_revisions": {**arr(DECIMAL, 128), "uniqueItems": True}, "superseded_by": nullable(ID),
        "tombstone": BOOL, "provenance": arr(ref("Provenance"), 32)})
    d["MemoryCorrection"] = obj({"original_memory_id": ID, "original_revision": DECIMAL,
        "replacement": ref("MemoryDetail")})
    d["MemoryRetirement"] = obj({"memory_id": ID, "revision": DECIMAL, "lifecycle": {"const": "tombstoned"}})
    d["HistoryRevision"] = obj({"revision": DECIMAL, "body_id": ID, "availability": AVAILABILITY,
        "created_at_ms": DECIMAL, "content_digest": nullable(DIGEST)})
    d["GraphNode"] = obj({"node_id": ID, "kind": enum("memory", "community"), "memory_id": nullable(ID),
        "community_id": nullable(ID), "label": LABEL, "origin": ID, "revision": DECIMAL, "cut": ID})
    d["GraphEdge"] = obj({"edge_id": ID, "kind": ID, "origin": enum("user", "dream", "source"),
        "source_id": ID, "target_id": ID, "revision": DECIMAL, "cut": ID, "active": BOOL})
    d["Community"] = obj({"community_id": ID, "generation": DECIMAL, "member_count": DECIMAL,
        "name": nullable(LABEL), "name_origin": enum("user", "derived", "unnamed"), "cursor": nullable(ID)})
    d["Recall"] = obj({"state": enum("none", "candidate", "selected", "returned"),
        "search_id": nullable(ID), "delivery_id": nullable(ID), "candidate_ids": IDS, "selected_ids": IDS,
        "returned_ids": IDS})
    d["OperationalStatus"] = obj({"session_id": nullable(ID),
        "source_state": enum("none", "active", "stale", "tombstoned", "unavailable"),
        "accepted_source_cursor": nullable(ID), "last_completed_receipt": nullable(ID),
        "pending_count": DECIMAL, "held_count": DECIMAL, "error_count": DECIMAL,
        "worker_state": enum("pending", "running", "held", "failed", "complete", "unavailable"), "latest_recall": ref("Recall")})
    cursor = nullable(ID)
    args = {
        "ui.owner_sessions": obj({"cursor": cursor, "limit": {"type": "integer", "minimum": 1, "maximum": 128}}),
        "ui.memory_list": obj({"cursor": cursor, "limit": {"type": "integer", "minimum": 1, "maximum": 128},
            "filters": obj({"query": {"type": "string", "maxLength": 4096}, "category": nullable(ID),
                            "memory_type": nullable(ID), "lifecycle": nullable(enum("active", "retired", "tombstoned", "superseded", "unavailable")),
                            "community_id": nullable(ID)})}),
        "ui.memory_detail": obj({"memory_id": ID, "revision": nullable(DECIMAL)}),
        "ui.memory_history": obj({"memory_id": ID, "cursor": cursor, "limit": {"type": "integer", "minimum": 1, "maximum": 128}}),
        "ui.provenance": obj({"memory_id": ID, "revision": DECIMAL}),
        "ui.graph_page": obj({"seed_ids": IDS, "community_id": nullable(ID), "depth": {"type": "integer", "minimum": 1, "maximum": 3},
            "node_limit": {"type": "integer", "minimum": 1, "maximum": 500},
            "edge_limit": {"type": "integer", "minimum": 1, "maximum": 1000}, "cursor": cursor}),
        "ui.community_list": obj({"cursor": cursor, "limit": {"type": "integer", "minimum": 1, "maximum": 128}}),
        "ui.community_members": obj({"community_id": ID, "expected_generation": DECIMAL, "cursor": cursor,
            "limit": {"type": "integer", "minimum": 1, "maximum": 128}}),
        "ui.operational_status": obj({}),
        "ui.memory_create": obj({"title": LABEL, "body": TEXT, "category": ID, "memory_type": ID}),
        "ui.memory_edit": obj({"memory_id": ID, "title": LABEL, "body": TEXT}),
        "ui.memory_retire": obj({"memory_id": ID, "effect": {"const": "retire"}}),
        "ui.relation_change": obj({"source_id": ID, "target_id": ID, "source_revision": DECIMAL, "target_revision": DECIMAL,
            "action": enum("link", "unlink"), "relation_kind": {"const": "user_association"}, "edge_id": nullable(ID)}),
        "ui.community_rename": obj({"community_id": ID, "name": LABEL}),
    }
    results = {
        "ui.owner_sessions": obj({"owners": page(ref("OwnerBinding")), "active_session_id": nullable(ID),
                                   "session_owner_id": nullable(ID), "active_phy_id": nullable(ID)}),
        "ui.memory_list": page(ref("MemorySummary")),
        "ui.memory_detail": ref("MemoryDetail"),
        "ui.memory_history": obj({"memory_id": ID, "revisions": page(ref("HistoryRevision"))}),
        "ui.provenance": obj({"memory_id": ID, "revision": DECIMAL, "sources": arr(ref("Provenance"), 32)}),
        "ui.graph_page": obj({"routing_state": {"const": "available"}, "nodes": arr(ref("GraphNode"), 500),
            "edges": arr(ref("GraphEdge"), 1000), "next_cursor": cursor, "truncated": BOOL}),
        "ui.community_list": obj({"metadata_state": {"const": "available"}, "communities": page(ref("Community"))}),
        "ui.community_members": obj({"community_id": ID, "generation": DECIMAL, "members": page(ID)}),
        "ui.operational_status": ref("OperationalStatus"),
    }
    committed = {"ui.memory_create": ref("MemoryDetail"), "ui.memory_edit": ref("MemoryCorrection"),
                 "ui.memory_retire": ref("MemoryRetirement"), "ui.relation_change": ref("GraphEdge"), "ui.community_rename": ref("Community")}
    for op, value in committed.items():
        results[op] = obj({"receipt_id": ID, "request_id": ID, "idempotency_key": ID, "changed": BOOL, "committed": value})
    requests, responses = [], []
    error = obj({"code": ID, "retryable": BOOL})
    for op in args:
        request = obj({"protocol_version": {"const": 1}, "request_id": ID, "operation": {"const": op},
            "profile_id": ID, "principal_id": ID, "session_id": nullable(ID), "owner_id": nullable(ID),
            "generation": nullable(DECIMAL), "cut": nullable(ID), "expected_revision": nullable(DECIMAL),
            "idempotency_key": nullable(ID), "arguments": args[op]})
        requests.append(request)
        base = {"protocol_version": {"const": 1}, "request_id": ID, "operation": {"const": op}}
        responses.append(obj({**base, "status": {"const": "ok"},
            "binding": {"type": "null"} if op == "ui.owner_sessions" else ref("OwnerBinding"), "result": results[op]}))
        responses.append(obj({**base, "status": enum("denied", "unavailable", "stale_cursor", "conflict", "invalid", "unsupported"),
                              "binding": {"type": "null"}, "result": error}))
    d["UIRequest"] = {"oneOf": requests}
    d["UIResponse"] = {"oneOf": responses}
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:reliquary:hermes:dashboard:v1",
            "$defs": d, "oneOf": [ref("UIRequest"), ref("UIResponse")]}


SCHEMA = build_schema()
