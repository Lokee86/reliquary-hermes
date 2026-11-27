"""Focused protocol and ctx.llm behavior for the hosted inference worker."""

import asyncio
import base64
from hashlib import sha256
import sys
from types import SimpleNamespace
import time
import types

import pytest

from reliquary_hermes.inference_worker import HostedInferenceWorker, _decode_job
from reliquary_hermes import setup
from reliquary_hermes import register as register_plugin
from reliquary_hermes.settings import NativeDecisionRoute
from reliquary_hermes.validation import canonical
from reliquary_hermes.validation import ContractError
from reliquary_hermes import inference_worker as worker_module


class FakeClient:
    def __init__(self, raw):
        self.raw = raw

    def inference_call(self, operation, body, *, timeout):
        assert operation == "request-part" and 0 < timeout <= 5.0
        offset = body["part_index"] * (64 * 1024)
        chunk = self.raw[offset:offset + 64 * 1024]
        return {"job_id": body["job_id"], "correlation_id": body["correlation_id"],
                "lease_epoch": body["lease_epoch"], "part_index": body["part_index"],
                "part_count": (len(self.raw) + 64 * 1024 - 1) // (64 * 1024),
                "total_bytes": len(self.raw), "sha256": sha256(self.raw).hexdigest(),
                "data_b64": base64.b64encode(chunk).decode("ascii")}


def test_worker_executes_embedding_with_query_document_identity_and_no_overrides(tmp_path):
    class Llm:
        async def aembed(self, inputs, **kwargs):
            assert inputs == ["a", "b"]
            assert set(kwargs) == {"input_type", "purpose", "timeout"}
            assert kwargs["input_type"] == "query" and kwargs["purpose"] == "switchboard-query"
            assert 19 < kwargs["timeout"] <= 20
            return SimpleNamespace(vectors=[[0.1, 0.2], [0.3, 0.4]], dimensions=2,
                provider="openai-api", model="text-embedding-3-small",
                audit={"input_type_handling": "shared", "normalization": "none"}, usage=None)

    worker = HostedInferenceWorker(Llm(), str(tmp_path))
    result = asyncio.run(worker._execute("embed", {"inputs": ["a", "b"], "input_type": "query",
        "purpose": "switchboard-query", "dimensions": 2}, time.monotonic() + 20))
    assert result["status"] == "ok"
    assert result["dimensions"] == 2 and result["provider"] == "openai-api"
    assert result["vectors"] == [[0.1, 0.2], [0.3, 0.4]]


def test_worker_heartbeat_wait_does_not_block_model_completion(tmp_path):
    class Llm:
        async def aembed(self, inputs, **kwargs):
            await asyncio.sleep(0)
            return SimpleNamespace(vectors=[[0.1]], dimensions=1, provider="openai-api", model="embed-v1",
                audit={"input_type_handling": "shared", "normalization": "none"})

    worker = HostedInferenceWorker(Llm(), str(tmp_path))
    worker._client = SimpleNamespace()
    job = {"operation": "embed", "deadline": time.monotonic() + 5}
    started = time.monotonic()
    result = asyncio.run(worker._execute_with_heartbeat(job, {
        "inputs": ["query"], "input_type": "query", "purpose": "test",
    }))
    assert result["status"] == "ok" and time.monotonic() - started < 1.0


def test_stop_cancels_readiness_probe(tmp_path):
    class Llm:
        async def acomplete_structured(self, **kwargs):
            await asyncio.Future()

    async def run():
        worker = HostedInferenceWorker(Llm(), str(tmp_path))
        task = asyncio.create_task(worker._tracked_probe())
        await asyncio.sleep(0)
        worker.stop()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())


def test_stop_tolerates_a_concurrently_closed_async_runner(tmp_path):
    class ClosedLoop:
        def call_soon_threadsafe(self, _callback):
            raise RuntimeError("Event loop is closed")

    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._loop = ClosedLoop()
    worker._active_task = SimpleNamespace(cancel=lambda: None)
    worker.stop()
    assert worker._stop.is_set()


