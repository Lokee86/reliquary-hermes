# HP01 version-one protocol and authority

## Purpose

Freeze the bounded HP01 transport, copied-source and server-owned authority DTOs for the standalone integration.

## Overview

Status: frozen contract DTOs and in-memory behavioral fixtures. There is no listening service, credential store, durable import implementation or Root bridge yet.

## Transport and authentication

A future long-lived service binds literal loopback only. The discovery value pins HTTP endpoint, protocol version, Hermes SHA, instance, profile and single-instance lease. Only `http://127.0.0.1:<port>/` or `http://[::1]:<port>/` is accepted by the fixture. DNS hostnames, wildcard/public addresses, userinfo, path routes, query parameters, fragments and absent ports fail closed. No credential goes in a URL or JSON DTO.

A per-profile private credential authenticates an out-of-band header/channel. Private service configuration lives outside the browser and follows the active profile's scoped secret storage; no logs, exports, bundles or shared default-profile cache. The fixture stores only a supplied credential in memory with redacted repr and constant-time equality. It does not provision, save, rotate or prove entropy of a real credential.

Server-side `ProfileGrant` binds profile, authenticated principal, REL owner, authenticated per-author PHY grants and operation capabilities. DTO profile/principal values must match the authenticated binding. Caller owner IDs, filesystem paths, SQL, store handles and executable commands are not part of the schema. Owner identifiers inside grants are trusted server values, never access authority supplied by a model.

The pinned provider capability set excludes user edits and consumption confirmation. `authorize()` also explicitly rejects consumption confirmation while `PINNED_HANDOFF_API_VERSION` is null, even if a grant manually lists that operation. The pinned client rejects successful consumption responses for the same reason. A parsed reserved DTO is not permission to dispatch it. `ProfileGrant` is exclusively provider-channel authority and always rejects `edit_memory`, even with manually expanded capabilities. A distinct authenticated user-origin UI authorization interface must be implemented before an edit can run; it is not modeled as a provider credential in HP01. A JSON `origin='authenticated_user'` claim alone cannot authorize a model tool or provider credential. UI session exchange, browser protections, per-profile credential storage and revocation belong to HP03/HU, not this fixture.

An ambiguous discovery/probe is unavailable, not permission to kill a process, start a second writer or create a fallback owner. Future mount ownership uses existing lease conflicts and a single service owner registry.

## Request envelope

Every request has exactly these fields:

- `protocol_version`: integer 1. Booleans and unknown versions fail.
- `request_id`: bounded correlation ID.
- `operation`: one named operation below.
- `profile_id`, `principal_id`, `session_id`, `turn_id`: explicit bounded IDs. They do not confer grants.
- `expected_revision`, `idempotency_key`: required nonblank IDs for mutations; explicitly null for reads.
- `arguments`: the operation's exact object, with no additional fields.

`expected_revision` is a **host owner-state revision**, not an invented Hermes source revision. For reserved `consumption_confirm`, the idempotency key must equal SHA-256 over canonical `{delivery_id, manifest_digest}`; arbitrary caller keys fail validation. Mutations reject stale revisions. Replay of an already accepted idempotency key with the same scoped operation/content returns its original receipt before CAS evaluation; reusing a key for different content, principal, session or turn conflicts. A new key for an already accepted identical snapshot does not duplicate Memory publication or clocks. The fake import ledger specifies these decisions but is not durable storage.

A future request sequence is: strict DTO decode, out-of-band profile/principal authentication, operation-channel grant check, trusted source/event registration and current owner-cut checks, the named public product operation, then strict correlated response parsing. HP01 implements only the pure DTO/grant/correlation pieces; it does not dispatch operations.

## Named operations

