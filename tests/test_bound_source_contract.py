"""Bound fake-source receipts/routing; no claim of real Hermes authentication/durability."""

from dataclasses import replace

import pytest

from fakes import BoundSourceImporter
from test_fake_provider import messages, setup_provider
from reliquary_hermes.validation import canonical, content_digest


def queued(p, source, author):
    p.sync_turn("filtered", "answer", session_id="session-1", messages=source, turn_author=author)
    return p.jobs[-1]


def test_provider_job_binds_source_and_current_author_without_relabeling_history(pinned_abc):
    p, h = setup_provider(pinned_abc)
    source = messages()
    author = {"id": "alice", "name": "Alice", "is_bot": False}
    job = queued(p, source, author)
    importer = BoundSourceImporter(h)
    snapshot = importer.register_source_fixture(p.scope(), source, author, authenticated_actor_ids=("alice",))
    decision = importer.accept_job(job, p.scope())
    assert decision.status == "accepted_fixture"
    assert decision.snapshot_digest == snapshot.snapshot_digest
    assert decision.current_author_authenticated is True
    assert decision.owners == ("rel-a",) and decision.phy_attribution == "denied"
    assert all(owners == ("rel-a",) for _, owners in decision.message_owners)
    assert job.egress_digest == content_digest(source)
    assert importer.accept_job(job, p.scope()).receipt_key == decision.receipt_key
    assert len(importer.receipts) == 1
    # Prior source rows do not inherit Alice just because she wrote this turn.
    assert b'"id":null' in snapshot.messages_json


@pytest.mark.parametrize("field,value,status", [("profile_id", "profile-b", "denied"),
    ("principal_id", "principal-b", "denied"), ("session_id", "session-other", "stale_job"), ("epoch", 999, "stale_job")])
def test_cross_profile_principal_session_and_stale_jobs_cannot_import(pinned_abc, field, value, status):
    p, h = setup_provider(pinned_abc)
    author = {"id": "alice", "is_bot": False}
    job = queued(p, messages(), author)
    importer = BoundSourceImporter(h)
    importer.register_source_fixture(p.scope(), messages(), author, authenticated_actor_ids=("alice",))
    assert importer.accept_job(replace(job, **{field: value}), p.scope()).status == status
    assert not importer.receipts


def test_changed_source_and_changed_job_payload_are_rejected_before_receipt(pinned_abc):
    p, h = setup_provider(pinned_abc)
    source, author = messages(), {"id": "alice", "is_bot": False}
    job = queued(p, source, author)
    importer = BoundSourceImporter(h)
    source[0]["content"] = "source edited after callback"
    importer.register_source_fixture(p.scope(), source, author, authenticated_actor_ids=("alice",))
    assert importer.accept_job(job, p.scope()).status == "source_changed"
    source = messages()
    importer.register_source_fixture(p.scope(), source, author, authenticated_actor_ids=("alice",))
    changed = replace(job, copied_egress_json=canonical([*source, source[0]]))
    assert importer.accept_job(changed, p.scope()).status == "source_changed"
    assert not importer.receipts


@pytest.mark.parametrize("author,authenticated", [
    (None, ()), ({"id": None, "is_bot": None}, ()), ({"id": "", "is_bot": False}, ()),
    ({"id": "stranger", "is_bot": False}, ("stranger",)),
    ({"id": "bot", "is_bot": True}, ("bot",)),
    ({"id": "alice", "is_bot": False}, ()),
    ({"id": "alice", "is_bot": False}, ("alice", "other")),
])
def test_unknown_mixed_unmapped_bot_and_unverified_authors_are_denied_phy_not_rel(pinned_abc, author, authenticated):
    p, h = setup_provider(pinned_abc)
    job = queued(p, messages(), author)
    importer = BoundSourceImporter(h)
    importer.register_source_fixture(p.scope(), messages(), author, authenticated_actor_ids=authenticated)
    decision = importer.accept_job(job, p.scope())
    assert decision.status == "accepted_fixture" and decision.owners == ("rel-a",)
    assert decision.phy_attribution == "denied"


def test_author_tampering_unavailable_source_and_unregistered_dto_never_get_receipt(pinned_abc):
    p, h = setup_provider(pinned_abc)
    author = {"id": "alice", "is_bot": False}
    job = queued(p, messages(), author)
    importer = BoundSourceImporter(h)
    assert importer.accept_job(job, p.scope()).status == "source_unavailable"
    importer.register_source_fixture(p.scope(), messages(), author, authenticated_actor_ids=("alice",))
    tampered = replace(job, turn_author_json=canonical({"id": "other", "is_bot": False}))
    assert importer.accept_job(tampered, p.scope()).status == "source_author_mismatch"
    h.available = False
    assert importer.accept_job(job, p.scope()).status == "source_unavailable"
    assert importer.accept_job({"authority": "hermes_source_copied_snapshot"}, p.scope()).status == "invalid_job"
    assert not importer.receipts


