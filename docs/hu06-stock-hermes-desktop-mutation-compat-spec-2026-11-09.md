# HU06 — Stock-Hermes Desktop mutation compatibility gate

**Date:** 2026-11-09  
**Baseline:** `5b338b5671672fb0461f62a46ef920ffa7131d99` — HU05 verified against the installed Hermes native-admission fix  
**Repository:** `C:\!bin\workspace\reliquary-hermes-onboarding`

## Problem Statement

HU05 proved the full Reliquary Desktop management surface, including sensitive Memory and graph mutations. That acceptance exposed a Hermes host limitation: stock Hermes `b766b76988449e15e3914037d3e03fb96af72774` redeems the native Desktop ticket at the gateway but does not preserve the resulting native-admission fact when forwarding a request into an isolated plugin worker.

Reliquary correctly requires same-origin/native admission for mutations, so on stock Hermes:

- Desktop setup status and reads work;
- Desktop setup validation/apply and Reliquary mutations are rejected with `same_origin_required` / denied;
- same-origin web dashboard mutations continue to work;
- the Reliquary runtime, ingestion, retrieval and conversation integration are unaffected.

A local Hermes fix proves the intended secure path, but a public Reliquary plugin must not require users to patch or fork Hermes while the upstream fix is unreleased.

The public plugin therefore needs a compatibility mode that preserves stock-Hermes support without weakening authorization.

## Target Architecture

The public plugin exposes one server-derived capability describing whether the current request environment supports trusted native Desktop mutations.

Conceptually:

`Hermes request scope -> Reliquary API capability derivation -> shared UI capability model -> Desktop presentation`

The capability is **not** inferred from a Hermes version string. It is derived from the admission mechanism actually available to the request/runtime.

The existing authorization path remains canonical:

- browser writes require same-origin browser admission;
- native Desktop writes require a verified native admission;
- no admission means no write.

The compatibility layer changes presentation and feature availability only. It does not add an alternate mutation transport.

### Capability shape

Add one presentation capability to the profile-scoped Reliquary setup/dashboard status contract, e.g.:

- `desktop_native_mutations: true|false`

Equivalent naming is acceptable if it clearly means: “this Hermes host can securely carry native Desktop mutation authority into the active plugin worker.”

The value is server-derived.

It must never be set from:
- a browser/renderer request body;
- a Desktop-provided version string;
- plugin-local preferences;
- user configuration.

### Capability derivation

The backend reports native mutation support only when the current Hermes environment provides a trusted native-admission mechanism compatible with the existing Reliquary `_same_origin()` guard.

For hosted isolated workers, this is presently represented by Hermes setting:

`request.state.hosted_native_http_authenticated is True`

after profile-bound native ticket verification at the gateway.

Direct/native non-hosted execution may continue to use the existing `native_http_principal` path.

Absence of either trusted mechanism means native Desktop mutations are unsupported.

Do not probe by attempting a destructive mutation.

### Desktop behavior

When `desktop_native_mutations == true`:

- preserve current HU05 behavior;
- setup validation/apply are enabled;
- Memory create/edit/retire are enabled;
- relation/community mutations are enabled.

When `desktop_native_mutations == false` on stock Hermes:

- owner discovery and all reads remain enabled;
- Desktop setup/status UI remains visible;
- mutation controls are disabled rather than allowed to fail after submission;
- setup fields that require a sensitive write may be displayed but Connect/Apply is disabled;
- the UI states that the installed Hermes build does not yet support secure Desktop writes for isolated plugins;
- the UI directs the user to the Reliquary web dashboard for setup/write management;
- no suggestion to patch Hermes or disable plugin isolation is presented as the normal public-product path.

The read-only state must be visually distinct from owner-level capability denial. This is a host transport capability limitation, not a Reliquary REL permission failure.

### Web behavior

Web behavior is unchanged.

Same-origin web setup and mutations remain available on stock Hermes because their authorization path does not depend on native Desktop admission forwarding.

The compatibility gate must not disable or narrow web mutation controls.

### Shared UI model

Where the web and Desktop surfaces currently share state/presentation-neutral request code, extend that model with the host capability rather than branching deep inside every mutation component.

The Desktop adapter owns the decision to expose a mutation writer.

Preferred shape:

- shared backend/status returns the capability;
- Desktop composition creates/passes the mutation writer only when capability is true;
- existing mutation panels already treat a missing writer as non-writable and should be reused where possible;
- add one clear host-compatibility notice at the appropriate parent surface rather than duplicating warnings in every panel.

Do not change Root owner capability flags such as `manage`, `memory_edit`, etc. Those describe Reliquary authorization, not Hermes transport capability.

## User / Developer Outcomes

- The public Reliquary plugin installs and runs on stock Hermes without requiring a private Hermes branch.
- Stock-Hermes users retain runtime integration, recall, ingestion, Desktop browsing and the full web management surface.
- Desktop write buttons do not misleadingly appear functional when Hermes cannot securely carry native mutation authority.
- Users get a clear upgrade path: use the web dashboard now; Desktop writes become available automatically on a compatible Hermes release.
- Reliquary authorization remains unchanged and fail-closed.
- No Hermes version allowlist/denylist needs ongoing maintenance.
- When Hermes ships the upstream native-admission fix, the same public plugin enables Desktop mutations without a Reliquary update if the server-derived capability becomes available.

