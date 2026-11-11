# Warlock v1 graph preferences — Reliquary/Hermes adaptation specification

**Date:** 2026-11-10
**Status:** Implemented. Final verification follows the user’s focused UI scope recorded below.
**Target:** `C:\!bin\workspace\reliquary-hermes` (`main` inspected at `f80c2f7b0814fc8bade889c1206c585603498225`; clean before this document).
**Primary source:** `C:\!bin\workspace\warlock-toolchain\ui\src\features\graph` (`warlock-toolchain` HEAD `4ca9627760e64ff95dc6c00b1079135534ebf76f`; unrelated dirty documentation files are **not** part of the source port).
**Existing renderer authority:** current Hermes `dashboard/src/graph/render/*`, `host/src/graph_render*.rs`, and prepared `graph-render-v1` contract. This is a *control restoration*, not a renderer migration.

## Purpose

Restore **the actual Warlock v1 Display and Animation preference panels** to Hermes's Reliquary Knowledge graph, preserving their behavior and interaction design while adapting code-graph/Arcana-specific concepts to Memories, Relations, and Communities. Reuse existing React implementations and model logic; do not invent lookalike controls or introduce Arcana/repository semantics into Reliquary.

## Overview

Warlock v1 had working Display and Animation menus that were omitted from the later scalable Warlock render path and are absent from the current Hermes scene. The current Hermes graph already has an authenticated owner/cut-bound prepared-generation client, binary chunks, multi-LOD edges, spatial bounds, memory selection, bounded hover/neighborhood inspection, community/unassigned territories, and theme tokens. Retain all of it.

```text
Warlock v1 React menus + pure settings/animation model
       │  remove repository/package assumptions and old storage keys
       ▼
Hermes KnowledgeGraph / GraphRenderScene presentation state
       ├── Display (edges, node glow, bloom, community shells, center marker)
       ├── Animation (X/Y/Z, counterspin, reroll, delay, pause, views)
       └── Reliquary/Hermes theme and scoped preference persistence
             │  visual parameters only
             ▼
Current bounded GraphRenderClient + React Three Fiber renderer
             │  unchanged generation, chunk, selection, and authorization boundaries
             ▼
Memory nodes • Relations • semantic Communities / unassigned group
```

### Authoritative source-to-destination inventory

| Original source under `warlock-toolchain/ui/src/features/graph/` | Target owner | Disposition |
| --- | --- | --- |
| `controls/DisplaySettingsMenu.tsx` | `dashboard/src/graph/controls/DisplaySettingsMenu.tsx` | Direct React structural/behavioral port; adapt labels, host controls and theme |
| `model/density.ts` | `dashboard/src/graph/model/displaySettings.ts` plus existing `render/renderColors.ts` | Port defaults, clamp and persistence; preserve density logic only where appropriate for resident REL chunks |
| `controls/AnimationControlsMenu.tsx` | `dashboard/src/graph/controls/AnimationControlsMenu.tsx` | Direct React structural/behavioral port; preserve complete X/Y/Z menu |
| `model/animationSettings.ts` | `dashboard/src/graph/model/animationSettings.ts` | Reuse bounds, validation, randomization and RPM conversion; new storage namespace |
| `scene/GraphAnimationController.tsx`, `model/graphRotation.ts` | `dashboard/src/graph/render/GraphAnimationController.tsx` and pure rotation helper | Port camera-only motion; integrate with existing `TrackballControls`, not a replacement camera |
| `model/viewDefaults.ts` and v1 scene's `CameraViewCapture` | `dashboard/src/graph/model/viewDefaults.ts` and scene camera bridge | Save/restore camera state by authorized owner, not repository path or render generation |
| `scene/GraphScene.tsx`, `GraphTab.tsx` | `dashboard/src/graph/render/GraphRenderScene.tsx`, `dashboard/src/knowledge/KnowledgeGraph.tsx` | **Reference integration semantics only**; do not copy rich `GraphData`, global force layout, graph page, or repository-specific workflow |
| `model/packageClusters.ts` | None | **Do not port**; package/path matching has no Reliquary equivalent |

Before implementation, record exact source commit/file paths, compare transplanted components to v1, and note only the justified deltas below. Do not modify the dirty Warlock source checkout.

