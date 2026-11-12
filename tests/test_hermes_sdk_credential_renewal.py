"""Exercise actual Hermes PluginLlm credential-pool rotation over loopback HTTP."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
from queue import Empty, Queue
from threading import Thread
from threading import Thread

import pytest


_CHILD = r'''
import asyncio
import json
import sys
from pathlib import Path

from hermes_constants import set_hermes_home_override
from agent.secret_scope import reset_secret_scope, set_secret_scope
from hermes_cli.auth import read_credential_pool, write_credential_pool
from hermes_cli.plugins import PluginContext, PluginManager
from hermes_cli.plugins_manifest import PluginManifest
import hermes_yaml

home = Path(sys.argv[1])
base_url = sys.argv[2]
home.mkdir(parents=True, exist_ok=True)
home_override = set_hermes_home_override(home)
secret_scope = set_secret_scope({}, profile_home=str(home))
(home / "config.yaml").write_text(hermes_yaml.safe_dump({
    "model": {"provider": "openai-codex", "default": "chat-only-default"},
    "providers": {"fixture": {
        "name": "fixture", "provider_key": "fixture", "base_url": base_url,
        "api_mode": "chat_completions",
    }},
    "auxiliary": {"embedding": {
        "provider": "custom:fixture", "model": "fixture-embedding-model",
        "dimensions": 2, "input_type_handling": "shared", "timeout": 8,
    }},
}), encoding="utf-8")
(home / ".env").write_text("", encoding="utf-8")

def entry(identifier, token, priority):
    return {"id": identifier, "label": identifier, "auth_type": "api_key",
            "priority": priority, "source": "manual", "access_token": token}

if not read_credential_pool("fixture"):
    write_credential_pool("fixture", [
        entry("key-one", "fixture-key-one", 0),
        entry("key-two", "fixture-key-two", 1),
    ], status_cleared_ids=["key-one", "key-two"])

manager = PluginManager(scope_key=str(home))
manifest = PluginManifest(name="reliquary-hermes", key="reliquary-hermes",
                          data_namespace="reliquary-hermes")
context = PluginContext(manifest, manager)
print(json.dumps({"event": "ready"}), flush=True)

async def embed():
    try:
        result = await context.llm.aembed(
            ["synthetic query"], input_type="query", purpose="credential-renewal-test")
    except Exception as exc:
        code = getattr(exc, "code", "embedding_failed")
        print(json.dumps({"event": "embedding_error", "code": code}), flush=True)
        return
    print(json.dumps({"event": "embedding_ok", "provider": result.provider,
                      "model": result.model, "dimensions": result.dimensions,
                      "input_type": result.audit.get("input_type")}), flush=True)

for line in sys.stdin:
    command = json.loads(line)
    operation = command.get("op")
    if operation == "embed":
        asyncio.run(embed())
    elif operation == "renew":
        rows = read_credential_pool("fixture")
        for row in rows:
            if row.get("id") == "key-two":
                row["access_token"] = "fixture-key-renewed"
        write_credential_pool("fixture", rows, status_cleared_ids=["key-two"])
        asyncio.run(embed())
    elif operation == "revoke-both":
        rows = read_credential_pool("fixture")
        replacements = [
            entry("revoked-one", "fixture-revoked-key-one", 0),
            entry("revoked-two", "fixture-revoked-key-two", 1),
        ]
        write_credential_pool("fixture", replacements,
                              removed_ids=[row["id"] for row in rows if row.get("id")],
                              status_cleared_ids=[row["id"] for row in replacements])
        print(json.dumps({"event": "pool_updated", "entries": len(replacements)}), flush=True)
    elif operation == "quit":
        print(json.dumps({"event": "quitting"}), flush=True)
        break
    else:
        print(json.dumps({"event": "command_error"}), flush=True)

reset_secret_scope(secret_scope)
set_hermes_home_override(home_override)
'''


@pytest.fixture
def fake_provider():
    state = {"accepted": "fixture-key-two", "seen": []}
    labels = {
        "Bearer fixture-key-one": "initial-one",
        "Bearer fixture-key-two": "initial-two",
        "Bearer fixture-key-renewed": "renewed",
        "Bearer fixture-revoked-key-one": "revoked-one",
        "Bearer fixture-revoked-key-two": "revoked-two",
    }

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            authorization = self.headers.get("Authorization", "")
            state["seen"].append({"credential": labels.get(authorization, "unknown"),
                                  "model": body.get("model"), "path": self.path})
            if authorization != "Bearer " + state["accepted"]:
                payload = json.dumps({"error": {"message": "credential rejected"}}).encode()
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            count = len(body.get("input", []))
            payload = json.dumps({
                "object": "list", "model": "fixture-actual-model",
                "data": [{"object": "embedding", "index": index,
                          "embedding": [float(index + 1), 0.25]}
                         for index in range(count)],
                "usage": {"prompt_tokens": 3, "total_tokens": 3},
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _start_sdk(home: Path, checkout: Path, base_url: str):
    repo_src = Path(__file__).resolve().parents[1] / "src"
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update({
        "HOME": str(home), "USERPROFILE": str(home), "APPDATA": str(home),
        "LOCALAPPDATA": str(home), "TEMP": str(home), "TMP": str(home),
        "TMPDIR": str(home), "PYTHONPATH": os.pathsep.join((str(repo_src), str(checkout))),
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
        "HERMES_DISABLE_LAZY_INSTALLS": "1",
    })
    process = subprocess.Popen(
        [sys.executable, "-B", "-c", _CHILD, str(home), base_url],
        cwd=home, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, bufsize=1,
    )
    assert process.stdout is not None
    process._sdk_output = Queue()

    def collect_output():
        for line in process.stdout:
            process._sdk_output.put(line)

    Thread(target=collect_output, daemon=True).start()
    try:
        ready = json.loads(process._sdk_output.get(timeout=20))
        assert ready == {"event": "ready"}
    except (Empty, AssertionError, json.JSONDecodeError):
        process.kill()
        process.wait(timeout=5)
        raise AssertionError("Pinned Hermes PluginContext failed to start") from None
    return process


def _command(process, operation: str) -> dict:
    assert process.stdin is not None
    process.stdin.write(json.dumps({"op": operation}) + "\n")
    process.stdin.flush()
    try:
        line = process._sdk_output.get(timeout=15)
    except Empty:
        raise AssertionError("Pinned Hermes PluginContext command timed out") from None
    return json.loads(line)


def test_real_plugin_llm_uses_and_renews_profile_credential_pool(
    tmp_path, inference_checkout, fake_provider,
):
    base_url, state = fake_provider
    home = tmp_path / "hermes-home"
    home.mkdir()
    process = _start_sdk(home, inference_checkout, base_url)
    try:
        # First credential is rejected; Hermes's resolver rotates to the second pool entry.
        first = _command(process, "embed")
        assert first == {"event": "embedding_ok", "provider": "custom:fixture",
                         "model": "fixture-actual-model", "dimensions": 2,
                         "input_type": "query"}
        assert [row["credential"] for row in state["seen"]] == ["initial-one", "initial-two"]
        assert {row["model"] for row in state["seen"]} == {"fixture-embedding-model"}
        assert all(row["path"] == "/v1/embeddings" for row in state["seen"])

        # Renew through Hermes's public auth store API and prove the facade retains identity.
        state["accepted"] = "fixture-key-renewed"
        renewed = _command(process, "renew")
        assert renewed == first
        assert state["seen"][-1] == {"credential": "renewed",
                                     "model": "fixture-embedding-model",
                                     "path": "/v1/embeddings"}

        # Revoke both pool entries; no provider detail or credential may escape the typed failure.
        state["accepted"] = "no-credential-is-valid"
        assert _command(process, "revoke-both") == {"event": "pool_updated", "entries": 2}
        assert _command(process, "quit") == {"event": "quitting"}
        process.stdin.close()
        process.wait(timeout=5)

        # A fresh Hermes process reloads the renewed profile pool, avoiding stale in-memory tokens.
        process = _start_sdk(home, inference_checkout, base_url)
        revoked = _command(process, "embed")
        assert revoked == {"event": "embedding_error", "code": "embedding_failed"}
        assert [row["credential"] for row in state["seen"]] == [
            "initial-one", "initial-two", "renewed", "revoked-one", "revoked-two",
        ]
        assert "fixture-key" not in json.dumps([first, renewed, revoked])
    finally:
        if process.poll() is None:
            assert _command(process, "quit") == {"event": "quitting"}
            process.stdin.close()
            process.wait(timeout=5)
