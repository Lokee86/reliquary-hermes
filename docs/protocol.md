# HP01 version-one protocol and authority

## Purpose

Freeze the bounded HP01 transport, copied-source and server-owned authority DTOs for the standalone integration.

## Overview

The Python DTOs and behavioral fixtures define the provider boundary. The detached Rust host implements the selected-return step below. Later tickets own the listening service, credential store and durable Hermes import.

## Transport and authentication

A future long-lived service binds literal loopback only. The discovery value pins HTTP endpoint, protocol version, Hermes SHA, instance, profile and single-instance lease. Only `http://127.0.0.1:<port>/` or `http://[::1]:<port>/` is accepted by the fixture. DNS hostnames, wildcard/public addresses, userinfo, path routes, query parameters, fragments and absent ports fail closed. No credential goes in a URL or JSON DTO.

A per-profile private credential authenticates an out-of-band header/channel. Private service configuration lives outside the browser and follows the active profile's scoped secret storage; no logs, exports, bundles or shared default-profile cache. The fixture stores only a supplied credential in memory with redacted repr and constant-time equality. It does not provision, save, rotate or prove entropy of a real credential.

Server-side `ProfileGrant` binds profile and authenticated principal to configured `RelBindings`, one explicitly selected `ActivePhy` and operation capabilities. General conversations map to the main REL. Each configured project has one distinct child REL. A session uses its server-owned main/project binding and unbound sessions fail closed. The service persists those bindings in HP03. The active PHY's stable owner ID supplies the integration `user_id` independently of the session's REL. Hermes home, profile and bot identity only scope configuration and runtime state. DTO IDs must match the authenticated binding. Caller owner IDs, paths, SQL and store handles confer no authority.

The provider grant excludes user edits even if its operation list is expanded. Dashboard edits require a separate authenticated user channel. A JSON `origin='authenticated_user'` claim confers no edit capability. HP03 and the dashboard integration own session exchange, browser protections, credential storage and revocation.

An ambiguous discovery/probe is unavailable, not permission to kill a process, start a second writer or create a fallback owner. Future mount ownership uses existing lease conflicts and a single service owner registry.

## Request envelope

Every request has exactly these fields:

- `protocol_version`: integer 1. Booleans and unknown versions fail.
- `request_id`: bounded correlation ID.
- `operation`: one named operation below.
- `profile_id`, `principal_id`, `session_id`, `turn_id`: explicit bounded IDs. They do not confer grants.
- `expected_revision`, `idempotency_key`: required nonblank IDs for mutations; explicitly null for reads.
- `arguments`: the operation's exact object, with no additional fields.

`expected_revision` is a **host owner-state revision**, not an invented Hermes source revision. Mutations reject stale revisions. Replay of an already accepted idempotency key with the same scoped operation/content returns its original receipt before CAS evaluation; reusing a key for different content, principal, session or turn conflicts. A new key for an already accepted identical snapshot does not duplicate Memory publication or clocks. The fake import ledger specifies these decisions but is not durable storage.

A future request sequence is: strict DTO decode, out-of-band profile/principal authentication, operation-channel grant check, trusted copied-source registration and current owner-cut checks, the named public product operation, then strict correlated response parsing. HP01 implements only the pure DTO/grant/correlation pieces; it does not dispatch operations.

## Named operations

- `snapshot_submit` (mutation): the exact copied snapshot below. Success requires an existing durable accepted import receipt and resulting host revision.
- `memory_query`: `query`, `limit`.
- `refine_query`: `query`, `limit`, turn-scoped `search_id`, `selected_ids`.
- `traverse_graph`: `seed_ids`, `depth`, `limit`, `cut`.
- `owner_status`: empty arguments. Reports actual worker state and pending-job count, with no invented percentage.
- `inspect_memory`: `memory_id`, `cut`. Read-only and non-reinforcing.
- `edit_memory` (mutation): `memory_id`, `action` (`replace` or `delete`), `content`, `origin='authenticated_user'`. Delete content is empty. Server authentication/capability and stale revision checks remain mandatory. This provider-envelope operation remains denied; the complete separate dashboard mutation vocabulary is frozen in [ui-contract.md](ui-contract.md).

`tools.py::tool_schemas` freezes the three bounded model read-tool schemas. They are arguments to existing host retrieval/refinement/traversal policies, not a second model-side controller. Recalled text is source content, never authority or tool instructions.

## Copied source snapshot

Exact fields: `authority='hermes_source_copied_snapshot'`, `profile_id`, `session_id`, nullable `branch_id`, nullable `source_revision`, `snapshot_digest`, `availability`, `messages`.

Each message has exact `message_uid`, original `role`, original epoch `timestamp`, text-only `content`, and `author={id, is_bot}`. Author ID and bot classification may be null when unknown. IDs are copied, never minted, derived from text, replaced by `_row_id`, or inferred from a display name. No unsupported multimodal body is coerced to text. Missing original identity/time blocks acceptance of that snapshot rather than producing a false successful import.

