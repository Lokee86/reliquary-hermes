# Hermes Reliquary — hard-cut Warlock Knowledge UI parity (non-graph)

**Date:** 2026-11-10

**Status:** Implementation-ready specification; implementation not started by this document

**Target repository:** `C:\!bin\workspace\reliquary-hermes`

**Canonical visual/interaction reference:** `C:\!bin\workspace\Warlock-graph-original-review-2026-11-10` at `d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b`

**Current Hermes UI reference:** `dashboard/src/app.tsx`, `dashboard/src/app.css`, `dashboard/src/knowledge/*`, `dashboard/src/setup.tsx`, `dashboard/src/sources.tsx`

**Excluded active work:** Graph renderer/layout/territories/selection transport and all in-progress Warlock rich-scalable graph work.

## Problem statement

The objective was to recreate **Warlock's established Reliquary Knowledge UI inside Hermes**, directly reusing its React components, their structure, styling, proportions, and interactions. The current Hermes integration copied some Knowledge component names and functionality but rewrote the host shell, navigation hierarchy, control layout, state flow, and styling. It added a second owner rail on top of Knowledge's existing navigation and lost the original cohesive three-column composition.

This is a **hard-cut rebuild of the non-graph presentation**, not iterative styling of `rly-*` and not another redesign. Treat the existing Hermes non-graph UI implementation as disposable. Do not touch the functioning memory provider, storage, authenticated APIs, project routing, source ingestion, owner mounting, or graph renderer.

### Verified source evidence

- Original Warlock: `src/features/workspace/{KnowledgePanel,KnowledgeInspector,KnowledgeRelationsEditor,KnowledgeGraph,knowledgeUi}.tsx/ts`, `WorkspaceShell.tsx`, `ScopeControls.tsx`, `MountedScopeActions.tsx`.
- Original visual composition: `src/styles.css` selectors `.knowledge-panel`, `.knowledge-nav`, `.knowledge-memory-list`, `.knowledge-inspector`, `.knowledge-view-switch`, `.knowledge-memory-row`, `.knowledge-create`, `.knowledge-relation-editor`, `.knowledge-source-evidence`, and associated selectors. The original `.knowledge-panel` uses **230px / flexible center / 300–420px** columns.
- Hermes today: `app.tsx` adds `.rly-workspace` and `.rly-rail` (10–13rem) **outside** `KnowledgePanel`, and `app.css` adds an unrelated title/section navigation system. `knowledge/KnowledgePanel.tsx` and `knowledge/KnowledgeInspector.tsx` implement Hermes state/operations but diverge in composition and control styling. `dashboard/src/knowledge/knowledge.css` must be checked against the original rather than assumed to preserve the visual baseline.
- The Warlock `ScopeControls.tsx` contains **Tauri dialog calls**. It is behavior/reference only; it is **not** a direct drop-in host adapter. Ordinary Knowledge React components are not Tauri-dependent in the same way. Do not copy the Warlock workspace process or project/repository management APIs.
- `dashboard/src/knowledge/client.ts` already supplies authenticated, cut/revision-checked, capability-limited reads and writes via `/dashboard-v1`. `dashboard/src/host.ts` provides Hermes-native controls and picker adapters. Keep these real boundaries, not Warlock `knowledgeApi.ts` Tauri `invoke` calls.
- `dashboard/src/setup.tsx` and `sources.tsx` are **Hermes-only workflows**. Their authorization, enrollment, file creation, manual history import, polling and confirmation behavior must survive the new presentation.

## Target architecture

```text
Hermes Web / Desktop plugin entrypoint
  └── thin Hermes host adapter
       ├── current profile/authorized REL-PHY owner selection
       ├── Hermes theme/control/picker hooks
       ├── existing JSON Knowledge client (cut and mutation authority)
       ├── existing Setup and Sources backends
       └── one canonical Warlock-derived React interface
            ├── Warlock-style Knowledge navigation: owner, search, communities, create
            ├── Warlock-style center: Memory List / existing Graph component
            ├── Warlock-style inspector: Memory detail/history/provenance/relations
            ├── Warlock-style Setup surface (Hermes-specific data/operations)
            └── Warlock-style Sources surface (Hermes-specific data/operations)
```

