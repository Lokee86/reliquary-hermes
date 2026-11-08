import contextvars
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest

from fakes import FakeHost, SelectedRecall, provider_class
from reliquary_hermes.authority import ActivePhy, ProfileGrant, ProjectRel, RelBindings, SessionRel


def setup_provider(pinned_abc, profile="a", *, context="primary"):
    grant = ProfileGrant(
        "profile-" + profile, "principal-" + profile,
        RelBindings("rel-" + profile, (SessionRel("session-1"), SessionRel("session-2", "project-1")),
                    (ProjectRel("project-1", "rel-project-" + profile),)),
        ActivePhy("phy-alice", "alice"), profile * 32,
    )
    host = FakeHost(grant)
    provider = provider_class(pinned_abc)(host, {"home-" + profile: "profile-" + profile})
    provider.initialize("session-1", hermes_home="home-" + profile, agent_context=context)
    return provider, host


def prepare(provider, host):
    scope = provider.scope()
    source_epoch = host.source_epoch(scope.profile_id, scope.session_id)
    recall = SelectedRecall("delivery-1", scope, source_epoch, ("memory-1",), "selected source content")
    host.recalls[recall.delivery_id] = recall
    return recall


def messages():
    return [{"message_uid": "logical-1", "role": "user", "timestamp": 123.25, "content": "<redacted>"},
            {"message_uid": "logical-2", "role": "assistant", "timestamp": 124.25, "content": "answer"}]


def test_real_pinned_abc_accepts_fake_and_availability_never_checks_network(pinned_abc):
    p, h = setup_provider(pinned_abc)
    h.available = False
    assert isinstance(p, pinned_abc.MemoryProvider)
    assert p.is_available()
    assert p.prefetch("query", session_id="session-1") == ""


def test_prefetch_and_tools_forward_the_scoped_host_result(pinned_abc):
    p, h = setup_provider(pinned_abc)
    d = prepare(p, h)
    assert json.loads(p.handle_tool_call("memory_query", {"query": "query"}))["content"] == d.context
    assert p.recall_status() is None
    assert p.prefetch("query", session_id="session-1") == d.context
    assert p.recall_status().count == 1
    p.queue_prefetch("query", session_id="session-1")
    assert p.status == "prefetch_queued"


def test_recall_indicator_is_only_last_actual_injected_batch(pinned_abc):
    p, h = setup_provider(pinned_abc)
    prepare(p, h)
    p.prefetch("query", session_id="session-1")
    assert p.recall_status() is not None
    p.prefetch("query", session_id="wrong-session")
    assert p.recall_status() is None
    h.source_invalidation_notice("profile-a", "session-1", "unavailable")
    assert p.prefetch("query", session_id="session-1") == ""
    assert p.recall_status() is None


@pytest.mark.parametrize("reason", ["resume", "branch", "reset", "rewind"])
def test_switch_resume_branch_reset_rewind_invalidates_inflight_prefetch(pinned_abc, reason):
    p, h = setup_provider(pinned_abc)
    old_recall = prepare(p, h)
    session = "session-1" if reason == "rewind" else "session-2"
    p.on_session_switch(session, reset=reason == "reset", rewound=reason == "rewind")
    assert not h.recalls and p.recall_status() is None
    h.recalls[old_recall.delivery_id] = old_recall  # a stale worker returns after the switch
    assert p.prefetch("query", session_id=session) == ""


def test_same_session_ids_do_not_leak_between_profiles_or_threads(pinned_abc):
    a, ah = setup_provider(pinned_abc, "a")
    b, bh = setup_provider(pinned_abc, "b")
    da, db = prepare(a, ah), prepare(b, bh)
    db = replace(db, context="profile B private recall")
    bh.recalls[db.delivery_id] = db
    assert da.context != db.context
    with ThreadPoolExecutor(max_workers=2) as executor:
        fa = executor.submit(a.prefetch, "query", session_id="session-1")
        fb = executor.submit(b.prefetch, "query", session_id="session-1")
        assert fa.result() == da.context and fb.result() == db.context
    assert ah.recalls[da.delivery_id].scope.profile_id == "profile-a"
    assert bh.recalls[db.delivery_id].scope.profile_id == "profile-b"


def test_wrong_profile_reinitialize_clears_cached_binding(pinned_abc):
    p, h = setup_provider(pinned_abc)
    prepare(p, h)
    p.initialize("session-1", hermes_home="home-b")
    assert p.status == "denied" and p.profile_id is None
    assert not h.recalls
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
    assert h.grant.owners_for("session-1", "stranger", False) == ("rel-a",)


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
    assert p.status == "unavailable" and not p.jobs


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


