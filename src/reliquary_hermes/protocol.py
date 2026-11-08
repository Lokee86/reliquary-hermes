"""Version-one transport DTOs. No network, credentials, or domain-store access."""

from dataclasses import dataclass
from typing import Any

from . import PROTOCOL_VERSION
from .source import SourceSnapshot
from .validation import (canonical, choice, decode, digest, identifier,
                         integer, obj, require, sequence, text)

MUTATIONS = frozenset({"snapshot_submit", "edit_memory"})
OPERATIONS = MUTATIONS | {"memory_query", "refine_query", "traverse_graph", "owner_status", "inspect_memory"}


def _ids(value: Any, *, nonempty: bool = False) -> None:
    values = sequence(value, 50, nonempty=nonempty)
    require(len(set(identifier(item) for item in values)) == len(values), "duplicate_id")


def _arguments(operation: str, value: Any) -> None:
    if operation == "snapshot_submit":
        SourceSnapshot.parse(value)
    elif operation in {"memory_query", "refine_query"}:
        keys = {"query", "limit"} | ({"search_id", "selected_ids"} if operation == "refine_query" else set())
        v = obj(value, keys)
        text(v["query"])
        integer(v["limit"], 1, 50)
        if operation == "refine_query":
            identifier(v["search_id"])
            _ids(v["selected_ids"])
    elif operation == "traverse_graph":
        v = obj(value, {"seed_ids", "depth", "limit", "cut"})
        _ids(v["seed_ids"], nonempty=True)
        integer(v["depth"], 1, 3)
        integer(v["limit"], 1, 50)
        identifier(v["cut"])
    elif operation == "owner_status":
        obj(value, set())
    elif operation == "inspect_memory":
        v = obj(value, {"memory_id", "cut"})
        identifier(v["memory_id"])
        identifier(v["cut"])
    elif operation == "edit_memory":
        v = obj(value, {"memory_id", "action", "content", "origin"})
        identifier(v["memory_id"])
        choice(v["action"], {"replace", "delete"})
        require(v["origin"] == "authenticated_user", "invalid_origin")
        text(v["content"], 32768, blank=v["action"] == "delete")
        require(v["action"] != "delete" or v["content"] == "", "invalid_delete")


@dataclass(frozen=True)
class Request:
    request_id: str
    operation: str
    profile_id: str
    principal_id: str
    session_id: str
    turn_id: str
    expected_revision: str | None
    idempotency_key: str | None
    arguments_json: bytes

    @classmethod
    def parse(cls, raw: bytes) -> "Request":
        v = obj(decode(raw), {"protocol_version", "request_id", "operation", "profile_id", "principal_id",
                              "session_id", "turn_id", "expected_revision", "idempotency_key", "arguments"})
        require(type(v["protocol_version"]) is int and v["protocol_version"] == PROTOCOL_VERSION, "unsupported_protocol")
        op = choice(v["operation"], set(OPERATIONS))
        ids = [identifier(v[k]) for k in ("request_id", "profile_id", "principal_id", "session_id", "turn_id")]
        revision, key = v["expected_revision"], v["idempotency_key"]
        if op in MUTATIONS:
            identifier(revision)
            identifier(key)
        else:
            require(revision is None and key is None, "unexpected_mutation_fields")
        _arguments(op, v["arguments"])
        if op == "snapshot_submit":
            require(v["arguments"]["profile_id"] == v["profile_id"] and
                    v["arguments"]["session_id"] == v["session_id"], "source_scope_mismatch")
        return cls(ids[0], op, *ids[1:], revision, key, canonical(v["arguments"]))


@dataclass(frozen=True)
class Response:
    request_id: str
    operation: str
    status: str
    revision: str | None
    cut: str | None
    result_json: bytes

    @classmethod
    def parse(cls, raw: bytes) -> "Response":
        v = obj(decode(raw), {"protocol_version", "request_id", "operation", "status", "revision", "cut", "result"})
        require(type(v["protocol_version"]) is int and v["protocol_version"] == PROTOCOL_VERSION, "unsupported_protocol")
        op = choice(v["operation"], set(OPERATIONS))
        status = choice(v["status"], {"ok", "unavailable", "conflict", "denied", "invalid", "unsupported"})
        for k in ("revision", "cut"):
            if v[k] is not None:
                identifier(v[k])
        result = v["result"]
        if status != "ok":
            e = obj(result, {"code", "retryable"})
            identifier(e["code"])
            require(type(e["retryable"]) is bool, "invalid_retryable")
        elif op in {"memory_query", "refine_query", "traverse_graph"}:
            r = obj(result, {"search_id", "delivery_id", "context", "memory_ids", "provenance"})
            identifier(r["search_id"])
            identifier(r["delivery_id"])
            text(r["context"], 32768, blank=True)
            _ids(r["memory_ids"])
            sources = set()
            for item in sequence(r["provenance"], 50):
                source = obj(item, {"memory_id", "source_snapshot_digests"})
                memory_id = identifier(source["memory_id"])
                require(memory_id not in sources, "duplicate_id")
                digests = [digest(d) for d in sequence(source["source_snapshot_digests"], 50)]
                require(len(set(digests)) == len(digests), "duplicate_source_digest")
                sources.add(memory_id)
            require(sources == set(r["memory_ids"]), "provenance_mismatch")
            require(v["cut"] is not None, "missing_cut")
        elif op == "snapshot_submit":
            r = obj(result, {"import_receipt", "snapshot_digest", "durable"})
            identifier(r["import_receipt"])
            digest(r["snapshot_digest"])
            require(r["durable"] is True, "not_durable")
        elif op == "owner_status":
            r = obj(result, {"worker_state", "pending_jobs"})
            choice(r["worker_state"], {"pending", "running", "held", "failed", "complete", "unavailable"})
            integer(r["pending_jobs"], 0, 10000)
        elif op == "inspect_memory":
            r = obj(result, {"memory_id", "content", "source_snapshot_digests"})
            identifier(r["memory_id"])
            text(r["content"], 32768, blank=True)
            for d in sequence(r["source_snapshot_digests"], 50):
                digest(d)
            require(v["cut"] is not None, "missing_cut")
        else:
            r = obj(result, {"memory_id", "changed"})
            identifier(r["memory_id"])
            require(type(r["changed"]) is bool, "invalid_changed")
        if status == "ok" and op in MUTATIONS:
            require(v["revision"] is not None, "missing_revision")
        return cls(identifier(v["request_id"]), op, status, v["revision"], v["cut"], canonical(result))

    def for_request(self, request: Request) -> "Response":
        require((self.request_id, self.operation) == (request.request_id, request.operation), "response_mismatch")
        if self.status != "ok":
            return self
        arguments, result = decode(request.arguments_json), decode(self.result_json)
        if self.operation in {"memory_query", "refine_query", "traverse_graph"}:
            require(len(result["memory_ids"]) <= arguments["limit"], "response_limit_mismatch")
        if self.operation == "refine_query":
            require(result["search_id"] == arguments["search_id"], "response_search_mismatch")
        if self.operation in {"traverse_graph", "inspect_memory"}:
            require(self.cut == arguments["cut"], "response_cut_mismatch")
        if self.operation in {"inspect_memory", "edit_memory"}:
            require(result["memory_id"] == arguments["memory_id"], "response_target_mismatch")
        if self.operation == "snapshot_submit":
            require(result["snapshot_digest"] == arguments["snapshot_digest"], "response_source_mismatch")
        return self
