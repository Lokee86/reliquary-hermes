"""Real registered Hermes ctx.llm, native broker, Root processing and durable replay."""

from contextlib import ExitStack
import json
import subprocess
from shutil import copyfile
from time import monotonic, sleep

from hosted_hermes_worker import configure_hermes, start_hermes_worker, worker_command
from hosted_inference_probe import hosted_model
from reliquary_hermes import client as client_module
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import TOKEN_VAR, save_settings
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN
from test_hp03_host import binaries as binaries
from test_hp03_host import config, owner, stop
from test_hp04_host import PRINCIPAL, PROFILE, SESSION, TEXT, _queue, _when_ready
from test_hp05_retrieval import _dashboard_binding, _dashboard_exchange, _dashboard_status


DIMENSIONS = 20000


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


def query(client, turn):
    raw = canonical({"protocol_version": 1, "request_id": "query-" + turn,
        "operation": "memory_query", "profile_id": PROFILE, "principal_id": PRINCIPAL,
        "session_id": SESSION, "turn_id": turn, "expected_revision": None,
        "idempotency_key": None, "arguments": {"query": "amber checklist", "limit": 10}})
    try:
        response = client.request(raw, recall_tool=True)
    except HostUnavailable as error:
        return str(error)
    if response.status != "ok":
        return decode(response.result_json)["code"]
    return decode(response.result_json)


def successful_query(client, turn):
    result = query(client, turn)
    assert isinstance(result, dict) and result["memory_ids"], result
    assert result["provenance"] and result["context"]
    return result


def test_real_hermes_hosted_inference_processing_recall_identity_and_restart(
        tmp_path, binaries, inference_checkout, monkeypatch):
    binary, cli = binaries
    # Acceptance operates on copies, never installed owners or the user's profile.
    seed_rel, seed_phy = tmp_path / "seed.rel", tmp_path / "seed.phy"
    owner(cli, "rel", seed_rel, "unspecified")
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
        worker = start_hermes_worker(home, inference_checkout, url, cleanup, dimensions=DIMENSIONS)
        log = home / "hosted-worker.log"
        def diagnostic():
            return (log.read_text(encoding="utf-8", errors="replace"), model["calls"], model["errors"],
                    native_log.read_text(encoding="utf-8", errors="replace"))
        wait_for(lambda: any(row.get("dimensions") == DIMENSIONS for row in audit(home)), diagnostic=diagnostic)
        assert not (state / "processing.json").exists()
        assert not list(home.rglob("*.cfg"))

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
        calls = audit(home)
        assert {"query", "document"} <= {row.get("input_type") for row in calls}
        assert model["large_reply"], "real vector results must cross the 256-KiB wire boundary"
        [marker] = list((state / "embedding-identities-v1").glob("*.json"))
        original_marker = marker.read_bytes()
        identity = json.loads(original_marker)
        assert identity["dimensions"] == DIMENSIONS and identity["model"] == "fixture-embedding"
        assert identity["input_type_handling"] == "shared" and identity["normalization"] == "none"
        # Keep the service alive independently while deliberately unloading its
        # inference worker. Processing above ran with only the worker's lease.
        client.attach_runtime(None)

        # The new selection deliberately emits identical vectors. Provenance, rather
        # than numeric probe equality, must prevent reuse, including after restart.
        configure_hermes(home, url, embedding_model="fixture-embedding-b", dimensions=DIMENSIONS)
        wait_for(lambda: any(row.get("model") == "fixture-embedding-b" for row in audit(home)), diagnostic=diagnostic)
        wait_for(lambda: client.read_source_status(SESSION).get("embedding_error") == "embedding_identity_stale",
                 diagnostic=diagnostic)
        assert query(client, "changed") == "embedding_identity_stale"
        assert marker.read_bytes() == original_marker
        assert client.deliver_source_job(job) == receipt
        assert worker_command(worker, "stop")["registered"] is False
        stop(client._process)
        restarted = HostClient(state, PROFILE, PRINCIPAL, TOKEN, binary=binary)
        cleanup.callback(lambda: stop(restarted._process) if restarted._process is not None else None)
        restarted.attach(SESSION)
        restarted.attach_runtime(None)
        assert worker_command(worker, "start")["registered"] is True
        wait_for(lambda: query(restarted, "restart-stale") == "embedding_identity_stale", diagnostic=diagnostic)
        assert restarted.deliver_source_job(job) == receipt
        configure_hermes(home, url, dimensions=DIMENSIONS)
        wait_for(lambda: isinstance(query(restarted, "restored"), dict), diagnostic=diagnostic)
        assert marker.read_bytes() == original_marker

        # Authentication remains Hermes-owned. A provider-side revocation cannot
        # fall back to a Reliquary credential, and recovery retains vector identity.
        model["revoked"] = True
        assert isinstance(query(restarted, "revoked"), str)
        assert restarted.deliver_source_job(job) == receipt
        model["revoked"] = False
        successful_query(restarted, "renewed")
        assert marker.read_bytes() == original_marker
        assert worker_command(worker, "stop")["registered"] is False
        assert isinstance(query(restarted, "no-worker"), str)
        assert worker_command(worker, "start")["registered"] is True
        wait_for(lambda: isinstance(query(restarted, "reconnected"), dict), diagnostic=diagnostic)
        assert _dashboard_status(restarted, SESSION)["accepted_source_cursor"] == job.snapshot.snapshot_digest
        assert restarted.deliver_source_job(job) == receipt
        assert not (state / "processing.json").exists() and not list(home.rglob("*.cfg"))
