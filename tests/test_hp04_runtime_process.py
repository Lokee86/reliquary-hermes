"""Real-process proofs for the host's generic integration runtime leases."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
from time import monotonic, sleep
from hashlib import sha256

import pytest

from reliquary_hermes.capture_policy import capture_cutoff
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import TOKEN_VAR, profile_setup_lock, read_settings
from reliquary_hermes.source_capture import capture_snapshot
from reliquary_hermes.validation import canonical
from test_host_client import TOKEN
from test_hp03_host import binaries, config, install_setup_host, owner, stop
from test_hp03_provider import history_provider
from test_hp04_host import TEXT, _cli, _loopback_model, _processing_config, _turn, _when_ready


PROFILE = "profile-a"
PRINCIPAL = "principal-a"
SESSION = "session-a"


def _host(binary, cli, root, cleanup, *, processing_url=None):
    rel, phy, state = root / "main.rel", root / "active.phy", root / "reliquary"
    owner(cli, "rel", rel, "unspecified")
    owner(cli, "phy", phy)
    config(state, rel, phy, profile=PROFILE)
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    (root / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
    if processing_url is not None:
        _processing_config(cli, state, processing_url)
    client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
    client.attach(SESSION)
    assert client._process is not None
    cleanup.callback(stop, client._process)
    return client, state


def _wait_until(predicate, timeout=8):
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        if predicate():
            return
        sleep(0.05)
    assert predicate(), "condition did not become true before timeout"


def test_clean_runtime_detach_keeps_shared_host_until_last_lease(tmp_path, binaries, monkeypatch):
    binary, cli = binaries
    with ExitStack() as cleanup:
        first, _ = _host(binary, cli, tmp_path, cleanup)
        lease_a, scopes_a = first.attach_runtime(SESSION)
        assert scopes_a == {}
        second = HostClient(first._state_dir, PROFILE, PRINCIPAL, TOKEN)
        second.attach(SESSION)
        other = second._runtime_call("/v1/runtime/attach", {
            "integration_kind": "synthetic", "runtime_id": secrets.token_hex(16),
            "principal_id": PRINCIPAL, "session_id": SESSION,
        })
        lease_b = other["runtime_lease_id"]
        second._runtime_lease = lease_b
        assert other["reconciliation_required"] == [] and lease_b != lease_a

        wrong_token = HostClient(first._state_dir, PROFILE, PRINCIPAL, "wrong-" + TOKEN)
        wrong_token._runtime_lease = lease_a
        with pytest.raises(HostUnavailable, match="host_authentication"):
            wrong_token.heartbeat_runtime()

        first.detach_runtime()
        stale_first = HostClient(first._state_dir, PROFILE, PRINCIPAL, TOKEN)
        stale_first._runtime_lease = lease_a
        with pytest.raises(HostUnavailable, match="runtime_lease_stale"):
            stale_first.heartbeat_runtime()
        with pytest.raises(HostUnavailable, match="runtime_lease_stale"):
            stale_first.detach_runtime()
        assert first._process.poll() is None

        sendall = socket.socket.sendall

        def send_split_heartbeat(connection, payload, *args):
            if payload.startswith(b"POST /v1/runtime/heartbeat "):
                body_start = payload.index(b"\r\n\r\n") + 4
                sendall(connection, payload[:body_start], *args)
                sleep(0.25)
                sendall(connection, payload[body_start:], *args)
            else:
                sendall(connection, payload, *args)

        monkeypatch.setattr(socket.socket, "sendall", send_split_heartbeat)
        assert second.heartbeat_runtime() is None

        second.detach_runtime()
        _wait_until(lambda: first._process.poll() is not None)
        assert not (first._state_dir / "discovery.json").exists()


def _enroll_and_create_session(home):
    from hermes_state import SessionDB

    with profile_setup_lock(home):
        capture_cutoff(home, enroll=True)
    with SessionDB(home / "state.db") as db:
        db.create_session(SESSION, source="cli", profile_name="default")


def test_history_provider_clean_drain_exits_and_restart_preserves_route(
        tmp_path, binaries, history_provider):
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    binary, cli = binaries
    rel, phy, state = tmp_path / "main.rel", tmp_path / "active.phy", tmp_path / "reliquary"
    owner(cli, "rel", rel, "unspecified")
    owner(cli, "phy", phy)
    config(state, rel, phy, profile=PROFILE)
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    (tmp_path / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")

    scope = set_hermes_home_override(tmp_path)
    with ExitStack() as cleanup:
        cleanup.callback(reset_hermes_home_override, scope)
        _enroll_and_create_session(tmp_path)
        first = history_provider.ReliquaryMemoryProvider()
        first.initialize(SESSION, hermes_home=str(tmp_path))
        _wait_until(lambda: first.lifecycle_status == "attached")
        first_binding = first.binding
        first_process = first._client._process
        cleanup.callback(stop, first_process)
        cleanup.callback(first.shutdown)
        first.sync_turn("", "", session_id=SESSION, messages=[{
            "message_uid": "accepted", "role": "user", "timestamp": time.time(),
            "content": TEXT["accepted"],
        }])
        first.shutdown()
        _wait_until(lambda: first_process.poll() is not None)
        assert not (state / "discovery.json").exists()

        outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
        cursor = outbox.cursor(SESSION)
        pending = outbox.next_job(SESSION)
        assert ((cursor is not None and cursor.last_message_uid == "accepted") or
                (pending is not None and pending.kind == "snapshot"))

        second = history_provider.ReliquaryMemoryProvider()
        second.initialize(SESSION, hermes_home=str(tmp_path))
        _wait_until(lambda: second.lifecycle_status == "attached")
        assert second.binding == first_binding
        second_process = second._client._process
        cleanup.callback(stop, second_process)
        cleanup.callback(second.shutdown)
        if pending is not None:
            _wait_until(lambda: second.sync_status == "source_accepted_durable", timeout=15)
            assert SourceOutbox(state, PROFILE, PRINCIPAL).cursor(SESSION).last_message_uid == "accepted"
        second.shutdown()
        _wait_until(lambda: second_process.poll() is not None)


def test_host_restart_during_reconciliation_advances_fence_epoch(tmp_path, binaries):
    binary, cli = binaries
    with ExitStack() as cleanup:
        first, state = _host(binary, cli, tmp_path, cleanup)
        binding = first.attach(SESSION)
        lease_a, required_a = first.attach_runtime(SESSION)
        assert required_a == {}

        outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
        messages = [{"message_uid": "accepted", "role": "user", "timestamp": 1700000000.25,
                     "content": TEXT["accepted"]}]
        initial = capture_snapshot(PROFILE, SESSION, messages)
        key = outbox.enqueue(initial, generation=outbox.generation(SESSION))
        initial_job = outbox.next_job(SESSION)
        assert initial_job.idempotency_key == key
        initial_receipt = first.deliver_source_job(initial_job)
        assert outbox.acknowledge(initial_job, initial_receipt)

        archived = "session-archived"
        first.attach(archived)
        first.add_runtime_scope(archived)
        outbox.enqueue(capture_snapshot(PROFILE, archived, messages), generation=0)
        archived_copy = outbox.next_job(archived)
        outbox.terminal(archived, "archive")
        terminal = outbox.next_job(archived)
        assert outbox.acknowledge(terminal, first.deliver_source_job(terminal))

        # A host restart fences the still-live adapter lease and returns epoch A.
        stop(first._process)
        second = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        assert second.attach(SESSION) == binding
        cleanup.callback(stop, second._process)
        with pytest.raises(HostUnavailable, match="source_terminal"):
            second.deliver_source_job(archived_copy)
        lease_b, archived_scopes = second.attach_runtime(archived)
        assert archived_scopes == {}
        scoped_lease, scopes_a = second.add_runtime_scope(SESSION)
        epoch_a = scopes_a[SESSION]
        assert epoch_a > 0 and scoped_lease == lease_b and lease_b != lease_a

        extended = capture_snapshot(PROFILE, SESSION, messages + [{
            "message_uid": "appended", "role": "user", "timestamp": 1700000001.25,
            "content": TEXT["appended"],
        }])
        old_key = outbox.enqueue(extended, generation=outbox.generation(SESSION),
                                 lease_id=lease_b, fence_epoch=epoch_a)
        old_candidate = outbox.next_job(SESSION)
        assert old_candidate.idempotency_key == old_key
        with pytest.raises(HostUnavailable, match="source_import_pending"):
            second.deliver_source_job(old_candidate)
        marker = json.loads((state / "integration-runtimes-v1.json").read_text(encoding="utf-8"))
        assert any(fence["epoch"] == epoch_a for fence in marker["fences"])

        processing_url = cleanup.enter_context(_loopback_model())
        _processing_config(cli, state, processing_url)


        # The host dies during pending reconciliation. Its active lease adds a
        # newer durable fence when the replacement process opens the registry.
        stop(second._process)
        third = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        assert third.attach(SESSION) == binding
        cleanup.callback(stop, third._process)
        lease_c, scopes_b = third.attach_runtime(SESSION)
        epoch_b = scopes_b[SESSION]
        assert epoch_b > epoch_a and lease_c not in {lease_a, lease_b}
        assert third.add_runtime_scope(archived) == (lease_c, {})
        with pytest.raises(HostUnavailable, match="source_terminal"):
            third.deliver_source_job(archived_copy)


        with pytest.raises(HostUnavailable, match="runtime_lease_stale"):
            third.deliver_source_job(old_candidate)
        assert outbox.discard_candidate(old_candidate)

        new_key = outbox.enqueue(extended, generation=outbox.generation(SESSION),
                                 lease_id=lease_c, fence_epoch=epoch_b)
        new_candidate = outbox.next_job(SESSION)
        assert new_candidate.idempotency_key == new_key
        receipt = _when_ready(third, new_candidate)
        assert outbox.acknowledge(new_candidate, receipt)
        assert third.deliver_source_job(new_candidate) == receipt
        assert third.deliver_source_job(initial_job) == initial_receipt
        assert outbox.next_job(SESSION) is None

        third.detach_runtime()
        assert third._process.wait(timeout=10) == 0

        conversation = "hermes-copy:" + sha256(
            b"reliquary/hermes-copied-conversation/v1\0" + len(PROFILE).to_bytes(8, "little") +
            PROFILE.encode("ascii") + SESSION.encode("ascii")).hexdigest()
        rel = state.parent / "main.rel"
        assert _turn(cli, rel, conversation, "accepted")["imported"]["message_id"] == "accepted"
        assert _turn(cli, rel, conversation, "appended")["imported"]["message_id"] == "appended"
        assert _cli(cli, "rel", "info", rel)["owner"]["rel_turn_count"] == 2


def test_ungraceful_runtime_exit_fences_scope_and_reconnects(
        tmp_path, binaries, history_provider, history_checkout, monkeypatch):
    binary, cli = binaries
    with ExitStack() as cleanup:
        processing_url = cleanup.enter_context(_loopback_model())
        host, state = _host(binary, cli, tmp_path, cleanup, processing_url=processing_url)
        _enroll_and_create_session(tmp_path)
        original_binding = host.attach(SESSION)
        survivor_lease, initial_scopes = host.attach_runtime(SESSION)
        assert initial_scopes == {}

        outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
        messages = [{"message_uid": "accepted", "role": "user", "timestamp": time.time(),
                     "content": TEXT["accepted"]}]
        initial_snapshot = capture_snapshot(PROFILE, SESSION, messages)
        initial_key = outbox.enqueue(initial_snapshot, generation=outbox.generation(SESSION))
        initial_job = outbox.next_job(SESSION)
        assert initial_job.idempotency_key == initial_key
        initial_receipt = host.deliver_source_job(initial_job)
        assert outbox.acknowledge(initial_job, initial_receipt)

        # A pinned Hermes process attaches through the real provider and is
        # terminated without provider.shutdown().
        repo_src = Path(__file__).resolve().parents[1] / "src"
        script = f"""from time import sleep
