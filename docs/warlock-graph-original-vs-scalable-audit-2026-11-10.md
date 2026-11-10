# Original Warlock graph vs scalable Warlock graph vs Hermes port

**Date:** 2026-11-10

**Type:** source-backed functionality audit, not an implementation specification
**Scope:** Warlock's graph visualization and Knowledge interaction, plus the current Hermes port. No product files or datasets modified.

## Comparison revisions and checkouts

| Comparison | Revision | Isolated path |
| --- | --- | --- |
| **Original last-live rich renderer** | `d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b` (parent of `52d40ac` graph hard cut) | `C:\!bin\workspace\Warlock-graph-original-review-2026-11-10` |
| **Scalable/current Warlock** | `cf41c6690e089cab4a00950d6048ad6828eaeab7` | `C:\!bin\workspace\Warlock-graph-scalable-review-2026-11-10` |
| **Current Hermes port** | current `C:\!bin\workspace\reliquary-hermes` checkout (at inspection, `main` HEAD included the camera recenter fix `ebc53fa`) | `C:\!bin\workspace\reliquary-hermes` |

Both Warlock worktrees are detached and clean. Existing active Warlock main has two previously modified Cargo files; neither was changed by this audit.

**Historical precision:** `9e7a9f0` (2026-09-07) originally ported the generic 3D renderer from Warlock v1; `d9e38cb` is the last source revision where the rich `GraphScene` remains the live Knowledge graph. `52d40ac` (2026-09-29) switched live Knowledge to render generations; `26acb77` removed the old modules. **Arcana source selection and inspection were implemented in October, after the rich renderer cutover**, notably `1baf44d` and `2e5e1ac` on 2026-10-01. Therefore the September original did **not** already contain October's Arcana source-selection behavior; matching the intended user experience means integrating the rich original interactions with the later generic/Arcana-capable render infrastructure, not assuming a single historic revision had everything.

## Verified feature matrix

Legend: **Yes** = implemented in inspected source; **Partial** = a narrower behavior exists; **No** = absent from inspected source or its rendered interaction path. This is a static source audit, not a claim of hands-on live-browser verification.

| Behavior | Original rich Warlock | Scalable Warlock | Current Hermes | Source-grounded finding |
| --- | --- | --- | --- | --- |
| Rotate / pan / wheel zoom in 3D | Yes | Yes | Yes (recent pan recenter fix) | All use Three.js `TrackballControls` |
| Group visual appearance | Spheres | Axis-aligned wireframe boxes | Boxes | `Territories.tsx` vs `RenderTerritories.tsx` |
| Named/color-coded group labels + node count | Yes | No | No | Old `TerritoryLabel` renders `NAME · count`; new descriptor lacks name/color |
| Relationship-aware local node placement | Yes | No | No | Old local `forceLayout3D` consumes link weights; new Rust hierarchy layout is spatial grid |
| Relation-weight-aware group positioning | Yes | No | No | Old cross-group edges aggregate into `ForceLink`; new group grid ignores connectivity for placement |
| Per-relation edge colors | Yes | Yes | Yes | Preserved in Rust source-specific edge styles and packed render buffers |
| Semantic relation weight affects **layout** | Yes | No | No | New weights affect edge styles/importance, not node position |
| Node hover detection | Yes | Yes | Yes | Old pointer handlers; new `BoundedPicker` calls `setHoveredRenderId` |
| Visible node hover tooltip (title + subtitle) | Yes | No | No | Original `GraphScene/Tooltip` uses Drei `Html`; current hover ID has no presentation consumer |
| Node click-to-select | Yes | Yes | Yes | New bounded raycast/picking retained |
| Selection moves camera target to selected node | Yes | No | No | Old `useEffect` targets selected coordinates; new target is only initialized from graph bounds |
| Dim nonselected nodes | Yes | Yes | Yes | Old `NodeCloud`; new `nodeRgb` scales nonselected colors to 0.16 |
| Highlight only connected edges on selection | Yes | No | No | Old `EdgeLines` filters by highlighted IDs; new edge chunks do not accept selected render ID |
| Visible labels | Top 80 by size or selected | Bounded/LOD by importance | Bounded/LOD by importance | New avoids all-node sorting in browser; selection does not force labels |
| Direct graph selection ↔ full Memory inspector | Yes | Partial | Partial | Original graph shares `selectedMemoryId` with inspector; newer graph uses dedicated selection inspector and suggests switching to List; Hermes provides a switch to List |
| List search/community/archive filtering **also filters graph** | Yes | No | No | Original `KnowledgePanel` passes `filtered` and filtered relations; new graph preparation is owner-wide and navigation filters are list-only |
| Full graph semantic snapshot in browser | Yes | No | No | Deliberately replaced for scale |
| Huge-graph bounded chunks and LOD | No | Yes | Yes | Render manifest, binary chunks, spatial indexes and LOD |
| Generation-specific bounded selection resolution | No | Yes | Yes | New render IDs resolve through backend |
| Arcana source selection and indexed Arcana node inspection | Not yet integrated | Yes | No | Added post-cut in October; Hermes is Reliquary-only |
| Graph source-aware generic infrastructure | No | Yes | Yes for REL only | New graph core supports source-independent keys; Hermes has single authorized Reliquary source |

