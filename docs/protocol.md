# Version-one protocol and authority

## Purpose

Freeze the bounded HP01 transport, copied-source and server-owned authority DTOs for the standalone integration.

## Overview

The Python DTOs define the provider boundary. The HP03 Rust host authenticates attach and serves owner status through Root. HP02 exposes initial copied snapshots and the selected-return workflow through Root. HP04 and HP05 wire those workflows into Hermes lifecycle and recall.

## Transport and authentication

The Rust service listens on `127.0.0.1` and publishes a literal loopback HTTP endpoint. Discovery pins `endpoint`, `instance_id`, `profile_id`, `protocol_version`, `hermes_revision` and `lease_id`. The client rejects other profiles or versions, non-loopback addresses, DNS hostnames, userinfo, route paths, query parameters and fragments.

The profile secret stays in Hermes secret storage and is passed to the local process on standard input. HTTP authenticates both peers with HMAC-SHA256. The HMAC of the UTF-8 strings `reliquary-hermes-transport-v1`, instance ID and lease ID, separated by NUL bytes, derives a binary per-instance key from the secret.

- Requests send a random 16-byte nonce as lowercase hex in `X-Reliquary-Nonce`. The `Authorization` value is `Reliquary ` followed by the lowercase hex HMAC of `request`, the HTTP route, the nonce and the exact body, separated by NUL bytes.
- Authenticated responses return the lowercase hex HMAC of `response`, the request nonce, the decimal HTTP status and the exact response body in `X-Reliquary-Proof`. The client verifies this proof before parsing the response.
- `POST /v1/attach` accepts exactly `discovery`, `principal_id` and `session_id`. Its success returns `discovery`, `session_id`, `rel_id` and `user_id`. `POST /v1/request` uses the provider envelope below. Each exchange uses one fixed-length JSON body. Invalid authentication, browser-origin traffic and alternate Host headers fail before dispatch.

The server binds the profile and authenticated principal to configured RELs and one explicitly selected PHY. Authenticated attach persists the main or configured project route for a session. Provider requests require an existing session route. The active PHY's stable owner ID supplies `user_id` independently of the session's REL. Hermes home, profile and bot identity scope configuration and runtime state. Only the private server registry chooses owners.

The provider channel denies user edits. Dashboard edits require a separately authenticated user channel. HP03 serves `owner_status` through Root. Source, inspection and retrieval requests return typed unavailable results until the corresponding live service wiring exists.

An ambiguous discovery probe reports unavailable. A missing discovery file or literal connection refusal can start a candidate. The candidate must acquire the service lease before opening any writable Root owner. The host uses existing Root writer conflicts across separate service profiles.

## Request envelope

Every request has exactly these fields:

- `protocol_version`: integer 1. Booleans and unknown versions fail.
- `request_id`: bounded correlation ID.
- `operation`: one named operation below.
- `profile_id`, `principal_id`, `session_id`, `turn_id`: explicit bounded IDs. They do not confer grants.
- `expected_revision`, `idempotency_key`: required nonblank IDs for mutations; explicitly null for reads.
- `arguments`: the operation's exact object, with no additional fields.

`expected_revision` is a **host owner-state revision**, not an invented Hermes source revision. Mutations reject stale revisions. Replay of an already accepted idempotency key with the same scoped operation/content returns its original receipt before CAS evaluation; reusing a key for different content, principal, session or turn conflicts. A new key for an already accepted identical snapshot does not duplicate Memory publication or clocks. The fake import ledger specifies these decisions but is not durable storage.

The host verifies transport authentication, decodes the exact DTO, checks profile, principal, session and operation grants, then invokes an available Root workflow. The client verifies the response signature and correlation. Trusted copied-source registration and mutation-cut checks enter live dispatch in HP04.

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

## HP04 private source adapter

`POST /v1/source` uses the same instance-bound transport proof and requires the configured profile and principal. The provider invokes this private channel from its filtered Hermes callback and the committed lifecycle observer. The profile credential authorizes this adapter. A JSON authority claim in a model-facing request conveys no source grant.

The exact envelope carries `protocol_version`, `profile_id`, `principal_id`, `session_id`, integer `generation`, `idempotency_key`, `operation` and `arguments`. A snapshot sends the original canonical copied view as `source_json` and its SHA-256 as `snapshot_digest`. Invalidation sends an empty object. A terminal operation sends the committed `archive` or `delete` reason. Both reasons share one terminal identity for the logical session. The generation fences adapter work and has no meaning as a Hermes source revision.

The service verifies the original source bytes, bounds and authenticated session route before staging through public Root. It retains the original epoch timestamp in the copied digest and converts its decimal value once to the native nanosecond field. An append requires an exact overlap with the previously accepted tail. The Root extension separately checks its completed predecessor receipt, current branch head and new logical IDs. A duplicate returns its recorded native receipt. A changed or unverifiable prefix fences the source as unreconciled.

A durable response binds `session_id`, `generation`, `idempotency_key` and `receipt` and carries `durable=true`. It records native staging for snapshots and the persisted fence for invalidation. A terminal reply requires the native tombstone when an accepted copy exists. The host fences the session before attempting that tombstone, so the older snapshot cannot replay while an open native epoch delays terminal publication.

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

## HP02 product mappings

The host uses `Instance::begin_retrieval`, `memory_query`, `refine_query` and `traverse_graph` for the existing retrieval workflow. `Instance::processing_status`, `live_stage_status` and `host_operation_status` expose owner work through the authenticated public API. The dashboard uses `WorkspaceManagement::inspect` for bounded, cut-bound reads. The [dashboard contract](ui-contract.md) defines its separate mutation vocabulary.

The REL management facade exposes `create_memory_at_cut`, `correct_memory_at_cut`, `retire_memory_at_cut`, `change_memory_association` and `rename_community_at_cut`. The service will translate their durable receipts into the dashboard result DTOs. The community projection requires a current accepted partition and returns unavailable when one is absent.

### Copied-source product boundary

The trusted source adapter can normalize a text-only snapshot through `NativeImportPlan::from_hermes_copy` and the existing Root import workflow. The copied author remains provenance and the initial import runs REL-only. Root binds a terminal notice to the original principal, profile, session and accepted normalized copy digest. It retains the receipt and source identity after tombstoning, hides the source body, and rejects exact stale replay. HP04 owns continuous copying, rewrite reconciliation, and service-side invalidation while a source transition is pending.

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
