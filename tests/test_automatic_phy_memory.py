"""Automatic PHY publication through the signed copied-source and ordinary Hermes paths."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
from shutil import copy2, copytree, ignore_patterns
import subprocess
import sys
from time import time

import pytest

from hosted_hermes_worker import configure_hermes, start_hermes_worker, worker_command
from hosted_inference_probe import hosted_model, reply
from reliquary_hermes import capture_policy, source_capture
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import TOKEN_VAR, save_settings
from reliquary_hermes.validation import canonical, decode
from test_host_client import TOKEN
from test_hosted_inference_e2e import wait_for
from test_hp03_host import config, stop
from test_hp04_host import PRINCIPAL, PROFILE, SESSION, _when_ready

PROJECT = "Lantern uses the amber checklist."
PERSONAL = "I prefer peppermint tea."
PROMPT = PROJECT + " " + PERSONAL
RESPONSE = "I have the Lantern checklist and your preference."


def _answer(request):
    name, payload = request["schema_name"], request["payload"]
    if name == "insomnia_authority_disposition_ledger":
        def retain(quote, category, kind):
            return {"disposition": "retain", "authority_kind": "direct", "category": category,
                    "type": kind, "lifecycle": "current", "proposition": quote,
                    "authority_source_node_id": "", "grounding_source_node_id": "",
                    "reason": "direct assertion"}

        turns = {uid: [] for uid in request["schema"]["properties"]["turns"]["required"]}
        for row in payload["turns"]:
            if row["id"] in turns and PROMPT in row["content"]:
                turns[row["id"]] = [retain(PROJECT, "fact", "project"),
                                    retain(PERSONAL, "preference", "communication")]
        return {"turns": turns, "evidence_requests": []}
    if name == "insomnia_memory_ownership":
        return {"ownership": {row["group_id"]: (
            "user" if row["category"] == "preference" else "project") for row in payload["synthesis_groups"]}}
    if name == "insomnia_memory_wording":
        candidates = []
        for row in payload["synthesis_groups"]:
            quote, = row["propositions"]
            candidates.append({
                "authority_kind": "direct", "category": row["category"], "memory_type": row["type"],
                "temporal_status": "current", "ownership": row["ownership"],
                "title": quote, "content": quote, "source_node_id": row["source_node_id"],
                "source_quote": quote, "authority_source": None, "grounding_source": None,
                "routing_mentions": [],
            })
        return {"candidates": candidates}
    return reply(request, ("", "")) if name == "dream_pair_classification" else reply(request)


@pytest.fixture
def automatic_profile(tmp_path, monkeypatch):
    value = os.environ.get("HP03_HOST_BINARY")
    if not value:
        pytest.skip("Set HP03_HOST_BINARY to the native integration host")
    binary = Path(value).resolve(strict=True)
    # The signed fixture supplies the same private witness as the patched
    # Hermes path. The separate live case obtains it from Hermes itself.
    monkeypatch.setattr(capture_policy, "history_supported", lambda: True)
    monkeypatch.setattr(source_capture, "turn_attribution_supported", lambda: True)
    home = tmp_path / "profile"
    home.mkdir()
    state = home / "reliquary"

    def create(role, name):
        path = tmp_path / name
        run = subprocess.run([str(binary), "setup-create", "--state-dir", str(state)],
                             input=canonical({"role": role, "path": str(path)}),
                             capture_output=True, timeout=20)
        assert run.returncode == 0, run.stderr.decode(errors="replace")
        result = decode(run.stdout)
        assert result["opened"], result
        return path, result["owner_id"]

    rel, rel_id = create("main_rel", "shared.rel")
    phy, phy_id = create("active_phy", "original.phy")
    other_phy, other_id = create("active_phy", "other.phy")
    config(state, rel, phy, profile=PROFILE)
    save_settings(home, {"profile_id": PROFILE, "principal_id": PRINCIPAL,
                         "main_rel": str(rel), "active_phy": str(phy), "binary": str(binary)})
    (home / ".env").write_text(f"{TOKEN_VAR}={TOKEN}\n", encoding="utf-8")
    return home, binary, rel_id, phy, phy_id, other_phy, other_id


def _client(home, binary):
    return HostClient(home / "reliquary", PROFILE, PRINCIPAL, TOKEN, binary=binary)


def _queued(home, session, mode):
    queue = SourceOutbox(home / "reliquary", PROFILE, PRINCIPAL)
    labels = {
        "owner": None, "unknown": None, "legacy": None,
        "bot": {"id": PRINCIPAL, "is_bot": True},
        "foreign": {"id": "another-human", "is_bot": False},
    }
    now = time()
    snapshot = source_capture.capture_snapshot(
        PROFILE, session,
        [{"message_uid": "original-user-row", "role": "user", "timestamp": now, "content": PROMPT},
         {"message_uid": "response-row", "role": "assistant", "timestamp": now + 1, "content": RESPONSE}],
        source_turn=({"message_uid": "original-user-row", "profile_owner": mode == "owner"}
                     if mode != "legacy" else None),
        turn_author=labels[mode], principal_id=PRINCIPAL,
    )
    queue.enqueue(snapshot, generation=0)
    return queue, queue.next_job(session)


def test_outbox_retains_only_the_exact_completed_turn_witness(tmp_path, monkeypatch):
    monkeypatch.setattr(source_capture, "turn_attribution_supported", lambda: True)
    state = tmp_path / "reliquary"
    state.mkdir()
    rows = [
        {"message_uid": uid, "role": role, "timestamp": stamp, "content": "Repeated prompt"}
        for uid, role, stamp in [
            ("older-user", "user", 1), ("older-response", "assistant", 2),
            ("current-user", "user", 3), ("current-response", "assistant", 4),
        ]
    ]
    snapshot = source_capture.capture_snapshot(
        PROFILE, SESSION, rows, principal_id=PRINCIPAL,
        source_turn={"message_uid": "current-user", "profile_owner": True},
    )
    queue = SourceOutbox(state, PROFILE, PRINCIPAL)
    receipt_key = queue.enqueue(snapshot, generation=0)
    replay = SourceOutbox(state, PROFILE, PRINCIPAL).next_job(SESSION)
    assert replay.idempotency_key == receipt_key
    copied = decode(replay.snapshot_json)
    assert copied["turn_author"] == {
        "message_uid": "current-user", "id": PRINCIPAL, "is_bot": False, "profile_owner": True,
    }
    assert all(row["author"] == {"id": None, "is_bot": None} for row in copied["messages"])
    without_proof = source_capture.capture_snapshot(
        PROFILE, SESSION, rows, principal_id=PRINCIPAL,
        source_turn={"message_uid": "older-response", "profile_owner": True},
    )
    assert without_proof.turn_author_json is None


def _query(client, session, turn):
    request = canonical({"protocol_version": 1, "request_id": turn,
                         "operation": "memory_query", "profile_id": PROFILE, "principal_id": PRINCIPAL,
                         "session_id": session, "turn_id": turn, "expected_revision": None,
                         "idempotency_key": None, "arguments": {"query": "amber checklist peppermint tea", "limit": 5}})
    try:
        result = client.request(request, recall_tool=True)
    except HostUnavailable as error:
        return {"code": str(error)}
    return decode(result.result_json)


def _assert_mixed(result, rel, phy):
    assert "context" in result, result
    assert PROJECT in result["context"] and PERSONAL in result["context"], result
    assert len(result["memory_ids"]) == 2
    assert {(item["owner_id"], item.get("source_principal_id")) for item in result["provenance"]} == {
        (rel, PRINCIPAL), (phy, PRINCIPAL),
    }
    assert all(item["source_snapshot_digests"] for item in result["provenance"])


def test_signed_automatic_phy_copy_stays_bound_across_switch_and_reopen(
        automatic_profile, inference_checkout):
    home, binary, rel, phy_path, phy, other_path, other = automatic_profile
    original_other_bytes = other_path.read_bytes()
    with hosted_model(2, complete=_answer) as (url, _model), ExitStack() as cleanup:
        client = _client(home, binary)
        client.attach(SESSION)
        cleanup.callback(stop, client._process)
        client.attach_runtime(SESSION)
        queue, job = _queued(home, SESSION, "owner")

        def switch(path):
            review = client.switch_review({"active_phy": str(path)})
            client.switch_apply(review)

        # The first delivery happens after switching. Its durable session
        # binding already points to the original PHY.
        switch(other_path)
        assert client.attach("other-chat").user_id == other
        with pytest.raises(HostUnavailable, match="phy_inactive"):
            client.deliver_source_job(job)
        switch(phy_path)
        receipt = _when_ready(client, job)
        assert queue.acknowledge(job, receipt)
        assert client.read_source_status(SESSION)["state"] != "complete"

        # Process from the recorded receipt on a new service, after another
        # chat attaches. Restore the same owner, then register the worker.
        client.detach_runtime()
        stop(client._process)
        reader = _client(home, binary)
        reader.attach("next-chat")
        cleanup.callback(stop, reader._process)
        reader.attach_runtime("next-chat")
        worker = start_hermes_worker(home, inference_checkout, url, cleanup)
        wait_for(lambda: reader.read_source_status(SESSION)["state"] == "complete",
                 diagnostic=lambda: reader.read_source_status(SESSION))
        after = _query(reader, "next-chat", "first-recall")
        _assert_mixed(after, rel, phy)

        reader.detach_runtime()
        assert worker_command(worker, "stop")["registered"] is False
        wait_for(lambda: not (home / "reliquary" / "discovery.json").exists())
        # Discovery can disappear before the former host releases the owner leases.
        assert reader._process.wait(timeout=10) == 0
        again = _client(home, binary)
        again.attach(SESSION)
        cleanup.callback(stop, again._process)
        again.attach_runtime(SESSION)
        assert worker_command(worker, "start")["registered"] is True
        reopened = wait_for(lambda: (
            result if "context" in (result := _query(again, SESSION, "reopened-recall")) else None))
        _assert_mixed(reopened, rel, phy)
        assert set(reopened["memory_ids"]) == set(after["memory_ids"])
        assert again.deliver_source_job(job) == receipt
        assert other_path.read_bytes() == original_other_bytes


@pytest.mark.parametrize("mode", ["legacy", "unknown", "bot", "foreign"])
def test_signed_unverified_personal_memory_is_held(automatic_profile, inference_checkout, mode):
    home, binary, _rel, phy_path, _phy, _other_path, _other = automatic_profile
    original = phy_path.read_bytes()
    with hosted_model(2, complete=_answer) as (url, _model), ExitStack() as cleanup:
        client = _client(home, binary)
        client.attach(SESSION)
        cleanup.callback(stop, client._process)
        client.attach_runtime(SESSION)
        queue, job = _queued(home, SESSION, mode)
        assert queue.acknowledge(job, _when_ready(client, job))
        start_hermes_worker(home, inference_checkout, url, cleanup)
        wait_for(lambda: client.read_source_status(SESSION).get("diagnostic")
                 == "source_personal_attribution_unverified",
                 diagnostic=lambda: client.read_source_status(SESSION))
        result = _query(client, SESSION, "held-recall")
        assert PERSONAL not in result.get("context", ""), result
    assert phy_path.read_bytes() == original


def test_ordinary_hermes_chat_publishes_both_memories(automatic_profile):
    checkout = os.environ.get("HP_PHY_ATTRIBUTION_HERMES_CHECKOUT")
    if not checkout:
        pytest.skip("Set HP_PHY_ATTRIBUTION_HERMES_CHECKOUT to the Hermes checkout with both capture patches")
    checkout = Path(checkout).resolve(strict=True)
    home, binary, rel, _phy_path, phy, _other_path, _other = automatic_profile
    plugin = home / "plugins" / "reliquary"
    plugin.mkdir(parents=True)
    package = Path(__file__).resolve().parents[1]
    for name in ("__init__.py", "plugin.yaml"):
        copy2(package / name, plugin / name)
    copytree(package / "src" / "reliquary_hermes", plugin / "src" / "reliquary_hermes",
             ignore=ignore_patterns("__pycache__"))
    state = home / "reliquary"
    (state / capture_policy.ENROLLMENT_FILE).write_bytes(canonical({"version": 1, "cutoff": time() - 30}))
    environment = {key: value for key, value in os.environ.items() if not key.startswith("HERMES_")}
    environment.update(HERMES_HOME=str(home), PYTHONPATH=str(checkout), PYTHONDONTWRITEBYTECODE="1")
    hermes = [sys.executable, "-B", "-m", "hermes_cli.main"]

    with hosted_model(2, complete=_answer, chat=RESPONSE) as (url, model), ExitStack() as cleanup:
        reader = _client(home, binary)
        cleanup.callback(reader.cancel_startup)
        reader.connect_dashboard(None)
        reader.attach_runtime(None)
        configure_hermes(home, url)
        settings = home / "config.yaml"
        with settings.open("a", encoding="utf-8") as stream:
            stream.write("plugins:\n  enabled: [reliquary]\n"
                         "memory:\n  provider: reliquary\n  memory_enabled: false\n"
                         "  user_profile_enabled: false\n")
        stop_gateway = """