## Required functional mapping

| v1 UI and model defaults | Reliquary graph behavior | Exact renderer integration |
| --- | --- | --- |
| **Edge brightness**: `0.1–3×`, default `1×` | Brightness of ambient Memory relations (all LODs) after automatic density scaling. Keep selected/neighborhood edges distinct and readable. | `RenderEdgeChunk.tsx`; retain `RenderSelectionEdges.tsx` priority |
| **Node glow**: `0–2×`, default `1×` | Multiply *excess glow above the base node color*, not the node itself. At `0` nodes remain visible without halos. Preserve hover/selection contrast in sphere and point modes. | `RenderNodeChunk.tsx`, `renderColors.ts` |
| **Bloom**: `0–2×`, default `1×` | Multiplier on existing base bloom `1.45` after any validated adaptive node-density factor. `0` means bloom off without hiding the graph. | `GraphRenderScene.tsx` `EffectComposer/Bloom` |
| **Territory shells**: `0–1`, default `0.3` | Wireframe transparency multiplier for *semantic community* and synthetic *unassigned* shells only. Do not affect Memory membership, filtering or relations. Labels remain visible when opacity is zero (as in v1). | `RenderTerritories.tsx` |
| **Package shell limit**: `0–1000`, default 300 in v1 | Rename **Community shell limit**. Bound count of *rendered community shell meshes in current viewport*, not number of real Communities, fetched hierarchy, or graph nodes. Preserve real/unassigned distinction. | `RenderTerritories.tsx`; stable deterministic selection over already bounded frame hierarchy |
| **Camera center indicator**: default off | Draw the v1 zoom-responsive, non-pickable pseudo-node at the live Trackball pivot. It does not represent a Memory and must never be passed to a picker. | `GraphRenderScene.tsx` using original `CameraCenterPseudoNode` behavior |
| **Reset display** | Restore all supported Reliquary display defaults, not old Arcana/package data. | Display settings model + menu |

**Original opacity semantics matter.** V1's `TerritoryOverlay` multiplies slider opacity by shell-type factors (ordinary area shell `0.085`, auxiliary `0.045`; special selected shell `0.24`). Do not interpret v1's `0.3` as an absolute `30%` material alpha or multiply the current fixed `0.075` alpha blindly. Use the original factor model as visual starting authority, adapt the unassigned bucket to auxiliary styling, and evaluate against actual REL graphs. Current graph colors come from the Reliquary community descriptor; no package color palette is synthesized.

