"""Focused protocol and ctx.llm behavior for the hosted inference worker."""

import asyncio
import base64
from hashlib import sha256
from types import SimpleNamespace
import time

import pytest

from reliquary_hermes.inference_worker import HostedInferenceWorker, _decode_job
from reliquary_hermes import setup
from reliquary_hermes.validation import canonical
from reliquary_hermes.validation import ContractError


class FakeClient:
    def __init__(self, raw):
        self.raw = raw

    def inference_call(self, operation, body, *, timeout):
        assert operation == "request-part" and timeout == 5.0
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
            assert kwargs["input_type"] == "query" and kwargs["purpose"] == "switchboard-query"
            assert 19 < kwargs["timeout"] <= 20
            return SimpleNamespace(vectors=[[0.1, 0.2], [0.3, 0.4]], dimensions=2,
                provider="openai-api", model="text-embedding-3-small",
                audit={"input_type_handling": "shared", "normalization": "none"}, usage=None)

    worker = HostedInferenceWorker(Llm(), str(tmp_path))
    result = asyncio.run(worker._execute("embed", {"inputs": ["a", "b"], "input_type": "query",
        "purpose": "switchboard-query"}, time.monotonic() + 20))
    assert result["status"] == "ok"
    assert result["dimensions"] == 2 and result["provider"] == "openai-api"
    assert result["vectors"] == [[0.1, 0.2], [0.3, 0.4]]


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


def test_job_manifest_download_checks_part_identity_and_exact_digest(tmp_path):
    raw = canonical({"input_type": "document", "synthetic": "a" * 70000})
    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._client = FakeClient(raw)
    worker._settings = SimpleNamespace(profile_id="profile-a")
    job = {"job_id": "job-1", "correlation_id": "corr-1", "lease_epoch": 2,
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
            self.calls.append((operation, body))
            return {"state": "accepted"}

    worker = HostedInferenceWorker(object(), str(tmp_path))
    worker._client = UploadClient()
    worker._settings = SimpleNamespace(profile_id="profile-a")
    payload = {"status": "ok", "vectors": [[0.5] * 40000], "provider": "openai-api",
               "model": "text-embedding-3-small", "dimensions": 40000, "usage": {}}
    job = {"job_id": "job-1", "correlation_id": "corr-1", "lease_epoch": 2}
    worker._upload_result(job, payload)
    calls = worker._client.calls
    assert calls[0][0] == "result-start" and all(call[0] == "result-part" for call in calls[1:])
    manifest = {key: calls[0][1][key] for key in ("part_count", "total_bytes", "sha256")}
    assert manifest["part_count"] >= 2 and len(calls) == manifest["part_count"] + 1
    chunks = []
    for _, part in calls[1:]:
        assert {key: part[key] for key in manifest} == manifest
        chunks.append(base64.b64decode(part["data_b64"], validate=True))
    raw = b"".join(chunks)
    assert len(raw) == manifest["total_bytes"] and sha256(raw).hexdigest() == manifest["sha256"]
    assert _decode_job(raw)["dimensions"] == 40000


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
