# Warlock rich graph + scalable renderer: canonical integration specification

**Date:** 2026-11-10

**Status:** Implementation and acceptance evidence are tracked in the verification guide.

**Owner:** Reliquary Hermes plugin's existing graph rendering subsystem, with reusable design/contract anchored in Warlock.

**Repository:** `C:\!bin\workspace\reliquary-hermes`

**Functional source:** original Warlock graph, `d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b` (detached comparison worktree `C:\!bin\workspace\Warlock-graph-original-review-2026-11-10`).

**Scaling source:** Warlock `cf41c6690e089cab4a00950d6048ad6828eaeab7` (detached `C:\!bin\workspace\Warlock-graph-scalable-review-2026-11-10`).

**Authoritative comparison:** [Original versus scalable feature audit](warlock-graph-original-vs-scalable-audit-2026-11-10.md).

**Scope:** Graph renderer, its source projection, and integrated Knowledge UI behavior in Hermes Web/Desktop. Not a general-purpose rewrite of the already functioning provider or UI.

## Purpose

Restore the original Warlock exploration behavior on the prepared-generation renderer shared by Hermes Web and Desktop.

## Overview

Root supplies authorized Memory eligibility and relationships at an exact cut. The Rust host prepares weighted positions, territory descriptors, bounded inspection and binary chunks. Graph and List share the same filters, selected Memory and inspector.

## 1. Problem statement

Warlock's original graph was a meaningful 3D knowledge explorer: relation-weighted clustering of Memories and communities, named/color-coded spherical territories, hover tooltips, focus-on-selection, incident-edge emphasis, and synchronized graph, list, filtering and Memory inspection. The scalable replacement preserved GPU navigation and picked-node identity but substituted deterministic spatial grids, unlabeled bounding boxes, a hover ID with no presentation, a separate lightweight selection inspector, and edges that do not change when selecting a Memory. In Hermes, the visual loss is conspicuous even for a 13-Memory processed REL.

The original rich renderer is not a suitable backend to resurrect unchanged. It constructed large rich JavaScript graphs and executed whole-graph CPU layout; Warlock documented around 181 seconds of clustered layout for a 1M-node benchmark and an out-of-memory failure at 5M nodes/50M edges. **The target is all of the original's useful exploration functionality on the modern Rust-owned prepared-generation, binary-chunk, indexed, LOD renderer.** Neither a cosmetic sphere swap nor reverting to the original JavaScript graph meets this requirement.

## 2. Target architecture and ownership

```text
Reliquary Root: authorized, exact-cut semantic Memories / relations / communities
  ↓ existing read-only graph source seam
Hermes Rust host: one graph-render source projection
  ├─ stable sorted semantic IDs → generation-local render IDs
  ├─ deterministic hierarchy and semantic-community membership
  ├─ bounded weighted graph layout: group + leaf-local topology
  ├─ immutable generation: territory descriptors and selected-node adjacency
  ├─ existing node and aggregate/detail edge binary chunks + LOD
  └─ authorized generation-bound inspect/resolve/neighborhood operations
  ↓ existing authenticated graph-render-v1 profile/owner/cut boundary
Shared Hermes Web/Desktop React Knowledge UI
  ├─ existing GraphRenderClient: spatial chunk planning, binary decoding, residency
  ├─ Three.js: scaled node geometry, sphere territories, edge LOD, camera
  ├─ hover, pick, focus and visible incident edges
  └─ synchronized graph/list/inspector/search/community/archive selection
```

**Authority:** Reliquary owns semantic identities, graph edges, communities, memory lifecycle and provenance. Renderer-owned coordinates, layout clusters, unassigned buckets, colors, chosen labels, importance, visual LOD and navigation state are nonauthoritative and disposable. No lower-store access from Hermes; no memory mutations from graph browsing.

