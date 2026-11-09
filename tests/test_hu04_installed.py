"""One installed pinned-Hermes flow from conversation through dashboard and archive."""

from contextlib import ExitStack, contextmanager
from decimal import Decimal
from hashlib import file_digest
import json
import os
from pathlib import Path
from shutil import copyfile, copytree
import subprocess
import sys
from types import SimpleNamespace

import pytest

from hu04_harness import REPO, start_dashboard, start_profile
from hu04_seed import _settle
from reliquary_hermes import HERMES_REVISION
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.outbox import SourceOutbox
from reliquary_hermes.settings import TOKEN_VAR, read_settings, read_token
from reliquary_hermes.validation import canonical, decode
from test_hp03_host import binaries, install_setup_host, owner, stop
from test_hp03_provider import pinned_provider
from test_hp04_host import TEXT, _cli
from test_hp05_retrieval import _configure, _retrieval_fixture_model, _wait
from test_hu03_dashboard import _stage_plugin

SOURCE = "hu04-native-source"
RECALL = "hu04-native-recall"
USER_TEXTS = (
    "Lantern release keeps an amber checklist for backups.",
    "Lantern backup schedule is reviewed each Friday.",
)
REPLY = "I will use the amber checklist for the backup rehearsal."
_BROWSER_ENV = {key: value for key, value in os.environ.items() if key.upper() in {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "PROGRAMFILES", "PROGRAMFILES(X86)",
    "APPDATA", "LOCALAPPDATA", "USERPROFILE",
}}


def _require_path(name, *, directory=False):
    value = os.environ.get(name)
    assert value, f"Set {name} for the installed HU04 acceptance"
    path = Path(value).resolve()
    assert path.is_dir() if directory else path.is_file(), f"Invalid {name}"
    return path


def _install(home, checkout, binary, rel, phy, project, ids):
    artifact = _require_path("HP06_PLUGIN_DIR", directory=True)
    manifest = decode((artifact / "host-pin.json").read_bytes())
    assert manifest["hermes_revision"] == HERMES_REVISION
    with (artifact / manifest["host_artifact"]).open("rb") as executable:
        assert file_digest(executable, "sha256").hexdigest() == manifest["host_sha256"]
    _stage_plugin(home)
    installed = home / "plugins/reliquary"
    copytree(artifact, installed, dirs_exist_ok=True)
    # Preserve the HP06 directory registration and update its implementation.
    for module in (REPO / "src/reliquary_hermes").glob("*.py"):
        if module.name != "__init__.py":
            copyfile(module, installed / module.name)
    installed_host = install_setup_host(home, binary)
    copytree(REPO / "dashboard/dist", home / "plugins/reliquary-hermes/dashboard/dist")
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR"}}
    env.update(
        HERMES_HOME=str(home), HOME=str(home), PYTHONPATH=str(checkout), USERPROFILE=str(home),
        APPDATA=str(home), LOCALAPPDATA=str(home), TEMP=str(home), TMP=str(home), TMPDIR=str(home),
        PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", PYTHONUTF8="1",
        HERMES_DISABLE_LAZY_INSTALLS="1", UV_OFFLINE="1", GIT_ALLOW_PROTOCOL="file",
        HTTP_PROXY="http://127.0.0.1:1", HTTPS_PROXY="http://127.0.0.1:1",
        NO_PROXY="127.0.0.1,localhost",
    )
    setup = subprocess.run(
        [sys.executable, "-B", "-m", "hermes_cli.main", "memory", "setup", "reliquary"],
        cwd=home, env=env, input=f"{rel}\n{phy}\n\nlantern\n{project}\n\n",
        encoding="utf-8", capture_output=True, timeout=45,
    )
    assert setup.returncode == 0 and "Reliquary configured." in setup.stdout, "Pinned Hermes memory setup failed"
    settings = read_settings(home)
    assert settings.binary == installed_host
    client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, read_token(home))
    # Prove the CLI started the host, then close it cleanly so the provider can start it again.
    client.attach_runtime("hu04-setup-probe")
    try:
        topology = client.read_dashboard_topology(None)
        assert {row["owner_id"] for row in topology["owners"]} == set(ids.values())
    finally:
        client.detach_runtime()
        _wait(lambda: not (settings.state_dir / "discovery.json").exists(), seconds=15)

    owners_path = settings.state_dir / "owners.json"
    owners = decode(owners_path.read_bytes())
    assert owners["projects"] == {"lantern": str(project)}
    owners["session_projects"] = {"session-project": "lantern"}
    owners_path.write_bytes(canonical(owners))
    return installed, settings


