# HU05 — Cross-surface Reliquary onboarding and Desktop interface

**Date:** 2026-11-08
**Baseline:** `5371fda` — HP07 real-model recall and restart acceptance
**Branch:** `hu05/onboarding-desktop`

**Post-acceptance revision (2026-11-09):** The original HU05 architecture and acceptance record remain historical. The [project-aware onboarding amendment](#post-acceptance-amendment--project-aware-onboarding-2026-11-09) below supersedes the manual project-row and web path-entry UX for this targeted follow-up. This is not a new phase.

## Purpose

### Problem Statement

Reliquary is operationally integrated with Hermes, and the web dashboard can manage configured owners, but first-run setup is still CLI-first. An unconfigured web dashboard shows an unavailable binding state instead of guiding setup, and the Hermes Desktop app has no native Reliquary management surface at all.

This creates three user-facing inconsistencies:

1. the visible Reliquary web tab cannot complete its own initial setup;
2. the Desktop app can use the Reliquary provider/runtime but cannot configure or inspect it;
3. setup logic is owned by the provider CLI path rather than exposed as one reusable backend capability for all Hermes surfaces.

The correction is to make setup and management one shared Reliquary capability with web and Desktop UI adapters.

## Overview

### Target Architecture

Canonical call direction:

`Hermes Web UI / Hermes Desktop -> profile-scoped Reliquary dashboard/setup API -> shared setup service -> existing settings/token/runtime owners`

The existing provider remains the runtime integration:

`Hermes MemoryProvider -> reliquary-hermes-host.exe -> Reliquary Root`

### Shared setup service

Introduce one internal setup module under `src/reliquary_hermes/` that owns all first-run configuration behavior currently spread across `provider.post_setup`, `settings.save_settings`, and token provisioning.

The setup service exposes a small internal interface conceptually equivalent to:

- `status(home)`
- `validate(home, candidate)`
- `apply(home, candidate)`

It must reuse, not duplicate:

- `save_settings()`
- `ensure_setup_token()`
- existing owner/config validation
- existing provider selection / enablement semantics
- existing `owners.json`, `provider.json`, `processing.json` formats

`hermes memory setup` becomes a thin CLI adapter over this service.

### Setup candidate

The user-visible candidate contains only meaningful local choices:

- main/general REL path
- active PHY path
- optional project REL entries
- optional Reliquary config path when the detected/default path is not desired

The following are backend-derived and must not be manually required from normal users:

- Hermes profile/home
- plugin host binary path
- service credential
- transport/runtime identity
- dashboard principal authority

The active Hermes profile is authoritative. The installed plugin determines its own host binary. A private random service credential is generated through Hermes secret storage.

### Runtime/config defaults

For a normal local installation:

- host binary defaults to the installed `plugins/reliquary/host/reliquary-hermes-host.exe`;
- processing config defaults to the locally configured Reliquary development/product config when known;
- an existing supported `processing.json` is preserved and displayed;
- setup never copies credential secrets into Hermes configuration.

### Owner preflight

Add a bounded host-side setup-validation command/mode to `reliquary-hermes-host.exe` using public Reliquary Root APIs.

It validates a candidate path without starting the long-lived service and returns only nonsecret metadata required for onboarding:

- path accepted/rejected;
- owner kind: REL / PHY;
- owner stable ID;
- REL scope/type where available;
- whether the owner can be opened;
- topology conflicts detectable without mutating state;
- whether the selected Reliquary config opens successfully.

Python must not learn REL/PHY storage internals.

### Dashboard setup API

Extend `dashboard/plugin_api.py` with a separate authenticated setup surface that is available before `read_settings()` succeeds.

Suggested operations/endpoints:

- setup status
- setup validation
- setup apply

Requirements:

- Hermes authentication remains mandatory.
- The active dashboard profile/home is resolved server-side exactly as current dashboard requests are.
- Browser-supplied profile/principal values never establish authority.
- Setup mutations require same-origin admission.
- Secrets are never returned to the browser.
- Applying setup is atomic from the user's perspective: either the persisted setup is valid and the provider can use it, or setup reports failure without claiming completion.

The existing `dashboard-v1` operational contract remains unchanged for configured profiles.

### Web onboarding UI

The current unconfigured dead end is replaced with a first-run setup view.

Unconfigured state displays:

- Reliquary runtime detected / unavailable;
- Reliquary config detected / path;
- main REL path;
- active PHY path;
- optional project REL rows;
- validation results with owner kind/ID;
- `Validate`;
- `Connect Reliquary`.

The web UI uses validated path entry. It must not pretend to provide an OS file picker when the dashboard SDK cannot.

On successful apply:

1. invalidate setup/discovery reads;
2. retry `ui.owner_sessions`;
3. transition into the existing operational dashboard without requiring a separate CLI setup.

### Desktop interface

Add a native Hermes Desktop plugin contribution for Reliquary.

Desktop is an adapter over the same setup/management backend contract, not a separate Reliquary implementation.

Desktop requirements:

- visible Reliquary entry/pane in the Desktop UI;
- same configured/unconfigured state model as web;
- same setup validation and apply operations;
- native `pickOpenPath()` for REL/PHY/config path fields;
- normal operational owner/memory management through the same backend APIs;
- active Desktop profile routes requests to the matching Hermes profile.

Where practical, share presentation-neutral state/request code between web and Desktop. Do not couple backend contracts to React or to either shell.

## User / Developer Outcomes

- Opening Reliquary for the first time leads directly through setup instead of a dead end.
- A user can configure Reliquary entirely from the web dashboard.
- A user can configure and manage Reliquary from Hermes Desktop.
- CLI, web, and Desktop all produce the same persistent state.
- No new credential or owner configuration format is introduced.
- The Rust host remains the only component that understands Reliquary owner internals.
- Existing HP07 provider, retrieval, source lifecycle, dashboard authority, and restart behavior remain intact.

## Implementation Decisions

1. One canonical setup implementation lives in the Python integration package.
2. `provider.post_setup` delegates to that implementation.
3. Web and Desktop call the same profile-scoped backend setup contract.
4. Existing `owners.json`, `provider.json`, `processing.json`, and Hermes secret storage remain canonical.
5. The host executable path is derived from the installed plugin, not entered by ordinary users.
6. Profile identity is derived from Hermes request scope, not entered by ordinary users.
7. Service credentials remain backend/private and are generated automatically.
8. REL/PHY structural validation belongs in the Rust host via public Root.
9. Web supports path entry; Desktop enhances it with native file selection.
10. The existing configured dashboard API is not broadened to permit pre-configuration authority. Setup gets its own narrowly scoped surface.
11. Desktop and web target feature parity for setup and ordinary Reliquary management.

## Migration Strategy

This is a staged hard cut for setup ownership.

### Stage A — canonical setup service

Move setup orchestration out of `provider.post_setup` into the shared setup service. Update CLI setup to call it directly. Do not leave duplicate setup logic behind.

Gate:
- CLI setup behavior remains green;
- existing HP03/HP04/HP07 provider setup tests remain green.

### Stage B — host preflight + setup API

Add the host validation mode and authenticated dashboard setup endpoints.

Gate:
- valid REL/PHY/config accepted;
- wrong owner kind, missing file, invalid config, topology conflict, and foreign profile denied;
- setup token remains private;
- no configured owner is mutated during validation.

### Stage C — web onboarding

Replace the unavailable dead-end with the onboarding state and transition into the existing dashboard after apply.

Gate:
- fresh profile can complete setup entirely through the web dashboard;
- refresh/restart preserves setup;
- configured profiles still open directly into the existing dashboard.

### Stage D — Desktop contribution

Add the native Reliquary Desktop surface using the same backend contract and native file picker.

Gate:
- fresh local profile can complete setup in Desktop;
- same profile/config is visible in web after Desktop setup and vice versa;
- Desktop can browse the same owner/memory management data as web.

### Integration gate

Run the complete HP03–HP07 relevant regression suite plus new onboarding/Desktop acceptance. There must be only one setup implementation and one persisted setup shape.

## Testing Decisions

### Shared setup service

Test through the service interface:

- status before/after setup;
- default resolution;
- idempotent reopen;
- preservation of project/session mappings where appropriate;
- token creation without token disclosure;
- failed apply does not claim configured state.

### Host validation

Rust tests cover:

- REL detection;
- PHY detection;
- wrong-kind rejection;
- invalid/corrupt owner;
- config open success/failure;
- no owner mutation;
- no long-lived lease left behind.

### Setup API

Python/FastAPI tests cover:

- authenticated active-profile access;
- foreign/profile spoof denial;
- same-origin mutation requirement;
- bounded request sizes;
- no secret fields in responses;
- setup before `owners.json` exists;
- transition to ordinary `dashboard-v1` after apply.

### Web

Browser/JS tests cover:

- unconfigured setup screen;
- field validation;
- explicit error state;
- successful transition to operational dashboard;
- existing configured dashboard behavior unchanged.

### Desktop

Hermes Desktop contribution tests cover:

- registration/rendering;
- active profile routing;
- `pickOpenPath()` integration;
- cancel handling;
- setup apply;
- operational management reads;
- web/Desktop parity against one profile.

### Final live acceptance

On Windows:

1. install plugin in a fresh local Hermes profile;
2. open Reliquary in web with no setup;
3. configure real REL + PHY through UI;
4. verify runtime starts and dashboard becomes operational;
5. open the same profile in Desktop and verify the same configuration/data;
6. repeat with Desktop-first setup in a second fresh profile;
7. run a real conversation, ingestion, recall, restart, and dashboard receipt check.

## Out of Scope

- Changing Reliquary owner/config storage formats.
- New account/ACL model.
- Remote/cloud Reliquary provisioning.
- Browser filesystem upload of REL/PHY files.
- Automatic inference of project REL assignments from conversation text.
- Replacing `hermes memory setup`; it remains the supported headless adapter.
- Redesigning existing Memory/graph/dashboard operations.

## Completion Gates

HU05 is complete only when:

- the web Reliquary tab never dead-ends on an unconfigured local profile and instead offers setup;
- Hermes Desktop has a native Reliquary setup/management surface;
- CLI, web, and Desktop converge on one shared setup implementation and persisted state;
- host-side validation proves REL/PHY/config choices without exposing storage internals to Python/JS;
- setup secrets remain private;
- cross-profile authority remains denied;
- web-first and Desktop-first live setup both pass;
- existing HP07 ingestion/recall/restart acceptance remains green;
- no duplicate setup path or temporary compatibility adapter remains.

## Related docs

- [Local service and provider](local-service.md)
- [Integration verification](verification.md)

## Notes

The completion gates above record the original HU05 acceptance, not implementation of the changes below.

---

## Post-acceptance amendment — Project-aware onboarding (2026-11-09)

### Problem Statement

HU05 established a functioning setup service and shared web/Desktop form, but normal onboarding still demands manually created REL/PHY files, absolute paths and invented project IDs. The current "Add project REL" action appends an ID/path row without creating an actual Hermes project. A project REL does not automatically route that project's conversations: the Rust host currently relies on a separate static session-to-project map. This is a UX and host-adapter correction to the existing HU05 architecture, not a replacement integration.

### Overview

The revised setup screen presents **General memory** (required General REL, Select/Create), **Active identity** (required PHY, Select/Create), then **Project memories** with one card per existing active Hermes project. Each card shows the actual name and effective memory route, with Select REL, Create REL and Use General actions. The final Review/Connect stage validates selected owners and explicitly warns once about projects falling back to General memory. The optional processing config and absolute path fields move under Advanced. Hermes-native HU07 controls are retained.

### Target Architecture

- Hermes first-class project registry -> active-profile project discovery adapter -> shared web/Desktop onboarding.
- Selected/created owners -> existing profile-scoped setup service (status, validate, apply) -> Rust host owner verification -> existing config and topology.
- Trusted Hermes session/project attribution -> authenticated first attachment -> **durable, immutable session REL route** -> ingestion, processing and recall.
- Hermes project identity and project REL mapping are distinct from Git/Lore repository correlation. No repository attachment is needed for ordinary memory operations.

#### Hermes project discovery and project cards

1. Read first-class projects from the authenticated active Hermes profile, not directory guesses or Git repo discovery. Installed Hermes already exposes projects through its web workspace-discovery route; use a supported host integration on each surface. Preserve stable Hermes project IDs as internal map keys and display human names. A multi-folder project is ONE card. Newly created projects appear after refresh; existing assignments remain visible on subsequent visits.
2. List every active Hermes project, including projects without a dedicated REL. Archived projects are not offered for new assignment; preserve pre-existing associations without silently deleting them. If discovery fails, display an error, not a misleading empty list.
3. Each project card displays Dedicated REL or Using General memory. Provide Select REL, Create REL and Use General. The main UI has **no Project N ID text fields or unbound Add project REL rows**.
4. Offer a distinct **Create Hermes project** action. It must use Hermes's own project-creation operation and obtain a real stable project ID before any REL binding. Do not create a phantom Reliquary project or write Hermes project DB directly. If the supported plugin surface cannot create a project, hand off to Hermes's existing project creation UI/CLI and refresh, rather than inventing an unsupported endpoint.

#### Owner selection, creation and file browsing

1. **Desktop:** reuse its existing native path picker to select existing REL/PHY/config files; add a destination choice for Create. Cancel does not modify state.
2. **Web:** add a narrow authenticated, read-only **host-filesystem picker**, not a browser upload control. It lists directories and eligible REL/PHY/config candidates on the Hermes host machine. It does not preview or return arbitrary file bytes, recursively scan trees, or index repositories. Label clearly that it browses the machine hosting Hermes, not a remote browser's disk.
3. Restrict listing to explicitly permitted roots: the current profile home, previously configured owner directories, relevant Hermes project folders, and operator-approved additional roots. Resolve/canonicalize every step and reject traversal outside these roots, symlink/reparse-point escapes, UNC/network locations and malformed paths. Cap listing sizes, depth, path length and time. Provide typed local errors. Advanced manual paths remain available for otherwise valid locations not exposed to the picker; their final selection must still pass host preflight.
4. Authenticate every list request and bind it to the active Hermes profile. Creation requires the existing same-origin / verified native Desktop mutation admission, a profile setup lock and validated destination. Never interpret a browser-selected path, owner ID or project ID as an authorization grant.
5. Add one small Rust-host owner-creation operation using public Root APIs: create non-project General REL, project-scoped REL or PHY, at a user-confirmed new path; **never overwrite an existing file**. Preflight after creation must confirm kind, scope, owner ID and ability to open. Do not require a separate installed Reliquary CLI, run arbitrary user-supplied commands or copy Root storage internals into JS/Python. Created owner files remain real files even when later setup fails; report that rather than deleting them silently.
6. The current host setup-validate mode remains the canonical final owner check. Browsing alone is not validation or acceptance.

#### Memory routing rules

1. General REL and active PHY are required for connecting. Dedicated project RELs are optional. If a Hermes project has no dedicated mapping, its **new sessions use General REL**; non-project sessions also use General REL. No REL is implicitly created for every Hermes project.
2. On Continue, when one or more visible projects lack a dedicated REL, show a **non-blocking confirmation** with the count and the statement that they will use General memory. The user can Continue or return to edit; no warning needs to persist after a confirmed choice. Absence of General REL or active PHY is a hard validation failure.
3. A project with a dedicated REL routes new sessions to that owner **only when the project identity comes from trusted Hermes session metadata**. The current Hermes provider initialize/switch callbacks do not by themselves supply a usable project ID; establish the authoritative session-to-project attribution contract before implementing this bridge. Do not infer project IDs from cwd, text, folder names, browser request fields, or model output. If trusted attribution is unavailable, this feature is NOT accepted.
4. Bind once on first authenticated host attachment. The durable host session route governs **all** ingestion, processing, automatic prefetch, and explicit query/traversal. The current provider/host must not choose different owners in different operations.
5. Previously attached sessions keep their accepted REL even if the associated Hermes project later changes its REL selection. No historical General memory is automatically copied, moved or deleted when a dedicated project REL is assigned.
6. Current host constraint to address: registry.rs route_for uses a static session_projects map, while Topology::is_accepted refuses any topology different from the stored version. Simply changing owners.json, or restarting with an expanded list, does NOT make later project additions work. Define narrow, authorized **append-only project registration** with preserved main REL/PHY, existing project owner IDs and accepted session routes; require an explicit service restart/reconfiguration when live mounts cannot be updated safely. Do not remove topology-v1.json, invalidate past accepted routes, or quietly remap existing sessions to force a match. Reject conflicting/unsafe changes with a specific error.
7. No Git/Lore repository or file correlation in this routing policy. Project membership is enough to select a REL.

#### Persisted format and API ownership

- Preserve the existing owners.json projects map (Hermes project ID -> REL path), plus existing provider.json, processing.json, topology and session-route formats where possible. An absent project key means General fallback. Do not introduce a parallel project identity or memory routing database.
- Extend the existing profile-scoped setup-v1 surface for project discovery, bounded host directory listing and explicitly admitted owner creation. Reuse the existing Rust verification and setup service; do not add an independent setup orchestrator.
- The shared web/Desktop view owns interaction and display, not filesystem or routing authority. Desktop picker and web browser differ only at the host adapter. Use existing Hermes-native controls and structural-only CSS.
- Setup must distinguish validated/accepted, creation success but connection failure, requires-restart, topology conflict and unauthorized access. Never claim the new topology is active when the host still uses an older route.

### User / Developer Outcomes

A first-time user can select or create General REL, PHY and optional project RELs without typing internal IDs or running the Reliquary CLI. Current Hermes projects and their effective memory routes are visible and stay in sync with the profile. Every project can use General memory by default. Source ingestion and retrieval agree on the session's permanently accepted REL. Web and Desktop provide real file selection while retaining security boundaries.

### Implementation Decisions

- Treat this as the scoped **HU05 follow-up**, reusing the accepted HU05 setup, HU06 native admission and HU07 presentation. No new phase, skin, configuration store or service architecture.
- Replace manual project rows in normal onboarding; retain existing headless CLI and Advanced manual paths.
- Create only explicitly requested owners; project discovery must never trigger automatic REL creation.
- Preserve accepted session bindings and distinguish safe project addition from prohibited owner swaps.
- Keep Git/Lore attachment, automatic repository scanning, repository grant management and any optional build-feature slimming outside this fix.

### Migration Strategy

This is a staged hard cut of the **onboarding UI**, with small focused backend additions:

1. Verify supported Hermes project-list, project-create and **session attribution** interfaces. Implement the trusted active-profile project adapter and first-attachment mapping without exposing project IDs as user inputs.
2. Add the canonical Rust owner-create action and the securely scoped web filesystem browser. Reuse Desktop picker and existing setup-validate preflight.
3. Replace onboarding form rows with General/PHY Select/Create, Hermes project cards, Advanced, and one non-blocking fallback confirmation. Keep shared UI and native components.
4. Address append-only project topology registration/restart behavior while keeping accepted session routes immutable.
5. Validate complete web/Desktop first-run and previously configured profiles, then remove obsolete normal-UI manual project ID controls and compatibility CSS if any. Retain backend ID validation for persisted and headless inputs.

### Testing Decisions

Test through existing Rust host, Python setup/API, JS dashboard/Desktop and installed Hermes seams.

- Project inventory: multiple projects, a multi-folder project, missing REL, archived project, refresh after new Hermes project, unavailable registry, foreign-profile and stale project selection.
- Web browser: correct host filesystem vs remote browser, allowed roots, traversal and symlink/reparse escapes, UNC, unreadable directory, output caps, unauthorized request, cancel and valid final owner.
- Owner create: correct General/project scopes and PHY kind, occupied path fails without overwrite, interrupted creation, reselect existing owner, successful creation followed by failed connect leaves owner intact.
- Setup: required General and PHY; project REL optional; fallback warning gives correct count and has explicit Continue/Cancel; existing selected owners persist after reopen.
- Routing: new mapped project session selects project REL; unmapped or non-project session selects General; ingestion and recall use the same signed durable route; two concurrent projects remain isolated; restart preserves mapping; change of a project's REL does not move existing attached sessions.
- Host lifecycle: accepted topology extension without rewriting earlier session routes, or explicit restart-required outcome; no deletion of topology; scope/writer/duplicate owner conflicts rejected.
- Installed smoke: first-time and return visits in Hermes Web and Desktop, dark/light mode, disabled native-mutation capability, and HP03–HP07 regression checks.
- Run Rust/JS/Python test suites, build both bundles, the shared documentation checker, and git diff --check.

### Out of Scope

Git and Lore project-repository attachment, VCS source scanning/indexing, Cargo dependency feature cleanup, automatic memory migration, unrelated Hermes session-persistence policy, remote file upload, new ACL/account models and redesign of Root storage.

### Completion Gates

1. No normal user-facing project ID entry; all cards match active Hermes projects with stable backed IDs.
2. General REL and PHY Select/Create work from Web and Desktop without a separate CLI. Web browsing is real, limited to authorized host paths, and does not read arbitrary files.
3. Unassigned projects display General fallback and produce one non-blocking confirmation; users can complete setup without dedicated project RELs.
4. A real Hermes project's authenticated session routes to its configured REL at first attachment; unmapped sessions route to General; all later operations use the accepted route.
5. New project configurations do not corrupt existing topology or reassign an accepted session. Live changes either use safe registration or explicitly require reconfiguration/restart.
6. Existing setup state, Rust validation, same-origin/profile admission, provider processing/recall and web/Desktop UX remain operational.
7. Repository attachment remains inactive and no unrelated session-persistence promises appear in onboarding.
8. Relevant automated and installed acceptance, builds, docs and whitespace checks pass.

### Further Notes

Current source seams: dashboard/src/onboarding.js and setup_client.js; desktop/src/plugin.js; src/reliquary_hermes/setup.py, settings.py and dashboard_api.py; host/src/registry.rs and setup_validation.rs. The installed Hermes dashboard exposes a project inventory through /api/chat/workspaces; its project registry is distinct from discovered repos. **Confirm** the supported session-attribution and project-creation interfaces at implementation time rather than assuming that project display names or worktree paths are authoritative. This specification is a proposed follow-up, not a claim of implemented acceptance.