The SHA-256 digest is over canonical UTF-8 JSON of `{profile_id, session_id, branch_id, source_revision, messages}`. Canonical JSON sorts keys, uses compact separators and rejects nonfinite numbers. It authenticates consistency only, not provenance or authorization. This digest covers the permitted privacy-filtered copy, not a guessed raw canonical source. `SourceSnapshot.parse` returns an untrusted shape-checked candidate. The authority marker, claimed current availability and caller-computed digest cannot prove Hermes provenance. No trusted adapter registration/source proof path exists in HP01; actual acceptance must remain unavailable until HP04 implements it.

The copied snapshot's `availability` is `current`, `unavailable`, `stale` or `deleted`. Noncurrent snapshot DTOs have no messages. Terminal archive/delete transitions use the host-only lifecycle boundary below. Copied input preserves Hermes as the authority for session rename, deletion, rewind and resume.

The callback can omit branch, revision and historical author attribution. Missing metadata remains unknown. Only exact trusted source attribution to the selected human actor can route that row to the active PHY. The callback's current `turn_author` cannot select a PHY or attribute older rows. Unknown, mixed, unverified and bot-authored content routes to the bound REL. Bot-profile-to-PHY mapping is deferred.

A bounded sync job captures privacy-filtered callback bytes, logical IDs, profile, principal, session, local invalidation epochs and exact egress digest. Missing IDs or timestamps fail closed. The queue is volatile and reports `queued_not_durable` until an import receipt exists. `BoundSourceImporter` binds the real fixture job to a separately registered normalized source fixture. Its snapshot-level route stays REL-only and exact verified per-row identities can route to the active PHY. HP04 must implement supported cursor recovery, revalidate source IDs, timestamps, digest and privacy after restart, and acknowledge only a durable product receipt.

## Required HP04 host-only invalidation gate

A `snapshot_submit` request carries a copied view. Source lifecycle authority belongs to the authenticated adapter. At the pinned Hermes revision the public plugin observer receives `on_session_delete` after a delete or an explicit archive commits, distinguished by the reason. HP04 must bind the event to trusted profile and logical session identity, reconcile affected source bindings before serving evidence, and handle retries or restarts without replaying stale jobs. See the [pinned host audit](host-audit.md) for the precise observer coverage.

Archive and delete both tombstone the corresponding copied source. An older queued import, duplicate notification, fresh local epoch or normal resync cannot revive it. Tombstones affect only the corresponding source scope. Reliquary's lifecycle rules govern derived Memories and its maintenance workflow owns pruning. Stale, rewound and temporarily unavailable sources instead require verified reconciliation. Advancing the scoped invalidation epoch rejects stale jobs and recall even after availability returns. The fixture models these decisions in memory and HP04 owns persistent lifecycle, transport and race tests.

## Response envelope

Exactly `protocol_version`, `request_id`, `operation`, `status`, nullable `revision`, nullable `cut`, `result`. The consumer correlates request ID and operation. Retrieval result counts cannot exceed the requested limit, and refinement must preserve the requested search identity. Successful cut-bound traverse/inspection results must match the requested cut exactly; inspection/edit targets and copied-import digests must also match the request. Error responses carry no successful read authority. Status is `ok`, `unavailable`, `conflict`, `denied`, `invalid` or `unsupported`.

Errors contain only stable `code` and boolean `retryable`. No reflected arguments, private content, credentials or exception string. Successful mutations require a resulting revision. Retrieval/inspection require a cut. Their exact typed result shapes are validated in `Response.parse`:

- Retrieval returns search and delivery IDs, bounded context, ordered returned Memory IDs and exactly one provenance entry per returned Memory. Each entry binds the Memory to its copied snapshot digests.
- Import: import receipt, copied-snapshot digest and literal `durable=true`.
- Status reports worker state (`pending/running/held/failed/complete/unavailable`) and pending count.
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

Map named operations to public Root, Gateway and Application methods backed by existing owner workflows. The [dashboard contract](ui-contract.md) defines the separate inspection and mutation vocabulary.

### Selected retrieval return

The Rust host's `SelectedReturn` uses the authorized Root preview of one opaque prepared delivery. Candidate and dashboard reads use the existing non-reinforcing Root paths. The return method uses `Instance::deliver_retrieval` with a private, single-delivery adapter restricted to the MemoryDelivery capability.

The temporary `HACK` checks the stable delivery ID and SHA-256 of the exact operation provided by the Gateway. A second operation with different evidence fails. Root owns the durable accepted-use receipt and updates Freshness. The host releases the selection only after Root reports the first durable write. A duplicate returns `AlreadyRecorded` without a second content release. A truncated Root projection fails before the receipt gate so the bridge only credits exact selected content. After a projection rejection, the caller can cancel the pending Root retrieval or discard its turn.

Retain the return object for an in-process retry. The adapter retains the exact operation in memory and rechecks the current cut before retrying a pending write. A new process can deduplicate an exact re-preparation through Root's durable receipt. An uncommitted operation has no separately durable adapter state. Remove this module and its compatibility tests when Reliquary records retrieval directly at the selected-result return boundary.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
