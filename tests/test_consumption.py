from dataclasses import replace

import pytest

from fakes import FakeHost
from reliquary_hermes.authority import ProfileGrant
from reliquary_hermes.consumption import HandoffEvent, PreparedDelivery, TurnScope
from reliquary_hermes.validation import content_digest


def scope():
    return TurnScope("profile-a", "principal-a", "session-1", "turn-1", 1)


def delivery(s=None):
    return PreparedDelivery("delivery-1", s or scope(), "cut-1", ("memory-1",), "recalled café", ("a"*64,))


def event(d=None, **changes):
    d = d or delivery()
    part = ("prefix " + d.context + " suffix").encode("utf-8")
    values = dict(event_id="event-1", attempt_id="attempt-1", scope=d.scope, outcome="accepted",
                  final_request_digest=content_digest({"fake_final_model_payload": part.decode("utf-8")}),
                  delivery_id=d.delivery_id, manifest_digest=d.manifest_digest, content_part=part,
                  span_start=len(b"prefix "), span_end=len(b"prefix ")+len(d.context.encode("utf-8")))
    values.update(changes)
    return HandoffEvent(**values)


def host(*, version=None):
    return FakeHost(ProfileGrant("profile-a", "principal-a", "rel-a", (), "a"*32), proposed_hook_version=version)


def test_current_host_never_confirms_even_if_event_looks_successful():
    h = host()
    assert h.handoff(delivery(), event(), scope()).status == "unavailable"
    assert not h.receipts


@pytest.mark.parametrize("outcome", ["failed", "cancelled", "uncertain", "replaced", "omitted"])
def test_no_credit_for_nonaccepted_terminal_outcomes(outcome):
    h = host(version=1)
    assert h.handoff(delivery(), event(outcome=outcome), scope()).status == outcome
    assert not h.receipts


@pytest.mark.parametrize("change", [
    {"outcome": "queued"}, {"outcome": []}, {"outcome": "post_response"}, {"final_request_digest": None},
    {"manifest_digest": "b"*64}, {"delivery_id": "other"}, {"event_id": ""},
    {"content_part": b"context omitted", "span_start": 0, "span_end": 15},
    {"content_part": b"recalled caf", "span_start": 0, "span_end": 12},
    {"span_start": True}, {"span_start": -1}, {"span_end": 999999}, {"content_part": "not bytes"},
])
def test_no_credit_for_guesses_omission_truncation_and_tampered_manifest(change):
    h = host(version=1)
    assert h.handoff(delivery(), event(**change), scope()).status != "confirmed"
    assert not h.receipts


@pytest.mark.parametrize("field,value", [("profile_id", "profile-b"), ("principal_id", "principal-b"),
                                        ("session_id", "session-2"), ("turn_id", "turn-2"), ("epoch", 2)])
def test_profile_session_turn_and_epoch_bindings_are_all_required(field, value):
    h = host(version=1)
    active = replace(scope(), **{field: value})
    assert h.handoff(delivery(), event(), active).status == "stale"
    assert not h.receipts


def test_proposed_exact_handoff_earns_one_receipt_across_retry_and_event_replay():
    h = host(version=1)
    d = delivery()
    first = h.handoff(d, event(d), scope())
    retry = h.handoff(d, event(d, event_id="event-2", attempt_id="attempt-2"), scope())
    assert first.status == retry.status == "confirmed"
    assert first.receipt_key == retry.receipt_key
    assert len(h.receipts) == 1


def test_replaced_or_unavailable_source_is_invalid_before_retrieval_or_receipt():
    h = host(version=1)
    h.source_available = False
    assert h.handoff(delivery(), event(), scope()).status == "source_unavailable"
    assert not h.receipts


def test_only_exact_utf8_span_counts_not_character_offsets_or_response_text():
    h = host(version=1)
    d = delivery()
    wrong_end = len("prefix ") + len(d.context)
    assert h.handoff(d, event(d, span_end=wrong_end), scope()).status == "content_mismatch"
    assert not h.receipts


def test_changed_owner_cut_cannot_confirm_old_delivery_even_with_exact_text():
    h = host(version=1)
    h.active_cut = "cut-2"
    assert h.handoff(delivery(), event(), scope()).status == "stale"
    assert not h.receipts


def test_proposed_handoff_requires_whole_content_component_to_be_utf8():
    h = host(version=1)
    original = event()
    malformed = event(content_part=b"\xff"+original.content_part,
                      span_start=original.span_start+1, span_end=original.span_end+1)
    assert h.handoff(delivery(), malformed, scope()).status == "invalid"
    assert not h.receipts
