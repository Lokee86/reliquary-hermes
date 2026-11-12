"""Deterministic external model for the real Hermes-hosted acceptance test."""

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread

from hosted_hermes_worker import decode_hermes_sdk_request
from reliquary_hermes.validation import canonical
from test_hp04_host import _fixture_reply


@contextmanager
def hosted_model(dimensions):
    state = {"calls": [], "errors": [], "revoked": False, "large_reply": False}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.headers.get("Authorization") != "Bearer synthetic-hosted-inference-key":
                self.send_error(401)
                return
            if state["revoked"]:
                self.send_response(401)
                body = b'{"error":{"message":"Synthetic credential revoked","type":"authentication_error"}}'
            else:
                try:
                    raw = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    request = decode_hermes_sdk_request(raw)
                    assert self.path.endswith(("/chat/completions", "/embeddings"))
                    name = request.get("schema_name", "embed")
                    state["calls"].append({"schema_name": name, "model": request["model"]})
                    if name == "embed":
                        assert request["dimensions"] == dimensions
                        result = {"model": request["model"], "data": [
                            {"index": index, "embedding": [0.12345678901234567] * dimensions}
                            for index in range(len(request["inputs"]))]}
                    else:
                        result = {"choices": [{"message": {"content": json.dumps(reply(request))}}],
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


def reply(request):
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
        return {"version": 1, "approved": [item["memory"] for item in state.get("candidates", [])]}
    if name == "dream_pair_classification":
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
