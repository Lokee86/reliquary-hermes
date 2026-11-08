"""Authenticated, bounded loopback transport for the profile-scoped Rust host."""

from dataclasses import asdict, dataclass
import hmac
import os
from pathlib import Path
import secrets
import socket
import stat
import subprocess
import time
from urllib.parse import urlsplit

from .authority import Discovery
from .protocol import Request, Response
from .validation import (ContractError, MAX_WIRE_BYTES, canonical, decode, digest,
                         identifier, integer, obj, require)


_DISCOVERY_FIELDS = set(Discovery.__dataclass_fields__)
_MAX_HEADER = 8192
# Winsock can take two seconds to report refusal on an unused loopback port.
_CONNECT_SECONDS = 3.0
_REQUEST_SECONDS = 1.5
_STARTUP_SECONDS = 3.0


class HostUnavailable(RuntimeError):
    """A fixed diagnostic that never includes credentials or wire content."""


class _ConnectionRefused(HostUnavailable):
    pass


@dataclass(frozen=True)
class SessionBinding:
    session_id: str
    rel_id: str
    user_id: str


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise HostUnavailable("host_timeout")
    return remaining


def _receive(connection: socket.socket, count: int, deadline: float) -> bytes:
    connection.settimeout(_remaining(deadline))
    chunk = connection.recv(count)
    if not chunk:
        raise HostUnavailable("host_incomplete_response")
    return chunk


def _response(connection: socket.socket, deadline: float) -> tuple[int, dict[str, str], bytes]:
    wire = bytearray()
    while b"\r\n\r\n" not in wire:
        if len(wire) == _MAX_HEADER:
            raise HostUnavailable("host_header_limit")
        wire.extend(_receive(connection, min(4096, _MAX_HEADER - len(wire)), deadline))
    header, body = wire.split(b"\r\n\r\n", 1)
    lines = header.decode("ascii").split("\r\n")
    version, status, _ = lines[0].split(" ", 2)
    require(version == "HTTP/1.1" and len(status) == 3 and status.isdecimal(), "invalid_http")
    fields = {}
    for line in lines[1:]:
        key, separator, value = line.partition(":")
        name = key.lower()
        require(separator == ":" and name and name not in fields, "invalid_http")
        fields[name] = value.strip()
    length = fields.get("content-length", "")
    require(length.isdecimal() and len(length) <= 6 and "transfer-encoding" not in fields and
            fields.get("content-type") == "application/json", "invalid_http")
    expected = int(length)
    require(len(body) <= expected <= MAX_WIRE_BYTES, "wire_limit")
    while len(body) < expected:
        body.extend(_receive(connection, min(8192, expected - len(body)), deadline))
    return int(status), fields, bytes(body)


def _sign(key: bytes, *parts: bytes) -> str:
    return hmac.digest(key, b"\0".join(parts), "sha256").hex()