**Graph exclusion is strict:** preserve the current `KnowledgeGraph` component's props and render transport contract, and the ongoing renderer work. Only embed it in the correct Warlock-style center-panel frame. No graph algorithms, geometry, graph styles, selection overlays, chunk transport, hierarchy, manifest, tests or source adapters are redesigned in this task.

**Canonical presentation owner:** shared React `dashboard/src/knowledge` and one small application/host shell. **One version for Web and Desktop**, built from the same source. The Hermes host remains responsible for its profile, authentication, sidebar embedding, and platform actions. Do not recreate Hermes global navigation or the entire Warlock application inside the plugin.

### Original component reuse rules

**Copy first. Adapt only where the real host requires.** Use the original component source as the starting implementation for each target; preserve recognizable markup, state ownership, CSS class names, visual hierarchy and interaction sequence. Review source diffs after porting to document each nontrivial modification.

| Original Warlock source | Target and mandatory treatment | Allowed differences |
|---|---|---|
| `KnowledgePanel.tsx` | Directly port three-column navigation/center/inspector composition, list/graph tab, unified selected Memory, search, communities and archive filter | Paginated Hermes data instead of original whole-owner `KnowledgeSnapshot`; host props; graph slot accepts current graph contract |
| `KnowledgeInspector.tsx` | Directly port title/body, edit-replacement, detail grid, provenance presentation, relationship section | Read exact revision/history and source status from Hermes; preserve capability/owner cut checks |
| `KnowledgeRelationsEditor.tsx` | Directly port relationship rows, direction/status, selection controls and confirmation UX | Restrict mutation kinds to actual `ui.relation_change` authorization; unsupported types visible as read-only evidence, not active mutation |
| `knowledgeUi.ts` | Copy formatting helpers (community labels, ID formatting, relation labels) where contracts match | Only exact backend naming/type mappings |
| `KnowledgeGraph.tsx` | **Keep the current graph rendering implementation untouched** | Adapt parent props only if needed; graph behavior is exclusively graph work |
| `WorkspaceShell.tsx` | Use its shell/scope placement and panel sizing as a visual/behavior reference | Do not copy Warlock chats, Files, system settings or Tauri lifecycle into Hermes |
| `ScopeControls.tsx`, `MountedScopeActions.tsx` | Reuse original UI arrangement and language for REL/PHY selection/create/open | Replace native Tauri dialogs with existing Hermes picker/setup operations; do not port repository bootstrap |
| `src/styles.css` Knowledge selectors | Directly reuse all relevant non-graph CSS structure, layout, sizing, colors, typography and responsive behavior | Only isolated CSS host token mapping, font availability, accessibility fixes and browser embedding adjustments |
| Warlock `knowledgeApi.ts`, `workspaceApi.ts` | Reference data/behavior shapes, **not** runtime transport | Use existing Hermes `knowledge/client.ts` and `host.ts` authority, no Tauri imports |

Use a **source parity ledger** with each component's origin commit/path, copied behavior/classes, explicit deviations, and objective verification. No “inspired by Warlock,” approximate CSS, layout recreation from screenshots, renamed duplicate components, or new design system. Small presentational adaptations are acceptable only if needed for Hermes embedding or a verified mismatch in backend capability.

### Layout and state

