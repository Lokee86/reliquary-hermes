# HU09 — Native file dialogs for Reliquary setup

**Date:** 2026-11-09
**Status:** Approved UX target; implementation pending
**Scope:** Reliquary Web/ Desktop setup UI and the narrow local Hermes dialog admission seam. No changes to REL/PHY storage or source ingestion.

## Purpose

The installed Web dashboard currently presents **Select REL / Create REL / Select PHY / Create PHY** but, when clicked, substitutes a custom Hermes-host directory listing headed "Permitted folders". It exposes an unnecessary navigation policy and then duplicates both owner paths under "Advanced". This is not how ordinary Windows users select or create files. The user explicitly requires **standard Windows Open File and Save As dialogs**.

The Desktop plugin already has native `ctx.os.pickOpenPath` and `ctx.os.pickSavePath`; the shared Web surface passes no picker callbacks, triggering `HostFilePicker`. The browser's own `<input type=file>` cannot provide a trustworthy absolute host path and would upload a copy rather than select an existing native container. Do not fake this with HTML file inputs.

## Overview

Keep the existing profile-scoped `setup.create`, `setup.validate`, and `setup.apply` authority and the existing native Desktop pickers. Supply a **trusted local native-dialog capability** to the Web dashboard and simplify the shared onboarding surface. Retain an explicit manual-path fallback for remote, service-only, or headless deployments, where a native dialog genuinely cannot run. Do not retain the custom "permitted folders" browser as the primary UX.

## Target architecture

`Onboarding Select/Create click → surface-specific local dialog capability → native Windows Open File / Save As → selected host path → existing setup validation / explicit create-confirmation → existing owner bindings`

- **Desktop:** continue using the SDK `ctx.os.pickOpenPath/pickSavePath`. Check that the returned path is scoped to the active profile and backend activation epoch.
- **Local Web:** implement a *narrow* Windows native picker broker, in a supported Hermes local/interactive host context. A setup-only request initiated by an authenticated local user interaction selects `open_rel`, `open_phy`, `open_config`, `save_rel` or `save_phy`. The broker invokes the real OS dialog **on the same machine and interactive user desktop as the Hermes host** and returns a single selected absolute path or a distinct cancelled/unavailable result. Prefer an existing supported Hermes local-dialog facility; otherwise add the smallest narrowly scoped plugin-host helper. Do not create a generic command-execution, arbitrary filesystem read/write, or local-file-upload API.
- **Shared form:** receive `pickOpenPath` and `pickSavePath` from either surface. Selection updates the relevant pending owner path; creation first obtains a Save As destination, then requires the current explicit owner-creation confirmation before calling existing `setup.create`. The picker never writes a REL/PHY and does not itself connect a profile.
- **Unusable native context:** show **"Native file dialogs unavailable for this connection"** with an explicit, clearly labeled **Enter path manually** option. The manual form submits to the same validated setup path; no silent fallback to a confusing directory tree. A remote browser cannot simply select its own local file and expect the host to use the same filesystem path.
- The normal form remains one General REL section, one active PHY section, then **Review and connect**. Move project management behind a secondary/optional section until initial REL/PHY binding is complete, to avoid distracting missing-feature notices on first run. Show the optional config path as read-only detected context with a **Change configuration** action; do not confuse this with the required owner selection.

### Exact UI behavior

| Button | Local Windows behavior | Post-selection |
|---|---|---|
| Select REL | Standard **Open File**, filter `*.rel` | Show selected filename/path; `Validate` / `Review and connect` use it |
| Create REL | Standard **Save As**, suggested `*.rel` | Show proposed path; require **Create REL** confirmation; create through existing backend with no overwrite |
| Select PHY | Standard **Open File**, filter `*.phy` | Show selected filename/path |
| Create PHY | Standard **Save As**, suggested `*.phy` | Show proposed path; require **Create PHY** confirmation; no overwrite |
| Change configuration | Standard **Open File**, filter `*.cfg` where supported | Update optional config path only |

An OS cancellation changes nothing, emits no error banner and does not call create, validate or apply. A failed dialog yields one actionable error and an optional manual-path fallback, not an implicit navigation mode. Disabled/busy states prevent duplicate dialog invocations. No redundant duplicate editable REL/PHY fields are visible by default.

## Implementation decisions and security constraints

