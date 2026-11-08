# HP01 web-dashboard DTO contract v1

## Purpose

Freeze the complete typed mock interface required by the dashboard implementation spec before HU01/backend parallel work. This is a contract and deterministic fixture deliverable, not a running dashboard tab, backend route, product facade or HU01 acceptance.

## Overview

The canonical machine-readable contract is [dashboard-v1.schema.json](../contracts/dashboard-v1.schema.json), generated from `ui_schema.py::SCHEMA`. It is standard JSON Schema 2020-12 with exact objects and a discriminated request/response union for every operation below. `UIRequest`/`UIResponse` apply additional scope, correlation, byte-budget and privacy rules; the schema alone does not authenticate requests. The exported schema must equal its canonical builder in tests. `jsonschema>=4,<5` is a declared contract-validator dependency; the existing 4.26.0 installation was used without installing or changing an environment.

`ui_contract.py` is distinct from provider DTOs. A provider `ProfileGrant` cannot authorize UI operations. A future backend must construct `VerifiedUIContext` only from verified Hermes request authentication plus server-bound Reliquary owner grants, an authorized session-to-REL map/active session, and same-origin checks. Its booleans are trusted fixture inputs, not a login implementation or fields accepted from a browser. The browser never receives the long-lived service credential, owner paths, SQL/store handles or arbitrary source-export access.

## Common typed envelopes

Requests contain exactly protocol version 1, request/operation IDs, profile/principal IDs, nullable session ID, owner ID/generation/cut, nullable expected revision, nullable idempotency key and operation arguments. `ui.owner_sessions` alone has null owner/generation/cut. Every other operation requires those scope values. Generation, revision, timestamp and count integers are bounded decimal strings (up to 39 digits), preserving values above JavaScript's safe integer range. IDs follow the shared 128-character ASCII rule.

Successful owner responses bind `owner_id`, `owner_kind` (`REL`/`PHY`), `display_label`, decimal `generation`, `cut` and exact boolean capabilities. Owner/session enumeration instead has null top-level binding and a separately bound entry for each authorized owner. Capabilities are `view`, `manage`, `history`, `provenance`, `graph`, `community`, `status`, `memory_create`, `memory_edit`, `memory_retire`, `relation_edit`, `community_rename`. They advertise only actual implemented/tested operations in a future live server, never success for an absent API.

All responses match request ID and operation. The verified UI context also binds response owner kind and display label and forbids capability widening. Session mapping must reference an authorized REL, and successful reads must match the owner, history generation and cut exactly. Detail, provenance and history match the requested identities and revisions. Mutations match the stable request and idempotency keys and return a product receipt and committed value. They stay in the requested owner history generation and return an advanced cut for `changed=true`. That flag describes the accepted effect, including when a retry returns its original receipt. Errors use `denied`, `unavailable`, `stale_cursor`, `conflict`, `invalid` or `unsupported`, with null binding and only a stable code and retryable flag.

## Frozen views and operations

- `ui.owner_sessions` pages through authorized owner bindings and returns the selected or authenticated active session with its exact REL mapping. Ordinary sessions default to the main REL. Project sessions use the configured child REL. The backend exposes the independently bound `active_phy_id` only through its view grant. Its stable ID supplies the integration's `user_id`. Absent selections are null. A non-null request session must exist in the trusted session map. A null request session resolves the authenticated active session for enumeration and uses owner-level scope for other operations. Selected-session REL status must match the session's mapped REL.
- `ui.memory_list`: cursor/limit and server filters (query, category, type, lifecycle, community). Records contain stable Memory ID, decimal revision, body ID, title/excerpt, category/type, lifecycle, canonical status, optional supported native Freshness and community ID. Freshness is not synthesized; absent support is null. A supported native decimal value binds its cut without inventing a new ranking algorithm.
- `ui.memory_detail`: Memory ID and nullable requested revision. Result contains summary, exact body revision/body ID/availability/content, retained revisions, supersession target, tombstone flag and typed provenance. Available content is a string; missing/unauthorized/pruned/corrupt content is null. A current body cannot substitute for an unavailable historical revision.
- `ui.memory_history`: Memory ID and paged exact retained revision/body IDs, availability, decimal creation time and nullable content digest.
- `ui.provenance`: exact Memory/revision and typed source records. Hermes source records preserve profile namespace, session/message UID, nullable branch/source revision, digest and an exact authorized UTF-8 byte range with the label `Hermes source / copied snapshot`. Unknown/stale/deleted/unauthorized/pruned/corrupt source is a typed `source_unavailable` reason without private source IDs/range. User-origin records identify the authenticated principal and creation time. Drill-down must revalidate source authorization/revision in the actual host.
- `ui.graph_page`: seed/community scope, depth, node/edge limits and cursor. Nodes have stable semantic node IDs, Memory/community IDs, kind/origin, label, revision/cut. Edges have stable semantic IDs, kind/origin, source/target, revision/cut and active state. Canvas/rendering IDs are not Memory IDs. Returned edges resolve only to nodes in the bounded page and every element matches the cut. Missing routing metadata is unavailable, not an empty successful graph.
- `ui.community_list`: cursor/limit; stable community ID/generation/member count/name/name-origin and optional member cursor. Missing community metadata is an explicit unavailable response, not an empty list.
- `ui.community_members` pages the Memory IDs for one exact community generation and owner cut. Its cursor binds the community ID and generation as well as the usual scope.
- `ui.operational_status` reports the selected owner/session's accepted source cursor, last completed receipt, copied-source state, actual worker state and decimal pending/held/error counts. The source state makes archive/delete tombstones visible for the bound session. Latest recall distinguishes candidate examination, selection, and the exact selected Memory set returned by Reliquary. Search and delivery IDs identify their respective stages. Dashboard inspection leaves Freshness accounting at the Reliquary result-return boundary.

