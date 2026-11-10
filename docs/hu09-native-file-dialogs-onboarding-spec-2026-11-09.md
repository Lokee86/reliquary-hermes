# HU09 — Finish native file dialogs in Hermes Web

**Date:** 2026-11-09
**Status:** Desktop accepted; local Web native dialogs missing
**Scope:** Finish the existing HU09 UI requirement. No new phase, memory subsystem, or authorization framework.

## Purpose

The user asked for four ordinary Windows file dialogs in Reliquary setup:

| Button | Required interaction |
|---|---|
| Select REL | Windows **Open File**, filtered to `*.rel` |
| Create REL | Windows **Save As**, default `*.rel`, then existing Create confirmation |
| Select PHY | Windows **Open File**, filtered to `*.phy` |
| Create PHY | Windows **Save As**, default `*.phy`, then existing Create confirmation |

The packaged Hermes Desktop plugin already does this via `ctx.os.pickOpenPath` and `ctx.os.pickSavePath`. Commit `daa07c6` removed the confusing Web “Permitted folders” navigator and provided an explicit **Enter path manually** fallback. It **did not make the four Web buttons work**. This specification finishes that missing behavior; do not redesign the form again.

## Overview

**Target:** Clicking any of these buttons in the installed, local Windows **Hermes Web dashboard** opens the actual Windows common file dialog in the current user's interactive desktop. Select returns the existing absolute host path. Save As selects a proposed path and the existing backend creates the container only after separate confirmation.

The Web page cannot obtain a usable absolute host path from a normal HTML file input or `showOpenFilePicker`. Therefore the only new capability, if Hermes does not already expose one, is a **small local-interactive OS dialog invocation seam**. A browser upload, directory-listing UI, and generic file-access API are not substitutes.

## Target architecture and ownership

`Web setup button → Hermes authenticated local-interactive dialog capability → OS Open/Save dialog → selected path or cancellation → existing setup.create/validate/apply`

- **UI:** `dashboard/src/live.js` supplies the supported picker callback; `dashboard/src/surface.js` and `dashboard/src/onboarding.js` already accept `pickOpenPath`/`pickSavePath`. Reuse those callbacks, including their cancel and confirmation behavior. Do not add another setup form.
- **Host capability:** First inspect the installed Hermes Web SDK, gateway, plugin-admission path and existing Desktop dialog implementation. Reuse a supported Hermes local-user/desktop bridge if available. Otherwise implement **only the minimum supported dialog invocation boundary**. Its allowed inputs are the five fixed modes `open_rel`, `open_phy`, `open_config`, `save_rel`, `save_phy`; its output is `selected absolute path`, `cancelled` or `unavailable`. No arbitrary command, file contents, directory enumeration, configurable starting path or filesystem write.
- **Authority:** Keep existing Hermes active-profile authentication, current backend/profile lifetime checks, setup mutation admission, and `setup.create`/`setup.validate`/`setup.apply`. Do not invent a second credential store, one-use permit protocol, path receipt, lease, generalized IPC or file-management service merely because they were listed as possibilities in the earlier HU09 proposal. Introduce additional proof **only when a concrete verified gap makes it necessary**, and document that gap before expanding scope.
- **Locality:** The dialog must run in an actually interactive Windows user session and be invocable only by an authenticated local user action. Same-origin alone does not prove locality; an HTTP socket peer can be a proxy. If Hermes cannot establish the local interactive caller with its existing trusted facilities, **stop that bridge implementation and report the exact missing Hermes host contract**. Do not replace it with an unsafe loopback assumption, PowerShell command endpoint, remote dialog trigger or simulated native dialog.
- **Existing file operations:** `Select` never creates, copies, uploads or changes a REL/PHY. `Create` never overwrites an existing owner; it uses the existing explicit confirmation and checked creation. The dialog-returned path is a candidate, not ownership authority.
- **Unsupported environments:** Remote/headless/worker-without-desktop Web keeps **Enter path manually** as an explicit fallback and clearly states that native dialogs are unavailable. The four buttons must not falsely appear operational. Do not resurrect the “Permitted folders” navigator.
- **Desktop:** Do not replace or reimplement its working SDK dialogs. Only touch Desktop code if required to maintain shared callback parity.

## Implementation decisions

1. Inspect the existing Hermes Web/desktop capability boundary and choose **one minimal integration seam**. Confirm it can actually display a native dialog from the user's running local Web dashboard before modifying unrelated parts.
2. Wire exactly the required callback and small capability indication into Web; keep the current UI. No new navigation screen or advanced setup page.
3. Use `*.rel` and `*.phy` filters, normal filesystem navigation and Save As filenames. Cancel is a no-op. Errors are actionable but do not expose internal paths or credentials.
4. Preserve current profile and backend-switch fencing: delayed results cannot select a path for another profile, and repeated clicks cannot open concurrent dialogs.
5. Confirmed Save As still calls the existing checked backend creation endpoint; no direct file writes from the dialog helper.
6. Do **not** change `Reliquary` core, REL/PHY format, configuration, history import, project attribution, enrollment state, or any deployed owner data. Do not request a new upstream PR by default.

## Migration strategy

Compatibility-preserving **small Web integration**. Keep `daa07c6` UI and existing Desktop code. The prior HU09 proposal's generalized dialog broker / one-use permits / path receipts are **not approved implementation requirements**. Add the smallest supported trusted native invocation only if necessary. If the installed Hermes build has no trustworthy local-user invocation capability, record that single blocker and stop instead of delivering another UI-only partial solution as “complete”.

## Verification and acceptance

- In an isolated Hermes profile on installed Windows Hermes **Web**, clicking Select REL, Select PHY, Create REL and Create PHY opens four genuine OS dialogs with the correct mode and extension. Record direct installed evidence, not only mocked tests.
- Cancel each dialog: no modified selection, new file or setup operation. Select existing synthetic owners and confirm unchanged bytes. Save As a new synthetic REL/PHY, confirm creation through the existing service and connect it.
- Existing filename conflict, incorrect type, backend/profile switch and wrong-profile or remote/headless access fail safely. Never trigger an interactive dialog from a remote request.
- Verify packaged **Desktop** still passes the same four picker behaviors.
- Run targeted Web/Desktop/ Python setup API tests, build and relevant host tests. Update `docs/verification.md` with the exact tested local context and any unsupported contexts.
- Reinstall only changed integration artifacts and verify their hashes. Do not overwrite real REL/PHY data or reset enrollment cutoffs.

**Completion is binary:** the installed local Web dashboard really opens all four native dialogs and connects synthetic owners, or HU09's Web dialog requirement remains **blocked/incomplete**. Removal of “Permitted folders”, tests of manual path entry or Desktop-only success does not satisfy that gate.

## Out of scope

New owner formats, file import/upload, remote filesystem UI, generalized file access, a new authorization framework, additional onboarding features, project UI changes, Reliquary core rebuild, upstream PR work unless directly demonstrated as indispensable.

## Related docs

- [HU05 onboarding](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [HU06 native admission](hu06-stock-hermes-desktop-mutation-compat-spec-2026-11-09.md)
- [Verification](verification.md)

## Notes

This targeted correction supersedes the broader design suggestions in HU09's prior text; it does **not** reopen the parts completed by `daa07c6`. The live Web bootstrap currently supplies no native picker callbacks, whereas Desktop already supplies both through the Hermes SDK. The missing capability must be verified at the Hermes host boundary rather than presumed to exist.