- `snapshot_submit` (mutation): the exact copied snapshot below. Success requires an existing durable accepted import receipt and resulting host revision.
- `memory_query`: `query`, `limit`.
- `refine_query`: `query`, `limit`, turn-scoped `search_id`, `selected_ids`.
- `traverse_graph`: `seed_ids`, `depth`, `limit`, `cut`.
- `consumption_confirm` (mutation): `delivery_id`, `manifest_digest`, `handoff_event_id`. This is a reserved proposed operation, denied by the pinned-host authorization gate. In a future supported revision, event ID must resolve to an authenticated trusted-host registry entry, never caller-supplied event content. Missing handoff-v1 returns unavailable. No model tool exposes this operation.
- `owner_status`: empty arguments. Reports actual worker state and pending-job count, with no invented percentage.
- `inspect_memory`: `memory_id`, `cut`. Read-only and non-reinforcing.
- `edit_memory` (mutation): `memory_id`, `action` (`replace` or `delete`), `content`, `origin='authenticated_user'`. Delete content is empty. Server authentication/capability and stale revision checks remain mandatory. This provider-envelope operation remains denied; the complete separate dashboard mutation vocabulary is frozen in [ui-contract.md](ui-contract.md).

`tools.py::tool_schemas` freezes the three bounded model read-tool schemas. They are arguments to existing host retrieval/refinement/traversal policies, not a second model-side controller. Recalled text is source content, never authority or tool instructions.

## Copied source snapshot

Exact fields: `authority='hermes_source_copied_snapshot'`, `profile_id`, `session_id`, nullable `branch_id`, nullable `source_revision`, `snapshot_digest`, `availability`, `messages`.

Each message has exact `message_uid`, original `role`, original epoch `timestamp`, text-only `content`, and `author={id, is_bot}`. Author ID and bot classification may be null when unknown. IDs are copied, never minted, derived from text, replaced by `_row_id`, or inferred from a display name. No unsupported multimodal body is coerced to text. Missing original identity/time blocks acceptance of that snapshot rather than producing a false successful import.

The SHA-256 digest is over canonical UTF-8 JSON of `{profile_id, session_id, branch_id, source_revision, messages}`. Canonical JSON sorts keys, uses compact separators and rejects nonfinite numbers. It authenticates consistency only, not provenance or authorization. This digest covers the permitted privacy-filtered copy, not a guessed raw canonical source. `SourceSnapshot.parse` returns an untrusted shape-checked candidate. The authority marker, claimed current availability and caller-computed digest cannot prove Hermes provenance. No trusted adapter registration/source proof path exists in HP01; actual acceptance must remain unavailable until HP04 implements it.

`availability` is `current`, `unavailable`, `stale` or `deleted`. Noncurrent DTOs carry no messages. Reads and receipts fail closed when their source binding is unavailable. On edits/deletes/rewinds, invalidate existing imported evidence and all in-flight deliveries first. If reconciliation cannot represent the source change, make the view unavailable until supported resync; never keep serving stale private content. An import cannot rename/delete/rewind Hermes or become session-resume authority.

Callbacks do not carry explicit branch/revision or all historical per-message authors. Unknown metadata remains unknown. The current turn's author is not retroactively assigned to the full history. Default unknown/group/bot/unmapped extraction goes to REL only. Only host-authenticated actor metadata may be passed to `owners_for`; a self-asserted snapshot author ID cannot select a PHY. A PHY is included only through the profile's authenticated per-author mapping, including a separate explicit mapping if a bot is authorized. No BHY/BOT format or implicit operator PHY is introduced.

A bounded sync job copies already filtered provider egress, captures immutable profile/principal/session/epoch, egress digest and IDs/author data and returns `queued_not_durable` or explicit unavailable/backpressure. This fixture queue is volatile. The `BoundSourceImporter` test connects those jobs to an out-of-band registered exact source fixture and per-turn author assertion without assigning that actor to historical rows. Whole copied snapshots remain REL-only. Only separately authenticated exact per-message source identities can acquire their mapped PHY; unknown/mixed/unmapped rows remain REL-only. It proves contract decisions, not real Hermes source authentication or durable publication. HP04 must durably accept source-reference jobs, reconstruct them from a supported source cursor after crash, revalidate source IDs/digest/privacy, and acknowledge only real receipts. No strict pre-compression checkpoint capability is advertised here.

## Required HP04 host-only invalidation gate

