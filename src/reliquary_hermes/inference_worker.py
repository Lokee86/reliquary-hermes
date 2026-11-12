"""Profile-bound bridge from the signed host inference broker to ``ctx.llm``."""

from __future__ import annotations

import asyncio
from dataclasses import asdict
import hashlib
import json
import logging
import math
import secrets
from threading import Event
from threading import current_thread
import time
from typing import Any

from .client import HostClient, HostUnavailable
from .settings import profile_home, read_settings, read_token
from .validation import ContractError, canonical, choice, digest, identifier, integer, obj, require, text

logger = logging.getLogger(__name__)
_PART_BYTES = 64 * 1024
_MAX_JOB_BYTES = 8 * 1024 * 1024
_MAX_PARTS = (_MAX_JOB_BYTES + _PART_BYTES - 1) // _PART_BYTES
_PROBE_TEXT = "Synthetic capability probe for Reliquary hosted inference."
_PROBE_SCHEMA = {
    "type": "object", "properties": {"ready": {"type": "boolean"}},
    "required": ["ready"], "additionalProperties": False,
}


def _field(value: Any, key: str, default: Any = None) -> Any:
    return value.get(key, default) if isinstance(value, dict) else getattr(value, key, default)


def _safe_error_code(error: BaseException) -> str:
    code = getattr(error, "code", None)
    known = {"embedding_unconfigured", "embedding_unsupported", "embedding_failed", "embedding_timeout",
             "embedding_invalid_response", "inference_deadline", "inference_invalid_response",
             "inference_identity_changed", "inference_unavailable"}
    return code if type(code) is str and code in known else "inference_failed"


def _decode_job(raw: bytes) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "invalid_inference_request")
            result[key] = value
        return result

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                           parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ContractError("invalid_inference_request") from None
    require(type(value) is dict, "invalid_inference_request")
    return value


def _usage(value: Any) -> dict[str, Any]:
    raw = _field(value, "usage")
    if raw is None:
        return {}
    if hasattr(raw, "__dataclass_fields__"):
        raw = asdict(raw)
    if not isinstance(raw, dict):
        return {}
    # Usage is intentionally limited to non-sensitive accounting values.
    allowed = {"input_tokens", "output_tokens", "total_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd"}
    clean = {}
    for key in allowed:
        item = raw.get(key)
        if item is None:
            continue
        if key == "cost_usd":
            if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or item < 0:
                continue
            clean[key] = float(item)
        elif type(item) is int and item >= 0:
            clean[key] = item
    return clean


