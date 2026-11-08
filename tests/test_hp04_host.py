"""Cross-process evidence for HP04 source receipts, processing and terminal fences."""

from contextlib import ExitStack, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import subprocess
from threading import Thread
from time import monotonic, sleep

import pytest

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox, SourceOutboxError
from reliquary_hermes.source_capture import capture_snapshot
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN
from test_hp03_host import binaries, config, owner, stop


SESSION = "session-a"
PROFILE = "profile-a"
PRINCIPAL = "principal-a"
TEXT = {"accepted": "Lantern release uses the amber checklist.",
        "appended": "Backups are retained for fourteen days."}


def _cli(cli, *args, stdin=None):
    run = subprocess.run([str(cli), *map(str, args)], input=stdin, capture_output=True, timeout=10)
    assert run.returncode == 0, f"local Root command failed: {run.stderr.decode('utf-8', errors='replace')}"
    return decode(run.stdout)


def _host(binary, state, cleanup):
    client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
    try:
        client.attach(SESSION)
    finally:
        if client._process is not None:
            cleanup.callback(stop, client._process)
    return client


def _owners(cli, root):
    rel, phy, state = root / "main.rel", root / "active.phy", root / "profile"
    owner(cli, "rel", rel, "unspecified")
    owner(cli, "phy", phy)
    config(state, rel, phy, profile=PROFILE)
    return rel, state


def _queue(outbox, ids):
    messages = [{"message_uid": uid, "role": "user", "timestamp": 1700000000.25 + index,
                 "content": TEXT[uid]} for index, uid in enumerate(ids)]
    snapshot = capture_snapshot(PROFILE, SESSION, messages)
    key = outbox.enqueue(snapshot, generation=outbox.generation(SESSION))
    job = outbox.next_job(SESSION)
    assert job.idempotency_key == key
    return job


def _when_ready(client, job):
    deadline = monotonic() + 15
    while True:
        try:
            return client.deliver_source_job(job)
        except HostUnavailable as error:
            if str(error) != "source_import_pending" or monotonic() >= deadline:
                raise
            sleep(0.05)


def _turn(cli, rel, conversation, uid):
    items = _cli(cli, "rel", "archive", "turn", rel, conversation, uid)["page"]["items"]
    [item] = items
    assert item["kind"] == "turn"
    return item["value"]


def test_hp04_crash_before_ack_replays_exact_receipt_and_terminal_fence(tmp_path, binaries):
    binary, cli = binaries
    rel, state = _owners(cli, tmp_path)
    outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
    initial = _queue(outbox, ["accepted"])
    with ExitStack() as cleanup:
        first = _host(binary, state, cleanup)
        receipt = first.deliver_source_job(initial)
        stop(first._process)
        staged = rel.read_bytes()

        # The first client died after native staging but before saving the acknowledged cursor.
        outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
        assert outbox.cursor(SESSION) is None
        assert outbox.next_job(SESSION) == initial
        second = _host(binary, state, cleanup)
        assert second.deliver_source_job(initial) == receipt
        assert outbox.acknowledge(initial, receipt)
        assert outbox.cursor(SESSION).last_message_uid == "accepted"
        assert outbox.next_job(SESSION) is None
        stop(second._process)
        assert rel.read_bytes() == staged

        # A separate adapter can enqueue the terminal notice while the service is down.
        cold = SourceOutbox(state, PROFILE, PRINCIPAL)
        key = cold.terminal(SESSION, "archive")
        assert cold.terminal(SESSION, "delete") == key
        terminal = cold.next_job(SESSION)
        with pytest.raises(SourceOutboxError, match="source_terminal"):
            cold.enqueue(initial.snapshot, generation=cold.generation(SESSION))

        third = _host(binary, state, cleanup)
        # Without a processing runtime the native epoch can still be open. The
        # terminal fence must persist immediately even if Root tombstoning waits.
        try:
            terminal_receipt = third.deliver_source_job(terminal)
        except HostUnavailable as error:
            assert str(error) == "source_import_pending"
        else:
            assert cold.acknowledge(terminal, terminal_receipt)
        with pytest.raises(HostUnavailable, match="source_terminal"):
            third.deliver_source_job(initial)
        stop(third._process)
        fenced = _host(binary, state, cleanup)
        with pytest.raises(HostUnavailable, match="source_terminal"):
            fenced.deliver_source_job(initial)


