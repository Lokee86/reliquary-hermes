# HU09 — Plugin-local file dialogs and removal of obsolete browsing

**Date:** 2026-11-09
**Status:** Approved target; not implemented
**Scope:** Existing HU09 only. This replaces the earlier Web broker/upstream design.

## Problem statement

The installed Hermes Desktop plugin already opens native Open/Save dialogs. The Web dashboard still disables Select REL/PHY and Create REL/PHY, even when the user operates Hermes locally on Windows. The custom "Permitted folders" interface has been removed from the UI by `daa07c6`, but its backend enumeration/allowlist machinery remains. The subsequent `eb08046` recorded an upstream Hermes dependency instead of testing a plugin-local native dialog.

**Deliver exactly four working Web buttons** with no Reliquary storage redesign, upstream dependency, new permission system or extra setup workflow.

## Target behavior

| Action | Dialog | Result |
|---|---|---|
| Select REL | `tkinter.filedialog.askopenfilename`, `*.rel` | Existing absolute path; candidate sent to current validation |
| Select PHY | `askopenfilename`, `*.phy` | Existing absolute path; candidate sent to current validation |
| Create REL | `tkinter.filedialog.asksaveasfilename`, `*.rel` | Proposed destination; existing explicit confirmation calls checked `setup.create` |
| Create PHY | `asksaveasfilename`, `*.phy` | Proposed destination; existing explicit confirmation calls checked `setup.create` |

Existing optional configuration selection can use `askopenfilename` with `*.cfg`. Both selections and cancellations have no effects on disk. Save As must not create or truncate anything; the Rust host's existing create-without-overwrite behavior remains authoritative.

## Target architecture

`Web button → existing authenticated profile-scoped setup API → tiny plugin-local Python tkinter dialog helper → chosen path/cancel → existing create/validate/apply`

- **Do not use Electron for Web.** Leave Desktop's working `ctx.os.pickOpenPath`/`ctx.os.pickSavePath` implementation intact.
- **Do not add any Hermes upstream API.** Use the plugin's existing authenticated HTTP and active-profile routing. This implementation should remain useful even if Hermes later adds a native Web picker.
- **No browser file uploads or attempts to convert File System Access handles into host paths.** Browser handles do not expose the absolute path needed by the existing Reliquary host.
- Implement one small Python dialog helper that runs `tkinter` in an isolated **short-lived process on its GUI main thread**, using the same installed Python runtime. The request specifies only a fixed dialog mode (REL/PHY/config, open/save), never arbitrary commands, paths to execute, or file contents. Return `{status: "selected", path: ...}`, `{status: "cancelled"}`, or `{status: "unavailable"}`. Handle Python/Tcl-Tk absent, missing display, dialog error and process exit without affecting the ASGI event loop. No persistent dialog daemon, new IPC protocol or generic filesystem bridge.
- The existing Web `createReliquarySurface` picker callback contract remains the only UI seam. Supply `pickOpenPath` and `pickSavePath` from `dashboard/src/live.js`, wire the small setup endpoint in `dashboard_api.py`, and preserve the current onboarding confirmation/validation.
- Do not change `setup.apply`, provider enrollment, source import/capture, REL/PHY contents or core Reliquary.

## Implementation sequence

1. **Feasibility first:** In the installed Hermes Python interpreter, confirm `import tkinter` succeeds and a standalone transient `askopenfilename()` actually appears in the interactive Windows session in which the Hermes Python plugin worker runs. Cancel safely; do not touch real REL/PHY files. Check the corresponding Tcl/Tk and display availability on macOS/Linux only where those platforms are accessible. Do not assume that the presence of `tkinter` proves a visible dialog can launch from a service/worker.
2. Add the minimal dialog helper and one enum-only profile-scoped `POST /setup-v1/dialog` operation to the existing authenticated plugin API. Optionally expose `local_dialogs_available` on the existing `/setup-v1/status` response to avoid dead buttons. Reuse current admission and profile scope; do not add permit, receipt, grant, credential store, listener or arbitrary file route.
3. Wire the Web callbacks for Open/Save into the already existing shared form. Preserve the explicit **Enter path manually** fallback for headless/remote environments. A cancelled dialog leaves all fields unchanged. Busy gating prevents simultaneous modals. Ignore a late response after profile/backend changes.
4. Reuse existing `setup.create` (no overwrite), `setup.validate` and `setup.apply`. A path returned by a dialog is not a verified REL/PHY until the host validates it. Keep the explicit create-confirmation step.
5. Remove the obsolete browsing and restrictions listed below **in the same change**, rather than maintaining two picker implementations. Update tests, generated bundles, docs, installed plugin, and verify actual Web dialogs with synthetic files.