def _conversation(home):
    from agent.session_persistence import _db_flush_row, _db_flush_write
    from hermes_state import SessionDB

    messages = []
    for index, content in enumerate(USER_TEXTS):
        messages.extend((
            {"role": "user", "content": content, "timestamp": 1794000000.25 + index * 2},
            {"role": "assistant", "content": REPLY, "timestamp": 1794000001.5 + index * 2},
        ))
    with SessionDB(home / "state.db") as db:
        db.create_session(SOURCE, source="cli")
        agent = SimpleNamespace(_session_db=db, session_id=SOURCE)
        rows = [_db_flush_row(agent, message, message["role"] == "user") for message in messages]
        _db_flush_write(agent, rows, messages, messages)
        durable = db.get_messages(SOURCE)
        db.create_session(RECALL, source="cli")
    assert [(row["message_uid"], row["timestamp"]) for row in durable] == [
        (row["message_uid"], row["timestamp"]) for row in messages
    ]
    assert len({row["message_uid"] for row in durable}) == 4
    return durable


@contextmanager
def _runtime(home, installed, session, ids):
    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider

    manager = MemoryManager()
    provider = load_memory_provider("reliquary", register_skills=False)
    assert provider is not None
    module = Path(sys.modules[type(provider).__module__].__file__).resolve()
    assert module.is_relative_to(installed), "Hermes loaded a provider outside the isolated installation"
    manager.add_provider(provider)
    try:
        manager.initialize_all(session, hermes_home=str(home))
        _wait(lambda: provider.lifecycle_status == "attached", seconds=15)
        assert (provider.binding.rel_id, provider.binding.user_id) == (ids["main"], ids["phy"])
        process = provider._client._process
        assert process is not None and process.poll() is None
        yield manager, provider
        manager.shutdown_all()
        assert process.wait(timeout=15) == 0
    finally:
        manager.shutdown_all()
        if provider._client is not None and provider._client._process is not None:
            stop(provider._client._process)


def _query(manager):
    manager.on_turn_start(1, "Recall the backup plan")
    return json.loads(manager.handle_tool_call(
        "memory_query", {"query": "amber checklist", "limit": 10}, session_id=RECALL,
    ))


