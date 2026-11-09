# HU05 — Cross-surface Reliquary onboarding and Desktop interface

**Date:** 2026-11-08  
**Baseline:** `5371fda` — HP07 real-model recall and restart acceptance  
**Branch:** `hu05/onboarding-desktop`

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

The completion gates in this specification define HU05 acceptance.