**Canonical internal modules:**
- Rust `host/src/graph_render_prepare.rs`: orchestrates source validation, sorted render identity, hierarchy, **edge projection before relation-sensitive layout**, materialization and reuse.
- Rust `host/src/graph_render_layout.rs` plus a dedicated cohesive layout implementation (not a chain of wrappers): weighted, deterministic hierarchical layout.
- Rust `host/src/graph_render_hierarchy*.rs`, `graph_render_source.rs`: community identity and presentation metadata, distinguishing semantic communities from synthetic unassigned buckets.
- Rust `host/src/graph_render_contract.rs`, `graph_render_manifest.rs`: the sole render manifest/territory DTO; binary chunk schemas stay unchanged unless independently justified.
- Rust `host/src/graph_render_edge_projection*.rs`: compact weighted adjacency, aggregate topology and generation-local incident edge indexing for bounded selection.
- React `dashboard/src/graph/render/{GraphRenderScene,RenderTerritories,BoundedPicker,RenderEdgeChunk,RenderNodeChunk,RenderLabels,client,types}.tsx/ts`: existing rendering client and surface, enriched rather than duplicated.
- React `dashboard/src/knowledge/{KnowledgePanel,KnowledgeGraph,KnowledgeInspector}.tsx` owns the shared selected Memory and filter scope through the authenticated Knowledge client.

**No duplicate graph path**, no Tauri dependency in Hermes, no new renderer process, no fallback to the old `GraphData` pipeline, and no independent frontend force simulation.

## 3. Render-source and manifest contract

### 3.1 Source input

Extend existing `GraphRenderCommunitySource` by one coherent presentation descriptor: stable opaque community ID, effective display name (if authoritative), member IDs and count, and a deterministic display color; synthetic `unassigned` is **explicitly identified** as a visualization-only bucket, not treated as a Reliquary community. Community names and metadata must be read through the current authorized Root service. If no authoritative name is available use a distinct, truthful `Community <short-id>` fallback; never invent semantic categories. Retain current source-generic node/edge key and style input so the renderer can later serve Arcana without Reliquary-specific branching.

The input edge projection must preserve endpoint render IDs, direction and relation-specific weight. Use existing `GraphRenderEdgeStyle.weight_units` for weighted placement; do not invent a separate inconsistent weight table. Deduplicate/handle repeated relationships deterministically. Validate endpoints; reject malformed input rather than silently creating fake adjacency.

### 3.2 Generation/manifest

Expose, per territory, a minimal bounded descriptor:
- source community ID or explicit `unassigned` kind;
- human label, node count, display color;
- center, bounding sphere radius, and existing hierarchy bounds;
- generation identity/cut compatibility through the enclosing manifest.

Keep the existing hierarchy structure, `totalNodeCount`, `nodeChunks`, `edgeChunks`, global bounds and binary magic/layout. The current manifest is schema v2 and lacks territory names/colors; **version this changed manifest contract explicitly** (e.g., v3), update both host and TS validators/build fixtures together, and reject mismatched versions. Do not maintain permanent dual-schema readers for the retired internal form.

For a single actual community, show one real labeled sphere. For unassigned-only data, show a distinguishable `Unassigned` visual group; don't label it a community. Empty community metadata must not fabricate a territory. Visual spheres are based on *calculated positioned-node bounds*; they must enclose the nodes after weighted layout, not merely reuse axis-aligned box dimensions.

### 3.3 Interaction inspection

Keep current `resolveNode(generationId,renderId)` stable. Add only the minimal **bounded, owner/cut/generation-bound selected-node inspection** needed for (a) hover title/subtitle and (b) incident links / immediate neighbor IDs, styles and endpoints. Prefer existing Root inspection/public adjacency read surfaces and retained compact edge projection where sufficient; do not build an all-node metadata/edge map in JavaScript. No huge unbounded JSON graph response. Requests must reject stale generation, switched profile, foreign owner and unauthorized source.

In dense graphs, selected-neighborhood results have explicit maximum and truncation indicator; **an eligible selected Memory's incident edges cannot silently disappear**. Display `N more relationships` or an expansion action when the bounded selection cannot show all. Keep a small bounded ID/tooltip cache; cancel and invalidate it on owner/cut/generation change. The selection overlay should use stable render IDs, not array indices from current viewport chunk ordering.

### 3.4 Filter scope

Provide one scoped graph-generation request with the same meaningful Memory selection criteria as List: query, community, active/archived lifecycle, and any supported type/category filters. **Filtering applies to the graph's authoritative node and induced-edge set**, not only to visible labels. Build/scoped-project via authorized Rust/backend operations before GPU chunk generation and bind filters into render-generation identity/cut. Repeated graph/list transitions preserve filters and selected Memory when still eligible. A selected Memory excluded by new filters clears selection intentionally; it must not leave a stale inspector. Avoid loading all Memory bodies or whole graph DTOs into React just to filter.

