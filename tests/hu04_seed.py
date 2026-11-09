"""Populate isolated HU04 owners through Hermes source delivery and public Root."""

from contextlib import contextmanager
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
from threading import Thread

import pytest

from reliquary_hermes.client import HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.source_capture import capture_snapshot
from reliquary_hermes.validation import canonical, decode
from test_hp03_host import stop
from test_hp04_host import _cli, _fixture_reply, _seed_blank_processing_config, _when_ready


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
    match schema["name"]:
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
    return {"choices": [{"message": {"content": json.dumps(result)}}]}


@contextmanager
def _model():
    errors = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
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
    runtime = state / "hu04.cfg"
    _seed_blank_processing_config(runtime)
    flags = ["--config", runtime, "config"]
    _cli(cli, *flags, "credential", "add-api-key", "HU04_FIXTURE", "--stdin",
         stdin=b"synthetic-hu04-model-token\n")
    for route in ("general", "entity-resolution", "dream", "embedding"):
        dimensions = ["--dimensions", "2"] if route == "embedding" else []
        _cli(cli, *flags, "model", f"set-{route}", "--model", "fixture", "--url", url,
             "--credential", "HU04_FIXTURE", "--provider", "openai-ready", *dimensions)
    return runtime


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


def _settle(cli, rel, state, session, runtime):
    # Match the HP05 process proof: read the host's accepted import ID from its
    # isolated test state and pass it to the public Root CLI with the lease free.
    key = sha256(session.encode("ascii")).hexdigest()
    accepted = decode((state / "sources-v1" / f"{key}.json").read_bytes())["accepted"]
    run = subprocess.run([str(cli), "rel", "process", str(rel), "--config", str(runtime),
                          "--until", "ready", "--import", accepted["import_id"]],
                         cwd=state, capture_output=True, timeout=40)
    assert run.returncode == 0, run.stderr.decode("utf-8", errors="replace")


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


def seed_profile(home, checkout, binaries, client, cleanup):
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
    stop(client._process)
    with _model() as url:
        runtime = _configure(cli, state, url)
        _settle(cli, main, state, GENERAL_SESSION, runtime)
        _settle(cli, project, state, PROJECT_SESSION, runtime)

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
