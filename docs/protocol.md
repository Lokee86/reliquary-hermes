# Version-one protocol and authority

## Purpose

The package retains the signed wire protocol and profile-fenced Hermes secret reads for its local transport token. For the stock Hermes v0.23.4 target, ordinary/structured completions use the registered plugin's `ctx.llm` in a separate context-bound worker; embeddings use an explicitly selected native Reliquary Switchboard route. The native process reads only that route's protected embedding credential locally; endpoint secrets never cross the broker. The unified root entry registers the worker, provider and `on_session_delete` hook. See [current installation and disclosure](../README.md). This target awaits assembled verification; historical evidence is scoped separately in [verification](verification.md#stock-hermes-native-embedding-target).

Freeze the bounded HP01 transport, copied-source and server-owned authority DTOs for the standalone integration.

## Overview

The Python DTOs define the provider boundary. The HP03 Rust host authenticates attach and serves owner status through Root. HP02 exposes initial copied snapshots and the selected-return workflow through Root. HP04 and HP05 wire those workflows into Hermes lifecycle and recall.

## Transport and authentication

The signed source-status response includes nullable `embedding_error` metadata.
An unavailable or incompatible embedding route/identity is reported without removing
the accepted import receipt. Startup configuration failures use the safe codes
`embedding_unconfigured`, `embedding_config_invalid`, and
`embedding_credentials_unavailable`. Source staging and inspection remain available;
semantic work stays pending or unavailable. Diagnostics must not reflect endpoint
secrets, prompts, source content, or authentication material.

Embedding bounds belong to the native Switchboard endpoint, not Hermes's facade
or multipart broker. `ConfiguredEmbeddingEndpoint` sends bounded native requests
with distinct `search_query` and `search_document` modes and validates returned
dimensions and normalization. No embedding request/result vectors use the broker.

The Rust service listens on `127.0.0.1` and publishes a literal loopback HTTP endpoint. Discovery pins `endpoint`, `instance_id`, `profile_id`, `protocol_version`, `hermes_revision` and `lease_id`. The client rejects other profiles or versions, non-loopback addresses, DNS hostnames, userinfo, route paths, query parameters and fragments.

The profile secret stays in Hermes secret storage and is passed to the local process on standard input. HTTP authenticates both peers with HMAC-SHA256. The HMAC of the UTF-8 strings `reliquary-hermes-transport-v1`, instance ID and lease ID, separated by NUL bytes, derives a binary per-instance key from the secret.

- Requests send a random 16-byte nonce as lowercase hex in `X-Reliquary-Nonce`. The `Authorization` value is `Reliquary ` followed by the lowercase hex HMAC of `request`, the HTTP route, the nonce and the exact body, separated by NUL bytes.
- Authenticated responses return the lowercase hex HMAC of `response`, the request nonce, the decimal HTTP status and the exact response body in `X-Reliquary-Proof`. The client verifies this proof before parsing the response.
- `POST /v1/attach` accepts `discovery`, `principal_id`, `session_id` and optional `project_id`. The provider adds the project ID only from the opted-in Hermes session lifecycle. Browser and dashboard DTOs carry no project-routing authority. Its success returns `discovery`, `session_id`, `rel_id` and `user_id`. `POST /v1/request` uses the provider envelope below. Each exchange uses one fixed-length JSON body. Invalid authentication, browser-origin traffic and alternate Host headers fail before dispatch.

The server binds the profile and authenticated principal to configured RELs and one explicitly selected PHY. The first authenticated attachment persists the dedicated REL when trusted Hermes attribution has a configured mapping. Other new sessions bind to General memory. Further attachments reuse the accepted REL even if the incoming attribution differs. Provider requests require an existing session route. The active PHY's stable owner ID supplies `user_id` independently of the session's REL. Hermes home, profile and bot identity scope configuration and runtime state. Only the private server registry chooses owners.

The provider channel denies user edits. Dashboard edits require a separately authenticated user channel. The provider envelope serves `owner_status` and turn-scoped retrieval through Root. Source delivery uses the separate authenticated source channel. Dashboard inspection uses the Root management surface.

An ambiguous discovery probe reports unavailable. A missing discovery file or literal connection refusal can start a candidate. The candidate must acquire the service lease before opening any writable Root owner. The host uses existing Root writer conflicts across separate service profiles.

## Hosted inference

The private `/v1/inference/*` control operations extend the same signed loopback service. They use its existing profile, principal, instance, service lease, nonce, Host/Origin checks, and response proof. They are not browser APIs or model endpoints. No provider credential crosses this protocol.

A dedicated profile-bound worker holds the registered plugin's `ctx.llm`. Its identity handshake requires `protocol_version=2` and contains the actually resolved general completion provider/model plus the optional native Perception route identity, not a Hermes embedding identity. The host binds the existing General/Decision contracts to that worker and the Embedding contract directly to native Switchboard. The existing general-to-decision adapter retains schema validation. Worker and host reject results from a different identity or epoch before publication. This worker version is separate from the unchanged version-one provider/discovery envelopes below; mixed worker/native versions must fail closed.

The native host resolves `<hermes_home>/reliquary/processing.json` with exactly `{"config_path": "<absolute CVCFG path>"}` once at startup. Existing pointers outside the profile are permitted; new Setup/CLI selections must resolve inside the active profile. Switchboard's `ResolvedEmbeddingRoute::from_path` loads only the explicit embedding slot and referenced encrypted API key using its existing OS-store lifecycle. Its `OpenAiReady` transport sends `input_type=search_query` or `search_document` directly to the selected service. The broker receives neither endpoint secrets nor embedding vectors. Restart the host after setup or key repair/rotation.

Durable per-owner evidence binds provider/endpoint hash, model, dimensions, query/document modes and normalization. Key bytes are not identity, so credential rotation alone does not change the space. Preserve immutable `embedding-identities-v1/` markers and source/processing receipts. Existing vectors without verified evidence report `embedding_identity_unbound`; incompatible evidence reports `embedding_identity_stale`. Synthetic probe similarity cannot establish compatibility. Without a verified match, explicitly replay authorized sources into a new REL through the normal import/owner workflow; do not reset markers, receipts, or vectors in the old REL.

The broker supports identity, heartbeat, claim, request-part, result-start, result-part, cancel, and worker-error operations for completion and optional Perception work only. Jobs carry bounded deadlines and correlation IDs. Requests and results use 64-KiB raw parts with an exact part count, byte count, ordering, and SHA-256 digest; base64 parts remain below the existing 256-KiB JSON wire limit. The broker bounds total job bytes and pending jobs and returns typed backpressure instead of truncating results. It retains no durable plaintext prompt cache. Embedding jobs and vectors are not broker operations.

Admission reserves capacity among the four HTTP workers for claim/result control requests. Model work runs without holding the SourceService, Registry, or Retrieval service locks. A worker exit, expired deadline, profile/instance/lease change, host restart, or changed model identity invalidates pending work and rejects late responses. No Hermes embedding API or credential fallback is consulted: native embedding configuration is explicit. The worker owns a scope-free integration runtime lease and can process work without an active chat turn. The optional Perception route and its Hermes-scoped credential handling remain unchanged. [Perception configuration](local-service.md#perception-decision-route)

## Profile setup

The profile-scoped setup API is under the Reliquary dashboard plugin namespace. It provides `GET /setup-v1/status`, `GET /setup-v1/projects`, `POST /setup-v1/dialog`, `POST /setup-v1/create`, `POST /setup-v1/validate`, and `POST /setup-v1/apply`. The Hermes request scope selects the profile, including when the profile has no `owners.json`. Status reports `configured`, `runtime_detected`, `local_dialogs_available`, current owner defaults and a safe embedding status. The owner validate and apply body contains `main_rel`, `active_phy`, and optional `projects` keyed by project ID. Embedding selection uses the separate admitted `POST /setup-v1/embedding` operation taking exactly `{"config_path": "<existing absolute profile-local CVCFG>"}`, not a route or key payload; it validates the CVCFG and persists the pointer. Mutations require same-origin browser admission or the Hermes-verified local Desktop grant. The JSON body limit is 64 KiB. Selection does not provision credentials or hot-reload a running host. [Setup usage](local-service.md#native-switchboard-embedding-route)

Project inventory comes from the profile’s Hermes registry. The response includes stable IDs, display names and the host routing capability. Validation checks changed assignments against active projects. The local dialog accepts a JSON object with only `mode` (`open_rel`, `open_phy`, `save_rel`, or `save_phy`). An authenticated same-origin request must also pass the Windows local-interactive check. The reply contains `status` (`selected`, `cancelled`, or `unavailable`) and an absolute `path` only when selected. It is a candidate for the normal setup operation. Create accepts an owner kind and new path, and a verified active project ID for a dedicated REL. The setup service locks the profile while the Rust host creates the owner through public Root and verifies the resulting file. It returns the selected path and owner metadata. Creating either REL role returns `scope: "unspecified"`. PHY creation returns a null scope.

The setup service calls `reliquary-hermes-host setup-validate --state-dir <profile-state>` with bounded JSON over stdin. The request carries the resolved owner configuration. The report exposes owner kind, stable ID, the scope stored in the REL header, open result and fixed validation codes. Any verified REL 2.1 can fill either REL role. The role follows the explicit configuration and trusted session routing. The host preflight uses public Root read-only verification and leaves no service lease. First setup revalidates, writes bootstrap settings, and checks the signed host topology before activating the provider. A successful apply returns `valid` and `configured` set to true. A failed initial preflight returns the validation report with `configured` set to false. The service token remains private.

An accepted profile uses signed `/v1/setup/status`, `/v1/setup/review` and `/v1/setup/apply` through the same setup admission. Status returns the assignment generation, current absolute paths and owner IDs, and the original PHY ID used for legacy work. Review accepts only the roles supplied and returns their verified paths and owner IDs with the observed generation. Apply checks that review under the owner request guard. It admits each changed owner against the reviewed ID before staging its grants, then publishes one committed assignment generation. A stale review returns `owner_switch_stale`. If a file at the reviewed path has a different owner ID, Apply returns `mounted_owner_changed`. The one-shot `setup-status` command reads the accepted record for stopped-profile status.

Attach still returns `session_id`, `rel_id` and `user_id`. New routes persist both owner IDs. Legacy routes use the pre-upgrade PHY recorded in the accepted topology. An inactive binding returns `session_phy_inactive`. Queued manual imports carry their reviewed PHY as `expected_phy_id` on the private source wire and wait when it is inactive. Existing source receipts use the original PHY where the legacy record lacks that field.

## Dashboard owner discovery

The initial `ui.owner_sessions` read can start the configured profile's host and verify its signed topology after a service restart. Operational reads and mutations continue using the same `dashboard-v1` DTOs and authorization rules.

The Hermes plugin admits the request through the pinned dashboard authentication guard and uses the host-bound profile home to read that integration's settings. In-process routes use the stamped secret scope. Hosted routes use the profile worker's launch home after private IPC admission. The browser sends the existing `ui.owner_sessions` envelope. The plugin uses the configured profile and the active PHY stable ID for `VerifiedUIContext`. Its private service request uses the configured service principal and credential.

`POST /v1/dashboard/topology` uses the existing signed loopback framing and accepts exactly `profile_id`, `principal_id`, and nullable `session_id`. It returns only configured owner bindings, the active PHY ID, and the selected session's exact REL mapping. Every session requires a durable attach record before topology lookup can return its REL. A read never creates a binding or starts the service.

Owner metadata comes from bounded public Root inspection. The decimal generation is the little-endian 128-bit prefix of Root's generation. The cut binds the full Root inspection cut and generation by SHA-256. Browser pages are at most 128 owners, and continuations bind the authenticated scope, arguments, and owner cuts. The dashboard advertises the enumeration view capability in this slice.

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

The copied snapshot's `availability` is `current`, `unavailable`, `stale` or `deleted`. Noncurrent snapshot DTOs have no messages. Committed deletes and rewinds use the host-only lifecycle boundary below. Copied input preserves Hermes as the authority for session rename, deletion, rewind and resume.

The callback can omit branch, revision and historical author attribution. Missing metadata remains unknown. Only exact trusted source attribution to the selected human actor can route that row to the active PHY. The callback's current `turn_author` cannot select a PHY or attribute older rows. Unknown, mixed, unverified and bot-authored content routes to the bound REL. Bot-profile-to-PHY mapping is deferred.

A bounded sync job captures privacy-filtered callback bytes, logical IDs, profile, principal, session, local invalidation epochs and exact egress digest. Missing IDs or timestamps fail closed. The queue is volatile and reports `queued_not_durable` until an import receipt exists. `BoundSourceImporter` binds the real fixture job to a separately registered normalized source fixture. Its snapshot-level route stays REL-only and exact verified per-row identities can route to the active PHY. HP04 must implement supported cursor recovery, revalidate source IDs, timestamps, digest and privacy after restart, and acknowledge only a durable product receipt.

## Integration runtime leases

Runtime lifecycle uses the existing authenticated, instance-bound loopback transport. `/v1/runtime/attach` registers an opaque runtime instance under an integration kind and returns a separate runtime lease ID. A runtime renews that lease with `/v1/runtime/heartbeat` and cleanly retires it with `/v1/runtime/detach`. A runtime may attach with an opaque source scope or without one. An adapter can associate additional source scopes with its lease through `/v1/runtime/scope`. Owner binding and the process lease remain separate.

Expiry durably records an unclean runtime and establishes a fence for each affected integration source scope. A replacement runtime sees the required recovery scopes and their fence epochs. Only the current lease for that scope can supply reconciliation evidence for the observed epoch. A clean detach releases only its exact lease. The host begins graceful shutdown when a clean detach leaves neither live leases nor unresolved crash fences.

## HP04 private source adapter

The provider admits new automatic snapshots only when the owned Hermes row carries native original-creation and root provenance beyond the profile enrollment cutoff. Legacy and restored rows cannot gain that proof on resume. The normal Hermes egress callback supplies copied bytes, original timestamps and logical message IDs. Existing outbox jobs retain their original session, generation and digest.

A confirmed manual import uses the same copied snapshot and outbox. Hermes v1 history export applies whole-transcript provider scrubbing before Reliquary receives any message fields. The source request carries the explicitly selected configured REL ID under the authenticated profile and scoped lease. The host pins the accepted source owner and returns a receipt using the same public Root importer. Status distinguishes the durable queue and receipt from native processing completion.

`POST /v1/source` uses the same instance-bound transport proof and requires the configured profile and principal. The provider invokes this private channel from its filtered Hermes callback and the committed lifecycle observer. The profile credential authorizes this adapter. A JSON authority claim in a model-facing request conveys no source grant.

The exact envelope carries `protocol_version`, `profile_id`, `principal_id`, `session_id`, integer `generation`, `idempotency_key`, `operation` and `arguments`. A snapshot sends the original canonical copied view as `source_json` and its SHA-256 as `snapshot_digest`. Invalidation sends an empty object. A terminal operation sends the committed `delete` reason. Archive and restore preserve the copy. The generation fences adapter work and has no meaning as a Hermes source revision.

A rewind sends `event_id`, `previous_head_message_uid`, `last_surviving_message_uid`, and `removed_message_uids`.
The two head fields can be null. A large suffix sends a bounded list with `removed_uids_complete=false`;
the adapter prioritizes known copied heads that the host journal confirms were removed. A rewind
increments the local generation and its idempotency key includes the digest of those exact arguments.
The adapter records the journal cursor and pending job in one transaction, replays a source's removals
in order, and holds capture and provider recall while an acknowledged owner cut is pending.

The Hermes provider supplies its runtime `lease_id` for snapshot delivery. During crash recovery, a fresh provider transcript callback also supplies the observed `fence_epoch`. Ordinary outbox keys stay unchanged. Reconciliation attempts have a distinct durable key bound to the exact lease and epoch. Ordinary replay is fenced before receipt lookup. The recovery snapshot must prove continuity with the latest accepted head, even if an older receipt matches it. A committed deletion remains terminal throughout recovery.

The service verifies the original source bytes, bounds and authenticated session route before staging through public Root. It retains the original epoch timestamp in the copied digest and converts its decimal value once to the native nanosecond field. An append requires an exact overlap with the previously accepted tail. The Root extension separately checks its completed predecessor receipt, current branch head and new logical IDs. A duplicate returns its recorded native receipt. A changed or unverifiable prefix fences the source as unreconciled.

A durable response binds `session_id`, `generation`, `idempotency_key` and `receipt` and carries `durable=true`. It records native staging for snapshots and the persisted fence for invalidation. A terminal reply requires the native tombstone when an accepted copy exists. The host fences the session before attempting that tombstone, so the older snapshot cannot replay while an open native epoch delays terminal publication.

## Required HP04 host-only invalidation gate

The [stable host audit](host-audit.md) pins HP04 verification to Hermes `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`. The source-copy, tombstone, replay and runtime recovery gates use that exact checkout.

A `snapshot_submit` request carries a copied view. The profiled adapter obtains removal authority
from the committed Hermes journal. Its legacy fallback accepts the positively committed delete
hook on older hosts. The delivery scope binds the exact profile, principal, and copied session. See
the [pinned host audit](host-audit.md) for observer coverage.

Archive and delete both tombstone the corresponding copied source. An older queued import, duplicate notification, fresh local epoch or normal resync cannot revive it. Tombstones affect only the corresponding source scope. Reliquary's lifecycle rules govern derived Memories and its maintenance workflow owns pruning. Stale, rewound and temporarily unavailable sources instead require verified reconciliation. Advancing the scoped invalidation epoch rejects stale jobs and recall even after availability returns. The fixture models these decisions in memory and HP04 owns persistent lifecycle, transport and race tests.

## Response envelope

Exactly `protocol_version`, `request_id`, `operation`, `status`, nullable `revision`, nullable `cut`, `result`. The consumer correlates request ID and operation. Returned Memory IDs cannot exceed the requested limit, and refinement must preserve the requested search identity. Query and refinement may also return up to eight Observations from Core's ranked selection. Successful cut-bound traverse/inspection results must match the requested cut exactly; inspection/edit targets and copied-import digests must also match the request. Error responses carry no successful read authority. Status is `ok`, `unavailable`, `conflict`, `denied`, `invalid` or `unsupported`.

Errors contain only stable `code` and boolean `retryable`. No reflected arguments, private content, credentials or exception string. Successful mutations require a resulting revision. Retrieval/inspection require a cut. Their exact typed result shapes are validated in `Response.parse`:

- Retrieval returns search and delivery IDs, bounded context, ordered returned Memory IDs and exactly one provenance entry per returned Memory. Each entry binds the Memory to its copied snapshot digests.
- Query and refinement include `observations` when the exact return contains verified claims. Each entry carries an owner-qualified Observation ID, revision, body ID, claim, status, time scope, and optional validity. Evidence references retain their owner, history generation, source kind and ID, revision, body, field and UTF-8 byte range. Ultimate Memory lineage identifies the exact source revisions and their copied snapshot digests. The request's `limit` applies to the combined count of Memories and Observations. An Observation-only result has empty `memory_ids` and `provenance`. Only returned Memory IDs can seed traversal.
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

The REL management facade exposes `create_memory_at_cut`, `correct_memory_at_cut`, `retire_memory_at_cut`, `change_memory_association` and `rename_community_at_cut`. The dashboard service translates their durable receipts into dashboard result DTOs. The community projection requires a current accepted partition and returns unavailable when one is absent.

### Copied-source product boundary

The trusted source adapter can normalize a text-only snapshot through `NativeImportPlan::from_hermes_copy` and the existing Root import workflow. The copied author remains provenance and the initial import runs REL-only. Root binds a terminal notice to the original principal, profile, session and accepted normalized copy digest. It retains the receipt and source identity after tombstoning, hides the source body, and rejects exact stale replay. HP04 owns continuous copying, rewrite reconciliation, and service-side invalidation while a source transition is pending.

### HP05 turn-scoped retrieval

The model tools send the provider envelope to `POST /v1/retrieval/tool`. Automatic prefetch requests its result through `POST /v1/request`. The host binds the turn controller to the authenticated profile, principal, session and turn and uses the session's durable REL route. Refine uses the opaque search ID for the current controller. Traverse uses the opaque returned cut and Memory seeds from that controller. Root runs its one-hop traversal policy.

The adapter can send the same `memory_query` envelope to `POST /v1/retrieval/prepare` ahead of actual prefetch. That response carries preparation status only. The host reuses a matching prepared request when the adapter asks for its result. Turn and source changes invalidate cached context. Selection checks occur before the durable selected return, including the result count, exact projection and live cut.

For copied Hermes evidence, each selected Memory's source references resolve to a bound REL session and stable message ID in an accepted snapshot. The return applies the same checks to each current Memory revision in an Observation's ultimate lineage, including derived Observations. A stale, ineligible, unreconciled or terminal source fails the exact return before content is released. Memories from other authorized Root sources can carry an empty copied-snapshot digest list.

### Selected retrieval return

The Rust host's `SelectedReturn` uses the authorized Root preview of one opaque prepared delivery. Candidate and dashboard reads use the existing non-reinforcing Root paths. The return method uses `Instance::deliver_retrieval_confirmed` with a private, single-delivery adapter restricted to the MemoryDelivery capability.

The temporary `HACK` checks the stable delivery ID and SHA-256 of the exact operation provided by the Gateway. A second operation with different evidence fails. Root confirms a new exact disclosure and records durable Freshness for any selected Memories. The host releases an Observation-only selection on the same confirmation path. A replay returns `AlreadyRecorded` without releasing content again. The host checks the full context and serialized response sizes before calling the delivery gate. Core's bounded ranked selection can be delivered intact, while actual loss of bytes or evidence fails the return.

Retain the return object for an in-process retry. The adapter retains the exact operation in memory and rechecks the current cut before retrying a pending write. A new process can deduplicate an exact Memory-containing re-preparation through Root's durable receipt. The temporary adapter's exact operation state is local to the process. Remove this module and its compatibility tests when Reliquary records retrieval directly at the selected-result return boundary.

## HU03 dashboard requests

Hermes authenticates and profile-scopes the plugin route `/api/plugins/reliquary-hermes/dashboard-v1`. The backend loads that profile's configured Reliquary topology through the authenticated loopback service. The private topology route returns the configured RELs, active PHY and verified session mapping. The private dashboard request route carries the canonical dashboard DTO, a private Root continuation if present, and the result of the host's same-origin check. Python rebinds profile and principal, and Rust checks the topology, selected session, owner generation and exact accepted cut. Only the bounded dashboard DTO and a server-issued cursor token reach the browser.

Same-origin writes use the Origin against Hermes' admitted Host and scheme. Hosted plugins receive request-local sensitive-route admission from Hermes over private IPC. Hosted browser mutations require an Origin and same-origin Fetch Metadata because Hermes strips the public Host before forwarding. Hosted Desktop mutations require Hermes' private native admission bit for the worker's profile and an absent Origin. The signed private service route accepts only the named public Root workflows for mutations and uses the configured active PHY as their actor. Provider operations keep their original service principal. A private durable intent retains the accepted original cut and exact inputs required for Root replay.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
