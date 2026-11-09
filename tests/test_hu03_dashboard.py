"""Live dashboard authority proof against the pinned Hermes and Rust host."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from reliquary_hermes import HERMES_REVISION
from reliquary_hermes.client import HostClient
from reliquary_hermes.ui_contract import UIResponse
from reliquary_hermes.validation import canonical
from test_hp03_host import binaries, config, owner, stop


REPO = Path(__file__).resolve().parents[1]


def _stage_plugin(home, enabled=True):
    dashboard = home / "plugins/reliquary-hermes/dashboard"
    dashboard.mkdir(parents=True)
    for name in ("manifest.json", "plugin_api.py"):
        shutil.copyfile(REPO / "dashboard" / name, dashboard / name)
    provider = home / "plugins/reliquary"
    provider.mkdir(parents=True)
    for module in (REPO / "src/reliquary_hermes").glob("*.py"):
        shutil.copyfile(module, provider / module.name)
    (provider / "plugin.yaml").write_text("name: reliquary\nkind: standalone\n", encoding="utf-8")
    consent = "enabled" if enabled else "disabled"
    (home / "config.yaml").write_text(f"plugins:\n  {consent}: [reliquary-hermes]\n", encoding="utf-8")


def _start_profile(home, profile_id, binaries, cleanup, *, project):
    binary, cli = binaries
    _stage_plugin(home)
    main, phy = home / "main.rel", home / "active.phy"
    ids = {"main": owner(cli, "rel", main, "unspecified"), "phy": owner(cli, "phy", phy)}
    project_rel = home / "project.rel" if project else None
    if project_rel:
        ids["project"] = owner(cli, "rel", project_rel, "project")
    state = home / "reliquary"
    config(state, main, phy, profile=profile_id, project_rel=project_rel)
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    token = f"isolated-hu03-service-credential-{profile_id}"
    (home / ".env").write_text(f"RELIQUARY_HERMES_TOKEN={token}\n", encoding="utf-8")
    client = HostClient(state, profile_id, "principal-a", token, binary=binary)
    try:
        client.attach(f"session-{profile_id}")
    finally:
        if client._process is not None:
            cleanup.callback(stop, client._process)
    return ids, token


def _request(**overrides):
    return {
        "protocol_version": 1, "request_id": "topology-test", "operation": "ui.owner_sessions",
        "profile_id": "forged-profile", "principal_id": "forged-principal", "session_id": None,
        "owner_id": None, "generation": None, "cut": None, "expected_revision": None,
        "idempotency_key": None, "arguments": {"cursor": None, "limit": 128}, **overrides,
    }


def _probe(home, pin, scratch, cases):
    script = """
import json
import os
import sys
from fastapi.testclient import TestClient
from hermes_cli import web_server

