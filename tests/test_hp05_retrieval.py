"""Pinned Hermes and real host retrieval acceptance evidence for HP05."""

from contextlib import ExitStack, contextmanager
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import subprocess
from threading import Event, Lock, Thread
from time import monotonic, sleep
from types import SimpleNamespace

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import TOKEN_VAR, save_settings
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN
from test_hp03_host import binaries, config, owner, stop
from test_hp03_provider import pinned_provider
from test_hp04_host import (
    PRINCIPAL, PROFILE, SESSION, TEXT, _cli, _fixture_reply, _queue, _when_ready,
)


def _wait(predicate, *, seconds=15):
    deadline = monotonic() + seconds
    while monotonic() < deadline:
        value = predicate()
        if value:
            return value
        sleep(0.025)
    assert predicate(), "HP05 deterministic host/provider operation did not settle"


@contextmanager
def _retrieval_fixture_model():
    """Use deterministic processor fixtures and approve only offered Memories."""
    retrieval_calls = []
    retrieval_ready = Event()
    errors = []
    lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if "state" in request:
                    state = request["state"]
                    if state.get("operation") in {"memory_query", "refine_query", "traverse_graph"}:
                        with lock:
                            retrieval_calls.append(state["operation"])
                        retrieval_ready.set()
                    operation = state.get("operation")
                    if operation == "refine_query_rewrite":
                        body_value = {"version": 1, "query": state["current_query"]}
                    else:
                        candidates = state.get("candidates", [])
                        approved = candidates[:1] if operation == "memory_query" else candidates
                        body_value = {"version": 1,
                                      "approved": [item["memory"] for item in approved]}
                elif "input" in request:
                    body_value = {"data": [
                        {"index": index, "embedding": [1.0, 0.0]}
                        for index, _text in enumerate(request["input"])
                    ]}
                else:
                    schema = request["response_format"]["json_schema"]
                    schema_name = schema["name"]
                    shape = schema["schema"]["properties"]
                    if schema_name == "insomnia_authority_disposition_ledger":
                        turns = {
                            uid: [{"disposition": "retain", "authority_kind": "direct", "category": "fact",
                                   "type": "project", "lifecycle": "current", "proposition": TEXT[uid],
                                   "authority_source_node_id": "", "grounding_source_node_id": "",
                                   "reason": "direct source statement"}]
                            for uid in shape["turns"]["required"]
                        }
                        response = {"turns": turns, "evidence_requests": []}
                        body_value = {"choices": [{"message": {"content": json.dumps(response)}}]}
                    elif schema_name == "insomnia_memory_wording":
                        node_ids = shape["candidates"]["items"]["properties"]["source_node_id"]["enum"]
                        response = {"candidates": [
                            {"authority_kind": "direct", "category": "fact", "memory_type": "project",
                             "temporal_status": "current", "ownership": "project", "title": uid,
                             "content": TEXT[uid], "source_node_id": uid, "source_quote": TEXT[uid],
                             "authority_source": None, "grounding_source": None, "routing_mentions": []}
                            for uid in node_ids
                        ]}
                        body_value = {"choices": [{"message": {"content": json.dumps(response)}}]}
                    elif schema_name == "dream_pair_classification":
                        response = {"relation": "topical", "direction": "undirected",
                                    "evidence": [{"side": "a", "quote": "Lantern"},
                                                 {"side": "b", "quote": "Lantern"}]}
                        body_value = {"choices": [{"message": {"content": json.dumps(response)}}]}
                    elif schema_name == "dream_pair_verification":
                        response = {"relation_supported": "yes", "direction_supported": "yes",
                                    "evidence_supported": "yes"}
                        body_value = {"choices": [{"message": {"content": json.dumps(response)}}]}
                    else:
                        body_value = _fixture_reply(request)
                body = canonical(body_value)
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
            yield f"http://127.0.0.1:{server.server_port}", retrieval_calls, retrieval_ready
        finally:
            server.shutdown()
            worker.join(5)
    assert not errors, errors


def _configure(cli, state, url):
    runtime = state / "synthetic.cfg"
    flags = ["--config", runtime, "config"]
    _cli(cli, *flags, "credential", "add-api-key", "HP05_FIXTURE", "--stdin",
         stdin=b"synthetic-hp05-fixture\n")
    for route in ("general", "entity-resolution", "dream", "embedding"):
        extra = ["--dimensions", "2"] if route == "embedding" else []
        _cli(cli, *flags, "model", f"set-{route}", "--model", "fixture", "--url", url,
             "--credential", "HP05_FIXTURE", "--provider", "openai-ready", *extra)
    _cli(cli, *flags, "model", "set-memory-retrieval-decision", "--model", "fixture",
         "--url", url, "--credential", "HP05_FIXTURE")
    return runtime


