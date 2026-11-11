# P0 correction: Restore Warlock's global graph, not a tiered territory browser

**Date:** 2026-11-11  
**Status:** Implemented candidate; visual acceptance pending
**Repository:** `C:\!bin\workspace\reliquary-hermes`  
**Scope:** Hermes Knowledge graph renderer (Rust layout + shared Web/Desktop React client); not Reliquary storage or community detection.

## Purpose

Define the remediation and acceptance criteria for restoring a continuously visible, relationship-laid-out Memory graph at the Knowledge overview while retaining bounded retrieval and rendering.

## Overview

The client now admits complete node residency when chunk count and byte limits fit, otherwise keeps a spatially distributed bounded sample visible. Node and edge LOD are evaluated independently, and unassigned population remains a truthful count rather than a synthetic shell. This is an implementation candidate only: actual REL browser review and visual signoff remain open, especially for spatial layout and camera framing.

## Required outcome

**Open Knowledge → Graph on the 28-day REL and immediately see the complete connected 3D Memory graph, laid out by relationships, with communities as subtle visual regions around their *already visible* nodes.** It must behave like the original Warlock explorer, not a 3D directory of large community blobs that must each be opened to see Memories.

The November 11 `RELCMP01` fix is correct and must be preserved. The installed host now exposes the real 12 historical communities, but that is not evidence of visual parity. It exposes 2,191 active Memory nodes: 970 assigned to 12 communities and 1,221 genuinely unassigned. The lack of Leiden recomputation is **a separate core roadmap item**, not a prerequisite to this repair.

### Explicit non-negotiables

1. **All 2,191 Memory nodes visible in the initial overview** of this REL. The initial frame's actual resident/drawn node total must be 2,191, not just `manifest.totalNodeCount = 2191`. No zoom/drill-down action required to reveal them.
2. **A spatially continuous graph, not grid layers.** Memory-to-Memory relationship strength affects local node proximity; cross-community connection strength affects relative community placement. No obvious columns, stacked planes, regular cubic grids, unconnected isolated balls, or giant nested-shell overview.
3. **Communities annotate the graph; they do not replace the graph.** A named community's members remain individually drawn, pickable and connected to members of other communities. No community-as-single-node impostor. No mandatory exploration mode.
4. **Unassigned is not a giant cage.** Its 1,221 nodes participate in the same topology and are distributed according to their connections; do not pack them into one opaque/wireframe foreground ball. A small neutral “Unassigned” indicator/filter is allowed, but no fabricated semantic community assignments.
5. **Warlock visual and interaction parity.** Reuse the *actual* original `GraphScene`, `NodeCloud`, `EdgeLines`, `NodeLabels`, `Territories`, `clusteredLayout`, `forceLayout` and visual-helper **behavior**. Port layouts as bounded Rust algorithms; do not import the unbounded whole-graph JS processing pipeline. Scene, colors, materials, hover, selected edges, camera and controls must be traceable to original code.
6. **Keep scalability.** The existing authenticated owner/cut/generation contracts, binary chunks, GPU instancing, bounded selection, picking, viewport indexes, and large-graph LOD remain. No second renderer, no full rich JSON graph into the browser, no Tauri dependency in Hermes.

## Verified reasons the current result is wrong

- `dashboard/src/graph/render/client.ts`: `SMALL_GRAPH_NODE_LIMIT = 256` is a hard gate for `detailFits`. When `lod !== "detail"`, `planViewport()` requests **zero node chunks**. With 2,191 Memories the opening frame renders overview aggregates/community shells instead of the Memory graph.
- `host/src/graph_render_layout_grid.rs` + `graph_render_layout.rs`: 3D grid coordinates from `grid_offset`, hierarchy centers, and tiny bounded relaxation, constrained within per-grid-cell displacement. The spatial arrangement is fundamentally grid-packed, not the original relationship-driven clustered force layout; the visible stacked planes are a direct consequence.
- `host/src/graph_render_hierarchy.rs`: retains correct semantic communities and creates a *synthetic unassigned* territory. Hierarchy and chunk boundaries must remain **internal partitioning**, never navigation levels the user must open.
- `host/src/graph_render_manifest.rs` and `dashboard/src/graph/render/RenderTerritories.tsx`: territory bounds/mesh presentation makes the unassigned group a dominant sphere while individual nodes disappear at overview LOD.
- The prior specs [rich scalable graph](warlock-rich-scalable-graph-spec-2026-11-10.md) and [original component hard cut](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md) **assumed** existing Rust layout had restored original placement. Their “implemented/verified” statements do **not** establish this acceptance. This document supersedes those assumptions on node visibility, placement, and large unassigned presentation.

**Frozen authoritative reference:** `C:\!bin\workspace\Warlock-graph-original-review-2026-11-10`, commit `d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b`. Inspect the original implementation, not screenshots or memory of its appearance. Its `src/features/graph/model/{clusteredLayout,forceLayout}.ts` performs (a) per-community weighted node placement, (b) aggregate intercommunity spring layout, (c) offsetting local positions into one shared 3D world. Original `src/features/graph/scene/*` draws nodes, edges, labels and translucent territory geometry together in that world. **Do not reinstate the original whole-graph JavaScript allocation/force pipeline at production scale.**