If Root cannot currently produce exact-cut filtered graph input, add a narrow explicit read-only projection seam there; do not simulate filtering by returning full graph JSON and discarding data client-side. No semantic changes to Root.

## 4. Relationship-aware layout without losing scaling

**Layout must derive meaningful proximity from graph links, but stay bounded and deterministic.**

- **Level 1 — territories:** Aggregate weighted cross-community edge connectivity into a sparse community graph (including unassigned bucket); place *small bounded sets of territory representatives* via seeded deterministic spring/repulsion refinement. For numerous communities, recursively partition the aggregate graph and only refine bounded sibling neighborhoods. Keep stable deterministic ordering and collision-safe sphere spacing.
- **Level 2 — subgroups/leaves:** Reuse current hierarchy and leaf capacity (32,768 max) for source grouping/chunk identity. For each leaf, derive a sparse local adjacency set. Partition into bounded subclusters, place group centers using deterministic coarse weighted connectivity, then refine a bounded local population using edge-attraction/repulsion. Nodes linked across leaves affect aggregate positions and optionally bounded leaf-boundary adjustment; do not run a global force step over all nodes.
- **Level 3 — placement:** Start from deterministic, non-overlapping coordinates; refine according to typed weights with strict iteration, neighbor and operation budgets. Preserve position finiteness, conservative nonintersection and bounded global extents. Enforce deterministic tie-breaking by source/render ID, fixed seeds and reproducible floating-point order. Recompute accurate territory/hierarchy bounds and derived chunk positions after layout.

**Explicit prohibitions:** No `O(N²)` global pairwise repulsion; no whole-graph force simulation; no per-frame CPU force pass in React; no converting binary chunks back into rich `GraphNode[]`; no global edge geometry generation in the browser.

**Concrete budget design:** The implementation must choose and document fixed maximum local solver population, solver iterations, aggregate fan-out, per-node neighborhood consideration and expansion bounds **before implementation benchmarking**. Keep work bounded by graph size plus inspected edges under those fixed budgets; require practical linear or near-linear scaling with N+E, not a claim of a strict asymptotic bound without measurement. Invalid/huge graph inputs must return typed errors or reduced-detail aggregate output, not lock the UI indefinitely.

The renderer uses the following limits.

| Surface | Limit |
| --- | --- |
| Hierarchy leaf capacity | 32,768 Memories |
| Local relaxation | 128 nodes per population, 12 iterations, 16 weighted neighbor candidates per node |
| Aggregate relaxation | 32 representatives per population, four iterations, 32 retained neighbors per representative |
| Center movement | Six units per aggregate center within a 24-unit base clearance. Local movement stays inside each node's grid clearance. |
| Selection | 128 incident edges, with the exact total and omitted count |
| Root scan | 2M retained Memories or membership entries and 20M relation states examined. A scan beyond these limits fails before publishing a generation. |
| Signed source | 1M Memories and 10M induced render relations, a 4 MiB manifest and 1 MiB binary chunks |

**Reuse and invalidation correction:** Current `graph_render_prepare.rs` reuses layout when node keys/hierarchy are identical even if relations change. This rule is wrong for a relation-driven layout. Use a stable weighted-topology fingerprint (and any layout-policy/version fingerprint) so adjacency/weight changes invalidate the affected layout regions. Preserve and reuse unchanged chunks and hierarchy branches where correct; **never reuse old node/edge chunk geometry when positions change**. The next generation has fresh immutable node positions and properly updated edges/bounds, and structural reuse is supported by deterministic equivalence tests.

## 5. Interaction specification (original parity)

### 5.1 Spheres and colors
Replace `RenderTerritories` wireframe boxes with the original translucent sphere language. Render names/counts as legible camera-facing labels using bounded text/texture residency. Community color comes from deterministic source metadata; color and labels must not change across equivalent generations. Support single-community, multi-community, unassigned-only and mixed groups. On huge graphs, show only viewport/LOD-eligible territories and labels; no one-label-per-node scene explosion.