def _dashboard_phase(primary, foreign, checkout, scratch, memory, result, *, archived=False):
    scratch.mkdir()
    with ExitStack() as cleanup:
        dashboard, secondary = start_dashboard(primary, foreign, checkout, scratch, cleanup)
        dashboard.refresh()
        secondary.refresh()
        assert dashboard.topology(session_id=SOURCE)["session_owner_id"] == primary.ids["main"]
        assert dashboard.topology(session_id="session-project")["session_owner_id"] == primary.ids["project"]
        assert dashboard.topology(session_id=RECALL)["active_phy_id"] == primary.ids["phy"]
        copied = dashboard.read("ui.operational_status", {}, session_id=SOURCE)["result"]
        assert copied["source_state"] == ("tombstoned" if archived else "active")
        request = {"memory_id": memory["id"], "revision": str(memory["revision"])}
        evidence = dashboard.read("ui.provenance", request)["result"]["sources"]
        if archived:
            assert evidence == [{"kind": "source_unavailable", "reason": "deleted"}]
        else:
            [source] = evidence
            assert (source["kind"], source["session_id"], source["message_uid"], source["range"]) == (
                "hermes_snapshot", SOURCE, memory["message_uid"], None,
            )
            assert source["content_digest"] == memory["source_digest"]
            recall = dashboard.read("ui.operational_status", {}, session_id=RECALL)["result"]["latest_recall"]
            assert recall["state"] == "returned"
            assert (recall["delivery_id"], recall["returned_ids"]) == (result["delivery_id"], result["memory_ids"])
        secondary.rejected(secondary.request("ui.provenance", request, binding=dashboard.binding()))

        fixture = scratch / "browser-evidence.json"
        fixture.write_bytes(canonical({
            "profileId": primary.profile_id, "owners": primary.ids, "sourceSession": SOURCE, "recallSession": RECALL,
            "memoryTitle": memory["title"], "messageUid": memory["message_uid"],
            "returnedIds": result["memory_ids"], "archived": archived,
        }))
        browser_tmp = REPO / "host/.test-tmp/chrome"
        browser_tmp.mkdir(parents=True, exist_ok=True)
        # Use the original Windows browser environment and a short disposable profile path.
        env = {**_BROWSER_ENV, "TEMP": str(browser_tmp), "TMP": str(browser_tmp), "TMPDIR": str(browser_tmp)}
        subprocess.run([
            "node", str(REPO / "dashboard/tests/hu04-host-smoke.mjs"),
            f"http://127.0.0.1:{dashboard.port}", str(_require_path("HU04_PLAYWRIGHT")), str(fixture),
        ], cwd=scratch, env=env, check=True, timeout=75)


