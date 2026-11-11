# Hard cut: original Warlock React graph components on the scalable Hermes renderer

**Date:** 2026-11-10

**Status:** approved target specification; implementation not performed by this document.

**Repository:** `C:\!bin\workspace\reliquary-hermes`

**Visual/interaction source:** `C:\!bin\workspace\Warlock-graph-original-review-2026-11-10`, commit `d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b` (last live rich GraphScene before the scalable cutover). Original source files: `src/features/graph/scene/{GraphScene,NodeCloud,EdgeLines,NodeLabels,Territories}.tsx`, `src/features/graph/model/{types,visuals}.ts`.

**Scaling source:** the *existing* Hermes `host/src/graph_render*.rs` and `dashboard/src/graph/render/{client,clientContract,binary,boundsIndex,lod,types}.ts`, descended from Warlock's newer renderer. Preserve their verified binary/generation and performance properties.

**Previous evidence:** `docs/warlock-graph-original-vs-scalable-audit-2026-11-10.md` and `docs/warlock-rich-scalable-graph-spec-2026-11-10.md`.

## Problem statement

The latest graph rebuild restored much of the original Warlock graph's behavior but **re-authored** its visual components rather than reusing the already-designed React scene. The current `RenderTerritories.tsx` is not the original `Territories.tsx`: it introduces a solid shell, a stronger wireframe, gray/neutral treatment for unassigned Memories, and a dark rounded label card. The screenshot shows an enormous gray mesh enclosing dark brown nodes with disproportionately small names. Similar divergences exist in node material/color, scene composition, camera framing, label dimensions and selected-node contrast.

Feature tests and a successful million-node benchmark do **not** prove visual parity. The required target is **the appearance and interaction behavior of the original Warlock components, with the modern scalable data feed**. Do not approximate the original with another hand-styled replacement.

## Target architecture

```text
Reliquary authorized graph source
    ↓ existing Rust weighted hierarchical layout and render generation
Immutable manifest + spatial hierarchy + binary chunks + bounded inspection
    ↓ existing GraphRenderClient / viewport chunk residency and selection
Small renderer-native view data (typed arrays / bounded labels / bounded metadata)
    ↓ directly ported original Warlock React/Three.js visual components
GraphScene + NodeCloud + EdgeLines + NodeLabels + Territories
    ↓ one Hermes Web/Desktop React scene; existing host/auth transport unchanged
```

**Ownership:** Rust remains the sole owner of layout, semantic→render projection, render IDs, chunk materialization, edge LOD and selection bounds. The existing TypeScript graph client owns chunk requests, residency, decode, viewport budgets and metadata cache. The **original React components own the visual scene, materials, lighting, sprites, emphasis, pointer interaction and camera framing**. Hermes only supplies authenticated transport and the surrounding host surface.

### Exact component disposition

| Original Warlock source | Hermes final owner | Required action |
| --- | --- | --- |
| `GraphScene.tsx` | `dashboard/src/graph/render/GraphRenderScene.tsx` or a canonical `GraphScene.tsx` | **Copy actual component implementation as the base**, then adapt only props, bounded viewport callbacks, pick/selection and camera-target inputs. Restore original ambient + two point lights, bloom configuration, composition order and controls. |
| `NodeCloud.tsx` | `dashboard/src/graph/render/RenderNodeChunk.tsx` | **Copy original sphere/point material and presentation logic.** Retain chunk-based instancing/points and bounded picking; no original all-node arrays. Keep original gradient sprite, sphere geometry fidelity, node size/color/glow behavior and selection emphasis. |
| `EdgeLines.tsx` | `dashboard/src/graph/render/RenderEdgeChunk.tsx` + existing selected-edge overlay | **Copy original edge material and intensity logic**; feed bounded chunks and selection overlay, retain per-relation coloring and incident-edge emphasis. Do not reconstruct all edges in React. |
| `NodeLabels.tsx` | `dashboard/src/graph/render/RenderLabels.tsx` | **Copy original canvas texture, font, sizing, placement, outline, color and selection-label behavior.** Retain current bounded label candidate selection/LOD. |
| `Territories.tsx` | `dashboard/src/graph/render/RenderTerritories.tsx` | **Copy the original translucent wireframe sphere and label-sprite implementation**. Use original `sphereGeometry` (28,18), wireframe opacity `0.075`, and original typography/placement. Remove the extra filled shell, heavy neutral mesh, and rounded-card label. Feed authenticated manifest territory data instead of `GraphTerritory[]`. |
| `src/features/graph/model/visuals.ts` | relevant `renderColors.ts` / original component colors | **Use original color/gamma/brightness rules** for small-graph node and edge display; adapt to packed RGB without a second theme. |
| `src/features/graph/model/clusteredLayout.ts`, `forceLayout.ts` | **not** frontend | **Do not port** these whole-graph JavaScript solvers; the accepted bounded Rust layout already owns relationship-sensitive spatial positioning. |

