# HU08 — New-session-only ingestion and selective Hermes history import

**Date:** 2026-11-09
**Status:** Implemented for Hermes hosts with the version 1 trusted history-export contract.
**Baseline:** `reliquary-hermes` `main` at `28356c5`
**Scope:** plugin setup/provider, trusted Hermes session-store adapter, existing source pipeline, Hermes-native Web/Desktop dashboard

## Purpose

Enabling Reliquary must never silently ingest years of existing Hermes conversations, including implementation-focused conversations the user may resume later. The present provider does **not** enumerate all historical sessions at startup, but Hermes may give `sync_turn` a complete transcript slice after a resumed conversation's next completed turn. Today `provider.sync_turn` forwards that slice to the existing copied-source outbox without a creation-time eligibility check.

The product therefore needs **two explicit, independent pathways**:

1. **Automatic:** capture only genuinely new conversations begun after Reliquary capture was enabled for that Hermes profile.
2. **Manual:** browse and selectively import old conversations from **Reliquary → Sources → Import Existing Sessions**. Nothing from history is imported merely because the view is opened.

This is a *Hermes integration* policy, not a change to Reliquary's Dream/Archive mechanics.

## Overview

This is an opt-in boundary at Hermes source admission: new conversations are automatically captured after enrollment, while historical conversations are excluded unless the user selects them explicitly. Both paths use the same validated and durable Reliquary source importer.

## Target architecture

`Hermes owner-scoped session registry → profile eligibility policy → normal provider callbacks → existing SourceSnapshot / SourceOutbox / signed source-host / Root import`

`Hermes owner-scoped paginated history → authenticated Sources selection view → explicit import command → trusted history-copy adapter → existing SourceSnapshot / SourceOutbox / signed source-host / Root import`

One canonical source normalization, privacy redaction, import identity and receipt path. Different **admission triggers** (automatic eligibility vs affirmative manual selection), not two implementations of ingestion. Hermes remains the authority for session metadata and historical message bytes; Reliquary remains the authority for REL selection, durable import receipts, deduplication and processing.

### A. Automatic capture: new conversations only

- Persist a per-profile **capture enrollment cutoff** when Reliquary automatic ingestion is first enabled. Set it once using the host/server clock in an atomic, private, profile-owned record; reopening setup, reinstalling, upgrading or switching REL must not reset it. Never accept a browser-supplied cutoff. Existing configured profiles upgrading to this policy must establish an initial cutoff at rollout *before any further capture*; missing/unreadable enrollment state fails closed and reports a setup action, rather than treating every session as new.
- Determine **conversation eligibility** from the authoritative Hermes session store: stable session ID, original `started_at`/creation evidence, active profile, parent/compression/branch provenance. A **new conversation root** strictly after the cutoff is eligible. Session resume, same-ID rewind, compression rotation or lineage continuation does **not** make a pre-cutoff conversation newly eligible. A new branch seeded by older, ineligible transcript history must not silently import that history; keep it excluded unless a verified new-source-only segmentation policy is explicitly developed later.
- Enforce the policy before the source worker activates/captures on initialize, session switch and completed-turn `sync_turn`. Ordinary recall may still be allowed by the user's already configured REL; excluded sessions must **never** enqueue copied transcripts or recovery candidates. A missing, ambiguous, foreign-profile or inconsistent Hermes session row fails closed for capture.
- The eligibility check uses Hermes-managed metadata, **not** session-ID prefixes, the current message timestamp, the visible session title, model text, cwd or project-rel routing. An old session that receives a new message is still old. Unknown creation age is not interpreted as new.
- Non-primary contexts remain excluded by the existing provider policy. Do not attempt to infer or rewrite unrelated Hermes session modes.
- Importing an old session manually does **not** enable automatic capture of its future turns; keep the two policies independent. Existing accepted source records, terminal notices and pending outbox receipts remain subject to current replay, archive/delete and crash-fence rules—do not delete or reprocess earlier accepted work while installing this policy.
- Preserve the existing General REL fallback and project REL routing rules. The cutoff is per active Hermes profile, not per REL or per project.

### B. Sources → Import Existing Sessions

**Entry point:** Add a Sources section to the configured Reliquary dashboard (web and Desktop, Hermes-native controls). It must be available after successful owner connection and **not** inserted into initial setup. Surface one explicit action, **Import Existing Sessions**, opening a scoped selection view.