class HostClient:
    def __init__(self, state_dir: Path, profile_id: str, principal_id: str, token: str,
                 *, binary: Path | None = None):
        self._state_dir = Path(state_dir)
        self._binary = None if binary is None else Path(binary)
        self._profile_id = identifier(profile_id)
        self._principal_id = identifier(principal_id)
        require(self._state_dir.is_absolute(), "invalid_state_dir")
        require(type(token) is str and 32 <= len(token) <= 512 and
                all(33 <= ord(char) <= 126 for char in token), "invalid_credential")
        self._token = token
        self._attached: tuple[Discovery, SessionBinding] | None = None
        self._process: subprocess.Popen | None = None
        self._runtime_lease: str | None = None
        self._runtime_id = secrets.token_hex(16)
        self._runtime_scopes: set[str] = set()

    def _runtime_call(self, path: str, value: dict) -> dict:
        discovery = self._read_discovery()
        if discovery is None:
            raise HostUnavailable("host_unavailable")
        reply = self._exchange(discovery, path, canonical(value),
                               time.monotonic() + _CONNECT_SECONDS + _REQUEST_SECONDS)
        try:
            result = decode(reply)
            require(type(result) is dict, "invalid_runtime_response")
            return result
        except ContractError:
            raise HostUnavailable("invalid_runtime_response") from None

    def attach_runtime(self, session_id: str) -> tuple[str, dict[str, int]]:
        """Register this provider process as a live integration runtime."""
        session = identifier(session_id)
        result = self._runtime_call("/v1/runtime/attach", {
            "integration_kind": "hermes", "runtime_id": self._runtime_id,
            "principal_id": self._principal_id, "session_id": session,
        })
        try:
            lease = identifier(result["runtime_lease_id"])
        except (KeyError, ContractError):
            raise HostUnavailable("invalid_runtime_response") from None
        scopes = self._parse_reconciliation_scopes(result)
        self._runtime_lease = lease
        self._runtime_scopes = {session}
        return lease, scopes

    def add_runtime_scope(self, session_id: str) -> tuple[str, dict[str, int]]:
        session = identifier(session_id)
        lease = self._runtime_lease
        if lease is None:
            return self.attach_runtime(session)
        try:
            result = self._runtime_call("/v1/runtime/scope", {"lease_id": lease,
                                                             "session_id": session})
        except HostUnavailable as error:
            if str(error) != "runtime_lease_stale":
                raise
            # Invalidate this exact lease. The next probe can retry registration
            # even if the host goes away again before this attempt completes.
            self._runtime_lease = None
            self._runtime_scopes.clear()
            return self.attach_runtime(session)
        scopes = self._parse_reconciliation_scopes(result)
        self._runtime_scopes.add(session)
        return lease, scopes

    @staticmethod
    def _parse_reconciliation_scopes(result: dict) -> dict[str, int]:
        try:
            required = result["reconciliation_required"]
            require(type(required) is list, "invalid_runtime_response")
            scopes = {}
            for item in required:
                require(type(item) is dict and set(item) == {"session_id", "fence_epoch"},
                        "invalid_runtime_response")
                session = identifier(item["session_id"])
                epoch = integer(item["fence_epoch"], 1, (1 << 63) - 1)
                require(session not in scopes, "invalid_runtime_response")
                scopes[session] = epoch
            return scopes
        except (KeyError, ContractError):
            raise HostUnavailable("invalid_runtime_response") from None

    def heartbeat_runtime(self) -> None:
        lease = self._runtime_lease
        if lease is None:
            raise HostUnavailable("runtime_not_attached")
        self._runtime_call("/v1/runtime/heartbeat", {"lease_id": lease})

    def detach_runtime(self) -> None:
        lease, self._runtime_lease = self._runtime_lease, None
        self._runtime_scopes.clear()
        if lease is not None:
            self._runtime_call("/v1/runtime/detach", {"lease_id": lease, "clean": True})

    @property
    def runtime_lease_id(self) -> str | None:
        return self._runtime_lease

    def runtime_has_scope(self, session_id: str) -> bool:
        return self._runtime_lease is not None and session_id in self._runtime_scopes

    def _read_discovery(self) -> Discovery | None:
        path = self._state_dir / "discovery.json"
        try:
            if not stat.S_ISREG(path.lstat().st_mode):
                raise HostUnavailable("invalid_discovery")
            with path.open("rb") as file:
                raw = file.read(_MAX_HEADER + 1)
        except FileNotFoundError:
            return None
        except OSError:
            raise HostUnavailable("invalid_discovery") from None
        try:
            require(len(raw) <= _MAX_HEADER, "discovery_limit")
            discovery = Discovery(**obj(decode(raw), _DISCOVERY_FIELDS))
            discovery.validate(expected_profile=self._profile_id, expected_instance=discovery.instance_id,
                               expected_lease=discovery.lease_id)
            return discovery
        except ContractError:
            raise HostUnavailable("invalid_discovery") from None

    def _exchange(self, discovery: Discovery, path: str, body: bytes, deadline: float,
                  *, response_seconds: float = _REQUEST_SECONDS) -> bytes:
        url = urlsplit(discovery.endpoint)
        nonce = secrets.token_hex(16)
        nonce_bytes = nonce.encode("ascii")
        key = bytes.fromhex(_sign(self._token.encode("ascii"), b"reliquary-hermes-transport-v1",
                                  discovery.instance_id.encode("ascii"), discovery.lease_id.encode("ascii")))
        signature = _sign(key, b"request", path.encode("ascii"), nonce_bytes, body)
        host = f"[{url.hostname}]" if url.hostname == "::1" else url.hostname
        authority = f"{host}:{url.port}"
        header = (f"POST {path} HTTP/1.1\r\nHost: {authority}\r\n"
                  f"Authorization: Reliquary {signature}\r\nX-Reliquary-Nonce: {nonce}\r\n"
                  f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n"
                  "Connection: close\r\n\r\n").encode("ascii")
        try:
            try:
                connection = socket.create_connection((url.hostname, url.port),
                                                      min(_CONNECT_SECONDS, _remaining(deadline)))
            except ConnectionRefusedError:
                raise _ConnectionRefused("host_connection_refused") from None
            with connection:
                deadline = min(deadline, time.monotonic() + response_seconds)
                connection.settimeout(_remaining(deadline))
                connection.sendall(header + body)
                status, fields, reply = _response(connection, deadline)
            proof = fields.get("x-reliquary-proof", "")
            expected = _sign(key, b"response", nonce_bytes, str(status).encode("ascii"), reply)
            if not hmac.compare_digest(proof, expected):
                raise HostUnavailable("host_authentication")
        except TimeoutError:
            raise HostUnavailable("host_timeout") from None
        except (OSError, ValueError):
            raise HostUnavailable("invalid_host_response") from None
        if status != 200:
            code = {403: "host_denied", 409: "host_conflict", 503: "host_unavailable"}.get(status)
            if path == "/v1/source" or path.startswith("/v1/runtime/"):
                try:
                    error = obj(decode(reply), {"code", "retryable"})
                    require(type(error["retryable"]) is bool, "invalid_source_response")
                    code = identifier(error["code"])
                except ContractError:
                    code = None
            raise HostUnavailable(code or "invalid_host_response")
        return reply

    def _launch(self) -> None:
        if self._process is not None and self._process.poll() is None:
            return
        if self._binary is None or not self._binary.is_absolute() or not self._binary.is_file():
            raise HostUnavailable("host_not_configured")
        environment = {name: os.environ[name] for name in ("SystemRoot", "WINDIR") if name in os.environ}
        environment.update({name: str(self._state_dir) for name in ("TEMP", "TMP", "TMPDIR")})
        platform = ({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt"
                    else {"start_new_session": True})
        try:
            self._process = subprocess.Popen(
                [str(self._binary), "--state-dir", str(self._state_dir)],
                cwd=self._state_dir, env=environment, stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **platform,
            )
            with self._process.stdin as stream:
                stream.write(canonical({"token": self._token}))
        except OSError:
            raise HostUnavailable("host_start_failed") from None

    def _attach(self, discovery: Discovery, session_id: str, deadline: float) -> SessionBinding:
        body = canonical({"discovery": asdict(discovery), "principal_id": self._principal_id,
                          "session_id": session_id})
        reply = self._exchange(discovery, "/v1/attach", body, deadline)
        try:
            result = obj(decode(reply), {"discovery", "session_id", "rel_id", "user_id"})
            require(result["discovery"] == asdict(discovery) and result["session_id"] == session_id,
                    "attach_scope_mismatch")
            owners = [identifier(result[field]) for field in ("rel_id", "user_id")]
            require(all(len(owner) == 32 and all(char in "0123456789abcdef" for char in owner)
                        for owner in owners) and owners[0] != owners[1], "invalid_owner_id")
        except ContractError:
            raise HostUnavailable("invalid_attach_response") from None
        binding = SessionBinding(session_id, *owners)
        self._attached = discovery, binding
        return binding

    def attach(self, session_id: str) -> SessionBinding:
        """Bind through the live service or start a candidate protected by its lease."""
        identifier(session_id)
        self._attached = None
        previous = self._read_discovery()
        if previous is not None:
            try:
                return self._attach(previous, session_id, time.monotonic() + _CONNECT_SECONDS + _REQUEST_SECONDS)
            except _ConnectionRefused:
                pass
        if self._binary is None:
            raise HostUnavailable("host_unavailable")
        self._launch()
        deadline = time.monotonic() + _STARTUP_SECONDS
        while True:
            remaining = _remaining(deadline)
            current = self._read_discovery()
            if current is not None and current != previous:
                return self._attach(current, session_id, deadline)
            time.sleep(min(0.03, remaining))

    def deliver_source_job(self, job) -> str:
        """Deliver only scoped durable outbox work and verify the exact receipt."""
        if job._scope != (self._profile_id, self._principal_id):
            raise HostUnavailable("source_scope_mismatch")
        discovery = self._read_discovery()
        if discovery is None:
            raise HostUnavailable("host_unavailable")
        arguments = {}
        if job.kind == "snapshot":
            source = decode(job.snapshot_json)
            view = {key: source[key] for key in
                    ("profile_id", "session_id", "branch_id", "source_revision", "messages")}
            arguments = {"snapshot_digest": job.snapshot.snapshot_digest,
                         "source_json": canonical(view).decode("utf-8")}
        elif job.kind == "terminal":
            arguments = {"reason": job.reason}
        envelope_value = {"protocol_version": 1, "profile_id": self._profile_id,
                              "principal_id": self._principal_id, "session_id": job.session_id,
                              "generation": job.generation, "idempotency_key": job.idempotency_key,
                              "operation": job.kind, "arguments": arguments}
        runtime_lease = job.lease_id or (
            self._runtime_lease if job.kind == "snapshot" and job.session_id in self._runtime_scopes else None)
        if runtime_lease is not None:
            envelope_value["lease_id"] = runtime_lease
        if job.lease_id is not None:
            envelope_value["fence_epoch"] = job.fence_epoch
        envelope = canonical(envelope_value)
        if len(envelope) > MAX_WIRE_BYTES:
            raise HostUnavailable("source_snapshot_too_large")
        reply = self._exchange(discovery, "/v1/source", envelope, time.monotonic() + _CONNECT_SECONDS + 8,
                               response_seconds=8)
        try:
            result = obj(decode(reply), {"session_id", "generation", "idempotency_key", "receipt", "durable"})
            require(result["session_id"] == job.session_id and type(result["generation"]) is int and
                    result["generation"] == job.generation and result["idempotency_key"] == job.idempotency_key and
                    result["durable"] is True, "source_receipt_mismatch")
            return digest(result["receipt"])
        except ContractError:
            raise HostUnavailable("invalid_source_receipt") from None

    def request(self, raw: bytes) -> Response:
        """Send a frozen provider request for the currently attached session."""
        request = Request.parse(raw)
        attached = self._attached
        if attached is None or (request.profile_id, request.principal_id, request.session_id) != (
                self._profile_id, self._principal_id, attached[1].session_id):
            raise HostUnavailable("host_not_attached")
        discovery, _ = attached
        reply = self._exchange(discovery, "/v1/request", raw, time.monotonic() + _CONNECT_SECONDS + _REQUEST_SECONDS)
        try:
            return Response.parse(reply).for_request(request)
        except ContractError:
            raise HostUnavailable("invalid_provider_response") from None
