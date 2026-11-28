"""Deterministic external model for the real Hermes-hosted acceptance test."""

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread

from hosted_hermes_worker import EMBEDDING_KEY, decode_hermes_sdk_request
from reliquary_hermes.validation import canonical
from test_hp04_host import _fixture_reply


NATIVE_DECISION_KEY = "synthetic-profile-jev-key"


@contextmanager
def hosted_model(dimensions, *, perception=None, embed=None, decide=None, complete=None, chat=None):
    state = {"calls": [], "errors": [], "revoked": False, "large_reply": False,
             "native_calls": [], "approve_memories": True, "embedding_calls": [],
             "embedding_key": EMBEDDING_KEY, "embedding_revoked": False}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            native = self.path == "/decisions"
            embedding = self.path == "/embedding-provider/embeddings"
            key = (NATIVE_DECISION_KEY if native else state["embedding_key"] if embedding
                   else "synthetic-hosted-inference-key")
            if self.headers.get("Authorization") != f"Bearer {key}":
                self.send_error(401)
                return
            if (state["embedding_revoked"] if embedding else state["revoked"]):
                self.send_response(401)
                body = b'{"error":{"message":"Synthetic credential revoked","type":"authentication_error"}}'
            else:
                try:
                    raw = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    if native:
                        assert perception is not None
                        state["native_calls"].append(raw)
                        body = canonical((decide or native_reply)(raw))
                    elif chat and self.path.endswith("/chat/completions") and not raw.get("response_format"):
                        if not isinstance(raw.get("model"), str) or not raw.get("messages"):
                            self.send_error(400)
                            return
                        state["calls"].append({"schema_name": "conversation", "model": raw["model"]})
                        return self.conversation(raw, chat)
                    else:
                        assert self.path.endswith("/chat/completions") or embedding
                        request = decode_hermes_sdk_request(raw)
                        name = request.get("schema_name", "embed")
                        assert (name == "embed") == embedding, "completion/embedding route crossed"
                        if name == "embed":
                            assert request["dimensions"] == dimensions
                            assert request["input_type"] in {"search_document", "search_query"}
                            state["embedding_calls"].append(request)
                            result = {"model": request["model"], "data": [
                                {"index": index, "embedding": (
                                    embed(text) if embed else [0.12345678901234567] * dimensions)}
                                for index, text in enumerate(request["inputs"])]}
                        else:
                            state["calls"].append({"schema_name": name, "model": request["model"]})
                            answer = complete(request) if complete else reply(
                                request, perception, approve_memories=state["approve_memories"])
                            result = {"choices": [{"message": {"content": json.dumps(answer)}}],
                                      "model": request["model"]}
                        body = canonical(result)
                        state["large_reply"] |= name == "embed" and len(body) > 256 * 1024
                    self.send_response(200)
                except (AssertionError, KeyError, TypeError, ValueError) as error:
                    state["errors"].append(type(error).__name__ + ": " + str(error))
                    self.send_error(400)
                    return
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def conversation(self, raw, text):
            header = {"id": "live-fixture", "created": 1, "model": raw["model"]}
            message = {"role": "assistant", "content": text}
            usage = {"prompt_tokens": 100, "completion_tokens": 4, "total_tokens": 104}
            if raw.get("stream"):
                chunks = [
                    {**header, "object": "chat.completion.chunk",
                     "choices": [{"index": 0, "delta": message, "finish_reason": None}]},
                    {**header, "object": "chat.completion.chunk", "usage": usage,
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                ]
                data = ("".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
                        + "data: [DONE]\n\n").encode()
                content_type = "text/event-stream"
            else:
                data = canonical({**header, "object": "chat.completion", "usage": usage,
                                  "choices": [{"index": 0, "message": message, "finish_reason": "stop"}]})
                content_type = "application/json"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", state
        finally:
            server.shutdown()
            thread.join(5)
    assert not state["errors"], state["errors"]


def native_reply(request, *, challenge=None):
    assert set(request) == {"model", "state", "questions"}
    assert request["model"] == "typesafe/jev-1.13"
    questions = request["questions"]
    replies = {}
    for key, question in questions.items():
        assert question["type"] == "choice"
        if key == "verify":
            choice = "stands_as_written"
        elif key.endswith("-time"):
            choice = "change_to_ongoing_claim"
        elif key.endswith("-scope"):
            choice = "overlapping_scope"
        elif challenge and request["state"].get("evidence_hits", {}).get(key) == challenge:
            choice = "material_challenge"
        else:
            choice = "no_material_effect"
        assert choice in question["criteria"]
        replies[key] = {"type": "choice", "choice": choice}
    return {"answers": replies}


def reply(request, perception=None, *, approve_memories=True):
    name, schema = request["schema_name"], request["schema"]
    payload = request["payload"] or {}
    if name == "reliquary_readiness":
        return {"ready": True}
    if name == "entity_resolution":
        existing = bool(payload.get("candidates"))
        return {"decision": "resolve_existing" if existing else "create_new",
                "reason": "context_match" if existing else "named_referent",
                "target_candidate_index": 0 if existing else -1,
                "identity_relation": "same_identity" if existing else "related_distinct",
                "mention_kind": "tool"}
    if name == "entity_admission":
        return {"decision": "create_new", "reason": "first_seen_identity",
                "promotion_policy": "immediate", "entity_kind": "tool",
                "entity_summary": "Lantern is the named release tool."}
    if name == "decision_answers":
        return {"answers": {key: {"type": "choice", "choice":
                "unresolved" if "unresolved" in definition["criteria"] else next(iter(definition["criteria"]))}
                for key, definition in payload["questions"].items()}}
    if name == "decision_response":
        state = payload["state"]
        if state.get("operation") == "refine_query_rewrite":
            return {"version": 1, "query": state["current_query"]}
        approved = [item["memory"] for item in state.get("candidates", [])
                    if approve_memories or (perception and item.get("content") == perception[1])]
        return {"version": 1, "approved": approved}
    if name == "memory_web_audit_v3":
        source, claim = perception
        candidates = [{"proposition": claim, "source_slots": [row["slot"]], "participant_slots": []}
                      for row in payload["sources"] if row["kind"] == "memory" and row["text"] == source]
        return {"ego": {"candidates": [], "lookups": []},
                "perception": {"candidates": candidates, "lookups": []}}
    if name == "observation_synthesis_v2":
        proposal = payload["proposal"]
        draft = {"proposition": proposal["proposition"], "status": "observed",
                 "time_scope": "current", "source_slots": payload["proposal_sources"],
                 "participants": []}
        return {"draft": draft, "duplicate_slot": None}
    if name == "observation_receptors_v1":
        return {"support": ["checklist steps for release"], "challenge": ["release checklist exclusion"],
                "qualification": ["changes to the checklist"], "other": ["updates to release"]}
    if name == "dream_pair_classification":
        if perception:
            return {"relation": "none", "direction": "none", "evidence": []}
        # Default Root policy verifies duplicate proposals, so this fixture
        # exercises both Dream consumers through their normal workflow.
        return {"relation": "duplicate_of", "direction": "undirected",
                "evidence": [{"side": "a", "quote": "Lantern"}, {"side": "b", "quote": "Lantern"}]}
    if name == "dream_pair_verification":
        return {"relation_supported": "yes", "direction_supported": "yes", "evidence_supported": "yes"}
    response = _fixture_reply({"response_format": {"json_schema": {"name": name, "schema": schema}}})
    result = json.loads(response["choices"][0]["message"]["content"])
    if name == "insomnia_memory_wording":
        for candidate in result["candidates"]:
            candidate["routing_mentions"] = [{"field": "content", "start_byte": 0,
                                               "end_byte": 7, "text": "Lantern"}]
    return result