1. **Do not change the existing REL/PHY file format, Root ownership, user data, enrollment cutoff, provider or memory pipeline.** Existing owner paths remain stable, and the installer must not generate new owner files without explicit confirmation.
2. **Locality and profile authorization:** bind each broker call to the active Hermes-authenticated profile and the existing same-origin/native-write rules. Admit only interactive local Windows contexts whose user desktop is genuinely available; reject remote/headless, hosted service contexts without interactive dialogs, wrong-profile requests and missing approval. Do not trust `Origin`, forwarded IP headers or caller-provided `profile_id` alone as proof of physical locality. The host/desktop bridge is responsible for validating the interactive local caller; if that cannot be proven, disable the native Web picker rather than weakening the rule.
3. **Narrow operations:** enumerated dialog kind only; no browser-submitted starting directory, shell executable, arbitrary dialog flags or profile home. No remote filesystem browsing API is needed for the normal flow. The returned selection is treated as a *candidate*, never proof of owner authority.
4. **Post-dialog checks:** existing `setup.create` must reject existing paths and invalid owner kind, and `setup.validate/apply` must verify owner scope, file type, authorized profile, config and topology. No path-based automatic owner rebinding.
5. **Cancellation, concurrency and cleanup:** one in-flight dialog per owner/profile/surface; a cancelled or timed-out call has no side effects. Dialog launch errors are typed and do not leak private filesystem listings, credentials, or arbitrary host errors. Close/cancel on navigation where possible; ignore late results after profile/backend switches. No modal dialog from page load, setup status refresh, polling, or unexpected external requests.
6. **Real Windows dialog:** use the native common file picker UI, including keyboard navigation, filesystem drives and normal Windows folders. The old `setup_paths.py` permitted-root browse policy is not a restriction on this user-driven OS picker; security enforcement remains in final owner validation and host admission. Existing `setup-v1/browse` may remain temporarily for genuinely remote installations, but it must not be the default browser on local Windows and should not be surfaced as "permitted folders".
7. **Desktop parity:** do not introduce a second Desktop dialog implementation or bypass the existing Hermes SDK; preserve `pickOpenPath/pickSavePath` and profile change fencing.
8. **Web picker availability:** expose a trustworthy, read-only capability result so the shared Web surface can choose local dialog vs manual-path UX. Do not claim native availability from OS detection alone; verification must show a dialog actually opened in the interactive session.
9. **Native-dialog feasibility gate:** verify the real Hermes gateway/worker ownership and installed Web route first. If plugin-only code cannot securely start a dialog in the user's interactive Windows session, document the precise missing Hermes local-host broker contract and implement the **smallest upstream surface** rather than a guessed endpoint or untrusted PowerShell/web workaround.

## Targeted file ownership

- `dashboard/src/onboarding.js` — replace implicit `HostFilePicker` fallback with native callback handling and explicit manual mode; simplify the default view.
- `dashboard/src/live.js` and `dashboard/src/surface.js` — supply Web picker capability and pass it to the shared form (preserve Desktop inputs).
- `desktop/src/plugin.js` — retain native picker wiring; small parity changes only if necessary.
- `src/reliquary_hermes/dashboard_api.py` and a small local-dialog adapter if needed — authenticated capability and local dialog request, **not** a new general filesystem service.
- `src/reliquary_hermes/setup.py` — retain existing validation and confirmed creation authority.
- `dashboard/tests/dashboard.test.cjs`, `desktop/tests/plugin.test.cjs`, `tests/test_setup_api.py` / `tests/test_hosted_desktop_api.py` — regressions at the existing boundaries.
- `docs/verification.md` — record supported local and unsupported remote/headless behavior.

## Migration strategy

Compatibility-preserving UI correction: keep persisted configuration, setup endpoints, and owner bindings untouched. Add the local dialog capability, update the shared setup form, and de-emphasize or remove the old Web host-directory picker only after native behavior and the explicit manual fallback are proven. No broad Hermes changes, duplicate storage adapters or parallel setup pipelines.

## Testing decisions

- Web local interactive: each Select action invokes the **actual Windows Open File dialog** with correct extension; each Create invokes **actual Save As**, then an independent creation-confirmation step. Validate path selection and successful connect using *synthetic* REL/PHY test files.
- Cancel Select/Save As: no path change, no new files, no setup mutations, no alarming error.
- Wrong extension, non-owner file, existing Save As target, missing drive, invalid path, profile switch, stale dialog response, duplicate clicks, no config, and rejected host preflight fail safely.
- Remote/headless/worker-without-desktop: no OS modal is launched; present explicit manual-path UI; preserve all existing validation and permission gates. Spoofed same-origin/locality or foreign-profile request must not open the host dialog.
- Desktop: same selections and create behavior through its SDK; existing native mutation admission and backend-switch checks continue to pass.
- **Installed acceptance:** launch actual Hermes Web dashboard on the same Windows machine as Hermes. Click all four buttons and observe genuine OS dialogs, not the old permitted-directory tree. Use an isolated Hermes profile and synthetic owner files. Verify production General user data and existing REL/PHY files remain unchanged.
- Run dashboard Node tests, Desktop tests (with the existing VM-modules setting), relevant Python API/setup tests, TypeScript/build checks, documentation check, and host tests if the broker touches host code.

## Out of scope

- Importing historical conversations, creating memories, moving REL/PHY data, remapping existing sessions, project attribution upstream PR, editing the Reliquary core configuration schema, and browser file uploads.
- A generic Hermes file manager, unrestricted remote OS dialog service or new filesystem access permission model.

## Completion gates

1. All four actions open the correct native Windows dialog in *local interactive* Hermes Web and Desktop.
2. Select does not copy/import/modify the chosen file; Create uses Save As plus explicit non-overwriting confirmation.
3. "Permitted folders" and duplicate path fields are no longer the default local setup UX; manual path entry is clearly accessible only when needed.
4. Native picker cannot be triggered from remote/headless or unauthorized requests; profile and lifecycle checks are enforced.
5. Existing setup validation, owner identity, General fallback, PHY and project data, and all source capture/import policies remain unchanged.
6. Browser, Desktop, Python and relevant host tests pass, plus real installed Web acceptance with synthetic data. No claim of success from mocks alone.

## Related docs

- [HU05 cross-surface onboarding](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [HU06 Desktop native admission](hu06-stock-hermes-desktop-mutation-compat-spec-2026-11-09.md)
- [HU07 Hermes-native UI](hu07-hermes-native-presentation-spec-2026-11-09.md)
- [Verification](verification.md)

## Notes

This specification supersedes only HU05's Web host-directory-browser UX, not its setup authority or Desktop native picker. A native Web dialog is a host capability, not a standard browser feature. The agent must verify that native modal activation is achievable safely in the installed Hermes environment before claiming completion.