### Admission and local-session boundary

A same-origin authenticated Web request alone **does not prove the browser is physically local**: a remote browser or reverse proxy can call the same API. Only enable the dialog endpoint when Hermes is intentionally running as a local, interactive desktop application for that user and the worker can access that GUI session. Do not infer this from a request's claimed host, forwarded IP, Origin or a loopback proxy address. Remote/hosted/headless deployments must get `unavailable` and use manual paths. Reuse existing Hermes authentication/profile scope and a minimal local-interactive availability guard; do **not** design a generalized one-use-click proof system. If the actual deployment cannot reliably distinguish a local interactive install from a remotely exposed one, state that limitation explicitly and leave dialog access disabled rather than making it remotely triggerable.

## Required deletion / simplification

This is not a second file browser. Remove the old infrastructure once the tkinter path is working:

1. **Delete `setup.browse` and `GET /setup-v1/browse`**, plus the browser-specific error entries from `dashboard_api.py` and unused browsing DTOs/client/tests. The custom Web `HostFilePicker` UI is already deleted; do not restore it.
2. **Delete from `setup_paths.py`** the directory listing, allowed-root discovery, `RELIQUARY_SETUP_BROWSE_ROOTS`, depth/entry/time quotas, `_roots`, `_permitted`, `browse` and associated listing-only helpers/imports. Retain only the minimal path validation/destination safety genuinely needed by owner creation; this may remain in `setup_paths.py` rather than creating another abstraction.
3. **Remove the artificial “permitted roots” condition on Web-created destinations** and the `native` distinction used solely to bypass that browsing limit. Retain checks for absolute path, correct extension, existing target/no overwrite, symlink/reparse escape and cross-profile data isolation. The selected path should go through the same owner-validation rules irrespective of whether it came from tkinter or manual entry. Do not remove Hermes authenticated scope or same-origin write protection.
4. Remove unused picker error texts, type declarations, test fixtures, documentation references and old workaround/“waiting for upstream” statements. Replace browsing tests with native-dialog callback tests and retain tests for genuine path/owner safeguards.
5. Do not remove shared Hermes native HTTP admission used by other plugin features. Do not remove `Desktop` native dialog support or any current working setup/create/validate/apply routes.
6. Do not retain a dormant upstream Web broker, local ticket scheme, path receipt format or compatibility adapter “for later”. If Hermes adds a native Web picker in the future, it is a separate optional integration decision, not a prerequisite or a parallel code path.

## Test and completion gates

- **Visible local Web acceptance:** Installed Hermes Web on Windows opens real native Open File and Save As dialogs for all four buttons. Test cancellation, valid synthetic REL/PHY selection, Save As then separate confirm, byte-identical source preservation, overwrite refusal and successful synthetic profile connection.
- **Availability and safety:** Missing tkinter/display, remote/headless, expired/wrong profile context, duplicate clicks and stale backend responses fail without showing inappropriate modals or writing files. Existing setup authorization and profile-isolation tests still pass. No arbitrary subprocess or filesystem operation is exposed to the browser.
- **Desktop:** The packaged Electron integration still opens its own genuine dialogs; it does not depend on tkinter.
- **Cross-platform:** On macOS/Linux with Tk/display support, the same Python helper can return selected paths. Do not claim tested platform support unless run there.
- **Cleanup:** Repository search finds no live `setup-v1/browse`, `RELIQUARY_SETUP_BROWSE_ROOTS` or permitted-root UI dependencies. `setup_paths.py` still enforces required owner destination safety. Build outputs and docs reflect the new Web behavior.
- Run targeted Python setup/API tests, Web and Desktop tests, build/TypeScript/doc checks and installed synthetic end-to-end verification. Protect production owner files, credentials, config and enrollment cutoffs.

**Do not mark HU09 complete on the basis of passing unit tests, manual-path setup, or Desktop behavior. Only a real installed local Web Open/Save demonstration satisfies the missing acceptance gate.**

## Out of scope

New Hermes upstream PRs, another HU phase, general-purpose OS dialog services, external desktop brokers, browser uploads, a new authentication system, storage changes, project routing work, and further UI redesign.

## Related documents

- [HU05 onboarding](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [HU06 native admission](hu06-stock-hermes-desktop-mutation-compat-spec-2026-11-09.md)
- [Verification](verification.md)

## Notes

This specification is **proposal only**. No Python, UI, desktop, host or installed runtime implementation has changed in this revision. Current `eb08046` remains the deployed code until a separate implementation task completes.