## Implementation contract

### 1. Correct the initial overview / node residency first

- In `dashboard/src/graph/render/client.ts` and `lod.ts`, remove the implicit rule that a graph with more than 256 Memories must hide all nodes at initial zoom.
- For graphs whose **actual node-chunk count and bytes fit existing budgets**, load and draw all node chunks at overview, irrespective of node count. The 28-day corpus has **13 node chunks**; the current detail chunk budget is 32. Admit it based on bounded bytes/chunks and device capability, not the arbitrary 256-node cutoff. Keep tight residency and request budgets, with explicit fallback for genuinely large graphs.
- Node LOD and edge LOD are **independent**. A graph may show all Memory points/spheres while drawing only a sampled, aggregated or attenuated edge set. Camera zoom must not turn Memories into community proxy nodes.
- At larger scales, progressively sample/aggregate points or cull by screen size while retaining spatial continuity and immediate pick/locate; never impose “you must enter a community” as the sole way to see nodes. Declare the threshold/LOD policy, test it, and report when downsampling occurs.
- Fix `GraphRenderScene.tsx` initial camera framing to fit the actual node world, not an inflated synthetic territory shell. Preserve rotate/zoom/right-pan, selection target, reset and no asynchronous recenter.
- Regression: initial frame for 2,191-node REL has 13 requested/decoded node chunks and all 2,191 nodes drawn, before any zoom; it can still use low-detail edges.

### 2. Replace grid *as the final layout* with original Warlock's relationship-driven spatial meaning

- Use `clusteredLayout.ts` and `forceLayout.ts` as the **algorithmic source of truth**. Transcribe their relevant stable/weighted force principles into the existing Rust `host/src/graph_render_layout.rs` pipeline. Do not use the original unbounded JS `GraphData` or main-thread solver.
- Input: the already prepared, authorized, exact-cut, typed weighted adjacency from `graph_render_edge_projection*`, deterministic render IDs, community membership and source metadata. Avoid a second relationship or community inference implementation.
- Stage A: build sparse weighted *cross-community* connectivity; position group centers in **unconstrained continuous 3D** using bounded attraction/repulsion and collision avoidance. Unassigned nodes are not required to behave as one cohesive semantic community; divide them into bounded **visual-only** connected/locality subclusters as needed while preserving their `community_id = null`.
- Stage B: within each community/visual locality region, place individual nodes by weighted links; cross-group links must influence local boundary/centroid placement. Use deterministic seeded initial coordinates, bounded neighborhoods/iterations and scalable spatial repulsion (grid or spatial tree for **force lookup only**, not visibly gridded final positions).
- Stage C: resolve group overlap without flattening nodes into planes, then recompute territory extents and all node/edge chunk bounds. Keep nodes positioned as one continuous world, not a stack of disjoint data layers. Numerical determinism and stable positions on equivalent graph cuts are required.
- For a small/moderate graph including this 2,191-node corpus, **do not force the 128-node solver-population partition to become a visible spatial partition**. Bounded local passes and coarse forces must collectively achieve relationship-sensitive positions across those boundaries.
- Layout reuse must be invalidated when weighted topology or memberships change, not solely on unchanged node IDs. No stale positions/edge buffers after a topology change. Distinguish visualization clusters from authoritative Leiden Community records.

### 3. Render territories as subtle annotations of already visible Memories

- Reuse original Warlock territory sphere/label JSX/material behavior as the reference, with correct center/radius derived from actual node positions. Do not use a large opaque shell, strongly filled foreground cage, or a billboard card dominating the nodes.
- Real community labels: authoritative name or truthful short-ID fallback, count and stable color. Distinct real community regions visible simultaneously. Members and cross-community edges remain drawn through/within the sphere.
- The unassigned population may appear as dispersed neutral-tinted nodes without a single enclosing sphere. It remains filterable/countable in the UI, and the legend reports 1,221 unassigned correctly. Never forge clusters as actual semantic communities.
- Node shape, size, glow, brightness, edge color and label treatment should use the original `GraphScene/NodeCloud/EdgeLines/NodeLabels/Territories` source behavior with minimal typed-chunk adaptation, **not an additional custom lookalike**.

### 4. Keep the exploration features usable at overview

- At overview, hovering and clicking a Memory must work without zooming into a territory. Hover shows real title/short identity; click selects the same Memory in Graph, List and the full Knowledge inspector.
- Selecting a node focuses/retargets the camera and highlights its **actual incident edges** across communities; unrelated edges fade. Keep existing owner/cut/generation-bound inspection, 128-edge cap and explicit truncated count.
- Filters (search, lifecycle, community, category/type where supported) must work on the same authorized data in Graph and List. Switching owner/generation clears stale selection and cached chunk requests.
- Reuse the installed original Warlock preference panel and Hermes color/theme bridge. Do not regress bloom, region opacity, node size or related display controls.