- Restore a **single Knowledge three-panel grid**: 230px Knowledge navigation; flexible Memory/Graph center with sensible minimum; 300–420px integrated inspector. Do not keep a second owner sidebar, a separate dashboard banner above the Knowledge grid, or redundant graph/list side controls.
- Integrate authorized owner/REL/PHY switcher at the existing Knowledge navigation/scope position. Show owner name/role clearly; long opaque IDs are available on demand in details, not constantly displayed.
- Preserve original panel scroll ownership: Knowledge navigation and inspector independently scroll, center List independently scrolls, Graph fills available center canvas, with no nested page scroll traps or horizontal overflow. Add a documented narrow viewport collapse/drawer pattern while preserving component hierarchy.
- Keep original Memory list rows (title/body excerpt/lifecycle, selection, highlighting), community list and counts, search, active/archive state, create Memory workflow, and action placement. Graph and List remain alternate views of the same selection and filter state. **The graph's actual renderer/transport remains untouched.**
- Keep original Memory inspector hierarchy (editable title/body, metadata, relationships, provenance) and the more recent Hermes revision history/retirement/capability correctness. Do not sacrifice genuine new functionality simply to copy the old screenshot. Source/provenance may be unavailable; show correct existing statuses.
- Use **the same selected Memory and owner/cut state in the Knowledge application**, not independent inspector/list/navigation selections. Owner changes abort requests and clear stale content; refreshed pagination and revisions preserve valid selection only. The graph team owns graph-specific camera/picking state.
- Preserve Warlock panel CSS/classes and local visual language. Avoid new global selectors, font overrides, and non-Warlock decorations. Hermes-native controls are rendered at the host boundary, with minimal styling adaptation in place. Preserve keyboard/focus affordances.

### Hermes-specific surfaces

- **Setup**: retain the current verified `setup-v1` status, validation, confirmed create, selected owner paths, native file dialogs where available, manual fallback, detected configuration, and General/project fallback policy. Recompose only visual structure to match Warlock panel/dialog patterns. No new onboarding/owner data model.
- **Sources**: retain new-session enrollment and explicit historical import with no automatic historical backfill; keep search, pagination, multi-select, authorized destination, review/confirm, progress, retry and deduplication. Match Warlock's list, panel, inspector and button treatment. No changes to underlying import/processing behavior.
- **Navigation**: Hermes retains the plugin entrypoint and app-level profile context. Knowledge/Sources/Setup tabs may exist as a small contextual switch but must not replicate Hermes global chrome or introduce another hierarchy of rails.
- **Capabilities**: use `OwnerBinding.capabilities`, `generation`, `cut`, `expected_revision`, and existing Hermes authentication. Read-only presentation is explicit; mutations cannot be enabled by styling or layout changes.

## User / developer outcomes

A local Hermes user sees the **recognizable Warlock Knowledge UI**, with its three-panel composition, search, communities, Memory list, full inspector, detail/history/provenance/relationships, and functional creation/editing/retirement as authorized. The same screen works in Web and Desktop. Hermes-specific setup and historical import remain present without looking like a second product. Frontend maintenance has one canonical component implementation instead of duplicated Warlock-like approximations. The graph module is neither changed nor blocked by this work.

## Implementation decisions

1. **Hard cut of the current non-graph presentation.** Existing `rly-app-header`, `rly-workspace`, `rly-rail`, duplicated navigation and custom Knowledge CSS are deletion targets. No dual old/new UI feature flag, temporary compatibility wrappers or re-styling as an intermediate product.
2. **Source reuse, not reinterpretation.** Port actual original Warlock React components, CSS and tested interaction patterns directly into their final Hermes modules. Preserve original names/classes unless a genuine namespacing collision exists.
3. **Transport stays Hermes.** Keep the existing authenticated `KnowledgeClient`, `HostBoundary` and backend `dashboard-v1`, `setup-v1`, `sources-v1` contracts. Only adapt component-facing types and calls where needed; no new generic service API.
4. **Bounded data.** The original `KnowledgeSnapshot` loads all Memories, which is incompatible with the current scalable renderer and Hermes pagination. Keep bounded list/community/history requests and server filtering; reuse original **presentation and state flow**, not its unlimited data-fetch implementation. Full data ownership stays in the host, not browser.
5. **Preserve cut-safe semantics.** Hermes has more precise revision, provenance, archive/retirement and authorized relations than the original. Retain these capabilities while placing them in Warlock's components. If a source control cannot be authorized, show genuine read-only state or omit it—never simulate backend support.
6. **No graph spillover.** Existing `graph/render/*`, Rust `graph_render*`, graph API, graph CSS, graph test baselines and graph-specific React state are separate work. Do not modify them to make UI layout easier. Coordinate only through existing `KnowledgeGraph` public props/owner/cut/filter/selection and mount it as-is.
7. **Retain user data and services.** No REL/PHY writes or format changes, no Hermes provider or host restart policy changes, no new Git/Lore association, no session or history import changes.
8. **Do not overwrite work in progress.** The Hermes repository currently contains uncommitted graph renderer, KnowledgePanel, inspector tests and other changes. First establish file ownership and isolate this non-graph migration in its own worktree/branch or an explicitly disjoint target. Never reset, stage, commit, or overwrite those unrelated changes. Reconcile current shared Knowledge files at integration rather than blindly replacing in-progress graph code.

