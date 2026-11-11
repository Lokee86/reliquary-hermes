# Hermes Reliquary Knowledge

## Purpose

The Reliquary tab mounts one Warlock-derived React Knowledge experience in Hermes Web and Desktop. The Web SDK 1.1.0 manifest registers `/reliquary`. Desktop registers the same route through the plugin SDK.

## Overview

Knowledge opens on the selected authorized owner’s spatial graph. REL and PHY scope controls live in the Knowledge navigation and follow the active Hermes profile. Graph and List share filters, Memory selection and the inspector in Warlock’s original three-column composition. Navigation and inspector scroll independently; List scrolls in the center column and Graph fills that center column. The shared Knowledge surface establishes the named `reliquary` inline-size container required by its responsive collapse rules.

The graph exposes **Display** and **Animation** popovers. Display starts with edge brightness, node glow and bloom at 1×, territory shell opacity at 30%, community shell limit at 128, and the camera center marker off. The community shell limit is capped at 128. Animation starts enabled with a 60-second delay, X and Z at 0 RPM, Y at 0.4 RPM, zero random range on every axis, and counterspin off. Its controls include per-axis speed and random range, counterspin, reroll, reset motion, pause/start, and save or restore the graph view.

Desktop stores preferences under the active Hermes profile; saved graph views also use the authorized owner scope. When a safe profile key is unavailable, Web keeps preferences in the current dashboard mount’s session store, so they reset when that mount ends. Both popovers use the active Hermes palette through inherited knowledge-surface tokens. They stay within the viewport, scroll when their contents need more room, close on outside click or Escape, and return focus to their trigger on Escape.

List and inspector reads use the bounded `dashboard-v1` contract. The graph uses manifest v3, binary chunks and bounded interaction reads through `graph-render-v1`. Setup and Sources use their existing profile-scoped APIs.

Build both entrypoints and the Web stylesheet from the repository root:

```powershell
npm --prefix dashboard ci
npm --prefix dashboard run check
```

Both bundles use the host’s React and control primitives. Surface colors resolve from the active Hermes palette: Desktop publishes `--dt-*`, while Web publishes `--background-base`, `--midground` and semantic `--color-*` tokens. The plugin maps these at `.knowledge-surface`; CSS inheritance follows theme switches without copying presets or maintaining theme state. Native controls inherit the host color scheme. The transparent graph canvas reveals that same themed background; graph data colors and Warlock layout remain unchanged. The shared graph stylesheet and Three.js scene preserve the Warlock graph presentation. Web uses the authenticated SDK fetch for binary responses. Desktop needs the SDK’s bounded `restBytes` method for graph chunks. The local patch and its exact upstream revision are recorded in the installation guide.

## Related docs

- [Installation and local service](../docs/local-service.md)
- [Dashboard and render contracts](../docs/ui-contract.md)
- [Verification](../docs/verification.md)
- [Source parity ledger](../docs/warlock-nongraph-ui-parity.md)
- [Warlock rebuild specification](../docs/warlock-ui-hard-cut-rebuild-spec-2026-11-10.md)

## Notes

One `npm --prefix dashboard run build` invocation generates the Web bundle and stylesheet plus the Desktop bundle. Install its generated assets together: `dashboard/dist/index.js`, `dashboard/dist/index.css`, `dashboard/dist/index.js.LEGAL.txt`, `desktop/plugin.js`, and `desktop/plugin.js.LEGAL.txt`. Install the static `dashboard/manifest.json` and `dashboard/plugin_api.py` alongside them.