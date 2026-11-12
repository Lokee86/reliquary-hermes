"""Run the plugin's hosted inference worker through the real Hermes SDK context."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time
import json
import re
from queue import Empty, Queue
from threading import Thread


INFERENCE_REVISION = "168a923023a7018be3dbf66530531dd20b1834b9"


def decode_hermes_sdk_request(request: dict) -> dict:
    """Normalize an OpenAI SDK HTTP body into provider-neutral fixture inputs."""
    if "input" in request:
        return {"operation": "embed", "model": request.get("model"),
                "dimensions": request.get("dimensions"), "inputs": request["input"]}
    schema = request["response_format"]["json_schema"]
    schema_name = schema["name"]
    messages = request.get("messages", [])
    user = next((message for message in messages if message.get("role") == "user"), {})
    content = user.get("content", [])
    if schema_name == "plugin_structured_output":
        header = content[0].get("text", "") if content and isinstance(content[0], dict) else ""
        match = re.search(r"^Schema name:\s*([^\r\n]+)", header, re.MULTILINE)
        if match:
            schema_name = match.group(1).strip()
    payload = None
    for block in content[1:] if isinstance(content, list) else ():
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        try:
            candidate = json.loads(block.get("text", ""))
        except (TypeError, ValueError):
            continue
        if isinstance(candidate, dict):
            payload = candidate
            break
    return {"operation": "complete_structured", "model": request.get("model"),
            "schema_name": schema_name, "schema": schema["schema"], "payload": payload}


def configure_hermes(home: Path, model_url: str, *, embedding_model: str = "fixture-embedding",
                     dimensions: int = 2) -> None:
    """Configure isolated Hermes chat and embedding routes for a fake HTTP server."""
    home.mkdir(parents=True, exist_ok=True)
    base_url = model_url.rstrip("/")
    (home / "config.yaml").write_text(
        "model:\n"
        "  provider: 'custom:fixture'\n"
        "  default: fixture-chat\n"
        "custom_providers:\n"
        "  - name: fixture\n"
        f"    base_url: {base_url}\n"
        "    api_mode: chat_completions\n"
        "    key_env: RELIQUARY_FIXTURE_API_KEY\n"
        "auxiliary:\n"
        "  embedding:\n"
        "    provider: 'custom:fixture'\n"
        f"    model: {embedding_model}\n"
        f"    dimensions: {dimensions}\n"
        "    input_type_handling: shared\n"
        "    timeout: 20\n",
        encoding="utf-8",
    )
    env_path = home / ".env"
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.is_file() else []
    lines = [line for line in lines if not line.startswith("RELIQUARY_FIXTURE_API_KEY=")]
    lines.append("RELIQUARY_FIXTURE_API_KEY=synthetic-hosted-inference-key")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def start_hermes_worker(home: Path, checkout: Path, model_url: str, cleanup, *,
                        embedding_model: str = "fixture-embedding", dimensions: int = 2) -> subprocess.Popen:
    """Register this plugin in a subprocess; its ctx.llm is Hermes' real PluginLlm facade."""
    home = home.resolve()
    checkout = checkout.resolve()
    configure_hermes(home, model_url, embedding_model=embedding_model, dimensions=dimensions)
    repo_src = Path(__file__).resolve().parents[1] / "src"
    script = r'''
import json
import sys
from pathlib import Path
from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from agent.secret_scope import load_env_file, reset_secret_scope, set_secret_scope
from hermes_cli.plugins import PluginContext, PluginManager
from hermes_cli.plugins_manifest import PluginManifest

home = Path(sys.argv[1])
scope = set_hermes_home_override(home)
secrets = load_env_file(home / ".env")
secret_scope = set_secret_scope(secrets, profile_home=str(home))
marker = home / "hosted-worker-registration.json"
manager = PluginManager(scope_key=str(home))
contexts = []
def start():
    manifest = PluginManifest(name="reliquary-hermes", key="reliquary-hermes",
                              data_namespace="reliquary-hermes")
    context = PluginContext(manifest, manager)
    install_audit(context)
    from reliquary_hermes import register
    register(context)
    contexts.append(context)
    return context

def install_audit(context):
    import os
    llm = context.llm
    original_complete = llm.acomplete_structured
    original_embed = llm.aembed
    audit_path = home / "hosted-inference-audit.jsonl"
    def record(value):
        fd = os.open(audit_path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as stream:
            stream.write(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
    async def audited_complete(*args, **kwargs):
        result = await original_complete(*args, **kwargs)
        record({"method": "acomplete_structured", "schema_name": kwargs.get("schema_name"),
                "purpose": kwargs.get("purpose"), "provider": getattr(result, "provider", None),
                "model": getattr(result, "model", None)})
        return result
    async def audited_embed(*args, **kwargs):
        result = await original_embed(*args, **kwargs)
        record({"method": "aembed", "input_type": kwargs.get("input_type"),
                "purpose": kwargs.get("purpose"), "provider": getattr(result, "provider", None),
                "model": getattr(result, "model", None), "dimensions": getattr(result, "dimensions", None)})
        return result
    llm.acomplete_structured = audited_complete
    llm.aembed = audited_embed

def stop(context):
    for registration in reversed(context._staged):
        registration.dispose()

context = start()
marker.write_text(json.dumps({"registered": True}), encoding="utf-8")
print(json.dumps({"event": "started", "registered": True}), flush=True)
try:
    for line in sys.stdin:
        try:
            command = json.loads(line)
        except ValueError:
            print(json.dumps({"event": "error", "code": "invalid_command"}), flush=True)
            continue
        operation = command.get("op") if isinstance(command, dict) else None
        if operation == "status":
            print(json.dumps({"event": "status", "registered": bool(contexts)}), flush=True)
        elif operation == "stop":
            for current in reversed(contexts):
                stop(current)
            contexts.clear()
            marker.unlink(missing_ok=True)
            print(json.dumps({"event": "stopped", "registered": False}), flush=True)
        elif operation == "start":
            if not contexts:
                context = start()
                marker.write_text(json.dumps({"registered": True}), encoding="utf-8")
            print(json.dumps({"event": "started", "registered": bool(contexts)}), flush=True)
        elif operation == "quit":
            print(json.dumps({"event": "quitting"}), flush=True)
            break
        else:
            print(json.dumps({"event": "error", "code": "unknown_operation"}), flush=True)
finally:
    for current in reversed(contexts):
        stop(current)
    marker.unlink(missing_ok=True)
    reset_secret_scope(secret_scope)
    reset_hermes_home_override(scope)
'''
    inherited = {key: value for key, value in os.environ.items()
                 if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    inherited.update(
        HOME=str(home), USERPROFILE=str(home), APPDATA=str(home), LOCALAPPDATA=str(home),
        TEMP=str(home), TMP=str(home), TMPDIR=str(home),
        PYTHONPATH=os.pathsep.join((str(repo_src), str(checkout))),
        PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", HERMES_DISABLE_LAZY_INSTALLS="1",
    )
    log_path = home / "hosted-worker.log"
    log = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        [sys.executable, "-B", "-c", script, str(home)], cwd=home, env=inherited,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True,
    )
    log.close()
    process._hosted_output_queue = Queue()
    def capture_stdout():
        for line in process.stdout:
            process._hosted_output_queue.put(line)
    Thread(target=capture_stdout, daemon=True).start()
    cleanup.callback(stop_hermes_worker, process)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if (home / "hosted-worker-registration.json").is_file():
            try:
                line = process._hosted_output_queue.get(timeout=max(0.01, deadline - time.monotonic()))
            except Empty:
                break
            if json.loads(line) == {"event": "started", "registered": True}:
                process._hosted_hermes_home = home
                process._hosted_hermes_log = log_path
                return process
        if process.poll() is not None:
            break
        time.sleep(0.05)
    log_text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
    raise AssertionError(f"Hermes plugin worker failed to register: {log_text}")


def worker_command(process: subprocess.Popen, operation: str) -> dict:
    """Send a JSON-line lifecycle/status command, exposing no provider credentials."""
    if process.poll() is not None or process.stdin is None or process.stdout is None:
        raise AssertionError("Hermes inference worker process is not running")
    process.stdin.write(json.dumps({"op": operation}) + "\n")
    process.stdin.flush()
    try:
        line = process._hosted_output_queue.get(timeout=5)
    except Empty:
        raise AssertionError("Hermes inference worker control response timed out") from None
    if not line:
        raise AssertionError("Hermes inference worker closed its control stream")
    return json.loads(line)


def stop_hermes_worker(process: subprocess.Popen) -> None:
    if process.poll() is None:
        try:
            worker_command(process, "quit")
            process.stdin.close()
            process.wait(timeout=5)
        except (AssertionError, BrokenPipeError, OSError, subprocess.TimeoutExpired):
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    if process.stdout:
        process.stdout.close()