from hermes_constants import set_hermes_home_override
from reliquary_hermes.provider import ReliquaryMemoryProvider
scope = set_hermes_home_override({str(state.parent)!r})
p = ReliquaryMemoryProvider()
p.initialize({SESSION!r}, hermes_home={str(state.parent)!r})
deadline = 10
while p.lifecycle_status == 'connecting' and deadline > 0:
    sleep(.05)
    deadline -= .05
assert p.lifecycle_status == 'attached'
sleep(120)
"""
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join((str(repo_src), str(history_checkout),
                                             env.get("PYTHONPATH", "")))
        child = subprocess.Popen([sys.executable, "-B", "-c", script], env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            marker_path = state / "integration-runtimes-v1.json"
            def runtime_registered():
                if child.poll() is not None:
                    return True
                try:
                    leases = json.loads(marker_path.read_text(encoding="utf-8"))["leases"]
                    return len(leases) > 1
                except (FileNotFoundError, json.JSONDecodeError, KeyError):
                    return False

            _wait_until(runtime_registered)
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            new_leases = set(marker["leases"])
            new_leases.discard(survivor_lease)
            assert len(new_leases) == 1, "the adapter subprocess did not register its lease"
            old_lease = new_leases.pop()
        finally:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=10)

        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        assert old_lease in marker["leases"]
        # Renew the survivor strictly before the crashed lease expires. Then
        # observe the host's background expiry loop persist the crash marker
        # without issuing any request that could trigger expiry itself.
        crash_lease = marker["leases"][old_lease]
        crash_expiry = crash_lease["expires_at"]
        runtime_id = crash_lease["runtime_id"]
        for seconds_before_expiry in (45, 30, 15):
            target = crash_expiry - seconds_before_expiry
            while time.time() < target:
                sleep(min(1, target - time.time()))
            host.heartbeat_runtime()
        marker_deadline = crash_expiry + 5
        while time.time() < marker_deadline:
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            if old_lease not in marker["leases"] and any(
                    fence["runtime_id"] == runtime_id and fence["session_id"] == SESSION
                    for fence in marker["fences"]):
                break
            sleep(0.1)
        assert old_lease not in marker["leases"]
        assert any(fence["runtime_id"] == runtime_id and fence["session_id"] == SESSION
                   for fence in marker["fences"])

        reconnect = HostClient(state, PROFILE, PRINCIPAL, TOKEN)
        assert reconnect.attach(SESSION) == original_binding
        new_lease, required = reconnect.attach_runtime(SESSION)
        assert new_lease != old_lease and required[SESSION] > 0
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        assert old_lease not in marker["leases"]
        assert any(fence["integration_kind"] == "hermes" and fence["session_id"] == SESSION
                   and fence["epoch"] == required[SESSION] for fence in marker["fences"])
        assert host._process.poll() is None

        # A delayed heartbeat from the crashed generation cannot revive it.
        stale = HostClient(state, PROFILE, PRINCIPAL, TOKEN)
        stale._runtime_lease = old_lease
        with pytest.raises(HostUnavailable, match="runtime_lease_stale"):
            stale.heartbeat_runtime()
        assert host._process.poll() is None

        with pytest.raises(HostUnavailable, match="source_reconciliation_required"):
            reconnect.deliver_source_job(initial_job)

        # With the crash fence unresolved, even zero live runtime leases must
        # keep the host available for the next integration to recover it.
        reconnect.detach_runtime()
        host.detach_runtime()
        assert host._process.poll() is None

        reconciled_messages = messages + [{
            "message_uid": "appended", "role": "user", "timestamp": time.time(),
            "content": TEXT["appended"],
        }]
        from hermes_cli.config import load_config
        from hermes_cli.memory_setup import _post_setup_hook
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        provider = history_provider.ReliquaryMemoryProvider()
        install_setup_host(state.parent, binary)
        prompts = iter(("", "", "", ""))
        monkeypatch.setattr("builtins.input", lambda _: next(prompts))
        scope = set_hermes_home_override(state.parent)
        try:
            assert _post_setup_hook(provider, {})
            settings = read_settings(state.parent)
            assert (settings.profile_id, settings.principal_id) == (PROFILE, PRINCIPAL)
            assert settings.binary == binary
            assert load_config()["memory"]["provider"] == "reliquary"
            provider.initialize(SESSION, hermes_home=str(state.parent))
            deadline = monotonic() + 10
            while provider.lifecycle_status == "connecting" and monotonic() < deadline:
                sleep(0.02)
            assert provider.lifecycle_status == "attached"
            assert provider.binding == original_binding
            provider.sync_turn("", "", session_id=SESSION, messages=reconciled_messages)
            deadline = monotonic() + 15
            while provider.sync_status != "source_accepted_durable" and monotonic() < deadline:
                sleep(0.05)
            assert provider.sync_status == "source_accepted_durable"
            assert reconnect.deliver_source_job(initial_job) == initial_receipt
        finally:
            provider.shutdown()
            reset_hermes_home_override(scope)

        assert host._process.wait(timeout=10) == 0

        conversation = "hermes-copy:" + sha256(
            b"reliquary/hermes-copied-conversation/v1\0" + len(PROFILE).to_bytes(8, "little") +
            PROFILE.encode("ascii") + SESSION.encode("ascii")).hexdigest()
        rel = state.parent / "main.rel"
        assert _turn(cli, rel, conversation, "accepted")["imported"]["message_id"] == "accepted"
        assert _turn(cli, rel, conversation, "appended")["imported"]["message_id"] == "appended"
        info = _cli(cli, "rel", "info", rel)["owner"]
        assert info["rel_turn_count"] == 2
