import contextvars
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest

from fakes import FakeHost, provider_class
from reliquary_hermes.authority import AuthorGrant, ProfileGrant
from test_consumption import delivery, event


def setup_provider(pinned_abc, profile="a", *, context="primary", version=None):
    grant = ProfileGrant("profile-"+profile, "principal-"+profile, "rel-"+profile,
                         (AuthorGrant("alice", "phy-alice"),), profile*32)
    host = FakeHost(grant, proposed_hook_version=version)
    provider = provider_class(pinned_abc)(host, {"home-"+profile: "profile-"+profile})
    provider.initialize("session-1", hermes_home="home-"+profile, agent_context=context)
    return provider, host


def prepare(provider, host):
    d = delivery(provider.scope())
    host.prepared[d.delivery_id] = d
    return d


def messages():
    return [{"message_uid": "logical-1", "role": "user", "timestamp": 123.25, "content": "<redacted>"},
            {"message_uid": "logical-2", "role": "assistant", "timestamp": 124.25, "content": "answer"}]


def test_real_pinned_abc_accepts_fake_and_availability_never_checks_network(pinned_abc):
    p, h = setup_provider(pinned_abc)
    h.available = False
    assert isinstance(p, pinned_abc.MemoryProvider)
    assert p.is_available()
    assert p.prefetch("query", session_id="session-1") == ""


def test_prefetch_dashboard_tool_and_queue_reads_never_reinforce(pinned_abc):
    p, h = setup_provider(pinned_abc)
    d = prepare(p, h)
    assert p.prefetch("query", session_id="session-1") == d.context
    assert p.recall_status().count == 1
    assert h.prepared[d.delivery_id].context == d.context  # dashboard inspection
    assert json.loads(p.handle_tool_call("memory_query", {"query": "query"}))["status"] == "read_only"
    p.queue_prefetch("query", session_id="session-1")
    assert not h.receipts
    assert h.handoff(d, event(d), p.scope()).status == "unavailable"


def test_recall_indicator_is_only_last_actual_injected_batch(pinned_abc):
    p, h = setup_provider(pinned_abc)
    prepare(p, h)
    p.prefetch("query", session_id="session-1")
    assert p.recall_status() is not None
    p.prefetch("query", session_id="wrong-session")
    assert p.recall_status() is None
    h.source_available = False
    assert p.prefetch("query", session_id="session-1") == ""
    assert p.recall_status() is None


@pytest.mark.parametrize("reason", ["resume", "branch", "reset", "rewind"])
def test_switch_resume_branch_reset_rewind_invalidates_inflight_prefetch(pinned_abc, reason):
    p, h = setup_provider(pinned_abc, version=1)
    d = prepare(p, h)
    p.on_session_switch("session-1" if reason == "rewind" else "session-2", reset=reason=="reset", rewound=reason=="rewind")
    assert not h.prepared and p.recall_status() is None
    assert h.handoff(d, event(d), p.scope()).status == "stale"
    assert not h.receipts


def test_same_session_ids_do_not_leak_between_profiles_or_threads(pinned_abc):
    a, ah = setup_provider(pinned_abc, "a")
    b, bh = setup_provider(pinned_abc, "b")
    da, db = prepare(a, ah), prepare(b, bh)
    db = replace(db, context="profile B private recall")
    bh.prepared[db.delivery_id] = db
    assert da.context != db.context
    with ThreadPoolExecutor(max_workers=2) as executor:
        fa = executor.submit(a.prefetch, "query", session_id="session-1")
        fb = executor.submit(b.prefetch, "query", session_id="session-1")
        assert fa.result() == da.context and fb.result() == db.context
    assert ah.prepared[da.delivery_id].scope.profile_id == "profile-a"
    assert bh.prepared[db.delivery_id].scope.profile_id == "profile-b"
    assert not ah.receipts and not bh.receipts


def test_wrong_profile_reinitialize_clears_cached_binding(pinned_abc):
    p, h = setup_provider(pinned_abc)
    prepare(p, h)
    p.initialize("session-1", hermes_home="home-b")
    assert p.status == "denied" and p.profile_id is None
    assert not h.prepared
    assert p.prefetch("query", session_id="session-1") == ""