### High-impact functional regressions in the newer path

1. **Semantic clustering became regular grid placement.** This is more than appearance: original link forces positioned strongly related Memories near one another and placed communities based on intercommunity links. The new hierarchy is sorted/grouped spatially, with no force-derived locality within a group. Edge colors/weights did survive, but not the spatial meaning.
2. **Community presentation lost both geometry and metadata.** Original spheres were labeled with human-readable group names, counts and distinct colors. The newer `GraphRenderHierarchyDescriptor` exposes `kind`, `bounds`, `nodeCount`, etc., but no label/color/community ID for the frontend. The backend has a source community ID internally, but `GraphRenderCommunitySource` carries only ID and membership. No simple React geometry swap restores complete parity.
3. **Hover was reduced to unused state.** Modern/Hermes `BoundedPicker` emits hover IDs, and `GraphRenderClient` stores one, but a search found no other consumer that renders a tooltip or hover highlight.
4. **Selection lost focused exploration.** The old scene retargets `TrackballControls` to a selected node and incident-edge highlighting provides immediate neighborhood context. The new scene dims other nodes but leaves edge chunks unchanged and does not retarget the camera.
5. **Graph/list coordination weakened.** The original `KnowledgePanel` passed selected Memory and shared the full Memory inspector with the graph, and graph contents respected current search, community and archive filters. Scalable Warlock and Hermes separate list filtering from graph preparation, and graph selection shows a lightweight inspector rather than the original full editor/inspection context.
6. **Small-graph presentation changed.** The original drew 3D instanced spheres up to 75,000 nodes and switched to point sprites above that threshold. The new renderer uses `THREE.Points` chunks at all scales. The Hermes port makes points smaller with `markerScale`; both visual and pick-size parity need inspection on small RELs.

### Genuine gains that must not be discarded

- Rust-owned deterministic hierarchy and grid layout; no global JavaScript force pass or rich whole-graph `GraphData`.
- Immutable render generations, stable render-local IDs, profile-scoped selection resolution, byte-oriented chunks and LOD, spatially bounded retrieval and picking.
- Chunk reuse and small/large viewport budgets; source-generic graph architecture; Arcana repository source support and indexed node inspection in Warlock.
- Original baseline measured ~181 seconds global layout at 1M nodes / 10M edges and heap OOM attempting the 5M/50M tier. The later design is demonstrably able to prepare and select graph nodes for 1.125M-node Arcana snapshots; preparation is still expensive (~208s measured in one documented debug benchmark). These are **different datasets and test conditions**: do not claim a direct speedup ratio. See Warlock `docs/GRAPH_RENDER_ARCHITECTURE.md` and `docs/GRAPH_RENDER_BASELINE_2026-09-28.md`.

### Important correction about the square box

