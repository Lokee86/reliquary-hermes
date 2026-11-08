from contextlib import contextmanager
from dataclasses import asdict
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

import pytest

from reliquary_hermes import HERMES_REVISION
from reliquary_hermes.authority import Discovery
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.validation import canonical, decode


TOKEN = "synthetic-private-test-token-value"
REL = "1" * 32
PHY = "2" * 32


def status_request(session_id="session-a"):
    return canonical({"protocol_version": 1, "request_id": "check-a", "operation": "owner_status",
                      "profile_id": "profile-a", "principal_id": "principal-a", "session_id": session_id,
                      "turn_id": "lifecycle", "expected_revision": None, "idempotency_key": None,
                      "arguments": {}})


@contextmanager
def endpoint(state, *, signed=True, request_id="check-a"):
    captured = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def do_POST(self):
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            nonce = self.headers["X-Reliquary-Nonce"].encode("ascii")
            captured.append((dict(self.headers), raw))
            key = hmac.digest(TOKEN.encode("ascii"), b"reliquary-hermes-transport-v1\0instance-a\0lease-a",
                              "sha256")
            expected = hmac.digest(key, b"request\0" + self.path.encode("ascii") + b"\0" + nonce + b"\0" + raw,
                                   "sha256").hex()
            authenticated = self.headers["Authorization"] == "Reliquary " + expected
            body = decode(raw)
            if not authenticated:
                status, result = 401, {"code": "denied", "retryable": False}
            elif self.path == "/v1/attach":
                status, result = 200, {"discovery": asdict(discovery), "session_id": body["session_id"],
                                       "rel_id": REL, "user_id": PHY}
            else:
                status, result = 200, {"protocol_version": 1, "request_id": request_id,
                                       "operation": "owner_status", "status": "ok", "revision": None,
                                       "cut": None, "result": {"worker_state": "complete", "pending_jobs": 0}}
            reply = canonical(result)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.send_header("Connection", "close")
            if signed and authenticated:
                message = b"response\0" + nonce + b"\0" + str(status).encode("ascii") + b"\0" + reply
                self.send_header("X-Reliquary-Proof", hmac.digest(key, message, "sha256").hex())
            self.end_headers()
            self.wfile.write(reply)

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        discovery = Discovery(f"http://127.0.0.1:{server.server_port}/", "instance-a", "profile-a", 1,
                              HERMES_REVISION, "lease-a")
        (state / "discovery.json").write_bytes(canonical(asdict(discovery)))
        worker = threading.Thread(target=server.serve_forever, daemon=True, kwargs={"poll_interval": 0.01})
        worker.start()
        try:
            yield captured
        finally:
            server.shutdown()
            worker.join(1)


def test_host_client_authenticates_exact_instance_and_correlates_status(tmp_path):
    with endpoint(tmp_path) as captured:
        client = HostClient(tmp_path, "profile-a", "principal-a", TOKEN)
        binding = client.attach("session-a")
        assert (binding.session_id, binding.rel_id, binding.user_id) == ("session-a", REL, PHY)
        response = client.request(status_request())
        assert decode(response.result_json) == {"worker_state": "complete", "pending_jobs": 0}
        with pytest.raises(HostUnavailable, match="host_not_attached"):
            client.request(status_request("session-b"))
        assert len(captured) == 2
        assert captured[0][0]["X-Reliquary-Nonce"] != captured[1][0]["X-Reliquary-Nonce"]
        assert TOKEN not in repr(captured) and TOKEN not in repr(client)


def test_client_rejects_forged_service_without_starting_another(tmp_path, monkeypatch):
    with endpoint(tmp_path, signed=False) as captured:
        client = HostClient(tmp_path, "profile-a", "principal-a", TOKEN, binary=tmp_path / "unused")
        monkeypatch.setattr(client, "_launch", lambda: pytest.fail("ambiguous probe tried to launch"))
        with pytest.raises(HostUnavailable, match="host_authentication"):
            client.attach("session-a")
        assert len(captured) == 1 and TOKEN not in repr(captured)


def test_client_rejects_wrong_token_and_signed_uncorrelated_reply(tmp_path):
    with endpoint(tmp_path, request_id="different-request"):
        wrong = HostClient(tmp_path, "profile-a", "principal-a", "wrong-" + TOKEN)
        with pytest.raises(HostUnavailable, match="host_authentication"):
            wrong.attach("session-a")
        client = HostClient(tmp_path, "profile-a", "principal-a", TOKEN)
        client.attach("session-a")
        with pytest.raises(HostUnavailable, match="invalid_provider_response"):
            client.request(status_request())


def test_wrong_profile_and_invalid_discovery_fail_before_contact(tmp_path, monkeypatch):
    with endpoint(tmp_path) as captured:
        wrong = HostClient(tmp_path, "profile-b", "principal-a", TOKEN, binary=tmp_path / "unused")
        monkeypatch.setattr(wrong, "_launch", lambda: pytest.fail("invalid discovery tried to launch"))
        with pytest.raises(HostUnavailable, match="invalid_discovery"):
            wrong.attach("session-a")
        assert captured == []
    client = HostClient(tmp_path, "profile-a", "principal-a", TOKEN)
    (tmp_path / "discovery.json").write_text('{"instance_id":"one","instance_id":"two"}', encoding="utf-8")
    with pytest.raises(HostUnavailable, match="invalid_discovery"):
        client.attach("session-a")