def test_idle_configuration_change_reprobes_before_claiming_old_identity(tmp_path):
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._settings = SimpleNamespace(profile_id="profile-a")
    worker._identity = {"general": {}, "embedding": {}}
    worker._lease_epoch = 2
    worker._configuration_revision = worker._configuration_stamp()
    (tmp_path / "config.yaml").write_text("model: changed\n", encoding="utf-8")
    worker._poll_once()
    assert worker._identity is None and worker._lease_epoch is None


def test_readiness_probe_cancels_if_its_runtime_lease_is_lost(tmp_path):
    from reliquary_hermes.client import HostUnavailable

    async def run():
        worker = HostedInferenceWorker(object(), str(tmp_path))
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def probe():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async def lose_lease():
            await entered.wait()
            raise HostUnavailable("runtime_lease_stale")

        worker._probe = probe
        worker._probe_keepalive = lose_lease
        with pytest.raises(HostUnavailable, match="runtime_lease_stale"):
            await asyncio.wait_for(worker._tracked_probe(), timeout=2)
        assert cancelled.is_set()

    asyncio.run(run())


def test_selection_change_during_call_rejects_result_before_publication(tmp_path):
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._settings = SimpleNamespace(profile_id="profile-a")
    worker._identity = {"general": {"provider": "fixture", "model": "old"}}
    worker._lease_epoch = 2
    worker._bound_scope = ("instance-a", "lease-a")
    worker._last_heartbeat = time.monotonic()
    discovery = SimpleNamespace(instance_id="instance-a", lease_id="lease-a")
    worker._client = SimpleNamespace(_read_discovery=lambda: discovery,
        inference_call=lambda *args, **kwargs: {"state": "claimed"})
    worker._validate_claim = lambda *args: {"operation": "complete_structured",
        "job_id": "job-a", "correlation_id": "corr-a", "lease_epoch": 2}
    worker._download_request = lambda job: b'{}'
    uploaded = []
    worker._upload_result = lambda job, result: uploaded.append(result)

    async def complete(job, request):
        (tmp_path / "config.yaml").write_text("model: changed\n", encoding="utf-8")
        return {"status": "ok", "provider": "fixture", "model": "old", "parsed": {"ready": True}}

    worker._execute_with_heartbeat = complete
    worker._poll_once()
    assert uploaded == [{"status": "error", "error_code": "inference_identity_changed"}]
    assert worker._identity is None


def test_worker_rejects_malformed_embedding_result_and_provider_semantics(tmp_path):
    class Llm:
        async def aembed(self, inputs, **kwargs):
            return SimpleNamespace(vectors=[[float("nan")]], dimensions=1, provider="openai-api",
                                   model="m", audit={"input_type_handling": "shared", "normalization": "none"})

    worker = HostedInferenceWorker(Llm(), str(tmp_path))
    with pytest.raises(ContractError, match="inference_invalid_response"):
        asyncio.run(worker._execute("embed", {"inputs": ["a"], "input_type": "document", "purpose": "test"},
                                    time.monotonic() + 10))


def test_worker_structured_call_preserves_schema_and_only_returns_parsed_value(tmp_path):
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}

    class Llm:
        async def acomplete_structured(self, **kwargs):
            assert kwargs["instructions"] == "Extract only the requested facts."
            assert kwargs["input"] == [{"type": "text", "text": "synthetic"}]
            assert kwargs["json_schema"] == schema and kwargs["schema_name"] == "extract"
            assert "provider" not in kwargs and "model" not in kwargs and "profile" not in kwargs
            return SimpleNamespace(parsed={"ok": True}, content_type="json", provider="openai-api",
                                   model="gpt-test", usage=None)

    worker = HostedInferenceWorker(Llm(), str(tmp_path))
    request = {"instructions": "Extract only the requested facts.",
               "input": [{"type": "text", "text": "synthetic"}], "json_schema": schema,
               "schema_name": "extract", "purpose": "unit"}
    result = asyncio.run(worker._execute("complete_structured", request,
                                         time.monotonic() + 10))
    assert result == {"status": "ok", "parsed": {"ok": True}, "provider": "openai-api",
                      "model": "gpt-test", "usage": {}}


