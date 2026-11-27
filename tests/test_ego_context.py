"""Ego uses stock Hermes request assembly in a disposable profile."""

from pathlib import Path
import os

import pytest

from test_pinned_source import _run_probe


def _stock_outgoing_request():
    import json
    import os
    import shutil
    import subprocess
    import sys
    from contextlib import ExitStack
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from pathlib import Path
    from threading import Thread
    from time import monotonic, sleep, time

    import reliquary_hermes
    from hermes_cli.plugins import discover_plugins, get_plugin_command_handler, get_plugin_context_engine

    home = Path(os.environ["HERMES_HOME"])
    profile_plugin = home / "plugins" / "reliquary"
    profile_plugin.mkdir(parents=True)
    package = Path(reliquary_hermes.__file__).resolve().parents[2]
    for name in ("__init__.py", "plugin.yaml"):
        shutil.copy2(package / name, profile_plugin / name)
    shutil.copytree(package / "src" / "reliquary_hermes", profile_plugin / "src" / "reliquary_hermes",
                    ignore=shutil.ignore_patterns("__pycache__"))
    soul = "The original fixture SOUL."
    (home / "SOUL.md").write_text(soul, encoding="utf-8")
    (home / "memories").mkdir()
    (home / "memories" / "MEMORY.md").write_text("Disabled legacy MEMORY fixture", encoding="utf-8")
    (home / "memories" / "USER.md").write_text("Disabled legacy USER fixture", encoding="utf-8")
    config = home / "config.yaml"
    install_config = "plugins:\n  enabled: [reliquary]\n"
    config.write_text(install_config + "memory:\n  provider: reliquary\n", encoding="utf-8")
    discover_plugins(force=True)
    from plugins.memory import load_memory_provider
    disabled_provider = load_memory_provider("reliquary")
    assert disabled_provider is not None and disabled_provider.name == "reliquary"
    assert get_plugin_context_engine() is None
    assert get_plugin_command_handler("identity") is None

    config.write_text(
        install_config + "context:\n  engine: reliquary-ego\n"
        "memory:\n  provider: reliquary\n  memory_enabled: false\n  user_profile_enabled: false\n"
        "model:\n  context_length: 131072\n  max_tokens: 2048\n",
        encoding="utf-8",
    )
    discover_plugins(force=True)
    engine_prototype = get_plugin_context_engine()
    assert engine_prototype is not None and engine_prototype.name == "reliquary-ego"
    assert get_plugin_command_handler("identity") is not None
    enabled_provider = load_memory_provider("reliquary")
    assert enabled_provider is not None and enabled_provider.name == "reliquary"

    host = os.environ.get("EGO_HOST_BINARY")
    hosted_checkout = os.environ.get("EGO_FIXTURE_HOSTED_CHECKOUT")
    if host:
        from reliquary_hermes.client import HostClient, HostUnavailable
        from reliquary_hermes.outbox import SourceOutbox
        from reliquary_hermes.source_capture import capture_snapshot
        from reliquary_hermes.validation import canonical
        from hermes_cli.env_loader import load_hermes_dotenv

        sys.path.insert(0, str(package / "tests"))
        import hosted_hermes_worker as worker
        from test_hp04_host import TEXT, _fixture_reply

        ordinary_recall = "Atlas also logs every approval in the procurement register."
        TEXT["accepted"] = ordinary_recall
        token = "fixture-" + "x" * 40
        state = home / "reliquary"
        state.mkdir()
        rel, phy = state / "fixture.rel", state / "fixture.phy"
        shutil.copy2(os.environ["EGO_FIXTURE_REL"], rel)
        shutil.copy2(os.environ["EGO_FIXTURE_PHY"], phy)
        (state / "owners.json").write_bytes(canonical({
            "profile_id": "profile-ego", "principal_id": "alice",
            "main_rel": str(rel), "active_phy": str(phy), "projects": {},
        }))
        native = HostClient(state, "profile-ego", "alice", token, binary=Path(host))
        expected_identity = "Respond with practical precision."
        markers = ("Always use metric units.", "Meetings use video.",
                   "Every Atlas purchase request is reviewed before payment is released.")
        message = "Tell me about Atlas payment."
    else:
        native = None
        expected_identity = "The approved Ego Identity."
        markers = ("Prefer the short version.", "The verified PHY summary.", "The verified REL point.")
        message = "Tell me about the fixture."

    captures = []
    fixture_calls = []
    class Stub(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def do_GET(self):
            self.send_error(404)
        def do_POST(self):
            inbound = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/v1/embeddings":
                fixture_calls.append("embed")
                dimensions = inbound.get("dimensions", 2)
                self.reply_json({"model": inbound["model"], "data": [
                    {"index": index, "embedding": [1.0] + [0.0] * (dimensions - 1)}
                    for index, _ in enumerate(inbound["input"])
                ], "usage": {"prompt_tokens": 2, "total_tokens": 2}})
                return
            assert self.path == "/v1/chat/completions", self.path
            if native and inbound.get("response_format"):
                self.reply_json(self.structured(inbound))
                return
            captures.append(inbound)
            base = {"id": "ego-probe", "created": 1, "model": "fixture-model"}
            usage = {"prompt_tokens": 100, "completion_tokens": 4, "total_tokens": 104}
            if inbound.get("stream"):
                chunks = [
                    {**base, "object": "chat.completion.chunk",
                     "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Fixture response."},
                                  "finish_reason": None}]},
                    {**base, "object": "chat.completion.chunk", "usage": usage,
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                ]
                body = ("".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n").encode()
                content_type = "text/event-stream"
            else:
                body = json.dumps({**base, "object": "chat.completion",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Fixture response."},
                                 "finish_reason": "stop"}], "usage": usage}).encode()
                content_type = "application/json"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def reply_json(self, payload):
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def structured(self, inbound):
            request = worker.decode_hermes_sdk_request(inbound)
            payload = request["payload"] or {}
            state = payload.get("state", {})
            fixture_calls.append(request["schema_name"] + ":" + state.get("operation", ""))
            if state.get("operation") in {"memory_query", "refine_query", "traverse_graph"}:
                candidates = state.get("candidates", [])
                matching = [item for item in candidates if ordinary_recall in json.dumps(item)]
                result = {"version": 1, "approved": [item["memory"] for item in (matching or candidates)[:1]]}
            elif request["schema_name"] == "memory_web_audit_v3":
                result = {"ego": {"candidates": [], "lookups": []}, "perception": {"candidates": [], "lookups": []}}
            else:
                result = json.loads(_fixture_reply(inbound)["choices"][0]["message"]["content"])
            return {
                "id": "ego-readiness", "object": "chat.completion", "created": 1,
                "model": inbound["model"], "choices": [
                    {"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": json.dumps(result)}}
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
            }

    class Package:
        def ego_call(self, action, body):
            assert action == "context"
            assert body["session_id"] == "ego-fixture"
            assert body["counter"] == "utf8-bytes-v1"
            assert 0 < body["budget"] <= 26_000
            return {"identity": "The approved Ego Identity.",
                    "standing_context": "Pinned context\n\nPrefer the short version.\n\n"
                    "User profile\n\nThe verified PHY summary.\n\nREL summary\n\nThe verified REL point."}

    from run_agent import AIAgent

    with ThreadingHTTPServer(("127.0.0.1", 0), Stub) as server, ExitStack() as worker_cleanup:
        http = Thread(target=server.serve_forever, daemon=True)
        http.start()
        try:
            if native:
                original_config = config.read_text(encoding="utf-8")
                config.write_text(
                    original_config.replace("model:\n", "model:\n  provider: 'custom:fixture'\n  default: fixture-model\n")
                    + "custom_providers:\n  - name: fixture\n"
                    + f"    base_url: http://127.0.0.1:{server.server_port}/v1\n"
                    + "    api_mode: chat_completions\n    key_env: RELIQUARY_FIXTURE_API_KEY\n"
                    + "auxiliary:\n  embedding:\n    provider: 'custom:fixture'\n"
                    + "    model: fixture-embedding\n    dimensions: 2\n    input_type_handling: shared\n",
                    encoding="utf-8",
                )
                (home / ".env").write_text(
                    f"RELIQUARY_HERMES_TOKEN={token}\nRELIQUARY_FIXTURE_API_KEY=fixture-loopback\n", encoding="utf-8",
                )
                load_hermes_dotenv(hermes_home=home)
                worker_cleanup.callback(native.cancel_startup)
                binding = native.attach("ego-fixture")
                assert binding.rel_id == "a2" * 16 and binding.user_id == "a3" * 16
                native.attach_runtime("ego-fixture")
                assert native.ego_call("status", {})["enabled"] is True
                (state / "provider.json").write_bytes(canonical({"binary": host}))
                if hosted_checkout:
                    # Stock owns request assembly. A second, unmodified Hermes SDK
                    # process discovers the same installed plugin and owns model jobs.
                    script = """
from pathlib import Path
import os
import sys
from hermes_cli.env_loader import load_hermes_dotenv
from hermes_cli.plugins import discover_plugins
load_hermes_dotenv(hermes_home=Path(os.environ["HERMES_HOME"]))
discover_plugins(force=True)
sys.stdin.read()
"""
                    environment = {**os.environ, "PYTHONPATH": os.pathsep.join((hosted_checkout, str(package / "src")))}
                    with (home / "ego-inference-worker.log").open("w", encoding="utf-8") as log:
                        companion = subprocess.Popen(
                            [sys.executable, "-B", "-c", script], cwd=home, env=environment, stdin=subprocess.PIPE,
                            stdout=log, stderr=subprocess.STDOUT,
                        )

                    def stop_companion():
                        companion.stdin.close()
                        try:
                            companion.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            companion.kill()
                            companion.wait(timeout=5)

                    worker_cleanup.callback(stop_companion)
                else:
                    discover_plugins(force=True)
                    engine_prototype = get_plugin_context_engine()
                # Seed a separately imported Memory through Hermes' real source pipeline.
                seed_session = "ego-memory-seed"
                native.attach(seed_session)
                outbox = SourceOutbox(state, "profile-ego", "alice")
                snapshot = capture_snapshot("profile-ego", seed_session, [{
                    "message_uid": "accepted", "role": "user", "timestamp": time(), "content": ordinary_recall,
                }])
                outbox.enqueue(snapshot, generation=outbox.generation(seed_session))
                job = outbox.next_job(seed_session)
                deadline = monotonic() + 40
                while monotonic() < deadline:
                    try:
                        receipt = native.deliver_source_job(job)
                        assert outbox.acknowledge(job, receipt)
                        break
                    except HostUnavailable as error:
                        if str(error) != "source_import_pending":
                            raise
                    sleep(0.1)
                else:
                    raise AssertionError(f"ordinary source fixture receipt did not arrive; loopback calls: {fixture_calls}")
                deadline = monotonic() + 40
                while monotonic() < deadline:
                    progress = native.read_source_status(seed_session)
                    if progress["state"] == "complete":
                        break
                    sleep(0.1)
                else:
                    raise AssertionError(f"ordinary source fixture did not finish ({progress['state']}); loopback calls: {fixture_calls}")
                native.attach("ego-fixture")
                ready_request = canonical({
                    "protocol_version": 1, "request_id": "ego-fixture-ready",
                    "operation": "memory_query", "profile_id": "profile-ego", "principal_id": "alice",
                    "session_id": "ego-fixture", "turn_id": "ego-fixture-ready", "expected_revision": None,
                    "idempotency_key": None, "arguments": {"query": message, "limit": 5},
                })
                deadline = monotonic() + 40
                ready_error = "inference_unavailable"
                while monotonic() < deadline:
                    try:
                        candidate = native.request(ready_request, recall_tool=True)
                        if candidate.status == "ok":
                            break
                        ready_error = json.loads(candidate.result_json)["code"]
                    except HostUnavailable as error:
                        ready_error = str(error)
                    sleep(0.1)
                else:
                    raise AssertionError(f"the native fixture recall route did not become available ({ready_error}); loopback calls: {fixture_calls}")
            agent = AIAgent(provider="custom", base_url=f"http://127.0.0.1:{server.server_port}/v1",
                            api_key="fixture-loopback", model="fixture-model", session_id="ego-fixture",
                            quiet_mode=True, max_iterations=2, skip_memory=False)
            engine = agent.context_compressor
            assert type(engine) is type(engine_prototype)
            exposed_tools = {tool.get("function", {}).get("name") for tool in agent.tools}
            assert {"lookup_anchors", "pin_anchor", "modify_anchor", "delete_anchor"} <= exposed_tools
            if native:
                assert engine._ego_client is None  # The engine resolves the stock profile itself.
                assert "memory_query" in exposed_tools
                provider = agent._memory_manager.get_provider("reliquary")
                assert provider is not None
                deadline = monotonic() + 10
                while provider.binding is None and monotonic() < deadline:
                    sleep(0.05)
                assert provider.binding is not None, provider.lifecycle_status
            else:
                engine._ego_client = Package()
            selection = engine.select_context
            inputs = []
            def witness(messages, **options):
                inputs.append([dict(message) for message in messages])
                return selection(messages, **options)
            engine.select_context = witness
            result = agent.run_conversation(message)
            assert len(captures) == 1, f"expected one completed request, saw {len(captures)}"
            first = captures[0]["messages"]
            original = inputs[0]
            assert original[0]["content"].startswith(soul), repr(original[0]["content"][:100])
            if native and not first[0]["content"].startswith(expected_identity):
                try:
                    package_now = native.ego_call("context", {
                        "session_id": "ego-fixture", "query": message, "budget": 10_000, "counter": "utf8-bytes-v1",
                    })
                    current_identity = package_now["identity"]
                except HostUnavailable as error:
                    current_identity = str(error)
                raise AssertionError(f"stock identity was not replaced; package Identity {current_identity!r}; "
                                     f"native client initialized: {engine._ego_client is not None}")
            assert first[0]["content"].startswith(expected_identity)
            suffix = original[0]["content"][len(soul):]
            assert first[0]["content"].startswith(expected_identity + suffix)
            for marker in markers:
                assert first[0]["content"].count(marker) == 1
            assert "Disabled legacy MEMORY" not in first[0]["content"]
            assert "Disabled legacy USER" not in first[0]["content"]
            assert first[1:] == original[1:]
            assert message in first[-1]["content"]
            if native:
                assert engine._ego_client is not None
            if native:
                assert ordinary_recall in json.dumps(first)
            history = result["messages"]
            saved_history = json.dumps(history)
            assert expected_identity not in saved_history
            assert all(marker not in saved_history for marker in markers)

            from unittest.mock import patch

            engine_module = sys.modules[type(engine).__module__]
            with patch.object(engine_module, "load_soul_md", return_value="Different leading identity."):
                agent.run_conversation("Continue the fixture.", conversation_history=history)
            assert len(captures) == 2
            fallback = captures[1]["messages"]
            assert fallback == inputs[1]
            assert len(fallback) > 2
            assert any(message in row["content"] for row in fallback if row["role"] == "user")
            assert fallback[0]["content"].startswith(soul)
            assert expected_identity not in fallback[0]["content"]
            assert all(marker not in fallback[0]["content"] for marker in markers)
            (home / "ego-wire-capture.json").write_text(
                json.dumps({"original_messages": inputs, "outgoing_requests": captures}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        finally:
            try:
                worker_cleanup.close()
            finally:
                server.shutdown()


def test_stock_hermes_outgoing_ego_request(pinned_checkout, tmp_path):
    _run_probe(_stock_outgoing_request, pinned_checkout, tmp_path)


def _native_fixture():
    names = ("EGO_HOST_BINARY", "EGO_FIXTURE_REL", "EGO_FIXTURE_PHY")
    if not all(os.environ.get(name) for name in names):
        pytest.skip("Set the isolated Ego binary and seeded fixture paths for the native proof")
    return {name: Path(os.environ[name]).resolve(strict=True) for name in names}


def test_stock_hermes_outgoing_ego_request_through_native_host(pinned_checkout, inference_checkout, tmp_path):
    fixtures = {**_native_fixture(), "EGO_FIXTURE_HOSTED_CHECKOUT": inference_checkout}
    _run_probe(_stock_outgoing_request, pinned_checkout, tmp_path, fixture_paths=fixtures)


def test_hermes_embedding_sdk_outgoing_ego_and_recall_through_native_host(inference_checkout, tmp_path):
    _run_probe(_stock_outgoing_request, inference_checkout, tmp_path, fixture_paths=_native_fixture())