## Migration strategy — staged hard cut

**Final architecture defined above is the only target.** Declare a non-graph UI migration window in a dedicated worktree. Compilation of the dashboard may be temporarily red during direct source copying; backend/service and the active graph work continue separately. No compatibility adapter solely for interim greenness.

1. **Freeze and ownership gate**: record exact original Warlock commit and source file/content hashes; inventory CSS selectors, component behavior and current Hermes API capabilities. Identify all consumers of `app.tsx`, `knowledge/*`, `app.css`, `setup.tsx`, `sources.tsx`; confirm the current graph WIP's overlapping `KnowledgePanel.tsx` and `knowledge.css`. Establish non-overlapping worktree/change ownership first.
2. **Direct Knowledge copy**: copy `KnowledgePanel`, `KnowledgeInspector`, `KnowledgeRelationsEditor`, `knowledgeUi` and original Knowledge CSS directly into final non-graph files. Apply the smallest bounded-data and Hermes API adaptations in place. Use direct diffs to record why each adaptation was needed. Do not copy Tauri or graph scene files.
3. **One shell + owner navigation**: replace `app.tsx` nested owner rail and dashboard banner with minimal Hermes section host and Warlock-based Knowledge navigation/scope control. Keep authenticated profile/REL/PHY switch and current setup status.
4. **Setup/Sources presentation**: reuse Warlock list/dialog/form/inspector primitives and CSS treatment for Hermes-specific views. Wire directly to existing setup and sources operations. No new service orchestration.
5. **Deletion pass**: delete obsolete non-graph `rly-workspace`, `rly-rail`, `rly-app-header` markup and their styling, redundant list/inspector controls, duplicate component implementations, outdated tests and CSS selectors. Keep existing graph component and its active tests. Do not leave old screens toggled or importable.
6. **Integration gate**: merge/reconcile with ongoing graph WIP; run Web/Desktop build, typecheck, UI tests, auth/cut/revision/security regressions and real hosted visual acceptance. Only after all gates pass, build and install new Web/Desktop bundles (no unrelated Rust host rebuild). Confirm current profiles, owner files and historical source state unchanged.

### Expected deletion inventory (verify consumers before deletion)

- The non-graph `rly-*` shell markup and redundant owner rail in `dashboard/src/app.tsx` and `app.css`.
- Rewritten non-graph Knowledge navigation/list/inspector markup and duplicate style rules in `dashboard/src/knowledge/KnowledgePanel.tsx`, `KnowledgeInspector.tsx`, `KnowledgeRelationsEditor.tsx`, `knowledge.css` that have no original Warlock equivalent.
- UI-only helpers introduced solely to support the superseded layout; obsolete view snapshots and layout-specific tests.
- Unused duplicated host-facing presentation wrappers. Keep the real Hermes `HostBoundary`, Knowledge read/write client, Setup/Sources backend and platform entrypoints.

**Deletion exceptions:** preserve any current module that actually contains authentication, owner/cut authority, source ingestion, Setup/Sources data behavior, or graph transport. Remove only its obsolete **presentation** after moving the behavior directly to the final owner. Never delete working backend functionality because a UI file shares a similar name.

## Testing decisions