The current `snapshot_submit` DTO is **insufficient** to implement source edit/delete/rewind invalidation: its noncurrent empty view is shape-checked, but the import simulation rejects it and no authenticated invalidation transport exists here. Rejecting that notification alone would leave stale content available and must not be the production behavior.

HP04 must define and authenticate a source-adapter-only invalidation event carrying stable event ID, profile/session/known branch scope, affected registered source snapshot digests, reason (`stale`, `deleted`, `rewound` or `unavailable`), and the actual source revision or verified permitted-view digest witness when available. No invented revision or model/browser origin marker may substitute for source verification. If affected bindings cannot be resolved safely, hold the entire scoped imported view unavailable.

Before returning any later recall or receipt, the host durably marks those bindings unavailable, invalidates their prepared manifests/prefetch and advances their local invalidation epoch. It may accept a verified later import only after supported reconciliation; restored availability cannot revive an invalidated old delivery. This gate needs a future host-only DTO/registration path and crash/race tests before HP04 acceptance. `FakeHost.source_invalidation_notice` merely specifies the required visible effect for stale/deleted/rewound/unavailable notices and the no-old-receipt rule; it is not an authenticated event implementation.

## Response envelope

Exactly `protocol_version`, `request_id`, `operation`, `status`, nullable `revision`, nullable `cut`, `result`. The consumer correlates request ID and operation. Retrieval result counts cannot exceed the requested limit, and refinement must preserve the requested search identity. Successful cut-bound traverse/inspection results must match the requested cut exactly; inspection/edit targets and copied-import digests must also match the request. Error responses carry no successful read authority. Status is `ok`, `unavailable`, `conflict`, `denied`, `invalid` or `unsupported`.

Errors contain only stable `code` and boolean `retryable`. No reflected arguments, private content, credentials or exception string. Successful mutations require a resulting revision. Retrieval/inspection require a cut. Their exact typed result shapes are validated in `Response.parse`:

- Retrieval: search/delivery IDs, manifest digest, bounded context and Memory IDs.
- Import: import receipt, copied-snapshot digest and literal `durable=true`.
- Consumption (reserved future schema): receipt/delivery IDs, the exact echoed manifest digest and literal `confirmed=true`; request correlation rejects a different manifest.
- Status: worker state (`pending/running/held/failed/complete/unavailable`), pending count and nullable handoff API version.
- Inspection: Memory ID, content and source snapshot digests.
- Edit: Memory ID and boolean changed.

DTO validation does not prove a server actually committed a mutation. Durable receipts, authorization and product semantics must be tested against the real host in later tickets.

## Limits and isolation

- Wire body: at most 262,144 bytes before parsing. Duplicate JSON keys, malformed UTF-8/JSON, nonfinite numbers and unknown fields fail.
- IDs: 1-128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9_.:-]*`.
- Query: at most 4,096 UTF-8 bytes; context/message/edit content: at most 32,768 UTF-8 bytes.
- Snapshot: at most 128 messages, with unique logical IDs. Memory/seed/selection/digest collections: at most 50. Traversal depth: 1-3. Retrieval limit: 1-50.
- Tool JSON Schema length bounds are characters; the host codec additionally enforces the stricter UTF-8 byte bound. Host validation remains authoritative.
- Credential supplied to the fixture: 32-512 ASCII characters. Actual host provisioning must use cryptographically random material and restrictive private storage.
- Scope/caches bind profile + principal + session + turn + local invalidation epoch. Epoch is adapter cache state, never a fabricated Hermes branch or source revision. Resume/switch/branch/rewind increments it and invalidates old prefetch/delivery state. Profile changes clear bindings, credentials and caches.

## HP02 mapping requirement

Each named operation must be implemented through supported public Root/Gateway/Application methods backed by existing owner workflows. Existing exports are not proof the complete facade exists. No lower-store escape hatch, generic SQL/read-path loader, fabricated live turn or new production dependency edge is permitted. The complete required HU vocabulary is frozen separately now in [ui-contract.md](ui-contract.md) and the exported standard schema. HP02 must implement its named public product operations with the corresponding conformance tests; freezing DTOs does not claim those methods exist.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
