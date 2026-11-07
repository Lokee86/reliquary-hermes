# Proposed generic terminal model-request handoff v1

## Purpose

Specify the missing generic terminal handoff capability and the exact zero-false-consumption boundary.

## Overview

Status: **required upstream capability, not implemented or present at the pinned Hermes SHA**. This file freezes the exact future consumer requirement. `consumption.py` is a pure fixture reducer, not a Hermes hook, service endpoint, acceptance attestation or domain receipt writer.

## Consumer and current behavior

The concrete consumer is an external memory provider with a prepared immutable Memory manifest. Reliquary must confirm only the exact content actually included in a successful model request. Current `prefetch`, tool returns, dashboard reads, request queueing, sanitized pre-request events, response text and pre/post correlation earn zero credit. Pinned host handoff API is null, so authorization denies confirmation even with a manually expanded operation grant, the pinned client rejects successful confirmation responses, and a fabricated accepted-looking event returns unavailable.

Retrieval remains useful and non-reinforcing until a generic upstream hook is independently implemented and tested in Hermes. HP05 cannot claim confirmed-use completion before that gate. This repository does not modify Hermes core to add it.

## Required trusted-host event

Proposed name: `model_request_handoff_v1`. This name is a contract proposal, not an advertised existing lifecycle hook or MemoryProvider method.

The host/transport adapter must issue one immutable **terminal** event per request attempt after all provider/SDK/middleware/fallback transformations and after the attempt's successful/failed/cancelled state is known. It runs in the owning profile's propagated context and carries:

- Stable event ID and attempt ID, with unique attempt identity across fallback/retries.
- Authenticated profile/principal, session, turn and invalidation epoch.
- Terminal outcome: `accepted`, `failed`, `cancelled`, `uncertain`, `replaced` or `omitted`.
- Digest of the exact final model-input request representation, without authentication headers or credential fields. The adapter must bind this digest to the actual attempted payload, not sanitized/capped observability copies.
- Provider delivery ID and prepared-manifest digest, resolved against the host's registered immutable delivery.
- Exact, immutable, decoded UTF-8 model-facing content component and byte-span offsets identifying the injected prepared context after transformation. A provider may use multiple components in a future revision; v1 accepts only a single exact contiguous context component.

`accepted` means the host has positive evidence this successful attempt accepted the exact indicated model input and that it was not later cancelled, replaced or discarded. Queuing, a socket write, a 2xx with an invalid model result, or a response that does not prove which final payload was used is insufficient. An adapter unable to observe the exact final request or acceptance must emit `uncertain`. Failed, cancelled, omitted, replaced and uncertain attempts get zero credit, including cancellation after partial streaming. Never emit preliminary accepted events that later require undoing reinforcement.

The full final payload digest and component/span must originate from the same trusted adapter observation. The reducer checks shape, scope, exact context bytes and manifest binding, but cannot independently prove an arbitrary digest attests real model delivery. That trust boundary requires Hermes-side integration and backend-specific failure tests. A caller can fabricate a dataclass in a unit test; it cannot thereby earn a real receipt.

## Preparation and confirmation rules

The immutable prepared delivery binds delivery ID, scope, owner cut, ordered unique Memory IDs, exact injected text and exact source snapshot digests. Its SHA-256 manifest digest covers all of those fields. Showing or preparing it is non-reinforcing.

The future service registers handoff events on an authenticated **host-only** path. Browser clients, model tools and provider JSON arguments cannot submit arbitrary event objects or claim acceptance. `consumption_confirm` only references a registered event ID and registered prepared delivery; both must be granted to the same principal/profile/turn. Missing current source, changed cut/grant, stale epoch, omitted/transformed/truncated text or mismatched manifest fails closed.

The confirmation idempotency key is derived from delivery ID + manifest digest, not event ID, so retries/replayed events produce at most one durable product receipt for the prepared batch. Receipt persistence, product consumption confirmation and deduplication must be atomic under the accepted Gateway semantics. The in-memory fake set only specifies this behavior; it is not evidence of crash safety.

Success for one batch does not confirm later batches. A change to selected IDs, source digest, owner cut or exact context changes its manifest. The current v1 reducer is intentionally all-or-nothing: partial/truncated context earns no partial credit. Refine/traverse/dashboard reads never implicitly confirm.

## Required independent Hermes tests before activation

1. Capture the exact final accepted component after middleware, provider-specific message adaptation, SDK serialization/preflight and fallback. Show that sanitized/truncated pre-hook payloads cannot substitute.
2. Cover retries with stable attempt identity and exactly-once terminal events. Distinguish model success from malformed/empty/failed model results and transport timeout with uncertain acceptance.
3. Give zero credit on cancellation before dispatch, during streaming, after partial response, omitted/replaced context and unsuccessful fallbacks. Include interruption races before/after terminal event production.
4. Preserve profile/contextvars across thread/executor dispatch, two principals sharing session labels, session switch/resume/branch/rewind, and a late old event.
5. Bind registry events to authorized provider deliveries without transmitting credentials or granting browser/model event-forgery capabilities. Reject wrong-token, wrong-profile, owner/cut/grant tampering and source invalidation races.
6. Connect the exact successful event to a real narrowly exposed Gateway receipt with duplicate/restart/crash tests. No completed gate may rest only on deterministic Python fakes.

The hook must stay generic and have this concrete consumer; no Reliquary-specific branch belongs in Hermes core. Upstream implementation and its tests are a separately scoped task, not silently included in HP01.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