### 5.2 Hover
Hovering a node highlights it and displays a tooltip with its actual title and short identifier, anchored to the node or cursor. Resolve metadata lazily through authenticated, generation-bound inspection; cancel stale requests, debounce or request-gate as appropriate, and bound cache memory. No tooltip for missing/inaccessible Memories. Keyboard focus and equivalent selected detail remain accessible.

### 5.3 Selection/focus
Click selects a Memory and focuses the `TrackballControls` target at its graph position **only on an intentional selection change**, never on viewport frame changes, hover, pan or chunk fetch. Preserve camera orientation and sensible zoom. Double click/keyboard focus behavior should be explicit and tested; do not interrupt right-drag pan. Highlight selected Memory and attenuate unrelated nodes/edges. Selection includes full Memory inspector in the same Knowledge surface (history/provenance/actions based on grants), not a bare ID and a forced switch to List.

### 5.4 Relationships
Original behavior highlights incident relationships and attenuates or omits unrelated edges. Implement a bounded selection-specific edge overlay or selection-aware LOD draw data from the Rust generation. Render real relation kinds/colors/direction/weights from authoritative source. Handle cross-community edges, selected nodes across chunks and offscreen neighbors with accurate counts/truncation. No fetching or rebuilding all graph edges on selection.

### 5.5 Graph/List/Inspector coordination
`KnowledgePanel` owns one `selectedMemoryId`, one authoritative filter scope, one current owner/cut and view mode. Both Graph and List consume the same selection/filter state. Clicking list row focuses/highlights the graph if graph becomes visible; selecting in graph updates full inspector immediately. Search/community/archive changes update both views, preserving selection only if it still matches. A read-only Memory remains inspectable; writes are only exposed when matching Hermes capabilities permit. Switching REL↔PHY or session must invalidate graph, selection, inspector, pending requests, and camera **only where the selected owner/generation actually changes**.

### 5.6 Navigation
Retain 3D rotate, wheel zoom and right-drag pan. Panning may **never reset** merely because a viewport chunk loads (see existing `ebc53fa` camera target stabilization). Provide a user-invoked reset/framing action for returning to graph bounds and clear focus behavior. Chunk/LOD transitions must preserve orientation, position and target.

## 6. Implementation decisions and hard-cut sequence

These stages are **bounded construction and verification checkpoints in one final architecture**, not separate shippable systems or feature-flagged dual renderers. A temporary red migration window is acceptable in graph-specific code.

1. **Frozen characterization:** Keep the two audited Warlock comparison worktrees unchanged. Capture a fixture for the processed November 8 REL/PHY *on copies* and synthetic fixtures for: one community, multiple linked communities, unassigned-only, isolated nodes, dense connected components, and lifecycle-filtered Memories. Record existing graph/renderer performance and usable UI screenshots. Confirm permitted Root projection input and existing Hermes auth routes.
2. **Source + protocol contract:** Specify/implement the source community presentation metadata, territory manifest schema bump, cut-bound graph filter scope and selected-neighborhood inspection at the final Rust/TS interface. Update runtime validators and synthetic fixtures. Explicitly exclude Tauri-only APIs.
3. **Weighted hierarchical Rust layout:** Compute source edge projection before layout; introduce bounded deterministic weighted territory/subgroup/leaf placement. Fix topology-sensitive invalidation/reuse. Test sparse, dense, isolated, multicommunity and cross-leaf cases with exact deterministic positions and bound checks. Preserve chunked materialization and LOD.
4. **Graph presentation:** Replace box territories with semantic colored spheres and labels. Restore tooltips, focus-on-selection, selected edges and bounded selection overlay. Port original scene behavior—not original rich-object data pipeline.
5. **Knowledge coordination:** Unify selected Memory/filter state across Graph, List and full inspector; keep Hermes capability and owner/cut model. Add user reset/framing, keyboard and pointer behaviors, and explicit dense-graph truncation affordances.
6. **Hard-cut cleanup + integration gate:** Delete superseded box presentation, graph-only ID inspector path and duplicate filter state once all consumers use final contracts. Remove abandoned schema/aliases and invalidation logic. Regenerate and deploy Web/Desktop bundles from the same React source. No old/new toggle, fallback renderer or permanent compatibility layer. Confirm unchanged Hermes memory-provider, source-ingestion, setup, user data and security functions.

## 7. Testing decisions