def _settled(provider, status="attached"):
    _wait(lambda: provider.lifecycle_status == status, seconds=10)


def _provider_profile(home, state, rel, phy, binary):
    home.mkdir(exist_ok=True)
    save_settings(home, {
        "profile_id": PROFILE,
        "principal_id": PRINCIPAL,
        "main_rel": str(rel),
        "active_phy": str(phy),
        "binary": str(binary),
    })
    (home / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
    assert (home / "reliquary").resolve() == state.resolve()


def test_hp05_pinned_provider_real_query_refine_traverse_prefetch_and_exact_return(
        tmp_path, binaries, pinned_provider, monkeypatch):
    from agent.memory_manager import MemoryManager
    from agent.turn_context import _memory_turn_start_and_prefetch
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    binary, cli = binaries
    home = tmp_path / "hermes-profile"
    home.mkdir()
    state = home / "reliquary"
    rel, phy = tmp_path / "main.rel", tmp_path / "active.phy"
    owner(cli, "rel", rel, "unspecified")
    owner(cli, "phy", phy)
    config(state, rel, phy, profile=PROFILE)
    _provider_profile(home, state, rel, phy, binary)
    monkeypatch.setitem(TEXT, "appended", "Lantern release keeps an amber checklist for backups.")
    monkeypatch.setitem(TEXT, "traveler", "Lantern release evidence is stored in the binder.")
    outbox = SourceOutbox(state, PROFILE, PRINCIPAL)

    with _retrieval_fixture_model() as (url, retrieval_calls, retrieval_ready), ExitStack() as cleanup:
        runtime = _configure(cli, state, url)
        client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        client.attach(SESSION)
        cleanup.callback(stop, client._process)
        job = _queue(outbox, ["accepted", "appended", "traveler"])
        receipt = _when_ready(client, job)
        assert outbox.acknowledge(job, receipt)
        stop(client._process)

        # Finish the exact staged import through public Root with the writer
        # lease released. The query then uses lexical retrieval against the
        # graph built during processing, leaving one neighbor unseen.
        state_key = sha256(SESSION.encode()).hexdigest()
        source_state = decode((state / "sources-v1" / f"{state_key}.json").read_bytes())
        import_id = source_state["accepted"]["import_id"]
        process = subprocess.run(
            [str(cli), "rel", "process", str(rel), "--config", str(runtime),
             "--until", "ready", "--import", import_id],
            capture_output=True, timeout=15,
        )
        assert process.returncode == 0, (process.stdout, process.stderr)
        info = _cli(cli, "rel", "info", rel)["owner"]
        assert info["memory_count"] == 3 and info["graph_version"] > 0
        _cli(cli, "--config", runtime, "config", "model", "clear-embedding")
        (state / "processing.json").write_bytes(canonical({"config_path": str(runtime)}))

        home_scope = set_hermes_home_override(home)
        cleanup.callback(reset_hermes_home_override, home_scope)
        def start_provider():
            manager = MemoryManager()
            provider = pinned_provider.ReliquaryMemoryProvider()
            manager.add_provider(provider)
            manager.initialize_all(SESSION, hermes_home=str(home))
            cleanup.callback(manager.shutdown_all)
            _settled(provider)
            provider_process = provider._client._process
            cleanup.callback(stop, provider_process)
            return manager, provider, provider_process

        def prepare(manager, provider):
            retrieval_ready.clear()
            prepare_completed = Event()
            outcomes = []
            original_prepare = provider._client.prepare_retrieval

            def prepare_and_signal(raw):
                try:
                    prepared = original_prepare(raw)
                    outcomes.append(prepared)
                    return prepared
                except (HostUnavailable, OSError) as error:
                    outcomes.append(str(error))
                    raise
                finally:
                    prepare_completed.set()

            provider._client.prepare_retrieval = prepare_and_signal
            manager.queue_prefetch_all("amber checklist", session_id=SESSION)
            assert prepare_completed.wait(10), "queued prefetch prepare did not complete"
            assert outcomes == [True], outcomes
            assert retrieval_ready.is_set(), retrieval_calls
            assert provider.recall_status() is None
            return provider._prefetch["raw"]

        def historical_records():
            return _cli(cli, "rel", "history", "proof", rel)["proof"]["retained_records"]

        # The Windows writer lease bars concurrent file inspection. Reopen
        # after clean detach to compare both the owner and its retained proof.
        before_candidate = rel.read_bytes()
        initial_records = historical_records()
        manager, provider, provider_process = start_provider()
        prepare(manager, provider)
        manager.shutdown_all()
        assert provider_process.wait(timeout=10) == 0
        assert rel.read_bytes() == before_candidate
        assert historical_records() == initial_records

        manager, provider, provider_process = start_provider()
        prepared_raw = prepare(manager, provider)
        query_decisions = retrieval_calls.count("memory_query")
        status_events = []
        agent = SimpleNamespace(_memory_manager=manager, _user_turn_count=1,
                                session_id=SESSION, _emit_status=status_events.append)
        context = _memory_turn_start_and_prefetch(agent, "amber checklist")
        assert context and "amber checklist" in context.lower()
        assert status_events and "recalled" in status_events[-1].lower()
        recall = provider.recall_status()
        assert recall is not None and recall.count >= 1
        assert retrieval_calls.count("memory_query") == query_decisions

        # Replay the exact prepared bytes used for the first release. The host
        # rejects a second release. Root history must retain exactly one write.
        try:
            replay = provider._client.request(prepared_raw)
        except HostUnavailable as error:
            assert str(error) == "host_conflict"
        else:
            assert replay.status == "conflict"
        manager.shutdown_all()
        assert provider_process.wait(timeout=10) == 0
        assert rel.read_bytes() != before_candidate
        assert historical_records() == initial_records + 1

        manager, provider, provider_process = start_provider()
        manager.on_turn_start(1, "Use the retrieval tools")
        query_json = json.loads(manager.handle_tool_call(
            "memory_query", {"query": "amber checklist", "limit": 10}, session_id=SESSION,
        ))
        assert query_json["status"] == "ok", query_json
        result = query_json["result"]
        assert len(result["memory_ids"]) == 1
        [memory_id] = result["memory_ids"]
        assert result["provenance"] == [{
            "memory_id": memory_id,
            "source_snapshot_digests": [job.snapshot.snapshot_digest],
        }]

        refined = json.loads(manager.handle_tool_call("refine_query", {
            "query": "amber checklist",
            "limit": 10,
            "search_id": result["search_id"],
            "selected_ids": [memory_id],
        }, session_id=SESSION))
        assert refined["status"] == "ok", refined
        assert refined["result"]["search_id"] == result["search_id"]
        assert len(refined["result"]["memory_ids"]) == 1
        [refined_memory_id] = refined["result"]["memory_ids"]

        traversal = {"seed_ids": [refined_memory_id], "depth": 1, "limit": 10, "cut": refined["cut"]}
        deeper = json.loads(manager.handle_tool_call(
            "traverse_graph", dict(traversal, depth=2), session_id=SESSION,
        ))
        assert deeper["status"] == "unsupported", deeper
        traversed = json.loads(manager.handle_tool_call("traverse_graph", traversal, session_id=SESSION))
        assert traversed["status"] == "ok", traversed
        assert len(traversed["result"]["memory_ids"]) == 1
        assert traversed["result"]["memory_ids"][0] not in result["memory_ids"]
        assert traversed["result"]["memory_ids"][0] not in refined["result"]["memory_ids"]

        # A rewind fences the copied evidence, even from another session
        # bound to the same REL. A session change also clears old prefetch.
        manager.on_session_switch(SESSION, rewound=True)
        _wait(lambda: outbox.cursor(SESSION).kind == "invalidate")
        manager.on_session_switch("session-b")
        _settled(provider)
        assert manager.prefetch_all("amber checklist", session_id=SESSION) == ""
        assert provider.recall_status() is None
        stale_tool = json.loads(manager.handle_tool_call(
            "memory_query", {"query": "amber checklist", "limit": 10}, session_id=SESSION,
        ))
        assert stale_tool["status"] == "unavailable"
        fenced = json.loads(manager.handle_tool_call(
            "memory_query", {"query": "amber checklist", "limit": 10}, session_id="session-b",
        ))
        assert fenced["status"] == "conflict", fenced
        assert fenced["result"]["code"] == "source_reconciliation_required"

        # The public Root inspection path is read-only. Inspect after releasing
        # the host lease, then prove it did not append another Freshness receipt.
        manager.shutdown_all()
        assert provider_process.wait(timeout=10) == 0
        before_inspection = rel.read_bytes()
        assert historical_records() == initial_records + 4
        inspected = _cli(cli, "rel", "memory", "get", rel, memory_id)
        assert inspected["memory"] is not None
        assert rel.read_bytes() == before_inspection