**Community shell limit semantics.** The current client has a `GRAPH_RENDER_HIERARCHY_BUDGET=128` for bounded visible descriptors. The new control must respect this cap; it cannot promise to load all communities. Set its supported maximum from the active render budget (currently 128), default to **all available in-frame shells** (not v1's meaningless 300), and show `0` as no community shell meshes. Retain community labels unless the user explicitly hides labels in a separate existing control. Select shells deterministically (prefer real communities, then descending `nodeCount`, tie-break stable hierarchy ID; keep unassigned explicitly labeled when shown). A current-viewport limit is a **visual limit**, not a filter or backend query.

**Density compensation.** Warlock's `edgeIntensityScale` uses `2500` reference edges and a `0.05` floor. Its node fade starts at `25,000` and reaches its floor by `250,000`. These values were developed for repository dependency graphs; do not silently treat them as calibrated to REL relationship distributions. Retain the existing bounded scene behavior as the baseline; port the *composition formula* (adaptive amount × user preference), then assess visible relation segments, LOD and resident node counts with small, medium and dense REL fixtures. No density calculation may scan the entire graph on the browser side. Selected edges remain emphasized, without being defeated by adaptive attenuation.

### Animation and camera settings

Port all of `AnimationControlsMenu.tsx` without removing options:

- Signed X/Y/Z rotation speeds, `-5` to `+5` RPM in v1; random range `0–5` RPM per axis; independent random-counterspin toggles.
- Enable/pause, start-delay `0–300` seconds, **Reroll** random speeds, and **Reset motion**.
- Default v1 motion: enabled, start delay 60 seconds, X=0, Y=+0.4 RPM, Z=0; random ranges zero and counterspin off.
- **Set Current View as Default** and **Restore Factory View**, with correct disabled state. Keep the separate existing **Reset view** button meaning clear: reset camera to the saved default (if valid), otherwise the factory framing; restoring the factory view deletes only the custom view.

Rotate the **camera around `controlsRef.current.target`**, never mutate Memory node positions or Rust layout. Use v1's `rotateCameraAroundPivotAxes`, `rpmToRadiansPerSecond` and `GraphAnimationController` semantics, with delta clamping. Pointer/wheel and relevant graph keyboard interaction reset the inactivity timer and suspend automatic motion until the configured delay elapses. Controls inside menus must not trigger a graph pick/drag, random speeds must reroll only as defined, and a pause must not move the camera. Respect Web/Desktop focus and page visibility; don't rotate an unfocused/hidden graph.

**Camera state:** store a validated finite `position`, `target`, normalized `up` triple; reject malformed/zero-up values. Persist per stable *authorized owner and host profile* when the host supplies a safe profile namespace. If the host cannot safely partition owner-specific persistence by profile, keep custom views session-local rather than storing them in shared global localStorage. Do **not** key to transient `generationId`, an Arcana repository path, or a Memory ID. On new generation or owner switch, check saved coordinates against current bounds and use computed factory framing when stale/out-of-range; never display a misleading empty view. Cosmetic changes must not reset camera framing or reconstruct the prepared graph.

### Pure settings and persistence

- Preserve `DisplaySettings`/ `GraphAnimationSettings` shape except replacing `packageShellLimit` with `communityShellLimit`, replacing obsolete storage keys, and adding only strictly needed Reliquary scope data.
- Clamp numeric values, reject NaN/Infinity, validate booleans, tolerate malformed/unavailable storage. Do not read old `cbm-display`, `warlock-graph-animation-v1`, or `warlock-graph-default-view:*` keys.
- Display and animation are presentation-only preferences, generally profile-scoped; saved camera views additionally owner-scoped. Neither is a Reliquary Memory, REL/PHY mutation, source-capture fact, or cross-owner shared setting.
- If profile-scoped browser storage is not supported, use in-memory preferences for that surface rather than leaking an owner's saved view to another profile. No browser-to-Reliquary write API is permitted for these controls.
- Keep user multipliers and defaults independent from the adaptive density calculation so `1×` has an intelligible meaning.

## Integration ownership and CSS

1. `KnowledgePanel.tsx` remains the authority for authorized owner, selected Memory, search/category/type/archive/community filters and list/inspector state. `KnowledgeGraph.tsx` mounts the scene and holds or passes scoped graph preferences; `GraphRenderScene.tsx` applies visual values.
2. The original v1 menus should be transplanted structurally, but replace `@/shared/ui/button` with the existing Hermes `HostControls` bridge or a small semantic native-button adapter. Do not add a second React/component library, a duplicate settings UI, or a Tailwind runtime.
3. The accepted theme mapping in `dashboard/src/app.css` uses `--reliquary-*` tokens sourced from Hermes Web/Desktop. Adapt v1 hardcoded `#0b1920`, `text-cyan-*`, `accent-cyan-*` and border/shadow values to those tokens. Preserve v1 menu information hierarchy, compact slider/value labels, reset affordances, popover placement, outside click and Escape behavior. Both dark/light Hermes themes and narrow responsive graph columns must remain usable; menus must not be clipped by the canvas.
4. Update only relevant renderer inputs: `RenderEdgeChunk`, `RenderNodeChunk`, `RenderTerritories`, `GraphRenderScene` and pure animation/camera helpers. Avoid unrelated changes to `GraphRenderClient` / `clientContract` / binary decoder / `lod.ts` / host/protocol unless a verified integration gap demands a separate scoped change.
5. Selected-memory focus, tooltip, incident relationship overlay, camera target and verified pick behavior already exist. Maintain them across slider changes and animation. An overlay must not intercept a graph interaction when closed.
6. Never reintroduce Arcana service/package/dead-code/entry-point labels or v1 repository/project selection. REL's real filters are already in Knowledge navigation; do not duplicate an Arcana filter panel or synthesize unknown relation taxonomies.

### Related v1 controls explicitly outside this restore

- **Node budget input:** not a substitute for bounded binary chunks, LOD or authorization. Do not expose v1's whole-graph budget or change `GraphRenderClient` residency to mimic it.
- **Manual node-size slider:** none exists in the inspected v1 source. Do not add one under the guise of restoration.
- **Graph search, saved filters, label visibility:** review for REL equivalents separately. Existing Knowledge search/community/category/type/archive filtering must stay functional. A label-visibility control can be scoped in a follow-on if explicitly requested; not a prerequisite to the two v1 preference panels.
- **Package selection, linked repositories, missed files, dead-code visualization, Arcana source controls:** not meaningful REL graph controls; exclude rather than fabricate equivalents.

## Implementation sequence

**P1 — source/parity and settings (no renderer changes).** Freeze the source map and exact source revision, copy v1 menu/model implementations into the target, normalize settings and storage, remove Arcana/package names and styles, and add tests for clamps/defaults/malformed persistence. Record source-to-target deltas in a short parity ledger section of this spec or the existing graph parity ledger.

**P2 — display wiring.** Connect edge brightness, node glow, bloom, community-shell opacity/limit and camera indicator to the current scene. Ensure both sphere and point renderers and all three edge LODs respond. Visual-only updates must not call `prepare`, mutate the owner/cut, change render IDs, invalidate caches or fetch a whole graph.

**P3 — animation and camera views.** Port rotation helpers/controller and full animation menu; connect to the existing camera pivot, idle delay and selection focus. Add safe camera capture/restore by owner/profile, including reset semantics and generation-change fallback.

**P4 — integration and acceptance.** Verify theme, layout/keyboard, Web/Desktop, small/large REL fixtures, source parity and tests. Update `dashboard/README.md`, `docs/verification.md`, and deployment bundle documentation to describe what was actually built. Rebuild both generated outputs from canonical sources; do not hand-edit `dashboard/dist/*` or `desktop/plugin.js`. Do not retire or alter existing branches/worktrees without an explicit cleanup task.

## Acceptance gates — all mandatory

1. **Control parity:** display menu exposes working edge brightness, node glow, bloom, territory opacity, community-shell count, center indicator, Reset. Animation menu exposes all axes, ranges, counterspin, reroll, delay, pause/start, motion reset, Set View and Restore Factory View. No dead/placeholder controls.
2. **Real renderer effect:** at minimum/min/max each display slider has a visible, testable effect with default restoration. Bloom 0 disables bloom, node glow 0 leaves base node color, shells 0 hides shell meshes but not the Memory graph or names; selection and hover remain readable.
3. **Correct REL semantics:** Memory/Relation/Community/unassigned presentation is accurate; no packages, paths, Arcana icons/categories, fake communities or changes to community membership. Community shell limit acts only on already delivered renderer hierarchy.
4. **Camera stability:** signed 3-axis motion works, randomization and delay are deterministic under test, pointer input interrupts motion, pause is stationary, saved view survives reload in the authorized scope, factory reset works; selection focus and normal viewport LOD still operate.
5. **Zero protocol regression:** cosmetic controls do not call `prepare`, change generation, touch REL/PHY data, bypass auth, or introduce whole-graph JSON/picking. Frame budgets, resident chunk limits and bounded selected-edge reads remain unchanged. No performance cliffs from frequent slider input.
6. **Cross-surface presentation:** matched side-by-side DOM/screenshot checks against the v1 menus at representative widths; explicit justified differences for Reliquary labels and Hermes theme. Exercise both Hermes light/dark color schemes and Web/Desktop; no clipped menus, misplaced controls, keyboard traps or hover loss.
7. **Isolation and persistence:** malformed keys and numeric values safely fall back; profile/owner switch does not show prior owner's camera; generation refresh has a sane factory fallback. Missing host storage is nonfatal.
8. **Tests and proof:** extend `dashboard/tests/graph-render-client.test.ts` or add focused TS tests for pure settings/geometry/animation, then run `npm --prefix dashboard run check`. Exercise `dashboard/tests/{knowledge-live,web-live}.mjs` and `desktop/tests/live-smoke.mjs` where supported; record which were actually run and their outcomes in `docs/verification.md`. Do not count existing unrelated passing tests as proof of this UI.
9. **Documentation:** update source-parity/verification records, run the shared documentation checker and confirm that source, compiled Web assets and Desktop bundle are in sync.

**Completion definition:** both original v1 menus are visible and operational in the real Reliquary graph, visually integrated with the active Hermes theme, and all mandatory gates are evidenced. Static TypeScript compilation alone is not acceptance.

## Implementation and source-parity ledger

The source remains `warlock-toolchain` commit `4ca9627760e64ff95dc6c00b1079135534ebf76f`. Display source SHA-256 is `91461a6e35772b7803d4e63e7f44efe48bb568510b7553ac8065ff8f64fe24f6`; Animation source is `902296c19da14b0b148511a94c85264e42d2088087fe34fed4266aff43830237`. No original Warlock source was edited.

| Preserved v1 behavior | Deliberate Reliquary/Hermes adaptation |
| --- | --- |
| Five Display sliders, compact value labels, center indicator, Reset and menu hierarchy | Memory/Relation/Community wording; community shell limit defaults/maxes at the existing 128-descriptor budget |
| Full X/Y/Z speed/range/counterspin controls, delay, reroll, pause, motion reset and view actions | Existing Trackball camera only; validated owner/profile view records and current-bounds fallback |
| Excess node glow, density × user edge brightness, bloom, shell factors and zoom-responsive non-pickable marker | Existing resident binary chunks, all edge LODs, selected-edge priority and semantic territory colors remain authoritative |
| Outside-click dismissal, Escape and focus return | Shared popover owner clamps the portal to the visible Hermes pane and permits internal scrolling |
| Compact v1 layout and native controls | Host React/Button bridge, live `--reliquary-*` palette aliases; no cyan palette, copied theme preset or new UI runtime |
| Display/motion defaults and robust normalization | New namespace; Desktop partitions by its public connection/profile and camera owner; Web without a safe public profile key stays mount-session-local |

P1–P3 are implemented in pure settings/storage/rotation modules, the two source-derived menus, `useGraphPreferences`, and the existing scene’s presentation inputs. `GraphCameraBridge` owns capture/reset/focus; `GraphAnimationController` owns idle-gated camera motion. The graph client, protocol, authorization, binary decoder, LOD budgets and Root/backend implementation were not changed.

The original menu components were rendered locally with their original compiled CSS at 1440, 493 and 390 pixels. The isolated reference frame was adjusted to put Display’s anchor at the right edge; the component itself was unchanged. Source panels measured 256×589 (Display) and 340×602.5 (Animation). Target sizes follow the active host font and available pane height: Desktop retains 256/340-pixel widths; Web measured 240/318.75 pixels. Narrow panes scroll the panels internally. Differences in palette, terminology, shell cap and host placement are intentional; this is component/interaction parity, not a claim that the full Warlock graph was migrated or that differently themed screenshots are pixel-identical.

The user’s final direction narrowed P4 to the outstanding Desktop preferences bridge, theme inheritance, menu clipping and a focused point-mode check, followed by documentation, cleanup and commit. Existing backend/scalability validation remains authoritative; no additional backend regression or large-scale acceptance gate is required by this execution. The focused outcomes and current artifact hashes are recorded in [verification](verification.md#warlock-v1-graph-preferences).

## Related docs

- [Original-vs-scalable graph audit](warlock-graph-original-vs-scalable-audit-2026-11-10.md)
- [Original React graph component hard cut](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md)
- [Rich scalable graph contract](warlock-rich-scalable-graph-spec-2026-11-10.md)
- [Existing UI/API graph contract](ui-contract.md)
- [Current verification guide](verification.md)
- [Documentation policy](documentation-policy.md)

## Notes

This specification adds preferences and camera behavior to the accepted scalable implementation. It does **not** authorize an architectural redesign, Rust layout rewrite, new backend API, full source-graph ingestion in JS, or an Arcana integration. Preserve the current committed theme migration (`f80c2f7`) and any independently evolving graph changes; resolve overlap by focused source diff rather than overwriting newer work.