"""Version-one transport DTOs. No network, credentials, or domain-store access."""

from dataclasses import dataclass
from typing import Any

from . import PROTOCOL_VERSION
from .source import SourceSnapshot
from .validation import (canonical, choice, decode, digest, identifier,
                         integer, obj, require, sequence, text)

MUTATIONS = frozenset({"snapshot_submit", "edit_memory"})
OPERATIONS = MUTATIONS | {"memory_query", "refine_query", "traverse_graph", "owner_status", "inspect_memory"}
MAX_RETRIEVAL_RESULTS = 50


def _ids(value: Any, *, nonempty: bool = False) -> None:
    values = sequence(value, MAX_RETRIEVAL_RESULTS, nonempty=nonempty)
    require(len(set(identifier(item) for item in values)) == len(values), "duplicate_id")


def _recall_owner(value: Any) -> str:
    owner = identifier(value)
    require(len(owner) == 32 and all(c in "0123456789abcdef" for c in owner),
            "invalid_retrieval_owner")
    return owner


def _ranked_recall(value: Any, memories: list, observations: list) -> set:
    seen, selected_memories, selected_observations = set(), set(), set()
    for row in sequence(value, MAX_RETRIEVAL_RESULTS, nonempty=True):
        hit = obj(row, {"kind", "owner_id", "id", "revision", "body_id"})
        kind = choice(hit["kind"], {"memory", "observation"})
        owner = _recall_owner(hit["owner_id"])
        identity = digest(hit["id"])
        revision = integer(hit["revision"], 1, 2**64 - 1)
        body = digest(hit["body_id"])
        key = (kind, owner, identity)
        require(key not in seen, "duplicate_id")
        seen.add(key)
        if kind == "memory":
            selected_memories.add((owner, identity))
        else:
            selected_observations.add((owner, identity, revision, body))
    require({identity for _, identity in selected_memories} == set(memories)
            and selected_observations == {
        (row["owner_id"], row["observation_id"], row["revision"], row["body_id"])
        for row in observations
    }, "retrieval_order_mismatch")
    return selected_memories


def _source_digests(value: Any, maximum: int) -> None:
    digests = [digest(d) for d in sequence(value, maximum)]
    require(len(set(digests)) == len(digests), "duplicate_source_digest")


def _observations(value: Any) -> list:
    observations = sequence(value, MAX_RETRIEVAL_RESULTS)
    ids = set()
    for item in observations:
        o = obj(item, {"owner_id", "observation_id", "revision", "body_id", "claim",
                       "status", "time_scope", "validity", "evidence", "lineage"})
        owner_id = identifier(o["owner_id"])
        require(len(owner_id) == 32 and all(c in "0123456789abcdef" for c in owner_id),
                "invalid_observation_owner")
        observation_id = digest(o["observation_id"])
        observation_key = (owner_id, observation_id)
        require(observation_key not in ids, "duplicate_id")
        ids.add(observation_key)
        integer(o["revision"], 1, 2**64 - 1)
        digest(o["body_id"])
        text(o["claim"], 4096)
        choice(o["status"], {"Observed", "Planned", "Requested", "Possible", "Expected"})
        choice(o["time_scope"], {"Past", "Current", "Future", "Unspecified"})
        if o["validity"] is not None:
            validity = obj(o["validity"], {"start_ns", "end_ns"})
            start, end = validity["start_ns"], validity["end_ns"]
            for timestamp in (start, end):
                if timestamp is not None:
                    integer(timestamp, -(2**63), 2**63 - 1)
            require((start is not None or end is not None)
                    and (start is None or end is None or start < end), "invalid_observation_validity")

        lineage = {}
        for row in sequence(o["lineage"], 64, nonempty=True):
            source = obj(row, {"memory_id", "revision", "body_id", "source_snapshot_digests"})
            memory_id = digest(source["memory_id"])
            require(memory_id not in lineage, "duplicate_id")
            lineage[memory_id] = (integer(source["revision"], 1, 2**64 - 1), digest(source["body_id"]))
            _source_digests(source["source_snapshot_digests"], 3)

        citations, generations = set(), set()
        for row in sequence(o["evidence"], 8, nonempty=True):
            cite = obj(row, {"owner_id", "history_generation", "source_kind", "source_id",
                            "revision", "body_id", "field", "start_byte", "end_byte"})
            require(cite["owner_id"] == owner_id, "observation_owner_mismatch")
            generations.add(digest(cite["history_generation"]))
            kind = choice(cite["source_kind"], {"memory", "observation"})
            source_id = digest(cite["source_id"])
            revision = integer(cite["revision"], 1, 2**64 - 1)
            body_id = digest(cite["body_id"])
            field = choice(cite["field"], {"Title", "Content"})
            start_byte = integer(cite["start_byte"], 0, 2**32 - 1)
            end_byte = integer(cite["end_byte"], start_byte + 1, 2**32 - 1)
            if kind == "memory":
                require(lineage.get(source_id) == (revision, body_id), "observation_lineage_mismatch")
            else:
                require(source_id != observation_id and field == "Content", "invalid_observation_evidence")
            citation = (kind, source_id, revision, body_id, field, start_byte, end_byte)
            require(citation not in citations, "duplicate_observation_evidence")
            citations.add(citation)
        require(len(generations) == 1, "observation_generation_mismatch")
    return observations