**Do not install both old and new visual stacks.** The original component sources are the implementation base; make the smallest shape/transport adaptations required by chunks. The new hand-authored rendering variants are deleted once the canonical components work.

## Critical data-shape decisions

The original components accept `GraphData` with rich `GraphNode[]`, `GraphEdge[]`, and `GraphTerritory[]`, whereas Hermes holds bounded `GraphRenderFrame`, typed position/color/size/render-ID buffers, and hierarchy descriptors.

- Supply typed-array chunk views directly to the original materials/geometry. Loop only over the bounded active chunk, never over an owner-wide rich `GraphNode[]`.
- Retain existing `GraphRenderClient.loadViewport`, edge-LOD selection, bounded picking and generation-bound ID resolution. Renderer components must not implement their own network transport, owner lookup or graph layout.
- Derive one small *visual territory view* from existing manifest `territory` fields (center, radius, name, member count, color, real-vs-unassigned kind). This is presentation mapping only, **not** a new storage or semantic contract.
- Use original node color/size logic from copied `NodeCloud` and `visuals.ts` where representable with current packed data. If original degree-dependent glow or group color requires a field not currently encoded, define the minimal generation-time scalar/color derivation in Rust, retaining chunk format and avoiding all-node JSON. Document and test every genuinely necessary contract change.
- Keep the source's `Unassigned` distinction truthful. For the *presentation*, apply original sphere/label treatment with subdued emphasis; don't fabricate a named community. The unassigned territory must not become a giant foreground cage.
- Preserve generation/cut/owner filtering; no direct Tauri imports, browser global graph cache, or synthetic unrelated community metadata.

## Visual parity contract (not subjective imitation)

The original React source defines defaults unless host/device constraints force a documented deviation.

1. **Scene:** same background (`#06090f`), original light setup and bloom appearance. Do not introduce overlays, fog or filled shells not present in the original.
2. **Territories:** original one-layer wireframe material, `0.075` opacity, original color treatment and `TerritoryLabel` sprite with text `NAME · count`. No opaque background card. Radius/mesh positions still come from the new bounded Rust layout.
3. **Nodes:** preserve the source's sphere-versus-points policy for small/large graphs where practical; retain instancing and GPU chunks. Actual source-derived node palette, perceptible glow and size hierarchy must remain legible. A selected node must not make all unselected nodes effectively black/brown.
4. **Edges:** original additive visual weight, cross-/intra-community attenuation and selected-neighborhood behavior, without global edge array construction. Selected connections stand out more than unrelated links.
5. **Labels:** original font weight, outline, color, scale relative to node and camera, plus bounded candidate/LOD policy. A tiny Memory label underneath a giant `Unassigned` heading is a parity failure.
6. **Camera:** graph framing primarily fits nodes and useful community structure, not an inflated label bounding sphere. Original rotate/zoom/right-pan and selected-node focus; moving a camera must not trigger recentering when a chunk finishes.
7. **Interaction:** original hover tooltip content, click selection, highlighted relationships, list/inspector coordination and keyboard equivalents retained from current working Hermes code.
8. **Host:** graph uses the same final React implementation in Hermes Web and Desktop. The surrounding Hermes-native host controls do not change the graph's internal design.

**Known screenshot failure to regress-test:** a single `Unassigned · 11 memories` group containing muted red/brown nodes and an enormous dense gray sphere, with its label dominating the canvas. The replacement must visibly resemble the original Warlock rendering of the *same positions and members*, without pretending this group is semantic.

## Hard-cut implementation strategy

The UI visual component subtree may temporarily be red during the change. Existing Rust generation and the backend/provider remain functional. No compatibility wrapper or old/new visualization toggle is warranted.