route = "/api/plugins/reliquary-hermes/dashboard-v1"
headers = {web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN}
responses = {}
with TestClient(web_server.app) as client:
    for label, profile, body in json.load(sys.stdin):
        params = {"profile": profile} if profile is not None else {}
        response = client.post(route, headers={} if label == "unauthenticated" else headers,
                               params=params, json=body)
        responses[label] = [response.status_code, response.json()]
    for label, profile in (("primary", None), ("secondary", "secondary")):
        rows = responses[label][1]["result"]["owners"]["items"]
        params = {"profile": profile} if profile is not None else {}
        for row in rows:
            for operation, args in (
                ("ui.memory_list", {"cursor": None, "limit": 1, "filters": {
                    "query": "", "category": None, "memory_type": None, "lifecycle": None, "community_id": None,
                }}),
                ("ui.graph_page", {"seed_ids": [], "community_id": None, "depth": 1,
                                   "node_limit": 2, "edge_limit": 2, "cursor": None}),
                ("ui.operational_status", {}),
            ):
                if operation == "ui.operational_status" and not row["capabilities"]["status"]:
                    continue
                body = {"protocol_version": 1, "request_id": "scoped-test", "operation": operation,
                        "profile_id": "browser-profile", "principal_id": "browser-principal",
                        "owner_id": row["owner_id"], "generation": row["generation"], "cut": row["cut"],
                        "session_id": None, "expected_revision": None, "idempotency_key": None,
                        "arguments": args}
                response = client.post(route, headers=headers, params=params, json=body)
                responses[f"{label}/{row['owner_id']}/{operation}"] = [response.status_code, response.json()]
                if operation == "ui.memory_list":
                    forged = client.post(route, headers=headers, params={"profile": "secondary"} if profile is None else {},
                                         json=body)
                    assert forged.status_code == 200 and forged.json()["status"] == "denied"
                    stale = client.post(route, headers=headers, params=params, json={**body, "cut": "stale-cut"})
                    assert stale.status_code == 200 and stale.json()["status"] == "stale_cursor"

    primary = next(row for row in responses["primary"][1]["result"]["owners"]["items"]
                   if row["display_label"] == "Main REL")
    phy = next(row for row in responses["primary"][1]["result"]["owners"]["items"] if row["owner_kind"] == "PHY")
    mutation = {"protocol_version": 1, "request_id": "mutation-test", "operation": "ui.memory_create",
                "profile_id": "forged-profile", "principal_id": "forged-principal",
                "owner_id": primary["owner_id"], "generation": primary["generation"], "cut": primary["cut"],
                "session_id": None, "expected_revision": None, "idempotency_key": "create-one",
                "arguments": {"title": "Dashboard proof", "body": "Safe <b>text</b>", "category": "fact",
                              "memory_type": "semantic"}}
    local = {**headers, "Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
    blocked = client.post(route, headers={**headers, "Origin": "http://different.invalid"}, json=mutation)
    responses["cross_origin"] = [blocked.status_code, blocked.json()]
    blocked_phy = client.post(route, headers=local, json={**mutation, "owner_id": phy["owner_id"],
                             "generation": phy["generation"], "cut": phy["cut"]})
    responses["phy_write"] = [blocked_phy.status_code, blocked_phy.json()]
    create = client.post(route, headers=local, json=mutation)
    responses["create"] = [create.status_code, create.json()]
    if create.json()["status"] == "ok":
        replay = client.post(route, headers=local, json={**mutation, "request_id": "create-retry"})
        responses["create_replay"] = [replay.status_code, replay.json()]
        different = client.post(route, headers=local, json={**mutation,
                                "arguments": {**mutation["arguments"], "title": "Other title"}})
        responses["create_reused_key"] = [different.status_code, different.json()]
        accepted = create.json()["binding"]
        memory = create.json()["result"]["committed"]["memory"]
        scoped = {**mutation, "generation": accepted["generation"], "cut": accepted["cut"]}
        read = client.post(route, headers=headers, json={**scoped, "operation": "ui.memory_detail",
                           "idempotency_key": None, "arguments": {"memory_id": memory["memory_id"], "revision": None}})
        responses["detail_after_create"] = [read.status_code, read.json()]
        history = client.post(route, headers=headers, json={**scoped, "operation": "ui.memory_history",
                              "idempotency_key": None, "arguments": {"memory_id": memory["memory_id"], "limit": 1, "cursor": None}})
        responses["history_after_create"] = [history.status_code, history.json()]
        correct = {**scoped, "operation": "ui.memory_edit", "idempotency_key": "correct-one",
                   "expected_revision": memory["revision"], "arguments": {
                       "memory_id": memory["memory_id"], "title": "Dashboard correction", "body": "Corrected text"}}
        corrected = client.post(route, headers=local, json=correct)
        responses["correction"] = [corrected.status_code, corrected.json()]
        replay = client.post(route, headers=local, json={**correct, "request_id": "correct-retry"})
        responses["correction_replay"] = [replay.status_code, replay.json()]
        if corrected.json()["status"] == "ok":
            corrected_binding = corrected.json()["binding"]
            corrected_result = corrected.json()["result"]["committed"]
            retirement = {**correct, "operation": "ui.memory_retire", "idempotency_key": "retire-one",
                          "cut": corrected_binding["cut"], "expected_revision": corrected_result["original_revision"],
                          "arguments": {"memory_id": memory["memory_id"], "effect": "retire"}}
            retired = client.post(route, headers=local, json=retirement)
            responses["retired"] = [retired.status_code, retired.json()]
            replay = client.post(route, headers=local, json={**retirement, "request_id": "retire-retry"})
            responses["retirement_replay"] = [replay.status_code, replay.json()]
            if retired.json()["status"] == "ok":
                tombstone = client.post(route, headers=headers, json={**scoped, "operation": "ui.memory_detail",
                    "cut": retired.json()["binding"]["cut"], "idempotency_key": None,
                    "arguments": {"memory_id": memory["memory_id"], "revision": None}})
                responses["retirement_detail"] = [tombstone.status_code, tombstone.json()]
                other = client.post(route, headers=local, json={**mutation, "cut": retired.json()["binding"]["cut"],
                    "idempotency_key": "create-two", "arguments": {**mutation["arguments"], "title": "Another Memory"}})
                responses["create_other"] = [other.status_code, other.json()]
                if other.json()["status"] == "ok":
                    source = corrected_result["replacement"]["memory"]
                    target = other.json()["result"]["committed"]["memory"]
                    link = {**scoped, "operation": "ui.relation_change", "cut": other.json()["binding"]["cut"],
                            "idempotency_key": "link-one", "arguments": {"source_id": source["memory_id"],
                            "source_revision": source["revision"], "target_id": target["memory_id"],
                            "target_revision": target["revision"], "action": "link",
                            "relation_kind": "user_association", "edge_id": None}}
                    linked = client.post(route, headers=local, json=link)
                    responses["linked"] = [linked.status_code, linked.json()]
                    if linked.json()["status"] == "ok":
                        edge = linked.json()["result"]["committed"]
                        unlink = {**link, "cut": linked.json()["binding"]["cut"], "idempotency_key": "unlink-one",
                                  "expected_revision": edge["revision"], "arguments": {
                                      **link["arguments"], "edge_id": edge["edge_id"], "action": "unlink"}}
                        unlinked = client.post(route, headers=local, json=unlink)
                        responses["unlinked"] = [unlinked.status_code, unlinked.json()]
os.write(1, json.dumps(responses).encode("utf-8"))
"""
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(HERMES_HOME=str(home), HERMES_KANBAN_HOME=str(scratch / "kanban"),
               USERPROFILE=str(scratch), APPDATA=str(scratch), LOCALAPPDATA=str(scratch),
               TEMP=str(scratch), TMP=str(scratch), TMPDIR=str(scratch), PYTHONDONTWRITEBYTECODE="1",
               HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_ENABLE_PROJECT_PLUGINS="0",
               PYTHONPATH=os.pathsep.join((str(pin), str(REPO / "src"))))
    result = subprocess.run([sys.executable, "-B", "-c", script], cwd=scratch, env=env,
                            input=json.dumps(cases), capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip(), result.stderr
    return json.loads(result.stdout)


def test_pinned_dashboard_scope_does_not_follow_browser_identity(tmp_path, binaries):
    checkout = os.environ.get("HP01_HERMES_CHECKOUT")
    if not checkout:
        pytest.skip("Set HP01_HERMES_CHECKOUT for the pinned dashboard proof")
    pin = Path(checkout).resolve()
    actual = subprocess.check_output(["git", "-C", str(pin), "rev-parse", "HEAD"], text=True).strip()
    assert actual == HERMES_REVISION

    home = tmp_path / "hermes"
    secondary = home / "profiles/secondary"
    _stage_plugin(home / "profiles/disabled", enabled=False)
    with ExitStack() as cleanup:
        primary_ids, primary_token = _start_profile(home, "primary", binaries, cleanup, project=True)
        secondary_ids, secondary_token = _start_profile(secondary, "secondary", binaries, cleanup, project=False)
        cases = [
            ("unauthenticated", None, _request()),
            ("primary", None, _request(session_id="session-project")),
            ("secondary", "secondary", _request(profile_id="primary", principal_id=primary_ids["phy"])),
            ("foreign_session", "secondary", _request(session_id="session-project")),
            ("unknown_profile", "missing-profile", _request()),
            ("owner_hint", None, _request(owner_id=secondary_ids["main"])),
            ("unsupported", None, _request(operation="ui.operational_status", owner_id=primary_ids["main"],
                                            generation="0", cut="browser-cut", arguments={})),
            ("disabled", "disabled", _request()),
        ]
        replies = _probe(home, pin, tmp_path, cases)

    assert replies["unauthenticated"][0] == 401
    assert replies["owner_hint"][0] == 400
    assert replies["disabled"][0] == 404
    assert replies["unknown_profile"][0] == 404
    for label, ids in (("primary", primary_ids), ("secondary", secondary_ids)):
        status, payload = replies[label]
        assert status == 200, (label, payload)
        result = UIResponse.parse(canonical(payload)).value["result"]
        assert {row["owner_id"] for row in result["owners"]["items"]} == set(ids.values())
        assert result["active_phy_id"] == ids["phy"]
        assert all(row["capabilities"]["view"] for row in result["owners"]["items"])
        assert all(not row["capabilities"]["manage"] for row in result["owners"]["items"] if row["owner_kind"] == "PHY")
        for row in result["owners"]["items"]:
            key = f"{label}/{row['owner_id']}"
            for operation in ("ui.memory_list", "ui.graph_page", "ui.operational_status"):
                if operation == "ui.operational_status" and not row["capabilities"]["status"]:
                    continue
                http, value = replies[f"{key}/{operation}"]
                assert http == 200 and value["status"] == "ok", (key, operation, value)
                assert UIResponse.parse(canonical(value)).value["binding"] == row
    assert replies["primary"][1]["result"]["session_owner_id"] == primary_ids["project"]
    assert replies["secondary"][1]["result"]["session_owner_id"] is None
    assert replies["foreign_session"][0] == 200
    assert replies["foreign_session"][1]["status"] == "denied"
    assert replies["unsupported"][0] == 200
    assert replies["unsupported"][1]["status"] == "stale_cursor"
    assert replies["cross_origin"][1]["status"] == "denied"
    assert replies["phy_write"][1]["status"] == "denied"
    accepted = replies["create"][1]
    assert accepted["status"] == "ok", accepted
    result = UIResponse.parse(canonical(accepted)).value["result"]
    assert result["committed"]["provenance"][0]["principal_id"] == primary_ids["phy"]
    assert result["committed"]["body"]["content"] == "Safe <b>text</b>"
    replay = UIResponse.parse(canonical(replies["create_replay"][1])).value
    assert replay["status"] == "ok" and replay["result"]["receipt_id"] == result["receipt_id"]
    assert replay["result"]["committed"] == result["committed"]
    assert replies["create_reused_key"][1]["status"] == "conflict"
    assert replies["detail_after_create"][1]["status"] == "ok", replies["detail_after_create"]
    assert replies["history_after_create"][1]["status"] == "ok", replies["history_after_create"]
    correction = UIResponse.parse(canonical(replies["correction"][1])).value
    assert correction["status"] == "ok", correction
    assert correction["result"]["committed"]["replacement"]["memory"]["memory_id"] != result["committed"]["memory"]["memory_id"]
    retry = UIResponse.parse(canonical(replies["correction_replay"][1])).value
    assert retry["status"] == "ok" and retry["result"]["receipt_id"] == correction["result"]["receipt_id"]
    retired = UIResponse.parse(canonical(replies["retired"][1])).value
    assert retired["status"] == "ok", retired
    assert retired["result"]["committed"]["lifecycle"] == "tombstoned"
    assert replies["retirement_replay"][1]["result"]["receipt_id"] == retired["result"]["receipt_id"]
    detail = replies["retirement_detail"][1]
    assert detail["status"] == "ok" and detail["result"]["body"]["content"] is None
    assert detail["result"]["tombstone"]
    assert replies["create_other"][1]["status"] == "ok", replies["create_other"]
    linked, unlinked = (UIResponse.parse(canonical(replies[label][1])).value for label in ("linked", "unlinked"))
    assert linked["status"] == "ok" and linked["result"]["committed"]["active"], linked
    assert unlinked["status"] == "ok" and not unlinked["result"]["committed"]["active"], unlinked
    assert linked["result"]["committed"]["edge_id"] == unlinked["result"]["committed"]["edge_id"]
    wire = json.dumps(replies)
    assert all(secret not in wire for secret in (primary_token, secondary_token, "principal-a"))
    assert json.dumps(str(home))[1:-1] not in wire