def _arguments(operation: str, value: Any) -> None:
    if operation == "snapshot_submit":
        SourceSnapshot.parse(value)
    elif operation in {"memory_query", "refine_query"}:
        keys = {"query", "limit"} | ({"search_id", "selected_ids"} if operation == "refine_query" else set())
        v = obj(value, keys)
        text(v["query"])
        integer(v["limit"], 1, MAX_RETRIEVAL_RESULTS)
        if operation == "refine_query":
            identifier(v["search_id"])
            _ids(v["selected_ids"])
    elif operation == "traverse_graph":
        v = obj(value, {"seed_ids", "depth", "limit", "cut"})
        _ids(v["seed_ids"], nonempty=True)
        integer(v["depth"], 1, 3)
        integer(v["limit"], 1, MAX_RETRIEVAL_RESULTS)
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
            keys = {"search_id", "delivery_id", "context", "memory_ids", "provenance"}
            if type(result) is dict:
                keys.update(result.keys() & {"observations", "ranked"})
            r = obj(result, keys)
            identifier(r["search_id"])
            identifier(r["delivery_id"])
            observations = _observations(r.get("observations", []))
            require(op != "traverse_graph" or not observations, "unexpected_observations")
            text(r["context"], 32768, blank=not observations)
            _ids(r["memory_ids"])
            require(len(r["memory_ids"]) + len(observations) <= MAX_RETRIEVAL_RESULTS,
                    "retrieval_result_limit")
            ranked_memories = (_ranked_recall(r["ranked"], r["memory_ids"], observations)
                               if "ranked" in r else None)
            sources, qualified = set(), set()
            for item in sequence(r["provenance"], MAX_RETRIEVAL_RESULTS):
                keys = {"memory_id", "source_snapshot_digests"}
                if type(item) is dict and "owner_id" in item:
                    keys.add("owner_id")
                source = obj(item, keys)
                memory_id = identifier(source["memory_id"])
                key = (_recall_owner(source["owner_id"]), memory_id) if "owner_id" in source else (
                    None, memory_id)
                require(key not in qualified, "duplicate_id")
                _source_digests(source["source_snapshot_digests"], 50)
                qualified.add(key)
                sources.add(memory_id)
            require(sources == set(r["memory_ids"]) and
                    (ranked_memories is None or qualified == ranked_memories),
                    "provenance_mismatch")
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
            count = (len(result["ranked"]) if "ranked" in result else
                     len(result["memory_ids"]) + len(result.get("observations", [])))
            require(count <= arguments["limit"], "response_limit_mismatch")
        if self.operation == "refine_query":
            require(result["search_id"] == arguments["search_id"], "response_search_mismatch")
        if self.operation in {"traverse_graph", "inspect_memory"}:
            require(self.cut == arguments["cut"], "response_cut_mismatch")
        if self.operation in {"inspect_memory", "edit_memory"}:
            require(result["memory_id"] == arguments["memory_id"], "response_target_mismatch")
        if self.operation == "snapshot_submit":
            require(result["snapshot_digest"] == arguments["snapshot_digest"], "response_source_mismatch")
        return self