`RenderTerritories` draws every hierarchy node whose kind is `territory`. The Rust `build_graph_render_hierarchy` also constructs one **synthetic unassigned territory** for Memories without community membership. Therefore seeing **one box does not prove the REL has one actual semantic community**. It might contain an unnamed, unassigned bucket. Proper semantic identity should be inspected separately. The prior suggestion to simply hide the box for one community would conceal the symptom without restoring the missing behavior.

## Restoration requirements derived from this comparison

**Target:** original 3D Knowledge exploration UX and meaningful relationship-driven clustering on the **existing scalable Rust/binary renderer**, not a return to global JS rich-object force layout.

1. Restore **bounded, deterministic, relation-sensitive placement** in Rust: make relation weights affect relative positions within visual leaves and community/territory positions without an O(N²) global simulation. Keep chunk boundaries, render identity and scalability.
2. Extend the source/manifest contract as necessary to convey **territory ID, human name, color, member count, and suitable sphere center/radius/extent**. Explicitly distinguish real communities from synthetic unassigned visualization buckets; do not mutate Reliquary community semantics.
3. Restore original **spherical territory appearance with readable names and counts**, including sensible small-graph and single-group presentation. Do not arbitrarily omit a real community because it is the only one.
4. Restore **node hover tooltip and feedback** using bounded generation-bound `resolveNode`/detail requests; no giant in-browser metadata map or unauthenticated payload lookup.
5. Restore **selected-node camera focus, selected-node emphasis and incident-edge highlighting**. The edge implementation needs a bounded relation-index/selection-aware edge layer, not whole-graph browser enumeration.
6. Restore **graph/list/inspector selection synchronization** and graph-scoped search/community/archive filtering. Use authoritative query/scoped render-source semantics; avoid eagerly materializing all Memory bodies in graph mode.
7. Maintain **binary chunks, Web/Desktop authenticated transport, profile changes, current generation/cut and Arcana-capable generic source boundaries**. Do not reintroduce Warlock's deprecated rich `GraphData` pipeline or its scaling ceiling.
8. Verify one-community, multiple-community, unassigned, selected-neighborhood and cross-community graphs and their camera/hover/list flows in a real browser, then test at medium and large synthetic scales.

## Verification scope and limitations

- **Completed:** two detached source checkouts, precise source/contract inspection, commit chronology and documented benchmark review; baseline and current feature inventory. No application code or REL/PHY data changed for this comparison.
- **Not completed:** launching both historical builds with the same graph corpus and recording visual or interaction tests. Rebuilding the old Tauri app would require matching its older Rust/Arcana dependencies. Current conclusions are verified source capabilities and historical measurements, not fresh browser benchmark measurements.
- **Historical caveat:** the 2026-09 original graph and the October Arcana-capable integration never coexisted at the same revision. Functional restoration must combine their useful behavior, not assume one historical snapshot is the complete target.

## Primary evidence files

Original `d9e38cb`:
- `src/features/graph/scene/{GraphScene,NodeCloud,NodeLabels,EdgeLines,Territories}.tsx`
- `src/features/graph/model/{clusteredLayout,forceLayout,types}.ts`
- `src/features/workspace/{KnowledgePanel,KnowledgeGraph}.tsx`, `knowledgeGraph/{layout,visuals}.ts`

Scalable `cf41c66`:
- `src/features/graph/render/{GraphRenderScene,RenderTerritories,RenderNodeChunk,RenderEdgeChunk,RenderLabels,BoundedPicker,CameraViewport,renderColors,client,types}.tsx/ts`
- `src-tauri/src/{graph_render_hierarchy,graph_render_layout_grid,graph_render_contract,workspace_graph_render_style}.rs`
- `src/features/workspace/{KnowledgePanel,KnowledgeGraph,GraphSelectionInspector,GraphSourceControls}.tsx`

Hermes:
- `dashboard/src/graph/render/*`; `dashboard/src/knowledge/{KnowledgePanel,KnowledgeGraph,GraphSelectionInspector}.tsx`
- `host/src/{graph_render_hierarchy,graph_render_source}.rs`