def test_native_decision_posts_only_the_native_contract_and_enforces_reply_budget(tmp_path, monkeypatch):
    httpx = pytest.importorskip("httpx")
    route = NativeDecisionRoute("https://fixture.invalid/decisions", "JEV_API_KEY")
    credential = "test-only-profile-jev-key"
    request = {"model": "typesafe/jev-1.13", "state": {"draft": "synthetic"},
               "questions": {"verify": {"type": "choice", "instructions": "Check the draft.",
                                        "criteria": {"supported": "Uses the batch evidence."}}}}
    answer = {"answers": {"verify": {"type": "choice", "choice": "supported"}}}
    observed = []

    class ResponseStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield canonical(answer)

    async def handler(call):
        observed.append(call)
        assert call.method == "POST" and str(call.url) == route.url
        assert call.headers["Authorization"] == f"Bearer {credential}"
        assert _decode_job(call.content) == request
        return httpx.Response(200, stream=ResponseStream())

    client = httpx.AsyncClient

    def async_client(**kwargs):
        assert kwargs["follow_redirects"] is False and kwargs["trust_env"] is False
        return client(transport=httpx.MockTransport(handler), **kwargs)

    def scoped_key(home, selected_route):
        assert home == tmp_path and selected_route == route
        return credential

    monkeypatch.setattr(httpx, "AsyncClient", async_client)
    monkeypatch.setattr(worker_module, "read_native_decision_key", scoped_key)
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._native_route = route
    result = asyncio.run(worker._execute("native_decision", {**request, "max_response_bytes": 256},
                                         time.monotonic() + 5))
    assert result == {"status": "ok", "parsed": answer, "model": request["model"],
                      "provider": worker_module._native_route_id(route)}
    assert credential.encode() not in canonical(result)
    assert len(observed) == 1

    with pytest.raises(ContractError, match="inference_invalid_response"):
        asyncio.run(worker._execute("native_decision", {**request, "max_response_bytes": 16},
                                    time.monotonic() + 5))
    assert len(observed) == 2


def test_job_manifest_download_checks_part_identity_and_exact_digest(tmp_path):
    raw = canonical({"input_type": "document", "synthetic": "a" * 70000})
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._client = FakeClient(raw)
    worker._settings = SimpleNamespace(profile_id="profile-a")
    job = {"job_id": "job-1", "correlation_id": "corr-1", "lease_epoch": 2,
           "deadline": time.monotonic() + 30,
           "manifest": {"part_count": (len(raw) + 64 * 1024 - 1) // (64 * 1024),
                        "total_bytes": len(raw), "sha256": sha256(raw).hexdigest()}}
    assert worker._download_request(job) == raw
    assert _decode_job(raw)["input_type"] == "document"


def test_job_decoder_rejects_duplicate_json_keys():
    with pytest.raises(ContractError, match="invalid_inference_request"):
        _decode_job(b'{"input_type":"query","input_type":"document"}')


def test_result_upload_splits_exact_bytes_and_reuses_manifest(tmp_path):
    class UploadClient:
        def __init__(self):
            self.calls = []

        def inference_call(self, operation, body, *, timeout):
            assert len(canonical(body)) <= 262144
            self.calls.append((operation, body))
            return {"state": "accepted"}

    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._client = UploadClient()
    worker._settings = SimpleNamespace(profile_id="profile-a")
    payload = {"status": "ok", "parsed": {"facts": "a" * 500000}, "provider": "openai-api",
               "model": "gpt-test", "usage": {}}
    job = {"job_id": "job-1", "correlation_id": "corr-1", "lease_epoch": 2,
           "deadline": time.monotonic() + 30}
    worker._upload_result(job, payload)
    calls = worker._client.calls
    assert calls[0][0] == "result-start" and all(call[0] == "result-part" for call in calls[1:])
    assert "parsed" not in calls[0][1] and "vectors" not in calls[0][1]
    manifest = {key: calls[0][1][key] for key in ("part_count", "total_bytes", "sha256")}
    assert manifest["part_count"] >= 2 and len(calls) == manifest["part_count"] + 1
    chunks = []
    for _, part in calls[1:]:
        assert {key: part[key] for key in manifest} == manifest
        chunks.append(base64.b64decode(part["data_b64"], validate=True))
    raw = b"".join(chunks)
    assert len(raw) == manifest["total_bytes"] and sha256(raw).hexdigest() == manifest["sha256"]
    assert _decode_job(raw)["parsed"]["facts"] == "a" * 500000


