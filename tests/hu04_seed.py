"""Populate isolated HU04 owners through Hermes source delivery and public Root."""

from contextlib import contextmanager
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from threading import Thread

import pytest

from reliquary_hermes.client import HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.source_capture import capture_snapshot
from reliquary_hermes.validation import canonical, decode
from hosted_hermes_worker import configure_hermes, start_hermes_worker, worker_command
from test_hp03_host import stop
from test_hp04_host import _cli, _fixture_reply, _when_ready


PROFILE = "primary"
PRINCIPAL = "principal-a"
GENERAL_SESSION = "session-primary"
PROJECT_SESSION = "session-project"
GENERAL_UIDS = ("hu04-checklist", "hu04-backups", "hu04-binder")
PROJECT_UID = "hu04-archived-record"
TURNS = {
    GENERAL_UIDS[0]: ("Lantern checklist", "Lantern release uses the café checklist."),
    GENERAL_UIDS[1]: ("Lantern backups", "Lantern release keeps backups for fourteen days."),
    GENERAL_UIDS[2]: ("Lantern binder", "Lantern release evidence is kept in the binder."),
    PROJECT_UID: ("Archived project record", "The archived project records a synthetic milestone."),
}


def _model_reply(request):
    if "input" in request:
        return _fixture_reply(request)
    schema = request["response_format"]["json_schema"]
    shape = schema["schema"]["properties"]
    name = schema["name"]
    if name == "plugin_structured_output":
        user = next((message for message in request.get("messages", [])
                     if message.get("role") == "user"), {})
        content = user.get("content", [])
        header = content[0].get("text", "") if content and isinstance(content[0], dict) else ""
        schema_match = re.search(r"^Schema name:\s*([^\r\n]+)", header, re.MULTILINE)
        if schema_match:
            name = schema_match.group(1).strip()
    match name:
        case "insomnia_authority_disposition_ledger":
            turns = {uid: [{"disposition": "retain", "authority_kind": "direct", "category": "fact",
                            "type": "project", "lifecycle": "current", "proposition": TURNS[uid][1],
                            "authority_source_node_id": "", "grounding_source_node_id": "",
                            "reason": "direct synthetic source statement"}]
                     for uid in shape["turns"]["required"]}
            result = {"turns": turns, "evidence_requests": []}
        case "insomnia_memory_wording":
            uids = shape["candidates"]["items"]["properties"]["source_node_id"]["enum"]
            result = {"candidates": [
                {"authority_kind": "direct", "category": "fact", "memory_type": "project",
                 "temporal_status": "current", "ownership": "project", "title": TURNS[uid][0],
                 "content": TURNS[uid][1], "source_node_id": uid, "source_quote": TURNS[uid][1],
                 "authority_source": None, "grounding_source": None, "routing_mentions": []}
                for uid in uids
            ]}
        case "dream_pair_classification":
            result = {"relation": "topical", "direction": "undirected",
                      "evidence": [{"side": "a", "quote": "Lantern"}, {"side": "b", "quote": "Lantern"}]}
        case "dream_pair_verification":
            result = {"relation_supported": "yes", "direction_supported": "yes", "evidence_supported": "yes"}
        case _:
            return _fixture_reply(request)
    return {"model": request.get("model", "fixture-chat"),
            "choices": [{"message": {"content": json.dumps(result)}}]}


@contextmanager
def _model():
    errors = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                if self.headers.get("Authorization") != "Bearer synthetic-hosted-inference-key":
                    raise ValueError("synthetic provider credential was not scoped to Hermes")
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                body = canonical(_model_reply(request))
            except (KeyError, TypeError, ValueError) as error:
                errors.append(str(error))
                self.send_error(400)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
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


def _configure(cli, state, url):
    configure_hermes(state.parent, url)