from gateway.status import terminate_pid
from hermes_cli.gateway_profile_lifecycle import owned_gateway_pid
if (pid := owned_gateway_pid()) is not None:
    terminate_pid(pid, force=False)
"""
        cleanup.callback(subprocess.run, [sys.executable, "-B", "-c", stop_gateway],
                         cwd=home, env=environment, capture_output=True, timeout=30)
        live = subprocess.run([*hermes, "chat", "-q", PROMPT, "--quiet", "--max-turns", "3"],
                              cwd=home, env=environment, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=85)
        assert live.returncode == 0 and RESPONSE in live.stdout, (live.stdout, live.stderr, model["calls"])
        [route] = list((state / "sessions-v1").glob("*.json"))
        session = json.loads(route.read_bytes())["session_id"]
        def diagnostic():
            log = home / "logs" / "gateway.log"
            return (reader.read_source_status(session), live.stdout, live.stderr,
                    log.read_text(encoding="utf-8", errors="replace")[-12000:] if log.exists() else "",
                    model["calls"], model["errors"])

        wait_for(lambda: reader.read_source_status(session)["state"] == "complete",
                 diagnostic=diagnostic)
        reader.attach(session)
        _assert_mixed(_query(reader, session, "ordinary-chat-recall"), rel, phy)