Management pages have at most 128 items and 256 KiB, matching accepted product constants in `reliquary-application/src/management_workflow.rs:7-8`. The complete wire envelope also stays within 256 KiB. Graph pages additionally have at most 500 nodes and 1,000 edges, and never exceed the caller's smaller requested limits or byte budget. Truncation and next cursor are explicit. Depth is 1-3; queries are at most 4,096 UTF-8 bytes, body/range text at most 32,768 UTF-8 bytes. All bounds compose; a page must satisfy the tightest one.

## User-origin operations

Every mutation requires an authorized REL, server-side manage plus its operation capability, same-origin verified UI context, expected owner generation/cut and a stable idempotency key. PHY bindings can advertise scoped reads. Existing-target edits also require an expected revision. `verify_expected_revisions` checks trusted current target revisions, including both relation endpoints. The service must obtain those revisions from the product workflows and return the committed result so the client can preserve drafts on conflicts.

- `ui.memory_create`: title/body/category/type through a manual user-origin workflow. No caller source citation/provenance field exists. The committed result must cite the same authenticated principal as user origin, never fabricated Hermes evidence.
- `ui.memory_edit` requests a correction to the specified Memory revision. ADR 0013 keeps semantic title and body immutable for a stable ID. A committed correction returns the original ID, its superseded revision and a distinct replacement with the requested title, body and authenticated user provenance.
- `ui.memory_retire` requests retirement of the specified Memory revision. The committed result returns the same ID and the new tombstone revision. The product retirement workflow enforces the supersession and reference rules. HU03 owns the confirmation UI.
- `ui.relation_change`: named user association link/unlink, source/target IDs and revisions. Unlink also names the existing edge/revision. The committed edge must retain user origin, exact endpoints and link/unlink active state. An unlink's committed edge revision must advance beyond the expected revision when changed, or equal it for a no-op. Raw/canonical/duplicate/supersession edge edits are not exposed by this API. Their read kinds remain visible; closure-rule mutations require a later separately approved named workflow, not arbitrary edge writes.
- `ui.community_rename`: community ID, expected community generation (carried as `expected_revision`, distinct from the owner generation) and name; committed name-origin is user. The committed community generation must advance beyond the expected revision when changed, or equal it for a no-op.

HP02 exposes these workflows through public Root. The service uses the idempotency key as the durable product request ID and keeps the wire request ID for correlation. The service also resolves immutable body identity and retirement successor evidence from the authorized owner at the requested cut before calling the corresponding product workflow. HU04 verifies these mappings through the live dashboard.

## Cursor, scope and security contract

`CursorBinding` specifies a trusted server registry entry bound to operation, profile/principal, session, owner/generation/cut and exact filters/arguments. The browser supplies only an opaque cursor ID. Filter/owner/remount/cut changes require stale-cursor/resync, never stitching old pages into a new view. The fake registry entry is not a signed cursor or authentication implementation.

Owner changes cancel requests and clear private selections/cache before new rendering. The DTO correlation tests reject prior-owner/cut results; actual cancellation/render cleanup requires HU01/HU02 component/browser tests. The backend must enforce these checks independently of hidden controls. HTML/Markdown/source text stays untrusted, requiring safe rendering, safe URLs, no raw executable HTML and no tool execution; there is no frontend renderer in HP01 to certify.

## Related docs

- [Host and web SDK audit](host-audit.md)
- [Provider/service contract](protocol.md)
- [Verification and real-service gates](verification.md)
- [Documentation index](INDEX.md)

## Notes

Schema, grant, cursor and receipt tests are deterministic contract evidence. HP02 verifies the named Root operations independently. HU01 can use the typed fixtures while building the dashboard bundle, manifest and React components. HU04 verifies the authenticated service, profile and source authorization, cursor registry, and end-to-end handling of product receipts.