def _fixture_reply(request):
    if "input" in request:
        return {"data": [{"index": index, "embedding": [1.0, 0.0]}
                         for index in range(len(request["input"]))]}
    schema = request["response_format"]["json_schema"]
    name, shape = schema["name"], schema["schema"]["properties"]
    if name == "readiness_probe":
        result = {"ok": True}
    elif name == "insomnia_authority_disposition_ledger":
        [uid] = shape["turns"]["required"]
        result = {"turns": {uid: [{"disposition": "retain", "authority_kind": "direct", "category": "fact",
                   "type": "project", "lifecycle": "current", "proposition": TEXT[uid],
                   "authority_source_node_id": "", "grounding_source_node_id": "", "reason": "direct source statement"}]},
                  "evidence_requests": []}
    elif name == "insomnia_memory_ownership":
        result = {"ownership": {group: "project" for group in shape["ownership"]["required"]}}
    elif name == "insomnia_memory_wording":
        uid = shape["candidates"]["items"]["properties"]["source_node_id"]["enum"][0]
        result = {"candidates": [{"authority_kind": "direct", "category": "fact", "memory_type": "project",
                  "temporal_status": "current", "ownership": "project", "title": uid,
                  "content": TEXT[uid], "source_node_id": uid, "source_quote": TEXT[uid],
                  "authority_source": None, "grounding_source": None, "routing_mentions": []}]}
    else:
        raise ValueError("unexpected processing schema")
    return {"choices": [{"message": {"content": json.dumps(result)}}]}


@contextmanager
def _loopback_model():
    errors = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                body = canonical(_fixture_reply(request))
            except (KeyError, TypeError, ValueError) as error:
                errors.append(str(error))
                self.send_error(400)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join(5)
    assert not errors, errors


def _processing_config(cli, state, url):
    runtime = state / "synthetic.cfg"
    flags = ["--config", runtime, "config"]
    _cli(cli, *flags, "credential", "add-api-key", "HP04_FIXTURE", "--stdin", stdin=b"synthetic-hp04-fixture\n")
    for route in ("general", "entity-resolution", "embedding"):
        extra = ["--dimensions", "2"] if route == "embedding" else []
        _cli(cli, *flags, "model", f"set-{route}", "--model", "fixture", "--url", url,
             "--credential", "HP04_FIXTURE", "--provider", "openai-ready", *extra)
    (state / "processing.json").write_bytes(canonical({"config_path": str(runtime)}))


def test_hp04_processed_append_tombstones_both_exact_source_turns(tmp_path, binaries):
    binary, cli = binaries
    rel, state = _owners(cli, tmp_path)
    outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
    with _loopback_model() as url, ExitStack() as cleanup:
        _processing_config(cli, state, url)
        client = _host(binary, state, cleanup)
        initial = _queue(outbox, ["accepted"])
        initial_receipt = client.deliver_source_job(initial)
        assert outbox.acknowledge(initial, initial_receipt)
        extension = _queue(outbox, ["accepted", "appended"])
        extension_receipt = _when_ready(client, extension)
        assert extension_receipt != initial_receipt
        assert client.deliver_source_job(extension) == extension_receipt
        assert outbox.acknowledge(extension, extension_receipt)

        [conversation] = _cli(cli, "rel", "archive", "conversations", rel)["page"]["items"]
        conversation_id = conversation["value"]["conversation_id"]
        assert conversation["value"]["turn_count"] == 2
        original = _turn(cli, rel, conversation_id, "accepted")
        assert original["timestamp_ns"] == 1700000000250000000
        assert original["content"] == TEXT["accepted"]
        assert original["imported"]["message_id"] == "accepted"

        outbox.terminal(SESSION, "delete")
        terminal = outbox.next_job(SESSION)
        terminal_receipt = _when_ready(client, terminal)
        assert outbox.acknowledge(terminal, terminal_receipt)
        assert client.deliver_source_job(terminal) == terminal_receipt
        with pytest.raises(HostUnavailable, match="source_terminal"):
            client.deliver_source_job(extension)
        stop(client._process)

    for uid, second in (("accepted", 0), ("appended", 1)):
        turn = _turn(cli, rel, conversation_id, uid)
        assert (turn["availability"], turn["content"], turn["imported"]["message_id"]) == ("terminal", None, uid)
        assert turn["timestamp_ns"] == 1700000000250000000 + second * 1_000_000_000
    info = _cli(cli, "rel", "info", rel)["owner"]
    assert (info["rel_turn_count"], info["memory_count"]) == (2, 2)