def _hermes_sessions(home, checkout, sessions, *, archive=None):
    """Use the pinned host's session API to persist the same synthetic source rows."""
    script = """
import json
import sys
from pathlib import Path
from hermes_state import SessionDB

sessions, archive = json.load(sys.stdin)
with SessionDB(Path(sys.argv[1]) / 'state.db') as db:
    for session, rows in sessions.items():
        db.create_session(session, source='cli')
        assert db.append_messages_batch(session, rows) == len(rows)
    if archive is not None:
        # The fixture delivers the corresponding lifecycle event via the source outbox.
        assert db.set_session_archived(archive, True, notify=False)
"""
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update({key: str(home) for key in (
        "HERMES_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR",
    )})
    env.update(PYTHONPATH=str(checkout), PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1",
               HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0")
    run = subprocess.run([sys.executable, "-B", "-c", script, str(home)], cwd=home, env=env,
                         input=canonical([sessions, archive]), capture_output=True, timeout=40)
    assert run.returncode == 0, run.stderr.decode("utf-8", errors="replace")


def _deliver(outbox, client, job):
    receipt = _when_ready(client, job)
    assert outbox.acknowledge(job, receipt)


def _settle(client, session, expected_memories):
    """Wait for the hosted Root runtime to finish processing the accepted source."""
    import time

    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        status = client.read_source_status(session)
        if status.get("state") == "complete":
            return
        time.sleep(0.1)
    pytest.fail(f"hosted Hermes processor did not complete {expected_memories} Memories for {session}")


def _memory_rows(cli, rel):
    items = _cli(cli, "rel", "memory", "list", rel)["page"]["items"]
    return {item["value"]["title"]: item["value"] for item in items}


def _expect_memory(memories, uid):
    title, body = TURNS[uid]
    memory = memories[title]
    assert (memory["content"], memory["category"], memory["memory_type"]) == (body, "fact", "project")
    return {"memory_id": memory["id"], "revision": str(memory["revision"]), "body_id": memory["body_id"],
            "title": title, "body": body, "category": "fact", "memory_type": "project"}


def _expect_graph(cli, rel, copied, companion):
    expected = {copied["memory_id"], companion["memory_id"]}
    items = _cli(cli, "rel", "graph", "neighbors", rel, copied["memory_id"])["page"]["items"]
    for item in items:
        edge = item["value"]
        endpoints = {bytes(edge[role]["id"]).hex() for role in ("source", "target")}
        if endpoints == expected and (edge["kind"], edge["origin"], edge["active"]) == ("Topical", "Dream", True):
            return
    pytest.fail("HU04 seed did not create the expected active Dream Topical edge")


def seed_profile(home, checkout, inference_checkout, binaries, client, cleanup):
    """Use the real Rust service for source receipts, then release its lease for processing."""
    _, cli = binaries
    state = home / "reliquary"
    main, project = home / "main.rel", home / "project.rel"
    sessions = {session: [{"message_uid": uid, "role": "user", "content": TURNS[uid][1],
                           "timestamp": 1700000000.25 + index}
                          for index, uid in enumerate(uids)]
                for session, uids in ((GENERAL_SESSION, GENERAL_UIDS), (PROJECT_SESSION, (PROJECT_UID,)))}
    _hermes_sessions(home, checkout, sessions)
    outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
    snapshots = {}
    for session, rows in sessions.items():
        snapshot = capture_snapshot(PROFILE, session, rows)
        outbox.enqueue(snapshot, generation=outbox.generation(session))
        job = outbox.next_job(session)
        assert job is not None and job.kind == "snapshot"
        snapshots[session] = job
        _deliver(outbox, client, job)

    assert client._process is not None
    with _model() as url:
        _configure(cli, state, url)
        worker = start_hermes_worker(home, inference_checkout, url, cleanup)
        _settle(client, GENERAL_SESSION, len(GENERAL_UIDS))
        _settle(client, PROJECT_SESSION, 1)

        # Release the hosted Root process before inspecting its Windows-backed REL files.
        worker_command(worker, "stop")
        stop(client._process)

    memories = _memory_rows(cli, main)
    copied, companion = (_expect_memory(memories, uid) for uid in GENERAL_UIDS[:2])
    _expect_memory(memories, GENERAL_UIDS[2])
    _expect_graph(cli, main, copied, companion)
    archived = _expect_memory(_memory_rows(cli, project), PROJECT_UID)
    [evidence] = _cli(cli, "rel", "memory", "provenance", main, copied["memory_id"])["page"]["items"]
    assert evidence["kind"] == "provenance"
    native = evidence["value"]
    imported = native["source_turn"]["imported"]
    assert imported["conversation_id"] == GENERAL_SESSION and imported["message_id"] == GENERAL_UIDS[0]
    copied["created_at_ms"] = str(native["created_at_ns"] // 1_000_000)
    copied["source"] = {
        "kind": "hermes_snapshot", "label": "Hermes source / copied snapshot",
        "profile_namespace": PROFILE, "session_id": GENERAL_SESSION, "message_uid": GENERAL_UIDS[0],
        "branch_id": None, "source_revision": None, "content_digest": bytes(imported["source_digest"]).hex(),
        "range": None,
    }
    worker_command(worker, "start")
    client.attach(GENERAL_SESSION)
    if client._process is not None:
        cleanup.callback(stop, client._process)
    _hermes_sessions(home, checkout, {}, archive=PROJECT_SESSION)
    try:
        client.attach(GENERAL_SESSION)
        client.attach(PROJECT_SESSION)
    finally:
        if client._process is not None:
            cleanup.callback(stop, client._process)
    outbox.terminal(PROJECT_SESSION, "archive")
    terminal = outbox.next_job(PROJECT_SESSION)
    assert terminal is not None and terminal.kind == "terminal"
    _deliver(outbox, client, terminal)
    with pytest.raises(HostUnavailable, match="^source_terminal$"):
        client.deliver_source_job(snapshots[PROJECT_SESSION])
    return {
        "copied_memory": copied, "companion_memory": companion, "archived_memory": archived,
        "graph": {"kind": "topical", "origin": "dream"},
        "operational": {"general": {"source_state": "active"}, "project": {"source_state": "tombstoned"}},
    }


def seed_foreign_memory(cli, rel):
    """Return the ID of a real Memory available only inside the foreign REL."""
    result = _cli(cli, "rel", "memory", "add", rel, "--title", "HU04 foreign private record",
                  "--content", "Synthetic foreign profile payload", "--category", "fact", "--type", "project")
    return result["memory"]["id"]