class HostedInferenceWorker:
    """A context-bound worker with no provider credentials or model overrides of its own."""

    def __init__(self, llm: Any, home: str):
        self._llm = llm
        self._home = profile_home(home)
        self._worker_id = "worker-" + secrets.token_hex(16)
        self._stop = Event()
        self._thread = None
        self._client: HostClient | None = None
        self._settings = None
        self._identity: dict[str, Any] | None = None
        self._lease_epoch: int | None = None
        self._active: tuple[str, str, int] | None = None
        self._bound_scope: tuple[str, str] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._active_task: asyncio.Task | None = None
        self._last_heartbeat = 0.0
        self._reported_capability_failure = False
        self._unavailable_logged = False

    def start(self) -> None:
        if self._thread is None:
            from agent.memory_provider import spawn_context_thread

            self._thread = spawn_context_thread(self._run, name="reliquary-inference")
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._loop is not None and self._active_task is not None:
            self._loop.call_soon_threadsafe(self._active_task.cancel)
        active = self._active
        if active is not None and self._client is not None:
            job_id, correlation_id, epoch = active
            try:
                self._call("cancel", {"worker_id": self._worker_id, "job_id": job_id,
                                      "correlation_id": correlation_id, "lease_epoch": epoch})
            except (HostUnavailable, ContractError, OSError):
                pass
        thread = self._thread
        if thread is not None and thread is not current_thread():
            thread.join(timeout=2.0)
        client = self._client
        if client is not None and self._settings is not None:
            try:
                discovery = client._read_discovery()
                if discovery is not None:
                    client.inference_call("worker-error", {
                        "worker_id": self._worker_id, "profile_id": self._settings.profile_id,
                        "instance_id": discovery.instance_id, "service_lease_id": discovery.lease_id,
                        "error_code": "inference_unavailable",
                    }, timeout=3.0)
            except (HostUnavailable, ContractError, OSError):
                pass
            try:
                client.detach_runtime()
            except (HostUnavailable, ContractError, OSError):
                pass

    def _connect(self) -> None:
        settings = read_settings(self._home)
        client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id,
                            read_token(self._home), binary=settings.binary)
        self._settings = settings
        self._client = client
        client.connect_dashboard(None)
        require(not self._stop.is_set(), "inference_cancelled")
        client.attach_runtime(None)
        if self._stop.is_set():
            try:
                client.detach_runtime()
            finally:
                raise ContractError("inference_cancelled")

    def _call(self, operation: str, body: dict, *, timeout: float = 5.0) -> dict:
        if self._client is None:
            self._connect()
        assert self._client is not None and self._settings is not None
        envelope = {**body, "worker_id": self._worker_id}
        if operation in {"identity", "heartbeat"}:
            envelope["profile_id"] = self._settings.profile_id
        return self._client.inference_call(operation, envelope, timeout=timeout)

    async def _probe(self) -> dict[str, Any]:
        structured = await self._llm.acomplete_structured(
            instructions="Return a JSON object with ready set to true.",
            input=[{"type": "text", "text": _PROBE_TEXT}], json_schema=_PROBE_SCHEMA,
            schema_name="reliquary_readiness", purpose="reliquary_readiness_probe", timeout=30.0,
        )
        require(_field(structured, "content_type") == "json" and
                _field(structured, "parsed") == {"ready": True}, "inference_unavailable")
        general = {"provider": identifier(_field(structured, "provider")),
                   "model": text(_field(structured, "model"), 256)}
        embedded = await self._llm.aembed([_PROBE_TEXT], input_type="document",
                                          purpose="reliquary_readiness_probe", timeout=30.0)
        vectors = _field(embedded, "vectors")
        dimensions = integer(_field(embedded, "dimensions"), 1, 65536)
        require(type(vectors) is list and len(vectors) == 1 and type(vectors[0]) is list and
                len(vectors[0]) == dimensions, "inference_unavailable")
        audit = _field(embedded, "audit", {})
        handling = _field(audit, "input_type_handling")
        normalization = _field(audit, "normalization")
        require(handling == "shared" and normalization == "none", "inference_unavailable")
        embedding = {"provider": identifier(_field(embedded, "provider")),
                     "model": text(_field(embedded, "model"), 256), "dimensions": dimensions,
                     "input_type_handling": "shared", "normalization": "none"}
        return {"general": general, "embedding": embedding}

    def _bind_identity(self) -> None:
        identity = asyncio.run(self._tracked_probe())
        assert self._settings is not None
        require(not self._stop.is_set(), "inference_cancelled")
        scope = (self._instance_id(), self._service_lease_id())
        bound = self._call("identity", {"instance_id": self._instance_id(),
                                         "service_lease_id": self._service_lease_id(),
                                         **identity})
        require(not self._stop.is_set(), "inference_cancelled")
        require(bound.get("state") == "bound", "inference_unavailable")
        epoch = integer(bound.get("lease_epoch"), 1, (1 << 63) - 1)
        require(bound.get("identity") == identity, "inference_identity_mismatch")
        self._identity, self._lease_epoch, self._bound_scope = identity, epoch, scope

    async def _tracked_probe(self) -> dict[str, Any]:
        self._loop = asyncio.get_running_loop()
        task = asyncio.create_task(self._probe())
        self._active_task = task
        try:
            result = await task
            require(not self._stop.is_set(), "inference_cancelled")
            return result
        finally:
            self._active_task = None
            self._loop = None

    def _instance_id(self) -> str:
        assert self._client is not None
        discovery = self._client._read_discovery()
        if discovery is None:
            raise HostUnavailable("host_unavailable")
        return discovery.instance_id

    def _service_lease_id(self) -> str:
        assert self._client is not None
        discovery = self._client._read_discovery()
        if discovery is None:
            raise HostUnavailable("host_unavailable")
        return discovery.lease_id

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if self._client is None:
                    self._connect()
                if not callable(getattr(self._llm, "acomplete_structured", None)) or \
                        not callable(getattr(self._llm, "aembed", None)):
                    if not self._unavailable_logged:
                        logger.warning("Reliquary hosted inference unavailable (%s)", "embedding_unavailable")
                        self._unavailable_logged = True
                    self._report_unavailable("embedding_unavailable")
                    if self._reported_capability_failure:
                        try:
                            self._client.detach_runtime()
                        except (HostUnavailable, ContractError, OSError):
                            pass
                        return
                    self._stop.wait(2.0)
                    continue
                if self._identity is None:
                    self._bind_identity()
                self._poll_once()
                self._unavailable_logged = False
            except (HostUnavailable, ContractError, OSError, RuntimeError, ValueError, AttributeError) as exc:
                self._identity = None
                self._lease_epoch = None
                self._bound_scope = None
                if not self._unavailable_logged:
                    # The exception text is deliberately excluded: some provider stacks include payloads.
                    logger.warning("Reliquary hosted inference worker unavailable (%s)", _safe_error_code(exc))
                    self._unavailable_logged = True
                self._stop.wait(2.0)
                if isinstance(exc, (HostUnavailable, OSError)):
                    self._reset_connection()

    def _reset_connection(self) -> None:
        client, self._client = self._client, None
        self._settings = None
        self._identity = None
        self._lease_epoch = None
        self._bound_scope = None
        self._last_heartbeat = 0.0
        if client is not None:
            try:
                client.detach_runtime()
            except (HostUnavailable, ContractError, OSError):
                pass

    def _report_unavailable(self, error_code: str) -> None:
        try:
            assert self._settings is not None
            discovery = self._client._read_discovery()
            if discovery is None:
                raise HostUnavailable("host_unavailable")
            reply = self._client.inference_call("worker-error", {
                "worker_id": self._worker_id, "profile_id": self._settings.profile_id,
                "instance_id": discovery.instance_id, "service_lease_id": discovery.lease_id,
                "error_code": error_code,
            }, timeout=3.0)
            require(reply.get("state") == "accepted", "inference_unavailable")
            self._reported_capability_failure = True
        except (HostUnavailable, ContractError, OSError):
            logger.warning("Reliquary hosted inference worker could not report capability status.")

    def _poll_once(self) -> None:
        assert self._settings is not None and self._identity is not None and self._lease_epoch is not None
        discovery = self._client._read_discovery()
        if discovery is None:
            raise HostUnavailable("host_unavailable")
        if self._bound_scope != (discovery.instance_id, discovery.lease_id):
            self._reset_connection()
            return
        if time.monotonic() - self._last_heartbeat >= 10.0:
            self._client.heartbeat_runtime()
            self._call("heartbeat", {"instance_id": discovery.instance_id,
                "service_lease_id": discovery.lease_id, "lease_epoch": self._lease_epoch}, timeout=3.0)
            self._last_heartbeat = time.monotonic()
        claim = self._client.inference_call("claim", {"worker_id": self._worker_id,
            "profile_id": self._settings.profile_id, "instance_id": discovery.instance_id,
            "service_lease_id": discovery.lease_id, "wait_ms": 750}, timeout=3.0)
        state = choice(claim.get("state"), {"idle", "claimed"})
        if state == "idle":
            return
        if self._stop.is_set():
            return
        job = self._validate_claim(claim, discovery.instance_id)
        self._active = (job["job_id"], job["correlation_id"], job["lease_epoch"])
        try:
            raw_request = self._download_request(job)
            require(not self._stop.is_set(), "inference_cancelled")
            request = _decode_job(raw_request)
            result = asyncio.run(self._execute_with_heartbeat(job, request))
            bound_identity = self._identity["embedding" if job["operation"] == "embed" else "general"]
            identity_changed = (result["provider"] != bound_identity["provider"] or
                                result["model"] != bound_identity["model"] or
                                (job["operation"] == "embed" and result["dimensions"] != bound_identity["dimensions"]))
            if identity_changed:
                result = {"status": "error", "error_code": "inference_identity_changed"}
                self._identity = None
            self._upload_result(job, result)
        except Exception as exc:
            self._upload_result(job, {"status": "error", "error_code": _safe_error_code(exc)})
        finally:
            self._active = None

    async def _execute_with_heartbeat(self, job: dict, request: dict) -> dict[str, Any]:
        require(not self._stop.is_set(), "inference_cancelled")

        async def keepalive() -> None:
            while not self._stop.is_set():
                await asyncio.sleep(10.0)
                if self._stop.is_set():
                    return
                discovery = self._client._read_discovery()
                if discovery is None:
                    raise HostUnavailable("host_unavailable")
                await asyncio.to_thread(self._call, "heartbeat", {
                    "instance_id": discovery.instance_id, "service_lease_id": discovery.lease_id,
                    "active_job_id": job["job_id"], "lease_epoch": job["lease_epoch"],
                }, timeout=3.0)
                self._last_heartbeat = time.monotonic()
                await asyncio.to_thread(self._client.heartbeat_runtime)
                await asyncio.to_thread(self._client.heartbeat_runtime)

        self._loop = asyncio.get_running_loop()
        call_task = asyncio.create_task(self._execute(job["operation"], request, job["deadline"]))
        self._active_task = call_task
        task = asyncio.create_task(keepalive())
        try:
            done, _ = await asyncio.wait((call_task, task), return_when=asyncio.FIRST_COMPLETED)
            if task in done:
                error = task.exception()
                call_task.cancel()
                if error is not None:
                    raise error
                raise asyncio.CancelledError
            return await call_task
        finally:
            self._active_task = None
            self._loop = None
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, HostUnavailable, ContractError):
                pass

    def _validate_claim(self, value: dict, instance_id: str) -> dict:
        fields = {"state", "job_id", "correlation_id", "operation", "profile_id", "instance_id",
                  "lease_epoch", "deadline_ms", "request"}
        require(set(value) == fields and value["profile_id"] == self._settings.profile_id and
                value["instance_id"] == instance_id,
                "invalid_inference_claim")
        require(value["lease_epoch"] == self._lease_epoch, "inference_lease_stale")
        operation = choice(value["operation"], {"complete_structured", "embed"})
        manifest = obj(value["request"], {"part_count", "total_bytes", "sha256"})
        part_count = integer(manifest["part_count"], 1, _MAX_PARTS)
        total_bytes = integer(manifest["total_bytes"], 1, _MAX_JOB_BYTES)
        require(part_count == (total_bytes + _PART_BYTES - 1) // _PART_BYTES, "invalid_inference_manifest")
        return {"job_id": identifier(value["job_id"]), "correlation_id": identifier(value["correlation_id"]),
                "operation": operation, "lease_epoch": integer(value["lease_epoch"], 1, (1 << 63) - 1),
                "deadline": time.monotonic() + integer(value["deadline_ms"], 1, 300000) / 1000.0,
                "manifest": {**manifest, "part_count": part_count, "total_bytes": total_bytes,
                             "sha256": digest(manifest["sha256"])}}

    def _download_request(self, job: dict) -> bytes:
        chunks = []
        manifest = job["manifest"]
        for index in range(manifest["part_count"]):
            part = self._call_job(job, "request-part", {"job_id": job["job_id"],
                "correlation_id": job["correlation_id"], "lease_epoch": job["lease_epoch"],
                "part_index": index})
            expected_fields = {"job_id", "correlation_id", "lease_epoch", "part_index", "part_count",
                               "total_bytes", "sha256", "data_b64"}
            require(set(part) == expected_fields and part["job_id"] == job["job_id"] and
                    part["correlation_id"] == job["correlation_id"] and part["lease_epoch"] == job["lease_epoch"] and
                    part["part_index"] == index and part["part_count"] == manifest["part_count"] and
                    part["total_bytes"] == manifest["total_bytes"] and part["sha256"] == manifest["sha256"],
                    "invalid_inference_part")
            import base64
            try:
                chunk = base64.b64decode(text(part["data_b64"], 90000), validate=True)
            except (ValueError, ContractError):
                raise ContractError("invalid_inference_part") from None
            require(0 < len(chunk) <= _PART_BYTES and (index == manifest["part_count"] - 1 or
                    len(chunk) == _PART_BYTES), "invalid_inference_part")
            chunks.append(chunk)
        raw = b"".join(chunks)
        require(len(raw) == manifest["total_bytes"] and hashlib.sha256(raw).hexdigest() == manifest["sha256"],
                "invalid_inference_digest")
        return raw

    async def _execute(self, operation: str, raw: dict, deadline: float) -> dict[str, Any]:
        timeout = deadline - time.monotonic()
        require(math.isfinite(timeout) and 0 < timeout <= 300, "inference_deadline")
        if operation == "complete_structured":
            required = {"instructions", "input", "json_schema", "schema_name", "purpose"}
            allowed = required | {"system_prompt", "temperature", "max_tokens"}
            require(required <= set(raw) <= allowed, "invalid_inference_request")
            instructions = text(raw["instructions"], _MAX_JOB_BYTES)
            blocks = raw["input"]
            require(type(blocks) is list and 1 <= len(blocks) <= 128, "invalid_inference_request")
            clean_blocks = []
            for block in blocks:
                row = obj(block, {"type", "text"})
                require(row["type"] == "text", "invalid_inference_request")
                clean_blocks.append({"type": "text", "text": text(row["text"], _MAX_JOB_BYTES)})
            schema = raw["json_schema"]
            require(type(schema) is dict and len(canonical(schema)) <= _MAX_JOB_BYTES, "invalid_inference_request")
            call = {"instructions": instructions, "input": clean_blocks, "json_schema": schema,
                    "schema_name": text(raw["schema_name"], 128), "purpose": text(raw["purpose"], 128),
                    "timeout": timeout}
            if "system_prompt" in raw:
                call["system_prompt"] = text(raw["system_prompt"], _MAX_JOB_BYTES)
            if "temperature" in raw:
                temperature = raw["temperature"]
                require(type(temperature) in (int, float) and math.isfinite(temperature), "invalid_inference_request")
                call["temperature"] = float(temperature)
            if "max_tokens" in raw:
                call["max_tokens"] = integer(raw["max_tokens"], 1, 1000000)
            result = await asyncio.wait_for(self._llm.acomplete_structured(**call), timeout=timeout)
            require(_field(result, "content_type") == "json" and _field(result, "parsed") is not None,
                    "inference_invalid_response")
            return {"status": "ok", "parsed": _field(result, "parsed"), "provider": identifier(_field(result, "provider")),
                    "model": text(_field(result, "model"), 256), "usage": _usage(result)}
        required = {"inputs", "input_type", "purpose"}
        allowed = required | {"dimensions"}
        require(required <= set(raw) <= allowed, "invalid_inference_request")
        inputs = raw["inputs"]
        require(type(inputs) is list and 1 <= len(inputs) <= 128, "invalid_inference_request")
        inputs = [text(item, _MAX_JOB_BYTES) for item in inputs]
        require(sum(len(item.encode("utf-8")) for item in inputs) <= 1024 * 1024,
                "invalid_inference_request")
        input_type = choice(raw["input_type"], {"query", "document"})
        kwargs = {"input_type": input_type, "purpose": text(raw["purpose"], 128), "timeout": timeout}
        if "dimensions" in raw:
            kwargs["dimensions"] = integer(raw["dimensions"], 1, 65536)
        result = await asyncio.wait_for(self._llm.aembed(inputs, **kwargs), timeout=timeout)
        vectors = _field(result, "vectors")
        dimensions = integer(_field(result, "dimensions"), 1, 65536)
        require(type(vectors) is list and len(vectors) == len(inputs), "inference_invalid_response")
        clean_vectors = []
        for vector in vectors:
            require(type(vector) is list and len(vector) == dimensions and
                    all(type(value) in (float, int) and math.isfinite(value) for value in vector),
                    "inference_invalid_response")
            clean_vectors.append([float(value) for value in vector])
        audit = _field(result, "audit", {})
        require(_field(audit, "input_type_handling") == "shared" and
                _field(audit, "normalization") == "none", "inference_invalid_response")
        return {"status": "ok", "vectors": clean_vectors, "provider": identifier(_field(result, "provider")),
                "model": text(_field(result, "model"), 256), "dimensions": dimensions,
                "usage": _usage(result)}

    def _upload_result(self, job: dict, result: dict) -> None:
        require(not self._stop.is_set(), "inference_cancelled")
        status = result.get("status")
        if status == "ok":
            payload = {key: result[key] for key in ("parsed", "vectors", "provider", "model", "dimensions", "usage")
                       if key in result}
            raw = canonical(payload)
            if not 0 < len(raw) <= _MAX_JOB_BYTES:
                result = {"status": "error", "error_code": "inference_result_limit"}
                raw = b""
                manifest = {"part_count": 0, "total_bytes": 0, "sha256": hashlib.sha256(raw).hexdigest()}
                start = {"status": "error", "error_code": "inference_result_limit", **manifest}
                payload = {}
            else:
                count = (len(raw) + _PART_BYTES - 1) // _PART_BYTES
                manifest = {"part_count": count, "total_bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                identity = {key: result[key] for key in ("provider", "model", "dimensions", "usage")
                            if key in result}
                start = {"status": "ok", **identity, **manifest}
        else:
            raw = b""
            manifest = {"part_count": 0, "total_bytes": 0, "sha256": hashlib.sha256(raw).hexdigest()}
            code = result.get("error_code", "inference_failed")
            start = {"status": "error", "error_code": identifier(code), **manifest}
        self._call_job(job, "result-start", {"job_id": job["job_id"], "correlation_id": job["correlation_id"],
            "lease_epoch": job["lease_epoch"], **start})
        if not raw:
            return
        import base64
        for index, offset in enumerate(range(0, len(raw), _PART_BYTES)):
            chunk = raw[offset:offset + _PART_BYTES]
            reply = self._call_job(job, "result-part", {"job_id": job["job_id"],
                "correlation_id": job["correlation_id"], "lease_epoch": job["lease_epoch"],
                "part_index": index, **manifest, "data_b64": base64.b64encode(chunk).decode("ascii")})
            require(reply.get("state") == "accepted", "inference_result_rejected")

    def _call_job(self, job: dict, operation: str, body: dict) -> dict:
        require(not self._stop.is_set(), "inference_cancelled")
        remaining = job["deadline"] - time.monotonic()
        require(math.isfinite(remaining) and remaining > 0, "inference_deadline")
        return self._call(operation, body, timeout=min(5.0, remaining))