- **Warlock source characterization**: record source file hashes and screenshots/DOM layout captures for original Knowledge navigation, List, selected Memory Inspector, create/edit, relation editor, community rename, source provenance and empty/loading states. Use same synthetic fixture/capability envelope when comparing to Hermes.
- **Component parity**: exact three-column grid proportions, scrolling/overflow, typography, spacing, colors, list row selection, community label/count, field placement, active/archived filter and owner switching. Test narrow viewport responsive fallback, keyboard focus and accessible labels. Compare real Web screenshots to original reference, not style intuition.
- **Functional parity**: search filtering and paged list, selection persistence, graph ↔ list/inspector synchronization through existing `KnowledgeGraph` props, create Memory, revision-aware replacement edit, safe retirement, supported relation operations, community rename, history and provenance. Test read-only and unknown-source states, stale cut, unauthorized owner, refresh/back navigation.
- **Hermes-only flows**: General REL/PHY setup, file dialog/select/create confirmation, no overwrite, project fallback, Sources browse/select/confirm, processing status, historical-session exclusion and deduplication. Verify no source jobs generated merely by opening the UI.
- **Cross-surface**: bundled React app loads in real Hermes Web and Desktop SDKs with the same component tree, host native controls, no `@tauri-apps/*` in production output, and no duplicated Knowledge UI. Run typechecks, React tests, original/port DOM or screenshot comparison, existing Node and Python host/API tests, and installed smoke.
- **Graph independence**: verify the existing graph transport and scene still load and graph-specific tests remain unchanged (except necessary parent integration assertions). No changes to graph manifest, layout, camera, territory, chunk protocol or graph code are accepted as part of this spec.
- **Integration hygiene**: source-search for abandoned `rly-workspace`, redundant rail and duplicate list/inspector screens; check CSS selectors, bundles and test fixtures. Verify no uncommitted graph WIP was overwritten, no REL/PHY file changed, and no unauthorized profile state mutation occurred.

## Out of scope

- **All graph rendering and algorithm work**, including appearance, nodes, edges, camera, panning, picking, territories, tooltip, physics/layout, selection overlay, Rust renderer, binary transport, LOD and performance optimization.
- Rebuilding the Hermes service, Rust host, memory provider, source ingestion, REL/PHY core, permission system or graph-source projection.
- Restoring the deprecated all-Memory frontend `KnowledgeSnapshot` implementation; keep current scalable data boundaries.
- Copying Tauri `invoke`, OS dialogs, repository bootstrap, Warlock chat/Files/Arcana/model settings and full desktop shell into Hermes.
- Changes to historical data, owner topology, onboarding semantics, imported sessions, or the separate REL dependency DAG correction.

## Completion gates

1. Hermes Knowledge UI is a direct, source-traceable port of the original Warlock **non-graph** component tree and visual layout, with documented minimal host/data adaptations—not a redesign or merely similar CSS.
2. One canonical three-panel Knowledge component tree; original nav/list/inspector styling and functionality; no redundant owner rail or fake dashboard shell.
3. Existing Hermes authentication, active profile, owner permissions, cut/revision/provenance checks, bounded data and mutation receipts remain correct; every supported Memory/Community/Relations workflow works.
4. Setup and Sources remain functional and visually integrated, with no reimplementation of their backend behavior.
5. Existing graph implementation, graph files, active graph work and tested renderer behavior remain untouched, with Graph still mounted through the existing component boundary.
6. Every obsolete non-graph UI path is deleted. No feature flag, old/new toggle, forwarding facade or dormant duplicate theme remains.
7. Web and Desktop build, test, real host screenshots/interaction parity and relevant integration security suites pass. Verify data and profile state unchanged. Updated bundles are installed only after final acceptance.
8. One final source/call-direction audit finds only the canonical component tree and Hermes host adapters; no accidental Tauri import or old dashboard presentation consumer remains.

## Further notes

The previous [full UI rebuild spec](warlock-ui-hard-cut-rebuild-spec-2026-11-10.md) is superseded **only for non-graph presentation ownership** by this focused hard-cut spec. The [rich/scalable graph spec](warlock-rich-scalable-graph-spec-2026-11-10.md) and active graph implementation work remain authoritative for all graph functionality. This specification does not authorize modifying those files.
