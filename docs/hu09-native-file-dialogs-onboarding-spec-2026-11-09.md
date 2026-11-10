# HU09 — Plugin-local file dialogs and removal of obsolete browsing

**Date:** 2026-11-09
**Status** Closed with the verification limits below. Implemented and deployed in `90f7a88`.
**Scope:** Existing HU09 only. This replaces the earlier Web broker/upstream design.

## Purpose

HU09 gives local Windows Hermes Web the four native file controls for General REL and active PHY setup. Hermes Desktop continues to use its Electron Open File and Save As dialogs.

## Dialog behavior

| Action | Dialog | Result |
|---|---|---|
| Select REL | `tkinter.filedialog.askopenfilename`, `*.rel` | Existing absolute path; candidate sent to current validation |
| Select PHY | `askopenfilename`, `*.phy` | Existing absolute path; candidate sent to current validation |
| Create REL | `tkinter.filedialog.asksaveasfilename`, `*.rel` | Proposed destination. Separate confirmation calls `setup.create` |
| Create PHY | `asksaveasfilename`, `*.phy` | Proposed destination. Separate confirmation calls `setup.create` |

Optional configuration selection uses `askopenfilename` with `*.cfg`. The chooser returns a candidate path or cancellation without writing an owner. Save As requires a separate Create confirmation, and the Rust host enforces exclusive creation.

## Overview

The shared setup form calls the authenticated, profile-scoped `POST /setup-v1/dialog` route. It accepts only `open_rel`, `open_phy`, `open_config`, `save_rel`, and `save_phy`. A short-lived process runs Tk on its GUI main thread using the installed Hermes Python. The response is `selected` with an absolute host path, `cancelled`, or `unavailable`. The existing setup endpoints validate the selected owner and handle creation and connection.

The Windows guard checks the standalone loopback dashboard and the actual TCP connection owners. It requires a supported browser running under the same OS account and in the same active desktop session as Hermes. Hosted workers, proxies, public dashboards, and unsupported or headless connections use **Enter path manually**. The shared form allows one pending picker and discards a response after its profile or backend scope changes.

HU09 removed the setup browse route, directory enumeration, `RELIQUARY_SETUP_BROWSE_ROOTS`, and the native-versus-Web destination distinction. Both surfaces use the same absolute-path, extension, reparse, profile isolation, and no-overwrite checks.

## Closeout

The installed-runtime Windows test opened and canceled all four Web dialogs and selected the existing synthetic REL and PHY. Automated tests covered setup confirmation and overwrite refusal. Window testing stopped before the live Save As selection through confirmed creation and connection sequence. The current Desktop bundle passed its automated suite. The genuine Desktop dialog evidence predates this revision. The [verification guide](verification.md#hu09-plugin-local-file-dialogs) records the deployment and check results.

## Out of scope

New Hermes upstream PRs, another HU phase, general-purpose OS dialog services, external desktop brokers, browser uploads, a new authentication system, storage changes, project routing work, and further UI redesign.

## Related docs

- [HU05 onboarding](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md)
- [HU06 native admission](hu06-stock-hermes-desktop-mutation-compat-spec-2026-11-09.md)
- [Verification](verification.md)

## Notes

Commit `1c6c4c4` approved the plugin-local Tk design.