## Implementation Decisions

1. Treat stock Hermes as an external compatibility boundary.
2. Preserve one canonical mutation authorization implementation.
3. Add a host/runtime capability, not a second auth path.
4. Detect capability from authenticated request state/host behavior, never from version strings.
5. Do not weaken `_same_origin()`.
6. Do not disable plugin isolation.
7. Do not route native Desktop writes through browser semantics or forge an Origin.
8. Do not add Reliquary-specific native tickets, secrets or loopback mutation servers.
9. Do not modify Root owner capability flags to represent Hermes compatibility.
10. Web writes remain fully supported on stock Hermes.
11. Desktop writes become available automatically when the host supplies trusted native admission.
12. Public documentation states the temporary limitation by capability, with the first compatible Hermes release recorded once one exists.

## Compatibility Strategy

This is compatibility-preserving at a real external boundary: released/stock Hermes installations exist independently of the Reliquary plugin.

There are two supported host states:

### Host without native mutation forwarding

Supported public-plugin behavior:
- Desktop reads: supported.
- Desktop mutation/setup writes: capability-gated off.
- Web reads/writes/setup: supported.
- Runtime/provider behavior: supported.

### Host with native mutation forwarding

Supported behavior:
- full HU05 web and Desktop feature parity.

These are not two internal implementations. Both use the same Reliquary API and authorization logic; only the host capability determines whether Desktop exposes the write path.

### Removal condition

Do not immediately remove the gate when the Hermes fix merges to `main`.

The compatibility state can be retired only after the project intentionally drops support for every released Hermes version lacking native forwarding. Until then, capability detection is the correct external compatibility boundary.

## Testing Decisions

### Backend capability tests

Cover:

- hosted request with `hosted_native_http_authenticated=True` reports Desktop mutations supported;
- hosted authenticated request without native admission reports unsupported;
- direct request with valid `native_http_principal` reports supported where applicable;
- spoofed headers/body values cannot enable support;
- capability reporting does not disclose native ticket/grant material;
- foreign profile routing cannot inherit another profile's capability/admission.

### Stock Hermes acceptance

Against unmodified Hermes `b766b76988449e15e3914037d3e03fb96af72774` or equivalent released build lacking the fix:

- plugin installs;
- Desktop Reliquary pane loads;
- owner discovery/read paths work;
- Desktop mutation controls are disabled before submission;
- explanatory compatibility notice is shown;
- web setup and full mutation lifecycle still pass;
- no `same_origin_required` errors occur during normal Desktop use because unsupported writes are not offered;
- runtime ingestion/recall remains green.

### Fixed Hermes acceptance

Against Hermes `104a7c4158e98719750e32347cd4101a7b35bc8d` or a later upstream/released equivalent:

- capability reports supported;
- Desktop setup validate/apply works;
- Memory create/edit/retire works;
- relation/community writes work;
- cross-profile denial, replay denial, Origin spoof denial and header spoof denial remain green;
- same plugin artifact is used as the stock-Hermes run.

### UI tests

Desktop tests verify:

- capability false => no active mutation writer reaches mutation panels;
- capability false => clear upgrade/web-dashboard notice;
- capability true => existing writer and controls behave unchanged;
- owner-level permission denial remains distinguishable from host-compatibility read-only mode;
- file-picker/read behavior is unaffected.

Web tests verify no regression in setup or writes.

## Out of Scope

- Upstreaming or maintaining the Hermes native-admission implementation itself.
- Shipping a patched Hermes binary with Reliquary.
- Automatic Hermes updates.
- Disabling plugin isolation.
- Adding a Reliquary-specific authentication mechanism.
- Proxying Desktop writes through the web renderer.
- Changing REL/PHY permissions or Root capability semantics.
- Hiding the Reliquary Desktop surface entirely on stock Hermes.

## Completion Gates

HU06 is complete when:

- one public Reliquary plugin artifact runs against both stock and fixed Hermes;
- stock Hermes provides Desktop setup/read visibility without presenting unusable mutation controls;
- stock Hermes retains full web setup/write behavior;
- fixed Hermes automatically enables full Desktop mutation functionality;
- capability detection is server-derived and not version-derived;
- existing mutation authorization is unchanged and remains fail-closed;
- no local Hermes patch is required to install or use the public plugin in its supported stock-Hermes mode;
- the public docs clearly describe the temporary Desktop-write limitation and web fallback;
- targeted stock-Hermes and fixed-Hermes acceptance suites pass;
- HU05 runtime, ingestion, retrieval and restart regressions remain green.

## Further Notes

The local Hermes commit `104a7c4158e98719750e32347cd4101a7b35bc8d` remains useful as the positive acceptance host until an official Hermes release includes equivalent native-admission forwarding. It is test infrastructure/reference behavior, not a runtime dependency of the public plugin.
