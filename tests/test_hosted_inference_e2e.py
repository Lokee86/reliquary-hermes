"""Real registered Hermes ctx.llm, native broker, Root processing and durable replay."""

from contextlib import ExitStack
from hashlib import sha256
from itertools import count
import json
from pathlib import Path
import re
import subprocess
from shutil import copyfile
from threading import Event
from time import monotonic, sleep

import pytest

from hosted_hermes_worker import EMBEDDING_KEY, configure_embeddings, start_hermes_worker, worker_command
from hosted_inference_probe import NATIVE_DECISION_KEY, hosted_model, native_reply
from reliquary_hermes import client as client_module, setup
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import TOKEN_VAR, save_settings
from reliquary_hermes.source_removals import reconcile_removals
from reliquary_hermes.validation import ContractError, canonical, decode
from test_host_client import TOKEN
from test_hp03_host import binaries as binaries
from test_hp03_host import config, owner, stop
from test_hp04_host import PRINCIPAL, PROFILE, SESSION, TEXT, _queue, _turn, _when_ready
from test_hp05_retrieval import _dashboard_binding, _dashboard_exchange, _dashboard_status


# Three full-precision vectors remain below Switchboard's 1-MiB response cap.
DIMENSIONS = 14000
DEFAULT_QUERY = "amber checklist"


def wait_for(predicate, *, seconds=40, diagnostic=lambda: ""):
    deadline = monotonic() + seconds
    while monotonic() < deadline:
        value = predicate()
        if value:
            return value
        sleep(0.1)
    raise AssertionError("Hosted acceptance did not settle: " + str(diagnostic()))


def audit(home):
    path = home / "hosted-inference-audit.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def stop_worker_and_host(worker, client):
    # Keep startup and teardown under the signed runtime lease even when
    # the worker and the client share one Windows host process.
    if client._runtime_lease is None:
        client.attach_runtime(None)
    assert worker_command(worker, "stop")["registered"] is False
    client.detach_runtime()
    assert client._process.wait(timeout=15) == 0
    assert not (client._state_dir / "discovery.json").exists()


def query_request(turn, text=DEFAULT_QUERY):
    return canonical({"protocol_version": 1, "request_id": "query-" + turn,
        "operation": "memory_query", "profile_id": PROFILE, "principal_id": PRINCIPAL,
        "session_id": SESSION, "turn_id": turn, "expected_revision": None,
        "idempotency_key": None, "arguments": {"query": text, "limit": 10}})


def query(client, turn, text=DEFAULT_QUERY):
    try:
        response = client.request(query_request(turn, text), recall_tool=True)
    except HostUnavailable as error:
        return str(error)
    if response.status != "ok":
        return decode(response.result_json)["code"]
    return decode(response.result_json)


def successful_query(client, turn, text=DEFAULT_QUERY):
    result = query(client, turn, text)
    assert isinstance(result, dict) and result["memory_ids"], result
    assert result["provenance"] and result["context"]
    return result


def _copied_memories(client):
    topology, binding = _dashboard_binding(client, SESSION)
    reply, _ = _dashboard_exchange(client, topology, binding, "ui.memory_list", {
        "cursor": None, "limit": 10, "filters": {"query": "", "category": None,
            "memory_type": None, "lifecycle": None, "community_id": None}})
    assert reply["status"] == "ok", reply
    return {item["title"]: item for item in reply["result"]["items"]}


def _copied_memory_detail(client, memory, *, removed=False):
    topology, binding = _dashboard_binding(client, SESSION)
    reply, _ = _dashboard_exchange(client, topology, binding, "ui.memory_detail", {
        "memory_id": memory["memory_id"], "revision": memory["revision"],
    })
    if removed:
        if reply["status"] == "ok":
            assert reply["result"]["body"]["content"] is None, reply
        else:
            assert reply["status"] == "unavailable", reply["result"]
        return
    assert reply["status"] == "ok", reply["result"]
    return reply["result"]