def test_claim_is_bound_to_registered_profile_and_lease(tmp_path):
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._settings = SimpleNamespace(profile_id="profile-a")
    worker._lease_epoch = 3
    claim = {"state": "claimed", "job_id": "job-1", "correlation_id": "corr-1",
             "operation": "embed", "profile_id": "profile-a", "instance_id": "instance-a",
             "lease_epoch": 3, "deadline_ms": 1000,
             "request": {"part_count": 1, "total_bytes": 10, "sha256": "a" * 64}}
    parsed = worker._validate_claim(claim, "instance-a")
    assert parsed["operation"] == "embed" and parsed["lease_epoch"] == 3
    claim["profile_id"] = "profile-b"
    with pytest.raises(ContractError, match="invalid_inference_claim"):
        worker._validate_claim(claim, "instance-a")


def test_setup_defaults_ignore_legacy_processing_and_environment_config(tmp_path, monkeypatch):
    state = tmp_path / "reliquary"
    state.mkdir()
    processing = state / "processing.json"
    prior = b'{"config_path":"C:/old/reliquary.cfg"}\n'
    processing.write_bytes(prior)
    cfg = tmp_path / "reliquary.cfg"
    cfg.write_bytes(b"legacy route config")
    monkeypatch.setenv("RELIQUARY_CONFIG_PATH", str(cfg))

    owners, _binary, defaults = setup._defaults(tmp_path)
    candidate = setup._candidate(tmp_path, {"main_rel": str(tmp_path / "main.rel"),
        "active_phy": str(tmp_path / "active.phy")}, owners, defaults)
    assert "config_path" not in defaults and "config_path" not in candidate
    assert processing.read_bytes() == prior and cfg.read_bytes() == b"legacy route config"
    with pytest.raises(ContractError, match="invalid_fields"):
        setup._candidate(tmp_path, {"main_rel": str(tmp_path / "main.rel"),
            "active_phy": str(tmp_path / "active.phy"), "config_path": str(cfg)}, owners, defaults)


def test_worker_connect_starts_service_and_attaches_sessionless_runtime(tmp_path, monkeypatch):
    settings = SimpleNamespace(state_dir=tmp_path, profile_id="profile-a", principal_id="operator-a",
                               binary=tmp_path / "host.exe")
    calls = []

    class FakeHostClient:
        def __init__(self, *args, **kwargs):
            calls.append(("construct", args))

        def connect_dashboard(self, session_id):
            calls.append(("start", session_id))

        def attach_runtime(self, session_id):
            calls.append(("attach", session_id))

    monkeypatch.setattr(worker_module, "read_settings", lambda _home: settings)
    monkeypatch.setattr(worker_module, "read_token", lambda _home: "synthetic-service-token")
    monkeypatch.setattr(worker_module, "HostClient", FakeHostClient)
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._connect()
    assert calls[-2:] == [("start", None), ("attach", None)]


def test_generic_plugin_context_starts_worker_without_memory_provider_slot(tmp_path, monkeypatch):
    started = []
    callbacks = []

    class FakeWorker:
        def __init__(self, llm, home):
            assert llm is not None and home == str(tmp_path)

        def start(self):
            started.append(True)

        def stop(self):
            started.append(False)

    provider = types.ModuleType("reliquary_hermes.provider")
    provider._availability_home = lambda: tmp_path
    provider.ReliquaryMemoryProvider = lambda: object()
    monkeypatch.setitem(sys.modules, "reliquary_hermes.provider", provider)
    monkeypatch.setattr(worker_module, "HostedInferenceWorker", FakeWorker)
    llm = SimpleNamespace(acomplete_structured=lambda: None, aembed=lambda: None)
    context = SimpleNamespace(llm=llm, on_unload=callbacks.append)
    register_plugin(context)
    assert started == [True] and len(callbacks) == 1
    callbacks[0]()
    assert started == [True, False]