**Selection UI:**
- Read *paginated* Hermes history with existing Hermes session-store APIs (e.g., `SessionDB.list_sessions_rich`) scoped to the currently authenticated profile. Show title, stable conversation identity, original creation and last activity dates, message count, optional named Hermes project, and previous import state. Project and dates are descriptive only.
- Default to historical human-facing top-level conversations, with search/filter, pagination and explicit checkboxes. **No prechecked rows, automatic bulk select or automatic import.** Do not surface non-primary subagent sessions as user conversations; when relationship is uncertain, exclude or mark unavailable rather than silently including them. Archived/deleted/hidden sessions must not be silently treated as normal importable rows.
- Let the user select one or multiple specific sessions and choose an authorized destination: **General REL** or an existing accessible **dedicated project REL**. On stock Hermes without trusted automatic project attribution, manually choosing an *authorized already-configured* project REL may still be supported because this is an explicit user destination choice, not automatic project inference. Never infer destination from a displayed project name.
- Review the exact count, titles and destination, plus an explicit **Import selected** confirmation. Read-only listing/preview cannot enqueue work. Cancel leaves all data unchanged.
- Provide real statuses **Queued / Staged / Processing / Complete / Failed / Already imported / Unavailable**, clearly distinguishing a durable import receipt from finished memory processing. Status must come from the existing queue, signed host receipts and Root processing state, not merely button clicks. Provide bounded retry of failed/unavailable imports without duplicating accepted sources.

**Trusted import operation:**
- Recheck each selected session's existence, profile ownership, active/nonterminal state, acceptable source kind and chosen owner authorization **server-side at import time**. Client-supplied session IDs, project names, source bodies and target REL IDs are requests, not provenance or permission. Resolve the final owner from the current signed Reliquary topology, not a freeform destination path. Require the same Hermes authentication, profile scope and same-origin / verified Desktop-native mutation admission as the existing setup and dashboard mutations.
- Copy the durable Hermes transcript through an **owner-scoped server adapter**; do not send entire messages through the browser or let the browser upload source JSON. Use existing `SessionDB.get_messages` or other supported transcript reader and normalize only those rows with **authentic stable `message_uid` and original timestamps**. Respect canonical compression lineage, copied/absorbed IDs, rewind/active visibility and branch boundaries. Never fabricate an ID, timestamp, source revision, historical author or message offset. Missing required evidence marks that session *Unavailable*, not imported.
- Apply the same **provider egress privacy filtering** as Hermes normal `sync_all` before `capture_snapshot` and the signed source handoff. Avoid raw transcript logging, browser response payloads and alternate unredacted history pipelines. Explicitly verify redaction parity with the installed Hermes version; where a supported redaction interface is absent, fail the manual-import acceptance gate rather than silently bypass it.
- Reuse `SourceSnapshot`, `SourceOutbox`, the authenticated host `/v1/source` path and native Root copied-source importer. There is **no second extraction engine** and no direct model-side historical replay. A manual job must have an authorized session-to-REL binding and appropriate scoped runtime lease so `SourceWorker`/host delivery cannot skip it merely because a different live session is active. Keep normal live-session source processing and manual imports serialized/fenced under their *actual source identity*. Do not impersonate a live `sync_turn` or inject a bogus current conversation to force routing.
- Use the real `(Hermes profile, logical session/source identity, owner binding, normalized source digest)` to detect repeat imports and resumes. Existing native receipts and outbox idempotency are authoritative; selecting an already imported session must yield **Already imported**, not duplicate memories. If the Hermes source has changed since a prior import, do not silently import into a different REL or replay a superseded revision; offer an explicit future reimport decision or mark conflict/unavailable for v1.
- Imports are bounded (per page, selected batch, copied snapshot size, message count, concurrent workers and queue pressure). Existing copied-source v1 has a **128-message snapshot bound**; do not claim a multi-hundred-message historical conversation imported completely if it was truncated. Import full supported chains through verified bounded sequential native-appends and overlap checks **only if** the existing Root importer can accept them consistently. Otherwise mark the entire session unsupported/partial with a visible reason; do not publish a success receipt for an incomplete conversation.
- Import from Hermes **without writing to, resuming, switching, deleting or replaying** its original session. Original conversation timestamps, content and project records remain unchanged. Handle archive/delete notifications consistently with copied-source tombstones and never resurrect a terminal source.

### Persisted state / API ownership

- Store the capture enrollment decision inside the current Reliquary **profile-owned** state directory; the record is the smallest necessary (one cutoff and version; no copied session titles or transcripts). Avoid adding an extra per-session allowlist when stable Hermes creation/lineage evidence is reliable. A separate per-session import state is justified only if the existing native receipts/outbox cannot report the required UI status.
- Add one narrowly scoped **history-list and import-command** backend adapter to the existing plugin's authenticated API. Prefer existing Hermes `SessionDB` access from the active profile over an upstream Hermes patch. Browser receives safe metadata/status only, not private transcript bodies or arbitrary filesystem access.
- Keep the real host's already authenticated source transport and Root import APIs authoritative. If a new host command is unavoidable, limit it to committing an already-verified import candidate under the existing owner grants, never a generic file reader or arbitrary REL write endpoint.
- UI lives in the shared dashboard/desktop surface using existing Hermes-native components. No second standalone frontend or external import service.

## User / Developer Outcomes

- Turning on Reliquary creates **zero automatic imports of preexisting conversations**.
- Resuming an old implementation conversation does not import its original transcript or its later turns.
- New primary conversations ingest normally; other provider and recall behavior stays unchanged.
- Specific old conversations can be imported intentionally, visibly and without duplicates.
- Import work remains auditable through source receipts and actual processing status.

## Implementation Decisions and migration