def test_sync_job_preserves_ids_filtered_copy_and_each_turn_author_without_durable_ack(pinned_abc):
    p, h = setup_provider(pinned_abc)
    source = messages()
    p.sync_turn("filtered", "answer", session_id="session-1", messages=source,
                turn_author={"id": "alice", "name": "Alice", "is_bot": False})
    p.sync_turn("filtered", "answer", session_id="session-1", messages=source,
                turn_author={"id": "stranger", "name": "Other", "is_bot": False})
    source[0]["content"] = "later change"
    first, second = p.jobs
    assert first.message_uids == ("logical-1", "logical-2")
    assert json.loads(first.copied_egress_json)[0]["content"] == "<redacted>"
    assert json.loads(first.turn_author_json)["id"] == "alice"
    assert json.loads(second.turn_author_json)["id"] == "stranger"
    assert p.status == "queued_not_durable"
    assert not h.receipts
    assert h.grant.owners_for("stranger", False) == ("rel-a",)


def test_sync_is_bounded_and_reports_backpressure_without_durable_success(pinned_abc):
    p, _ = setup_provider(pinned_abc)
    for _ in range(3):
        p.sync_turn("x", "y", session_id="session-1", messages=messages())
    assert len(p.jobs) == 2 and p.status == "backpressure"


@pytest.mark.parametrize("context", ["subagent", "cron", "flush"])
def test_nonprimary_does_not_duplicate_parent_ingestion(pinned_abc, context):
    p, _ = setup_provider(pinned_abc, context=context)
    p.sync_turn("x", "y", session_id="session-1", messages=messages())
    assert not p.jobs and p.status == "non_primary"


def test_missing_source_uid_is_not_replaced_with_row_id_or_text_hash(pinned_abc):
    p, _ = setup_provider(pinned_abc)
    p.sync_turn("x", "y", session_id="session-1", messages=[{"_row_id": 42, "content": "x"}])
    assert not p.jobs and p.status == "source_unavailable"


def test_source_outage_and_cancelled_tool_are_not_success(pinned_abc):
    p, h = setup_provider(pinned_abc)
    prepare(p, h)
    assert json.loads(p.handle_tool_call("memory_query", {}, cancelled=True))["status"] == "cancelled"
    h.available = False
    p.sync_turn("x", "y", session_id="session-1", messages=messages())
    assert p.status == "unavailable" and not p.jobs and not h.receipts


def test_pinned_context_helpers_capture_profile_at_submission_not_worker_launch(pinned_abc):
    profile = contextvars.ContextVar("hp01_profile", default="default")
    profile.set("profile-a")
    first = pinned_abc.ctx_bound(profile.get)
    profile.set("profile-b")
    second = pinned_abc.ctx_bound(profile.get)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert pool.submit(first).result() == "profile-a"
        assert pool.submit(second).result() == "profile-b"
    values = []
    thread = pinned_abc.spawn_context_thread(lambda: values.append(profile.get()), name="hp01-profile")
    profile.set("profile-c")
    thread.start()
    thread.join(timeout=5)
    assert not thread.is_alive() and values == ["profile-b"]


def test_tools_are_bounded_and_cannot_supply_owner_or_confirmation_authority(pinned_abc):
    p, _ = setup_provider(pinned_abc)
    schemas = {tool["name"]: tool["parameters"] for tool in p.get_tool_schemas()}
    assert set(schemas) == {"memory_query", "refine_query", "traverse_graph"}
    for schema in schemas.values():
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])
        assert "owner_id" not in schema["properties"] and "handoff_event_id" not in schema["properties"]
    assert schemas["memory_query"]["properties"]["limit"]["maximum"] == 50
    assert schemas["refine_query"]["properties"]["selected_ids"]["maxItems"] == 50
    assert schemas["traverse_graph"]["properties"]["depth"]["maximum"] == 3


@pytest.mark.parametrize("reason", ["stale", "deleted", "rewound", "unavailable"])
def test_required_host_only_source_notice_stops_retrieval_and_old_receipts(pinned_abc, reason):
    p, h = setup_provider(pinned_abc, version=1)
    d = prepare(p, h)
    assert p.prefetch("query", session_id="session-1") == d.context
    # Future host-only notification simulation, not a supported current DTO/source export.
    h.source_invalidation_notice(reason)
    assert not h.prepared
    assert p.prefetch("query", session_id="session-1") == ""
    assert p.recall_status() is None
    assert h.handoff(d, event(d), p.scope()).status == "source_unavailable"
    h.source_available = True  # resync availability cannot revive an invalidated old manifest
    assert p.prefetch("query", session_id="session-1") == ""
    assert h.handoff(d, event(d), p.scope()).status == "source_unavailable"
    assert not h.receipts