@pytest.mark.skipif(os.environ.get("HU04_LIVE_ACCEPTANCE") != "1", reason="Enable installed HU04 acceptance")
def test_hu04_installed_hermes_browser_recall_restart_and_archive(
    tmp_path, pinned_checkout, pinned_provider, binaries, monkeypatch,
):
    from hermes_cli.plugins import _reset_plugin_managers_for_tests, get_plugin_manager
    from hermes_constants import profile_name_for_home, reset_hermes_home_override, set_hermes_home_override
    from hermes_state import SessionDB

    binary, cli = binaries
    home = tmp_path / "installed-hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    assert profile_name_for_home(home) == "default"
    rel, phy, project = home / "main.rel", home / "active.phy", home / "project.rel"
    ids = {"main": owner(cli, "rel", rel, "unspecified"), "phy": owner(cli, "phy", phy),
           "project": owner(cli, "rel", project, "project")}
    installed, settings = _install(home, pinned_checkout, binary, rel, phy, project, ids)
    state = settings.state_dir
    with _retrieval_fixture_model() as (url, calls, _), ExitStack() as cleanup:
        scope = set_hermes_home_override(home)
        cleanup.callback(reset_hermes_home_override, scope)
        cleanup.callback(_reset_plugin_managers_for_tests)
        monkeypatch.delenv(TOKEN_VAR, raising=False)
        primary = SimpleNamespace(home=home, ids=ids, token=read_token(home), profile_id=settings.profile_id,
                                  principal_id=settings.principal_id)
        foreign = start_profile(home / "profiles/secondary", "secondary", binaries, cleanup)
        rows = _conversation(home)
        source_times = {
            row["message_uid"]: int(Decimal(str(row["timestamp"])) * 1_000_000_000)
            for row in rows if row["role"] == "user"
        }
        for row in rows:
            if row["role"] == "user":
                monkeypatch.setitem(TEXT, row["message_uid"], row["content"])
        runtime = _configure(cli, state, url)
        outbox = SourceOutbox(state, settings.profile_id, settings.principal_id)
        delivered = []
        with _runtime(home, installed, SOURCE, ids) as (manager, provider):
            send = provider._client.deliver_source_job

            def remember_snapshot(job):
                receipt = send(job)
                if job.kind == "snapshot" and job.session_id == SOURCE:
                    delivered.append(job)
                return receipt

            monkeypatch.setattr(provider._client, "deliver_source_job", remember_snapshot)
            manager.sync_all(USER_TEXTS[0], REPLY, session_id=SOURCE, messages=rows)
            assert manager.flush_pending(timeout=10)
            _wait(lambda: provider.sync_status == "source_accepted_durable", seconds=20)
            accepted_snapshot = outbox.cursor(SOURCE)
            assert accepted_snapshot.last_message_uid == rows[-1]["message_uid"]
            [original_job] = delivered
            assert original_job.snapshot.snapshot_digest == accepted_snapshot.snapshot_digest
        _settle(cli, rel, state, SOURCE, runtime)
        _cli(cli, "--config", runtime, "config", "model", "clear-embedding")
        (state / "processing.json").write_bytes(canonical({"config_path": str(runtime)}))

        memories = {}
        for row in _cli(cli, "rel", "memory", "list", rel)["page"]["items"]:
            memory = row["value"]
            [provenance] = _cli(cli, "rel", "memory", "provenance", rel, memory["id"])["page"]["items"]
            turn = provenance["value"]["source_turn"]
            imported = turn["imported"]
            assert imported["conversation_id"] == SOURCE and turn["availability"] == "available"
            assert turn["timestamp_ns"] == source_times[imported["message_id"]]
            memories[memory["id"]] = {**memory, "message_uid": imported["message_id"],
                                     "source_digest": bytes(imported["source_digest"]).hex()}
        assert len(memories) == 2
        with _runtime(home, installed, RECALL, ids) as (manager, _):
            first = _query(manager)
            assert first["status"] == "ok", first
            first = first["result"]
            [memory_id] = first["memory_ids"]
            assert first["context"] == USER_TEXTS[0]
            assert first["provenance"] == [{
                "memory_id": memory_id, "source_snapshot_digests": [accepted_snapshot.snapshot_digest],
            }]
            original_instance = decode((state / "discovery.json").read_bytes())["instance_id"]
            _dashboard_phase(primary, foreign, pinned_checkout, tmp_path / "before", memories[memory_id], first)
        with _runtime(home, installed, RECALL, ids) as (manager, _):
            assert decode((state / "discovery.json").read_bytes())["instance_id"] != original_instance
            later = _query(manager)
            assert later["status"] == "ok", later
            later = later["result"]
            for key in ("memory_ids", "provenance", "context"):
                assert later[key] == first[key]
            _dashboard_phase(primary, foreign, pinned_checkout, tmp_path / "after", memories[memory_id], later)
        assert calls.count("memory_query") == 2

        _reset_plugin_managers_for_tests()
        get_plugin_manager().discover_and_load(force=True)
        with SessionDB(home / "state.db") as db:
            assert db.set_session_archived(SOURCE, True)
            assert db.get_session(SOURCE)["archived"] == 1
            assert [row["message_uid"] for row in db.get_messages(SOURCE)] == [row["message_uid"] for row in rows]
        queued = outbox.next_job(SOURCE, terminal_only=True)
        assert queued is not None and queued.reason == "archive"
        with _runtime(home, installed, RECALL, ids) as (manager, _):
            def terminal_acknowledged():
                cursor = outbox.cursor(SOURCE)
                return cursor is not None and cursor.kind == "terminal"

            _wait(terminal_acknowledged, seconds=20)
            replay = HostClient(state, settings.profile_id, settings.principal_id, primary.token)
            with pytest.raises(HostUnavailable, match="^source_terminal$"):
                replay.deliver_source_job(original_job)
            denied = _query(manager)
            assert denied["status"] in {"conflict", "unavailable"}, denied
            _dashboard_phase(primary, foreign, pinned_checkout, tmp_path / "archived",
                             memories[memory_id], later, archived=True)