def test_shared_session_participant_change_does_not_reuse_first_speakers_phy(pinned_abc):
    p, h = setup_provider(pinned_abc)
    importer = BoundSourceImporter(h)
    first_source = messages()
    alice = {"id": "alice", "is_bot": False}
    first_job = queued(p, first_source, alice)
    importer.register_source_fixture(p.scope(), first_source, alice, authenticated_actor_ids=("alice",))
    assert importer.accept_job(first_job, p.scope()).owners == ("rel-a",)
    second_source = first_source + [
        {"message_uid": "logical-3", "role": "user", "timestamp": 125.25, "content": "different participant"},
        {"message_uid": "logical-4", "role": "assistant", "timestamp": 126.25, "content": "reply"}]
    other = {"id": "other", "is_bot": False}
    second_job = queued(p, second_source, other)
    importer.register_source_fixture(p.scope(), second_source, other, authenticated_actor_ids=("other",))
    decision = importer.accept_job(second_job, p.scope())
    assert decision.status == "accepted_fixture" and decision.owners == ("rel-a",)
    assert decision.phy_attribution == "denied"


def test_current_turn_cannot_route_unknown_or_other_authors_to_its_phy(pinned_abc):
    p, h = setup_provider(pinned_abc)
    author = {"id": "alice", "is_bot": False}
    source = messages() + [
        {"message_uid": "logical-3", "role": "user", "timestamp": 125.25, "content": "Alice row",
         "author": {"id": "alice", "is_bot": False}},
        {"message_uid": "logical-4", "role": "user", "timestamp": 126.25, "content": "Other row",
         "author": {"id": "other", "is_bot": False}},
        {"message_uid": "logical-5", "role": "user", "timestamp": 127.25, "content": "Bot row",
         "author": {"id": "bot", "is_bot": True}},
    ]
    job = queued(p, source, author)
    importer = BoundSourceImporter(h)
    # Authenticating the callback's current author does not authenticate any source row.
    importer.register_source_fixture(p.scope(), source, author, authenticated_actor_ids=("alice",))
    decision = importer.accept_job(job, p.scope())
    assert decision.owners == ("rel-a",) and decision.phy_attribution == "denied"
    assert decision.current_author_authenticated is True
    assert all(owners == ("rel-a",) for _, owners in decision.message_owners)
    # Separate exact row assertions permit only independently authenticated row routes.
    importer.register_source_fixture(p.scope(), source, author, authenticated_actor_ids=("alice",),
        authenticated_message_actors=(("logical-3", "alice"), ("logical-4", "other"), ("logical-5", "bot")))
    decision = importer.accept_job(job, p.scope())
    assert decision.owners == ("rel-a",) and decision.phy_attribution == "authorized"
    routes = dict(decision.message_owners)
    assert routes["logical-3"] == ("rel-a", "phy-alice")
    assert all(routes[uid] == ("rel-a",) for uid in ("logical-1", "logical-2", "logical-4", "logical-5"))


@pytest.mark.parametrize("assertions", [(("logical-1", "alice"),), (("missing", "alice"),),
    (("logical-1", "alice"), ("logical-1", "other"))])
def test_forged_unknown_duplicate_or_missing_per_message_actor_assertion_fails(pinned_abc, assertions):
    p, h = setup_provider(pinned_abc)
    author = {"id": "alice", "is_bot": False}
    job = queued(p, messages(), author)
    importer = BoundSourceImporter(h)
    importer.register_source_fixture(p.scope(), messages(), author, authenticated_actor_ids=("alice",),
                                     authenticated_message_actors=assertions)
    assert importer.accept_job(job, p.scope()).status == "source_author_mismatch"
    assert not importer.receipts


@pytest.mark.parametrize("reason", ["archived", "deleted"])
def test_terminal_source_tombstone_rejects_accepted_replay_and_reregistered_job(pinned_abc, reason):
    p, h = setup_provider(pinned_abc)
    source, author = messages(), {"id": "alice", "is_bot": False}
    job = queued(p, source, author)
    importer = BoundSourceImporter(h)
    importer.register_source_fixture(p.scope(), source, author)
    decision = importer.accept_job(job, p.scope())
    assert decision.status == "accepted_fixture"
    h.source_invalidation_notice("profile-a", "session-1", reason)
    assert importer.accept_job(job, p.scope()).status == "source_tombstoned"

    p.on_session_switch("session-1")
    importer.register_source_fixture(p.scope(), source, author)
    replay = replace(job, epoch=p.scope().epoch, source_epoch=h.source_epoch("profile-a", "session-1"))
    assert importer.accept_job(replay, p.scope()).status == "source_tombstoned"
    assert importer.receipts == {decision.receipt_key}


def test_transient_source_invalidation_rejects_queued_job_after_resync(pinned_abc):
    p, h = setup_provider(pinned_abc)
    source, author = messages(), {"id": "alice", "is_bot": False}
    job = queued(p, source, author)
    importer = BoundSourceImporter(h)
    importer.register_source_fixture(p.scope(), source, author)
    h.source_invalidation_notice("profile-a", "session-1", "rewound")
    h.unavailable_sources.clear()
    assert importer.accept_job(job, p.scope()).status == "stale_job"
    fresh_job = queued(p, source, author)
    assert importer.accept_job(fresh_job, p.scope()).status == "source_unavailable"
    importer.register_source_fixture(p.scope(), source, author)
    assert importer.accept_job(fresh_job, p.scope()).status == "accepted_fixture"