**Compatibility-preserving policy addition, no separate Hermes upstream dependency unless existing stable APIs prove inadequate.**

1. **Enrollment first:** implement and regression-test the persisted new-session cutoff and lineage-aware eligibility before exposing any manual importer. Test enable/upgrade time; prove old resumed sessions cannot write, while fresh primary sessions do. Retain the current outbox and accepted sources. Do not silently migrate previous unverified capture history.
2. **History adapter:** add bounded profile-scoped listing, exact session resolution and privacy-filtered transcript normalization. Establish one-source verification and dedupe across normal and manual ingestion.
3. **Source delivery:** wire selected historical sessions through the existing signed source channel/Root importer and scoped runtime lease, with durable status and careful conflict/terminal handling.
4. **Shared UI:** add Sources → Import Existing Sessions with no default selection, destination choice, confirmation, progress and retry.
5. **Acceptance:** test in isolated Web and Desktop profiles against the pinned stock Hermes and the optional attribution-patched host. No automatic import actions are triggered by viewing history.

If the Hermes history reader cannot provide original message identity/time or a safe redacted transcript, **stop the import portion and report the precise missing contract**. Do not create another Hermes upstream PR merely for UI convenience; propose the smallest upstream read contract only if a real source-provenance blocker is verified.

## Testing Decisions

- **Cutoff:** fresh vs old vs resumed vs compression child vs branched old history; eligible new session; missing `started_at`/lineage; cross-profile mismatch; retroactive cutoff tampering; setup retry/reinstall; no jobs or owner mutation from excluded sessions. Verify `sync_turn` sees a full historical slice and is still blocked.
- **Listings:** correct profile, pagination/search, archived/hidden/subagent handling, no previews of private bodies, inactive/foreign IDs unavailable, no automatic selection, Web/Desktop parity.
- **Imports:** 1/many selections, cancel, confirm, authorized General/project REL, unavailable owner, wrong origin/profile, duplicate request, queued/retry/crash, native receipt, real processing progress. Check complete original transcript identity/digest and absence of stale rewound/tool duplicate rows.
- **Long sessions:** over-128-message input, native sequential append with correct overlap or explicit unsupported status; no silent truncation.
- **Safety:** redaction parity; spoofed `message_uid`, timestamps, author, project and destination denied; failure preserves original Hermes DB; archive/delete tombstones prevent resurrection; source provenance and REL stay identical after restart.
- Run existing Python provider/API, Rust signed-host/import, Node shared dashboard, TypeScript and pinned/installed Hermes smoke tests. Preserve HP03–HP07 source, reconciliation, setup and authorization regressions.

## Out of scope

- Automatic import of preexisting chats, automatic subagent imports, blanket `import all` or import-on-open.
- New Hermes projects/RELs during import, repository scanning or Git/Lore associations.
- Historical conversation modification, backdated/forged sources, new model processing semantics.
- Automatically reassigning previously accepted session/REL routes or transferring historical memories across RELs.
- A second native import/extraction implementation, new trust authority, wholesale Hermes session API refactor or new upstream change without verified necessity.

## Completion gates

1. Automatic capture is **new-conversation-only** by default and enforced on actual source callbacks, including resumed/rotated old conversations.
2. A profile newly enabling the provider does not create any historical source job; older pre-cutoff chats remain ignored even after later user turns.
3. A configured Web/Desktop Sources section lists *only* authorized historical sessions, none selected by default.
4. Import requires deliberate session selection, explicit target REL and confirmation, checked again server-side under current Hermes/Root authority.
5. Selected conversations produce authentic, privacy-filtered, complete source copies through the **existing** outbox/host/Root pipeline, or accurately report Unavailable/Partial; never silently truncate.
6. Receipts and processing status are genuine; retries do not duplicate work; archive/delete and old accepted session routes remain correct.
7. Source contents and Hermes session records are not changed by import.
8. Applicable automated, installed, security, Web and Desktop tests pass, with no unrelated Hermes PR introduced.

## Related docs

- [Local service and Hermes provider](local-service.md)
- [Copied-source and authority contract](protocol.md)
- [HU05 onboarding and project routing](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [Verification](verification.md)

## Notes

Verified existing seams on the pinned Hermes checkout: `SessionDB.list_sessions_rich` supplies paginated profile-visible records with `started_at`; `get_session_list_row` exposes creation and status metadata; `get_messages` returns stored message rows, including stable IDs where present, and supports paginated reads/ancestors. Hermes normal external-memory `sync_all` applies provider egress redaction, and finalization can pass a full messages slice. The current plugin uses `provider.py::sync_turn` → `source_capture.capture_snapshot` → `SourceWorker`/`SourceOutbox` → authenticated host source ingestion. The configured Reliquary dashboard does **not** currently have a Sources tab; this spec adds it. The exact historical adapter's preservation of copied-source identities/redaction and the existing importer's long-transcript behavior remain implementation acceptance gates.

The [verification guide](verification.md#hu08-selective-import-and-automatic-capture) records the compatibility and installed-host checks. The [host audit](host-audit.md) describes the trusted export and original-creation contract.