## Work boundaries and sequence

1. **Baseline**: pin current Hermes and original Warlock hashes; record the installed host SHA and the 28-day REL source checksum; keep the active REL/PHY untouched. Work on an isolated branch/worktree if another agent owns the current checkout. Capture baseline screenshot and record the initial frame's actual node-chunk count.
2. **Overview visibility correction**: remove the 256-node visibility gate and decouple node from edge LOD. Validate that all 2,191 real nodes load at overview. This is the smallest independently useful fix; do it before layout rework.
3. **Rust spatial parity correction**: replace the grid-output logic by a bounded continuous force-based layout, adapted from original Warlock principles, including unassigned visual locality, weighted cross-territory forces and topology-sensitive invalidation. Keep binary formats where possible.
4. **Presentation parity**: align territory geometry and community/unassigned treatment with original Warlock. Remove any duplicate or obsolete custom layouts/presentation paths rather than preserving switches.
5. **Real-browser acceptance**: validate same updated build in both Hermes Web and Desktop (or report the specific unverified host). Capture initial overview, rotated, hovered, selected and cross-community views of the **actual 28-day REL** and compare with a faithful original Warlock rendering of the same dataset or a traceable source-derived fixture. Correct visible divergences rather than claiming parity from unit tests.
6. **Deploy**: rebuild source and Web/Desktop bundles and the Rust host only where changed; back up installed artifacts and pins; update them atomically with rollback. Do not deploy until the real 28-day graph passes the functional and visual gates. Do not rewrite the active REL.

### Acceptance gates — all required

| Gate | Required evidence |
| --- | --- |
| **A: Real 28-day initial overview** | 2,191/2,191 active nodes drawn at first frame with no click/zoom/drill; 12 existing semantic communities plus 1,221 genuinely unassigned shown truthfully; no community proxy-node substitution |
| **B: Spatial structure** | No conspicuous grid, flat stacked layers, or isolated territory balls. Stronger real links result in closer nodes/groups than weak/unlinked control fixture; cross-community edges influence relative positions |
| **C: No giant unassigned shell** | The 1,221 unassigned Memories participate visually in the connected world; no dominant `UNASSIGNED` cage or single impassable region; no fake semantic membership |
| **D: Interaction** | Rotate, zoom, right-pan, reset, hover, click, full inspection, selection focus, bounded incident edges, search/filter coordination and preference controls work in the real 28-day view |
| **E: Data invariants** | Exact same REL, PHY, owner ID, 2,191 active Memories, known community memberships, graph relations and source provenance; unchanged auth/cut/generation isolation |
| **F: Scalability** | Bounded node/edge chunk requests, GPU instancing, stable memory budgets; 100k and 1M-node synthetic checks or focused existing equivalent evidence. No unbounded JS force pass. LOD may reduce node detail on huge graphs but not turn all nodes into compulsory click-through communities |
| **G: Visual signoff** | Side-by-side rendered screenshots and direct browser observation of the first-open overview. “Manifest reports 12 communities” and “tests pass” alone **do not pass** |

**Failure conditions:** Any initial overview where all nodes are hidden behind a territory shell, obvious XYZ lattice/layers, disconnected community blobs requiring separate exploration, or a giant neutral cage enclosing the unassigned population is **not done**, regardless of successful compilation or previous spec status.

## Exclusions / dependencies

- No Leiden restoration, migration, re-embedding or Dream rerun. Original 12 partial communities must remain intact.
- No Reliquary storage changes, host multiplexing/active REL hot-swap work, or project routing repair.
- No wholesale Hermes UI redesign; preserve existing Warlock-derived Knowledge shell, preferences, theme and connected provider.
- Prior comparison and component port remain valid references: [graph audit](warlock-graph-original-vs-scalable-audit-2026-11-10.md), [rich scalable graph](warlock-rich-scalable-graph-spec-2026-11-10.md), [source-first React port](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md). **Their prior implementation/verification claims do not close this defect.**

## Handoff instruction

Repair the **installed Hermes graph** using this spec, original Warlock source and the 28-day active REL. First make all 2,191 nodes visible at overview; then replace the visibly layered grid with bounded relation-directed placement and remove compulsory community drill-down. Preserve the existing binary renderer and working community decoder. Do not report completion without live browser screenshots and initial-frame count verification on the actual REL.

## Related docs

- [Verification record](verification.md)
- [Local service graph operation](local-service.md#graph-rendering-and-bounds)
- [Original Warlock graph audit](warlock-graph-original-vs-scalable-audit-2026-11-10.md)
- [Rich scalable graph requirements](warlock-rich-scalable-graph-spec-2026-11-10.md)
- [Original React component port](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md)

## Notes

Passing focused client tests or matching fixture counts does not satisfy the real-browser visual gate. Keep the status at “Implemented candidate; visual acceptance pending” until direct browser review of the actual 28-day REL records first-frame drawn counts and the required visual comparison.