def test_real_hermes_hosted_inference_processing_recall_identity_and_restart(
        tmp_path, binaries, inference_checkout, monkeypatch):
    binary, cli = binaries
    # Acceptance operates on copies, never installed owners or the user's profile.
    seed_rel, seed_phy = tmp_path / "seed.rel", tmp_path / "seed.phy"
    owner(cli, "rel", seed_rel)
    owner(cli, "phy", seed_phy)
    rel, phy = tmp_path / "main.rel", tmp_path / "active.phy"
    copyfile(seed_rel, rel)
    copyfile(seed_phy, phy)
    home = tmp_path / "hermes-profile"
    home.mkdir()
    state = home / "reliquary"
    config(state, rel, phy, profile=PROFILE)
    save_settings(home, {"profile_id": PROFILE, "principal_id": PRINCIPAL,
        "main_rel": str(rel), "active_phy": str(phy), "binary": str(binary)})
    (home / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
    monkeypatch.setitem(TEXT, "appended", "Lantern release keeps an amber checklist for backups.")
    monkeypatch.setitem(TEXT, "traveler", "Lantern release evidence is stored in the binder.")
    outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
    native_log = home / "native-host.log"
    original_popen = subprocess.Popen

    def traced_popen(args, **kwargs):
        if str(args[0]) == str(binary):
            with native_log.open("ab") as stream:
                kwargs["stderr"] = stream
                return original_popen(args, **kwargs)
        return original_popen(args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", traced_popen)
    original_response = client_module._response

    def traced_response(*args, **kwargs):
        try:
            return original_response(*args, **kwargs)
        except (OSError, ValueError) as error:
            with native_log.open("a", encoding="utf-8") as stream:
                stream.write(f"HTTP parser: {type(error).__name__} {error}\n")
            raise

    monkeypatch.setattr(client_module, "_response", traced_response)

    with hosted_model(DIMENSIONS) as (url, model), ExitStack() as cleanup:
        client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        cleanup.callback(lambda: stop(client._process) if client._process is not None else None)
        client.attach(SESSION)
        # Accepted source copying is independent of inference availability. The
        # worker must resume this import without another chat turn or attach.
        job = _queue(outbox, ["accepted", "appended", "traveler"])
        receipt = _when_ready(client, job)
        assert outbox.acknowledge(job, receipt)
        pending = client.read_source_status(SESSION)
        assert pending["state"] == "unavailable" and pending["receipt"] == receipt
        worker = start_hermes_worker(home, inference_checkout, url, cleanup)
        log = home / "hosted-worker.log"
        def diagnostic():
            return (log.read_text(encoding="utf-8", errors="replace"), model["calls"], model["errors"],
                    native_log.read_text(encoding="utf-8", errors="replace"))
        wait_for(lambda: audit(home), diagnostic=diagnostic)
        assert not (state / "processing.json").exists()
        assert not list(home.rglob("*.cfg"))
        wait_for(lambda: client.read_source_status(SESSION).get("embedding_error") == "embedding_unconfigured",
                 diagnostic=diagnostic)
        assert query(client, "missing-config") == "embedding_unconfigured"
        assert client.deliver_source_job(job) == receipt

        def reopen(current, after_stop=None):
            stop_worker_and_host(worker, current)
            if after_stop is not None:
                after_stop()
            fresh = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
            cleanup.callback(lambda: stop(fresh._process) if fresh._process is not None else None)
            fresh.attach(SESSION)
            fresh.attach_runtime(None)
            assert worker_command(worker, "start")["registered"] is True
            return fresh

        (state / "processing.json").write_text('{"config_path":"relative.cfg"}', encoding="utf-8")
        client = reopen(client)
        wait_for(lambda: query(client, "invalid-config") == "embedding_config_invalid", diagnostic=diagnostic)
        assert client.deliver_source_job(job) == receipt
        pointer = state / "processing.json"
        invalid_pointer = pointer.read_bytes()
        with pytest.raises(ContractError, match="embedding_path_outside_profile"):
            setup.configure_embedding(home, {"config_path": str(tmp_path / "outside.cfg")})
        assert pointer.read_bytes() == invalid_pointer
        processing = configure_embeddings(home, url, cli, dimensions=DIMENSIONS, select=False)
        assert setup.configure_embedding(home, {"config_path": str(processing)}) == {"embedding_error": None}
        client = reopen(client)

        wait_for(lambda: client.read_source_status(SESSION)["state"] == "complete", diagnostic=diagnostic)
        assert client.deliver_source_job(job) == receipt
        topology, binding = _dashboard_binding(client, SESSION)
        listed, cursor = _dashboard_exchange(client, topology, binding, "ui.memory_list", {
            "cursor": None, "limit": 10, "filters": {"query": "", "category": None,
                "memory_type": None, "lifecycle": None, "community_id": None}})
        assert listed["status"] == "ok" and cursor is None, listed
        assert len(listed["result"]["items"]) == 3
        for memory in listed["result"]["items"]:
            provenance, _ = _dashboard_exchange(client, topology, binding, "ui.provenance", {
                "memory_id": memory["memory_id"], "revision": memory["revision"]})
            assert provenance["status"] == "ok", provenance
            [source] = provenance["result"]["sources"]
            assert source["profile_namespace"] == PROFILE and source["session_id"] == SESSION
            assert source["message_uid"] in {"accepted", "appended", "traveler"}
        successful_query(client, "initial")
        schemas = {row["schema_name"] for row in model["calls"]}
        assert {"insomnia_authority_disposition_ledger", "insomnia_memory_wording",
                "dream_pair_classification", "dream_pair_verification", "entity_resolution",
                "entity_admission", "decision_response"} <= schemas, schemas
        assert {row["method"] for row in audit(home)} == {"acomplete_structured"}
        assert {"search_query", "search_document"} <= {
            row["input_type"] for row in model["embedding_calls"]}
        assert "embed" not in schemas
        assert model["large_reply"], "Switchboard handled the large provider response directly"
        [marker] = list((state / "embedding-identities-v1").glob("*.json"))
        original_marker = marker.read_bytes()
        identity = json.loads(original_marker)
        assert identity["dimensions"] == DIMENSIONS and identity["model"] == "fixture-embedding"
        assert identity["input_type_handling"] == "search_query_document" and identity["normalization"] == "none"
        # Keep the service alive independently while unloading its worker.
        client.attach_runtime(None)

        # The new selection deliberately emits identical vectors. Provenance, rather
        # than numeric probe equality, must prevent reuse, including after restart.
        configure_embeddings(home, url, cli, model="fixture-embedding-b", dimensions=DIMENSIONS)
        client = reopen(client)
        wait_for(lambda: client.read_source_status(SESSION).get("embedding_error") == "embedding_identity_stale",
                 diagnostic=diagnostic)
        assert query(client, "changed") == "embedding_identity_stale"
        assert marker.read_bytes() == original_marker
        assert client.deliver_source_job(job) == receipt
        restarted = reopen(client)
        wait_for(lambda: query(restarted, "restart-stale") == "embedding_identity_stale", diagnostic=diagnostic)
        assert restarted.deliver_source_job(job) == receipt
        configure_embeddings(home, url, cli, dimensions=DIMENSIONS)
        restarted = reopen(restarted)
        wait_for(lambda: isinstance(query(restarted, "restored"), dict), diagnostic=diagnostic)
        assert marker.read_bytes() == original_marker

        selection = home / "config.yaml"
        selection.write_text(selection.read_text(encoding="utf-8").replace("fixture-chat", "fixture-chat-v2"),
                             encoding="utf-8")
        wait_for(lambda: any(row.get("model") == "fixture-chat-v2" for row in audit(home)), diagnostic=diagnostic)
        wait_for(lambda: isinstance(query(restarted, "new-chat-model"), dict), diagnostic=diagnostic)
        assert marker.read_bytes() == original_marker

        # Chat and embeddings have separate credentials and cannot substitute for
        # one another. Neither revocation changes the durable vector identity.
        model["revoked"] = True
        assert isinstance(query(restarted, "revoked"), str)
        assert restarted.deliver_source_job(job) == receipt
        model["revoked"] = False
        successful_query(restarted, "renewed")
        assert marker.read_bytes() == original_marker
        model["embedding_revoked"] = True
        assert isinstance(query(restarted, "embedding-revoked"), str)
        assert restarted.deliver_source_job(job) == receipt
        model["embedding_revoked"] = False
        successful_query(restarted, "embedding-renewed")

        def source_documents():
            # Runtime reopen performs public compatibility probes, not reindexing.
            return [text for row in model["embedding_calls"] if row["input_type"] == "search_document"
                    for text in row["inputs"]
                    if any(TEXT[uid] in text for uid in ("accepted", "appended", "traveler"))]

        documents = source_documents()
        assert documents
        rotated = "synthetic-switchboard-embedding-key-rotated"
        model["embedding_key"] = rotated
        configure_embeddings(home, url, cli, dimensions=DIMENSIONS, key=rotated)
        restarted = reopen(restarted)
        wait_for(lambda: isinstance(query(restarted, "rotated-ready"), dict), diagnostic=diagnostic)
        successful_query(restarted, "rotated-key")
        assert marker.read_bytes() == original_marker
        assert source_documents() == documents
        assert restarted.deliver_source_job(job) == receipt

        # Existing vectors with no provenance marker are never silently adopted.
        restarted = reopen(restarted, marker.unlink)
        wait_for(lambda: query(restarted, "unbound") == "embedding_identity_unbound", diagnostic=diagnostic)
        assert not marker.exists()
        assert restarted.deliver_source_job(job) == receipt
        restarted = reopen(restarted, lambda: marker.write_bytes(original_marker))
        wait_for(lambda: isinstance(query(restarted, "marker-ready"), dict), diagnostic=diagnostic)
        successful_query(restarted, "marker-restored")
        assert worker_command(worker, "stop")["registered"] is False
        assert isinstance(query(restarted, "no-worker"), str)
        assert worker_command(worker, "start")["registered"] is True
        wait_for(lambda: isinstance(query(restarted, "reconnected"), dict), diagnostic=diagnostic)
        assert _dashboard_status(restarted, SESSION)["accepted_source_cursor"] == job.snapshot.snapshot_digest
        assert restarted.deliver_source_job(job) == receipt
        assert json.loads((state / "processing.json").read_text(encoding="utf-8")) == {
            "config_path": str(processing)}
        assert EMBEDDING_KEY not in (home / ".env").read_text(encoding="utf-8")
        assert rotated not in log.read_text(encoding="utf-8")
        assert EMBEDDING_KEY not in native_log.read_text(encoding="utf-8", errors="replace")


def test_embedding_routes_are_profile_local(tmp_path, binaries, inference_checkout):
    binary, cli = binaries
    with hosted_model(2) as (first_url, first_model), hosted_model(2) as (second_url, second_model), ExitStack() as cleanup:
        clients, homes, workers, jobs = [], [], [], []
        second_key = "synthetic-second-profile-embedding-key"
        second_model["embedding_key"] = second_key
        for index, url in enumerate((first_url, second_url)):
            home = tmp_path / f"profile-{index}"
            home.mkdir()
            homes.append(home)
            rel, phy = home / "main.rel", home / "active.phy"
            owner(cli, "rel", rel)
            owner(cli, "phy", phy)
            state = home / "reliquary"
            config(state, rel, phy, profile=PROFILE)
            save_settings(home, {"profile_id": PROFILE, "principal_id": PRINCIPAL,
                "main_rel": str(rel), "active_phy": str(phy), "binary": str(binary)})
            (home / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
            if index == 0:
                configure_embeddings(home, url, cli)
            client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
            clients.append(client)
            cleanup.callback(lambda client=client: stop(client._process) if client._process is not None else None)
            client.attach(SESSION)
            client.attach_runtime(None)
            workers.append(start_hermes_worker(home, inference_checkout, url, cleanup))
            outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
            job = _queue(outbox, ["accepted"])
            receipt = _when_ready(client, job)
            assert outbox.acknowledge(job, receipt)
            jobs.append((job, receipt))
        wait_for(lambda: clients[0].read_source_status(SESSION)["state"] == "complete")
        successful_query(clients[0], "first-profile")
        wait_for(lambda: clients[1].read_source_status(SESSION).get("embedding_error") == "embedding_unconfigured")
        assert query(clients[1], "no-profile-fallback") == "embedding_unconfigured"
        assert not second_model["embedding_calls"]
        assert clients[1].deliver_source_job(jobs[1][0]) == jobs[1][1]
        stop_worker_and_host(workers[1], clients[1])
        configure_embeddings(homes[1], second_url, cli, model="second-profile-embedding", key=second_key)
        second = HostClient(homes[1] / "reliquary", PROFILE, PRINCIPAL, TOKEN, binary=binary)
        cleanup.callback(lambda: stop(second._process) if second._process is not None else None)
        second.attach(SESSION)
        second.attach_runtime(None)
        assert worker_command(workers[1], "start")["registered"] is True
        wait_for(lambda: second.read_source_status(SESSION)["state"] == "complete")
        successful_query(second, "second-profile")
        successful_query(clients[0], "first-profile-still-isolated")
        assert {row["model"] for row in first_model["embedding_calls"]} == {"fixture-embedding"}
        assert {row["model"] for row in second_model["embedding_calls"]} == {"second-profile-embedding"}
        assert second.deliver_source_job(jobs[1][0]) == jobs[1][1]


@pytest.mark.parametrize("committed_removals", [False, True], ids=["legacy", "committed"])
def test_native_jev_observation_is_disclosed_with_copied_evidence_after_restart(
        tmp_path, binaries, inference_checkout, monkeypatch, request, committed_removals):
    binary, cli = binaries
    if committed_removals:
        # This regression needs the separately pinned committed-removal authority;
        # stock 0.23.4 supplies inference but does not expose that lifecycle API.
        checkout = request.getfixturevalue("removal_checkout")
        monkeypatch.syspath_prepend(str(checkout))
        import hermes_state

        assert Path(hermes_state.__file__).resolve().parent == checkout
        session_db = hermes_state.SessionDB
    home = tmp_path / "profiles" / "hermes-profile"
    home.mkdir(parents=True)
    rel, phy = tmp_path / "general.rel", tmp_path / "active.phy"
    state = home / "reliquary"
    for role, path in (("main_rel", rel), ("active_phy", phy)):
        created = subprocess.run([str(binary), "setup-create", "--state-dir", str(state)],
            input=canonical({"role": role, "path": str(path)}), capture_output=True, timeout=10)
        assert created.returncode == 0, created.stderr
        report = decode(created.stdout)
        assert report["accepted"] and report["opened"]
        if role == "main_rel":
            owner_id = report["owner_id"]
    phy_bytes = phy.read_bytes()
    config(state, rel, phy, profile=PROFILE)
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    (home / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\nJEV_API_KEY={NATIVE_DECISION_KEY}\n", encoding="utf-8")
    source = TEXT["accepted"]
    claim = "The Lantern release uses an amber checklist."
    paraphrase = "Deployment follows golden procedures."
    distractor = "Lantern records backup evidence separately."
    unrelated_query = "Maritime forecast"
    challenge = "Lantern release excludes the amber checklist."
    monkeypatch.setitem(TEXT, "appended", distractor)
    monkeypatch.setitem(TEXT, "challenge", challenge)
    # The fixture grounds the named tool at the start of every copied row.
    monkeypatch.setitem(TEXT, "fresh", "Lantern requires a weekly smoke test for Orchid backups.")
    outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
    profile_key = PROFILE.encode("ascii")
    conversation = "hermes-copy:" + sha256(b"reliquary/hermes-copied-conversation/v1\0"
                                            + len(profile_key).to_bytes(8, "little")
                                            + profile_key + SESSION.encode("ascii")).hexdigest()

    def append_source(db, uid, position):
        return db.append_message(SESSION, "user", TEXT[uid], message_uid=uid,
                                 timestamp=1700000000.25 + position)

    if committed_removals:
        with session_db(home / "state.db") as db:
            db.create_session(SESSION, source="cli")
            append_source(db, "accepted", 0)
            append_source(db, "appended", 1)
    query_terms = set(re.findall(r"[^\W_]+", paraphrase.casefold()))
    assert query_terms.isdisjoint(re.findall(r"[^\W_]+", f"{claim} {source}".casefold()))

    embedded = set()

    def embed(text):
        embedded.add(text)
        return [0.0, 1.0] if text == unrelated_query else [1.0, 0.0]

    review_requested = Event()
    defer_review = True

    def decide(request):
        decision = native_reply(request, challenge=challenge)
        state = request["state"]
        if (defer_review and "verify" in request["questions"] and state["claim"] == claim
                and any(row["text"] == challenge for row in state["backcheck_hits"])):
            review_requested.set()
            return {"answers": {}}
        return decision

    with hosted_model(2, perception=(source, claim), embed=embed, decide=decide) as (url, model), ExitStack() as cleanup:
        configure_embeddings(home, url, cli)
        client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        cleanup.callback(lambda: stop(client._process) if client._process is not None else None)
        client.attach(SESSION)
        worker = start_hermes_worker(home, inference_checkout, url, cleanup)
        def diagnostic():
            log = (home / "hosted-worker.log").read_text(encoding="utf-8", errors="replace")
            return log, model["calls"], model["native_calls"], model["errors"]

        job = _queue(outbox, ["accepted", "appended"])
        assert outbox.acknowledge(job, _when_ready(client, job))
        wait_for(lambda: client.read_source_status(SESSION)["state"] == "complete", diagnostic=diagnostic)
        memory = _copied_memories(client)["accepted"]
        assert model["native_calls"] == []
        assert worker_command(worker, "stop")["registered"] is False
        discovery = state / "discovery.json"
        wait_for(lambda: not discovery.exists(), diagnostic=diagnostic)

        # The plugin starts the configured host and verifies a claim from the
        # settled copied source before any session attaches or asks for recall.
        selection = home / "config.yaml"
        with selection.open("a", encoding="utf-8") as config_file:
            config_file.write("reliquary:\n  perception:\n"
                              f"    decisions_url: {url}/decisions\n"
                              "    credential_env: JEV_API_KEY\n")
        assert worker_command(worker, "start")["registered"] is True
        wait_for(lambda: any(call["state"].get("claim") == claim for call in model["native_calls"]),
                 diagnostic=diagnostic)

        # An empty approved Memory selection must still deliver the exact
        # Observation and its evidence, with the same identity after a clean reopen.
        model["approve_memories"] = False
        turns = count()
        reader = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        reader.attach(SESSION)

        def observation_query():
            result = query(reader, f"perception-{next(turns)}", paraphrase)
            return result if isinstance(result, dict) and result.get("observations") else None

        before = wait_for(observation_query, diagnostic=diagnostic)
        [observation] = before["observations"]
        first_instance = reader._read_discovery().instance_id
        assert before["memory_ids"] == []
        assert observation["owner_id"] == owner_id and observation["claim"] == claim
        assert observation["revision"] == 1
        assert observation["status"] == "Observed" and observation["time_scope"] == "Current"
        assert claim in before["context"]
        [evidence] = observation["evidence"]
        [lineage] = observation["lineage"]
        assert evidence["owner_id"] == owner_id and evidence["source_kind"] == "memory"
        assert evidence["source_id"] == lineage["memory_id"] == memory["memory_id"]
        assert evidence["revision"] == lineage["revision"] == int(memory["revision"])
        assert evidence["body_id"] == lineage["body_id"] == memory["body_id"]
        assert evidence["field"] == "Content"
        assert (evidence["start_byte"], evidence["end_byte"]) == (0, len(source.encode("utf-8")))
        assert lineage["source_snapshot_digests"] == [job.snapshot.snapshot_digest]
        citation = f"memory {owner_id}/{memory['memory_id']} revision {memory['revision']}"
        assert f"{citation}, Content bytes 0–{len(source.encode('utf-8'))}" in before["context"]

        assert worker_command(worker, "stop")["registered"] is False
        wait_for(lambda: not discovery.exists(), diagnostic=diagnostic)
        assert worker_command(worker, "start")["registered"] is True
        wait_for(discovery.exists, diagnostic=diagnostic)
        reader = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        reader.attach(SESSION)
        assert reader._read_discovery().instance_id != first_instance
        after = wait_for(observation_query, diagnostic=diagnostic)
        assert after["memory_ids"] == [] and after["observations"] == [observation]
        assert sum(call["state"].get("claim") == claim for call in model["native_calls"]) == 1

        def inspect_durable_turn(uid):
            nonlocal reader
            # The standalone reader needs the owner lease released on Windows.
            assert worker_command(worker, "stop")["registered"] is False
            wait_for(lambda: not discovery.exists(), diagnostic=diagnostic)
            turn = _turn(cli, rel, conversation, uid)
            assert worker_command(worker, "start")["registered"] is True
            wait_for(discovery.exists, diagnostic=diagnostic)
            reader = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
            reader.attach(SESSION)
            wait_for(lambda: isinstance(query(reader, f"cli-reopen-{next(turns)}", paraphrase), dict),
                     diagnostic=diagnostic)
            return turn

        if committed_removals:
            with session_db(home / "state.db") as db:
                assert db.set_session_archived(SESSION, True)
                reconcile_removals(outbox, home)
                assert outbox.next_job() is None
                archived = successful_query(reader, "perception-archived", paraphrase)
                assert memory["memory_id"] in archived["memory_ids"]
                assert archived["observations"] == [observation]
                assert _copied_memory_detail(reader, memory)["provenance"][0]["message_uid"] == "accepted"
                if cli:
                    assert inspect_durable_turn("accepted")["availability"] == "available"
                assert db.set_session_archived(SESSION, False)
                challenge_row = append_source(db, "challenge", 2)

        # Core publishes Pending before routing the challenge to review Verify.
        # Leave that review unresolved while the same signed query retrieves a Memory.
        changed = _queue(outbox, ["accepted", "appended", "challenge"])
        assert outbox.acknowledge(changed, _when_ready(reader, changed))
        wait_for(review_requested.is_set, diagnostic=diagnostic)
        assert any(call["state"].get("existing_observation") == claim
            and challenge in call["state"]["evidence_hits"].values() for call in model["native_calls"])
        pending = successful_query(reader, "perception-pending-review", paraphrase)
        assert memory["memory_id"] in pending["memory_ids"]
        assert not pending.get("observations") and claim not in pending["context"]

        # Retry the review in a fresh host before testing a delayed disclosure.
        defer_review = False
        model["approve_memories"] = False
        assert worker_command(worker, "stop")["registered"] is False
        wait_for(lambda: not discovery.exists(), diagnostic=diagnostic)
        assert worker_command(worker, "start")["registered"] is True
        wait_for(discovery.exists, diagnostic=diagnostic)
        reader = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        reader.attach(SESSION)
        wait_for(observation_query, diagnostic=diagnostic)
        if committed_removals:
            withdrawn = _copied_memories(reader)["challenge"]
            assert _copied_memory_detail(reader, withdrawn)["provenance"][0]["message_uid"] == "challenge"
            assert reader.prepare_retrieval(query_request("perception-before-rewind", paraphrase))
            with session_db(home / "state.db") as db:
                assert db.rewind_to_message(SESSION, challenge_row)["rewound_count"] == 1
            reconcile_removals(outbox, home)
            rewind = outbox.next_job(SESSION)
            assert rewind.kind == "rewind"
            assert decode(rewind.removal_json)["removed_message_uids"] == ["challenge"]
            receipt = _when_ready(reader, rewind)
            # Drop the acknowledgment, restart the host, and replay the exact
            # local job. Core must return the same receipt and cut.
            assert worker_command(worker, "stop")["registered"] is False
            wait_for(lambda: not discovery.exists(), diagnostic=diagnostic)
            if cli:
                assert _turn(cli, rel, conversation, "challenge")["content"] is None
                assert _turn(cli, rel, conversation, "accepted")["content"] == source
            assert worker_command(worker, "start")["registered"] is True
            wait_for(discovery.exists, diagnostic=diagnostic)
            reader = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
            reader.attach(SESSION)
            outbox = SourceOutbox(state, PROFILE, PRINCIPAL)
            reconcile_removals(outbox, home)
            assert outbox.next_job(SESSION) == rewind
            assert _when_ready(reader, rewind) == receipt
            assert outbox.acknowledge(rewind, receipt)
            assert outbox.next_job() is None
            _copied_memory_detail(reader, withdrawn, removed=True)
            assert _copied_memory_detail(reader, memory)["body"]["content"] == source
            model["approve_memories"] = True
            retained = successful_query(reader, "perception-after-rewind", paraphrase)
            assert memory["memory_id"] in retained["memory_ids"] and challenge not in retained["context"]
            with session_db(home / "state.db") as db:
                append_source(db, "fresh", 2)
            extension = _queue(outbox, ["accepted", "appended", "fresh"])
            assert outbox.acknowledge(extension, _when_ready(reader, extension))
            def extension_settled():
                status = reader.read_source_status(SESSION)
                return status["state"] == "complete" and status["snapshot_digest"] == extension.snapshot.snapshot_digest

            wait_for(extension_settled, diagnostic=diagnostic)
            fresh = wait_for(lambda: _copied_memories(reader).get("fresh"), diagnostic=diagnostic)
            assert _copied_memory_detail(reader, fresh)["provenance"][0]["message_uid"] == "fresh"
            if cli:
                assert inspect_durable_turn("fresh")["content"] == TEXT["fresh"]

        assert reader.prepare_retrieval(query_request("perception-before-deletion", paraphrase))
        if committed_removals:
            with session_db(home / "state.db") as db:
                assert db.set_session_archived(SESSION, True)
                assert db.delete_session(SESSION)
            reconcile_removals(outbox, home)
        else:
            outbox.terminal(SESSION, "delete")
        terminal = outbox.next_job(SESSION)
        assert terminal.kind == "terminal" and terminal.reason == "delete"
        assert outbox.acknowledge(terminal, _when_ready(reader, terminal))
        rejected = query(reader, "perception-before-deletion", paraphrase)
        assert isinstance(rejected, str) and rejected in {
            "source_terminal", "no_recall_results", "retrieval_cut_stale", "unavailable",
        }, rejected
        if committed_removals:
            _copied_memory_detail(reader, memory, removed=True)
            _copied_memory_detail(reader, fresh, removed=True)
        assert phy.read_bytes() == phy_bytes
        assert NATIVE_DECISION_KEY not in (home / "hosted-worker.log").read_text(encoding="utf-8")
        assert worker_command(worker, "stop")["registered"] is False
        wait_for(lambda: not discovery.exists(), diagnostic=diagnostic)
        if committed_removals and cli:
            assert all(_turn(cli, rel, conversation, uid)["content"] is None
                       for uid in ("accepted", "appended", "challenge", "fresh"))


@pytest.mark.parametrize("pending", [False, True])
def test_native_active_phy_observation_uses_ordinary_mixed_recall(
        tmp_path, inference_checkout, monkeypatch, pending):
    directory = os.environ.get("HP_PHY_RECALL_FIXTURE_DIR")
    if not directory:
        pytest.skip("Set HP_PHY_RECALL_FIXTURE_DIR to the disposable Core mixed-recall fixture")
    fixture = Path(directory)
    host = os.environ.get("HP03_HOST_BINARY")
    if not host:
        pytest.skip("Set HP03_HOST_BINARY for native host recall verification")
    binary = Path(host).resolve(strict=True)
    monkeypatch.syspath_prepend(str(inference_checkout))
    rel, phy = tmp_path / "mixed.rel", tmp_path / "active.phy"
    copyfile(fixture / "mixed.rel", rel)
    copyfile(fixture / ("pending.phy" if pending else "current.phy"), phy)
    home = tmp_path / "profile"
    home.mkdir()
    state = home / "reliquary"
    config(state, rel, phy, profile=PROFILE)
    save_settings(home, {"profile_id": PROFILE, "principal_id": PRINCIPAL,
        "main_rel": str(rel), "active_phy": str(phy), "binary": str(binary)})
    (home / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
    original_phy = sha256(phy.read_bytes()).digest()

    with hosted_model(DIMENSIONS) as (url, _), ExitStack() as cleanup:
        client = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        cleanup.callback(lambda: stop(client._process) if client._process is not None else None)
        client.attach(SESSION)
        start_hermes_worker(home, inference_checkout, url, cleanup, dimensions=DIMENSIONS)
        attempts = count()

        def ordinary(limit=10):
            request = decode(query_request(f"phy-{next(attempts)}", "needle zephyr"))
            request["arguments"]["limit"] = limit
            try:
                response = client.request(canonical(request), recall_tool=True)
            except HostUnavailable as error:
                return str(error)
            result = decode(response.result_json)
            return result if response.status == "ok" else result["code"]

        def recalled():
            result = ordinary()
            return result if isinstance(result, dict) else None

        result = wait_for(recalled, diagnostic=lambda: audit(home))
        memory_hits = [hit for hit in result["ranked"] if hit["kind"] == "memory"]
        assert len(memory_hits) == 2, result
        assert len({hit["owner_id"] for hit in memory_hits}) == 2
        assert len({hit["id"] for hit in memory_hits}) == 1
        assert len({hit["body_id"] for hit in memory_hits}) == 2
        assert {(row["owner_id"], row["memory_id"]) for row in result["provenance"]} == {
            (hit["owner_id"], hit["id"]) for hit in memory_hits
        }
        if pending:
            assert not result.get("observations") and "Zephyr delivery was approved." not in result["context"]
        else:
            [claim] = result["observations"]
            [ranked_claim] = [hit for hit in result["ranked"] if hit["kind"] == "observation"]
            [private] = [hit for hit in memory_hits if hit["owner_id"] == claim["owner_id"]]
            assert ranked_claim["owner_id"] == claim["owner_id"]
            assert ranked_claim["id"] == claim["observation_id"]
            assert all(reference["owner_id"] == private["owner_id"] for reference in claim["evidence"])
            assert claim["claim"] == "Zephyr delivery was approved."
        limited = ordinary(limit=1)
        assert isinstance(limited, dict) and len(limited["ranked"]) == 1, limited
        forged = decode(query_request("wrong-principal", "needle zephyr"))
        forged["principal_id"] = "another-principal"
        discovery = client._read_discovery()
        assert discovery is not None
        denied = decode(client._exchange(
            discovery, "/v1/retrieval/tool", canonical(forged), monotonic() + 5))
        assert denied["status"] == "denied" and denied["result"]["code"] == "denied"
    assert sha256(phy.read_bytes()).digest() == original_phy