**Existing test seams:** `host/src/graph_render_*_tests.rs` (layout, hierarchy, manifest, edge materialization, reuse, source identity); `dashboard/tests/graph-render-client.test.ts` (binary decoding/LOD/selection); `dashboard/tests/knowledge-client.test.ts`; `tests/test_graph_render_api.py` (authorized backend); dashboard Web/Desktop hosted tests. Extend these; do not invent internal-only public APIs just for tests.

**Focused acceptance scenarios:**
- Equivalent graph input → byte-identical deterministic hierarchy/layout/manifest positions (excluding fresh generation identity); same IDs/community membership with altered relation weights → changed proximity and correct node, edge, bounds and chunk invalidation.
- Connected node pair is spatially nearer under stronger link weight versus weaker/no link under controlled fixture; cross-community aggregate weights influence territory arrangement; isolated nodes remain stable and finite. Verify with numeric tolerances and no overlaps, not just appealing screenshots.
- One real community yields one named colored sphere/count; unassigned-only yields clearly marked unassigned bucket; empty graph yields no fabricated groups; mixed/community-bridging edges display correctly.
- Hover title/identifier appears and clears; stale hover/selection resolves are denied after owner/profile/generation change; graph click displays complete Memory detail/provenance; selected edge emphasis and relationship count are correct.
- Search, community and archive filters produce identical eligible Memory sets in Graph and List, with induced relationships and selection invalidation. No cross-owner leaks or unauthorized writes.
- Camera pan, rotate, zoom, click-focus, reset, right-drag threshold and viewport/LOD updates tested in **actual Hermes Web and Desktop**. Pan must not snap back on asynchronous frame completion.
- Verify raw authenticated binary chunk/selection calls, schema mismatch/corruption/staleness rejection and non-reinforcing browsing. Foreign profile cannot access an in-memory generation.
- Benchmarks: 13-Memory real corpus copy, moderate sparse and dense synthetic tiers, 100k/1M and 1M/10M source tiers using Warlock's historical sizes, plus optional 5M/50M stress. Report wall-clock generation/layout, peak Rust memory, JS heap, frame time and selection/hover p95 against current scalable baseline under comparable hardware/build flags. **No fixed claim of preserved million-node performance without measurement**; reject unbounded growth or degradation back toward the original OOM/whole-graph pipeline. Record the accepted ceilings before final gate.

**Completion gates:** Rust format/check/test and frontend typecheck/test/build; both Web and Desktop hosted smoke and real interaction tests; source and built bundle checks; exact-path security reviews; no outdated UI/schema consumers; no regression in currently passing source/manual-import/setup suites. Update architecture and benchmark docs with actual result evidence. Preserve the existing processed `C:\!bin\workspace-data\reliquary-oc09-live-2026-11-08\project.rel` and `user.phy` by testing only independent copies.

## 8. Out of scope

- Rebuilding Hermes, its plugin lifecycle, auth, provider or source ingestion.
- Reinstating the original global TypeScript `GraphData`, force loop, and whole-graph edge processing.
- Replacing the Rust storage/model or changing REL/PHY formats, Memories, semantic graph truth or community calculation.
- Implementing the separately deferred inter-REL dependency DAG.
- Adding Arcana as a Hermes graph source now; keep the renderer's source-agnostic contracts and do not regress Arcana capability in Warlock itself.
- Unrelated changes to Memory mutation policies and project onboarding.

## 9. Source map

- Original: `Warlock-graph-original-review-2026-11-10/src/features/graph/{scene,model}/` and `src/features/workspace/{KnowledgePanel,KnowledgeGraph}.tsx`
- Scalable: `Warlock-graph-scalable-review-2026-11-10/src/features/graph/render/`, `src-tauri/src/graph_render*.rs`, `docs/GRAPH_RENDER_ARCHITECTURE.md`
- Hermes: `host/src/graph_render*.rs`, `dashboard/src/graph/render/*`, `dashboard/src/knowledge/*`, `dashboard/tests/`, `tests/test_graph_render_api.py`

## Related docs

- [Web and Desktop render API contract](ui-contract.md)
- [Verification and acceptance evidence](verification.md)

## Notes

Historical renderer measurements use different datasets and build configurations. Compare candidate and baseline using the same synthetic graph and build profile.