def test_tools_are_bounded_and_cannot_supply_owner_authority(pinned_abc):
    p, _ = setup_provider(pinned_abc)
    schemas = {tool["name"]: tool["parameters"] for tool in p.get_tool_schemas()}
    assert set(schemas) == {"memory_query", "refine_query", "traverse_graph"}
    for schema in schemas.values():
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])
        assert "owner_id" not in schema["properties"]
    assert schemas["memory_query"]["properties"]["limit"]["maximum"] == 50
    assert schemas["refine_query"]["properties"]["selected_ids"]["maxItems"] == 50
    assert schemas["traverse_graph"]["properties"]["depth"]["maximum"] == 3


@pytest.mark.parametrize("reason", ["stale", "rewound", "unavailable"])
def test_nonterminal_source_notice_clears_scoped_recall_until_resync(pinned_abc, reason):
    p, h = setup_provider(pinned_abc)
    d = prepare(p, h)
    assert p.prefetch("query", session_id="session-1") == d.context
    h.source_invalidation_notice("profile-a", "session-1", reason)
    assert not h.recalls
    assert p.recall_status() is None
    assert p.prefetch("query", session_id="session-1") == ""
    h.unavailable_sources.clear()
    h.recalls[d.delivery_id] = d  # result from the invalidated source epoch
    assert p.prefetch("query", session_id="session-1") == ""


@pytest.mark.parametrize("reason", ["archived", "deleted"])
def test_terminal_source_notice_stops_copy_and_recall_for_only_that_session(pinned_abc, reason):
    p, h = setup_provider(pinned_abc)
    old_recall = prepare(p, h)
    assert p.prefetch("query", session_id="session-1") == old_recall.context
    h.source_invalidation_notice("profile-a", "session-1", reason)
    assert p.recall_status() is None
    h.unavailable_sources.clear()  # ordinary resync cannot remove a tombstone
    p.on_session_switch("session-1")
    prepare(p, h)
    assert p.prefetch("query", session_id="session-1") == ""
    p.sync_turn("x", "y", session_id="session-1", messages=messages())
    assert p.status == "source_tombstoned" and not p.jobs

    p.on_session_switch("session-2")
    fresh_recall = prepare(p, h)
    assert p.prefetch("query", session_id="session-2") == fresh_recall.context
    p.sync_turn("x", "y", session_id="session-2", messages=messages())
    assert p.status == "queued_not_durable"


def test_active_phy_identity_is_independent_of_hermes_bot_and_rel_scope(pinned_abc):
    a, ah = setup_provider(pinned_abc, "a")
    b, _ = setup_provider(pinned_abc, "b")
    a.initialize("session-2", hermes_home="home-a", agent_identity="bot-a")
    b.initialize("session-1", hermes_home="home-b", agent_identity="bot-b")
    assert a.user_id == b.user_id == "phy-alice"
    assert ah.grant.rel_bindings.rel_for("session-2") == "rel-project-a"
    a.initialize("unknown", hermes_home="home-a")
    assert a.status == "denied" and a.user_id is None


@pytest.mark.parametrize("timestamp", [None, -1, True, float("inf")])
def test_sync_never_invents_missing_or_invalid_source_time(pinned_abc, timestamp):
    p, _ = setup_provider(pinned_abc)
    source = messages()
    source[0]["timestamp"] = timestamp
    p.sync_turn("x", "y", session_id="session-1", messages=source)
    assert not p.jobs and p.status == "source_unavailable"


def test_provider_cleanup_cannot_erase_other_session_recall_on_shared_host(pinned_abc):
    p, host = setup_provider(pinned_abc)
    first = prepare(p, host)
    other = provider_class(pinned_abc)(host, {"home-a": "profile-a"})
    other.initialize("session-2", hermes_home="home-a")
    assert p.prefetch("query", session_id="session-1") == first.context
    other.on_session_switch("session-1")
    other.shutdown()
    assert p.prefetch("query", session_id="session-1") == first.context


@pytest.mark.parametrize("source", [
    ["invalid row"],
    [{**messages()[0], "content": "é" * 16385}],
    [{**messages()[0], "metadata": "x" * 262144}],
    [messages()[0], messages()[0]],
], ids=["row-shape", "message-byte-bound", "job-byte-bound", "duplicate-id"])
def test_sync_rejects_malformed_or_oversized_callback_before_enqueue(pinned_abc, source):
    p, _ = setup_provider(pinned_abc)
    p.sync_turn("x", "y", session_id="session-1", messages=source)
    assert not p.jobs and p.status == "source_unavailable"