1. **Freeze the two sources:** record original commit, the current dirty Hermes state and visual source hashes. Do not reset/commit/delete the agent's currently uncommitted graph implementation. Work in a dedicated branch/worktree if concurrent agent work remains active.
2. **Mechanical component port:** copy the original five scene components and visual helpers into their *final Hermes home*. Preserve JSX structure, materials, lights, shaders/texture creation, tooltip and sprite handling. Make minimal naming/prop changes; mark any deviation inline with its concrete chunk/host reason. Do not first restyle current renderer manually.
3. **Typed-chunk adaptation:** wire source components to existing `GraphRenderFrame`, packed node buffers, chunk edge data and bounded selection results. Keep a single canonical `GraphRenderScene` and reuse existing React/Three tooling. Delete replaced hand-written visual implementations as part of the move.
4. **Selection + framing:** preserve working Hermes generation-bound hover, active-neighborhood, selected-memory synchronization and pan stabilization while restoring the original's visual priority, focus behavior, scene lighting and camera framing.
5. **Parity verification:** render identical small/cross-community/unassigned datasets in historical original and new Hermes graph (or, if running the historical Tauri app is blocked, use an isolated original React scene harness with its original source and a fixed small fixture). Capture reproducible screenshots at equal canvas size, camera angle and selection state. Review side-by-side, explain and correct every meaningful visual difference. Do not call component unit tests or successful hosted smoke tests sufficient.
6. **Final cut:** remove no-longer-used visual CSS, custom `makeTerritoryLabel` card, extra sphere shell, duplicate shader/material helpers, and old UI render branches. Regenerate Web and Desktop bundles from the canonical source and update visual evidence/docs.

**Red-window verification:** typecheck and test coherent component slices; validate binary client invariants throughout; do not add temporary old-shape adapters just to maintain a green global suite. **Integration gate:** whole dashboard typecheck/test/build, Rust host tests, Web/Desktop hosted interaction checks and visual screenshot parity, plus clean source-consumer audit.

## Testing decisions

- **Component source audit:** automated source-to-port comparison with an allowlist of transformations for typed chunk IO/selection/host props. Differences to source materials, scene lights, node labels, colors, opacity, geometry and tooltip must be justified and reviewed.
- **Visual fixtures:** single real community, single unassigned bucket, two linked communities, isolated Memories, dense selected neighborhood, dark theme, small viewport and large viewport. Fix camera and dataset across original and Hermes; include selected/hovered/unselected states. Test native GPU browser where available, not exclusively SwiftShader.
- **Functional tests:** rotate, right-pan (no snapback), zoom, pick, tooltip, camera focus, selected-edge fading/highlight, List ↔ Graph selection and full inspector, filter scope, stale-generation/profile denial.
- **Scale gates:** 13-Memory processed REL (copy of source corpus), medium graph, synthetic 100k and 1M-node/10M-edge tests. Retain prepared-generation and chunk-residency budgets, binary validation and bounded browser heap. Avoid returning to original global JS force / owner-wide graph object memory use. Report fresh benchmark comparisons using consistent hardware and run conditions; a software-renderer p95 discrepancy alone does not negate correct visual parity.
- **Build/deployment:** confirm the exact built bundle hashes match the installed Web/Desktop artifacts if deployment is part of the implementation task. No installation or service restarts are authorized by merely writing this spec.

## Out of scope

- Reimplementing graph layout or semantic clustering, rewriting graph storage, changing REL/PHY persistence or rebuilding the Rust provider.
- Rebuilding the surrounding Hermes setup/Sources/UI shell; that is a separate Warlock-shell parity concern.
- Enabling Arcana as a Hermes graph source without an authorized integration.
- New styling/theme inventions and duplicate visual component libraries.
- Backward compatibility with the discarded visual components.

## Completion gates

- The **original** five Warlock React visual components are the source of truth in the final Hermes graph implementation, with only documented bounded-data integration changes.
- New custom lookalike scene/material/territory/label components are gone.
- Visual parity is demonstrated with reproducible before/after captures, not inferred from test success.
- Existing weighted Rust layout, edge LOD, binary chunks, generation reuse and authenticated Web/Desktop access remain intact.
- Existing graph and Knowledge interactions pass, including panning/selection and owner changes.
- No full `GraphData` bridge, whole-graph JS force loop, duplicate renderer, Tauri dependency or transient compatibility layer remains.
- Final source and generated bundles have one canonical renderer; all renderer/host regression tests and final integration checks pass.

## References

- Original React sources: `Warlock-graph-original-review-2026-11-10/src/features/graph/scene/*`.
- Original visual helpers: `Warlock-graph-original-review-2026-11-10/src/features/graph/model/visuals.ts`.
- Hermes current implementation: `dashboard/src/graph/render/*`, `host/src/graph_render*.rs`.
- Prior audit/spec: `docs/warlock-graph-original-vs-scalable-audit-2026-11-10.md` and `docs/warlock-rich-scalable-graph-spec-2026-11-10.md`.
