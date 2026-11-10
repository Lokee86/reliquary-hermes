# HU05 follow-up — Release-safe General REL and minimal Hermes project attribution

**Date:** 2026-11-09
**Status:** Approved direction, pending implementation and live acceptance
**Integration baseline:** `reliquary-hermes` `main` at `c4930d9`
**Related scope:** the 2026-11-09 [HU05 project-aware onboarding amendment](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md#post-acceptance-amendment--project-aware-onboarding-2026-11-09)

## Purpose

Release Reliquary's existing Hermes integration on stock Hermes without claiming project-specific routing works, while independently preparing the smallest possible upstream change to supply trusted Hermes project identity to the *existing* MemoryProvider lifecycle.

## Overview

Two tracks share one routing contract:

- **A — Stock Hermes release:** All **new, unbound** sessions with no trusted project attribution attach to General REL. Project cards may display saved dedicated owner paths, but no inactive project-specific routing is advertised as usable. Release must not await the Hermes PR.
- **B — Minimal Hermes upstream PR:** Hermes resolves its own first-class project identity for an already scoped session and passes its stable ID to memory providers as an optional existing lifecycle keyword. The plugin already accepts that keyword; no new API, project store, or protocol is needed.

Accepted historical session routes are immutable in **both** modes. Switching a plugin installation or upgrading Hermes must not reroute existing sessions or migrate memories.

## Problem Statement

HU05's updated setup screen enumerates real Hermes projects and can configure dedicated RELs. The Rust host already binds a signed, durable session route from an optional project ID. But the installed Hermes revision `104a7c4` does not provide trusted `session_project_id` through provider initialization or session switching. The plugin's `routing_available()` checks for an upstream `SESSION_PROJECT_ATTRIBUTION_VERSION == 1` marker and is false on stock Hermes. New project conversations therefore attach to General REL.

A configured dedicated project path is *not* evidence that the host actually routes project sessions to that REL. Shipping with selectable project RELs but no usable project attribution misleads users. Deferring the whole plugin for this one missing metadata field is unnecessary.

## Target Architecture

### A. Release-safe General-only mode (plugin; independent)

Keep the current backend unchanged: `ReliquaryMemoryProvider.initialize` and `on_session_switch` pass an optional project ID to `HostClient.attach`; `host/src/registry.rs::bind_session` writes a durable owner route. With no trusted ID, new sessions use the mounted General REL. Once written, an accepted route wins over all later hints.

Use the existing `projects.routing_available()` capability gate. When false:

1. Normal setup still requires **General REL + PHY**, with working Select/Create, the [HU09 local Web picker](hu09-native-file-dialogs-onboarding-spec-2026-11-09.md) and Desktop native picker.
2. Show Hermes projects if project discovery succeeds, but label dedicated routing **Unavailable on this Hermes build**. Saved project REL paths may be shown read-only so prior configuration is not lost.
3. Disable or hide project-specific Select/Create/Use General and any action that would mutate a project REL assignment. Do not create misleading draft selections; do not block General setup because dedicated routing is unavailable.
4. Explain compactly: **Project conversations use General memory on this Hermes version.** Do not imply dedicated REL routing or present a warning suggesting the user can fix it by selecting a project REL.
5. New unbound sessions without trusted project attribution attach to General REL. Explicitly preserve already accepted routes, including existing dedicated routes; no cleanup/migration/deletion of project owner files.
6. Avoid treating `routing_available()` as an authentication grant. Hermes is still responsible for generating trusted IDs; the Rust host remains responsible for validating, authorizing and persisting routes. A browser-provided project ID cannot select an owner's REL.

No storage format, Rust routing protocol, owner topology, SDK, or setup authorization change is required for Track A unless a targeted regression reveals an actual bug.

### B. Minimal Hermes upstream PR (independent)

**One semantic addition:** An optional `session_project_id: str | None` is supplied to the existing `MemoryProvider.initialize(session_id, **kwargs)` and `on_session_switch(new_session_id, **kwargs)` lifecycle callbacks when Hermes itself has a reliable first-class project association for that session.

Ground the value in Hermes-owned session context and canonical project registry, never in plugin-controlled request fields. The installed code already resolves project identity for the session banner through `gateway/session_local_inventory.py::_project(cwd)` and `hermes_cli.projects_db.project_for_path`, with longest registered folder match. Prefer reusing this **existing Hermes policy** at the existing memory-provider kwargs seam (`agent/agent_init_memory_provider.py::_memory_provider_init_kwargs`), not introducing a new project resolver. The effective cwd must be Hermes-owned, from the same session (not a global active-project setting), and the profile registry must be the actual owning profile. Missing or ambiguous attribution yields `None`, never a guessed ID.

The upstream PR must:

1. Pass the optional stable ID to the provider at initial attachment. The project must be an actual active Hermes project from the session's owner profile, not merely a discovered Git repository or folder label.
2. Preserve that authoritative association when Hermes explicitly switches/rebinds a session. Use the smallest existing callback path; do **not** modify every gateway surface, Web/desktop frontend, or session creation API individually. A new session without verified attribution reports `None`. A resumed session's previously durable Reliquary route remains authoritative.
3. Expose `SESSION_PROJECT_ATTRIBUTION_VERSION = 1` from `agent.memory_provider` **only when both applicable lifecycle paths are implemented and tested**. The plugin already uses this marker to enable project-specific controls. The marker is a capability declaration, not a security token.
4. Retain all current MemoryProvider method signatures as-is (they already accept `**kwargs`). No new required parameter for third-party providers; no behavior change for providers ignoring the optional keyword.
5. Preserve the no-provider, nonprimary, and `skip_memory` pathways. No extra memory provider initialization, background work or memory reads.
6. Carry only the opaque ID; no project name, file path, source contents, REL path, secret, permissions, or filesystem operations cross to the provider.

**Strict upstream scope ceiling:** A small provider-lifecycle metadata propagation change, ideally confined to `agent/agent_init_memory_provider.py`, `agent/memory_provider.py` and the single existing switch bridge if required, plus focused tests. If a correct implementation would require changes to Hermes session-storage schema, gateway protocol, project UI, frontend IPC, public HTTP endpoints, or multiple unrelated subsystems, **stop and report that the tiny-PR premise failed** rather than expanding scope. Do not invent a second session-to-project registry or force a refactor of session lifecycles.

### Compatibility and activation

- **Unmodified/stock Hermes:** marker absent -> project-specific controls unavailable, General-only for fresh unbound sessions.
- **Patched Hermes with proven marker:** project cards become editable; newly attached project sessions with a trusted, configured mapping bind their dedicated REL. Unmapped projects still route General. No user migration of prior accepted sessions.
- **Upgrade/downgrade:** existing signed, persisted session routes survive. On downgrade, new sessions route General. On re-upgrade, new trusted sessions may use dedicated RELs; no retroactive reinterpretation.
- The plugin must not infer a project from text, cwd or a browser parameter itself. The **Hermes upstream resolver** owns that decision, even when it legitimately uses Hermes's existing cwd-to-project policy.

## User / Developer Outcomes

- The public plugin can ship and ingest/recall through General REL on stock Hermes.
- Users never see an editable dedicated project selection that cannot affect live routing.
- Hermes changes no session storage, wire protocol, UI, or project schema solely for Reliquary.
- A supported Hermes version upgrades project routing through the already-present plugin seam.
- Historical memories and accepted session routes stay where they are.

## Implementation Decisions

1. Two independent branches/checklists: release-safe plugin work and narrowly upstream Hermes work; do not combine them into one release blocker.
2. Track A is a presentation/capability hard cut of inactive controls, not a Rust routing redesign.
3. Track B is **provider-neutral optional metadata**, not a Reliquary-specific API and not a new project feature.
4. Keep the General REL fallback, existing saved mappings and route pinning. Do not auto-create project RELs.
5. No automatic memory migration or cross-owner recall. Switching from General to dedicated applies to future newly attached sessions only.
6. Do not use the presence of the build marker alone to prove correctness; actual installed project-chat attachment must be tested against a real named Hermes project.
7. The previously discovered Python synthetic processing-config regressions are separately tracked; do not rewrite production processing logic under this routing spec unless a test proves routing caused them.

## Migration Strategy

**Parallel, compatibility-preserving release tracks.**

**Track A (ship independently):**
- Make UI project controls read-only/disabled whenever `routing_available()` is false; preserve existing General/PHY actions and existing project path visibility.
- Update the setup/review wording so it describes General-only behavior accurately.
- Verify fresh first-run in installed stock Hermes, no project REL route claims, General ingestion/recall/restart, and historical dedicated route preservation.
- Build/reinstall from consolidated plugin `main`; publish acceptance evidence and any real test failures. Do not wait for B.

**Track B (small PR):**
- Find the already-owned Hermes session project resolution and pass only its ID into provider initialization and switches. Document the exact metadata authority and any unsupported session types.
- Add a focused Hermes regression proving the kwargs on a named project, no-project session, profile isolation, new session, and session switch/resume; ensure legacy providers remain unaffected.
- Build/run focused upstream tests, then verify a *real installed Hermes* project chat routes into the correct dedicated REL and another project/no-project chat uses General as expected. Inspect the host's signed/persisted binding, not only the UI.
- Submit this as its **own upstream PR**; carry a temporary development branch for tests without making the public plugin depend on it. Upon upstream merge, rebuild with the supported version and reverify capability activation.

## Testing Decisions

**Plugin:** Existing JS onboarding/SDK tests; Python provider setup, project inventory and lifecycle tests; Rust host attachment/route persistence tests; installed browser and Desktop smoke. Add a stock-host regression in which project records and configured REL paths exist but no marker is present, proving project controls are disabled and fresh sessions bind General. Test accepted dedicated session replay stays dedicated after downgrade.

**Hermes:** Focused provider lifecycle tests on the optional keyword, correct active profile registry and Hermes-authored session cwd/project association, a no-project result, switch/resume/restart behavior, and unchanged callbacks for providers that ignore unknown keywords. Test non-primary/`skip_memory` unchanged.

**End-to-end:** On patched Hermes with two projects and one dedicated REL, attach fresh sessions and verify (a) dedicated project -> dedicated REL, (b) unmapped project -> General, (c) unprojected -> General, (d) copied-source ingestion, prefetch and explicit retrieval use the same durable route, (e) existing session route does not move after configuration changes.

## Out of Scope

- Git/Lore repository association, repository scanning, or Rust feature-footprint changes.
- New Hermes project registry/schema, new browser/SDK APIs, gateway wire format, new memory provider interface, project-related frontend changes, user/project ACL redesign.
- Ephemeral-session features or any mention of them in onboarding.
- Moving historical General memories to project RELs.
- Altering primary REL/PHY provisioning or completed HU07 Hermes-native styling.

## Completion Gates

**Track A is complete (release-ready) when:**
1. Stock Hermes has a fully working General REL/PHY onboarding and memory lifecycle.
2. Dedicated project controls are non-actionable and clearly described as unavailable; persisted mappings remain intact.
3. New unbound sessions without trusted project attribution use General, with signed route verification.
4. Existing accepted route files and owner topology are unchanged.
5. Relevant tests/build/docs and installed acceptance pass; any unrelated failures are reported separately.

**Track B is complete (upstream-ready) when:**
1. The Hermes patch has the limited optional-ID propagation scope, plus the capability marker.
2. Session project IDs are produced solely by existing trusted Hermes project policy.
3. All relevant init and switch lifecycle tests pass without changing default provider behavior.
4. Patched installed Hermes demonstrably attaches a real project session to its dedicated REL; old sessions retain prior binding.
5. The PR is submitted separately; a merged upstream change is not asserted until actually merged.

## Related docs

- [HU05 first-run implementation and project-aware amendment](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [Local service and routing](local-service.md)
- [Verification](verification.md)
- [HU07 native presentation](hu07-hermes-native-presentation-spec-2026-11-09.md)

## Notes

Current plugin seams are `src/reliquary_hermes/projects.py::routing_available`, `src/reliquary_hermes/provider.py`, `dashboard/src/onboarding.js`, `src/reliquary_hermes/client.py::HostClient.attach` and `host/src/registry.rs::bind_session`. Installed Hermes `agent/agent_init_memory_provider.py::_memory_provider_init_kwargs` already passes session cwd and other optional metadata; `gateway/session_local_inventory.py::_project` already resolves real Hermes projects from cwd. The specific Hermes switch/resume call-path still needs narrow validation during implementation to avoid misattributing cross-project session switches.

No code, compiled host or upstream Hermes checkout was modified by authoring this specification.