# Hermes Reliquary UI — Warlock-parity hard-cut rebuild specification

**Date:** 2026-11-10

**Status:** implementation-ready design; no implementation authorized by this document

**Repository:** `C:\!bin\workspace\reliquary-hermes`, baseline `7ccc429e51e37bb731313dc6184f426f527d34ce`

**Reference implementation:** `C:\!bin\workspace\warlock-v2` at `cf41c6690e089cab4a00950d6048ad6828eaeab7` (source commit; two local Cargo manifest/lock edits excluded)
**User intent:** Recreate the **existing Warlock Reliquary Knowledge experience inside Hermes**, not redesign its appearance or rehabilitate the current Hermes dashboard.

## Problem statement

The Hermes plugin has working memory-provider, owner mounting, authenticated dashboard, source import, and setup infrastructure, but its UI was separately authored rather than ported from Warlock. Its current graph is a small SVG oval rather than Warlock's Three.js spatial renderer. `dashboard/src/owner_content.js` hardcodes `node_limit: 4` (or 6 for a selected seed), `edge_limit: 12` and depth 1/2. The `ui.graph_page` response is a bounded Memory neighborhood, not a prepared render generation. The result can be truncated without an actionable continuation, and four isolated nodes give a false impression that a valid processed REL has no graph.

The existing Warlock Knowledge UI instead uses `KnowledgePanel`, `KnowledgeGraph`, `KnowledgeInspector`, `KnowledgeRelationsEditor`, `GraphSelectionInspector`, and a standalone `GraphRenderClient` and Three.js scene. Warlock Rust projects a semantic graph into immutable prepared render generations, hierarchy, layout, multiple edge LODs, binary node/edge chunks, and render-ID resolution. The current Hermes plugin does not import these components or share their render contract.

**Architectural error:** Hermes UI specs mandated Hermes-native controls and reused backend services but failed to require reuse of Warlock's established Knowledge experience. This task is a **hard-cut rebuild** of the UI, with the existing dashboard treated as disposable implementation—not a migration baseline.

## Authoritative source inventory and reuse disposition

Reconfirm these recorded Warlock/Hermes source commits and the clean source-path inventory before copying. Do not incorporate Warlock's unrelated modified Cargo manifest/lock files. Work against the actual files listed here, not screenshots or an invented component API.

| Source in `warlock-v2` | Final target | Decision |
| --- | --- | --- |
| `src/features/workspace/KnowledgePanel.tsx` | Main Knowledge workflow: graph/list switch, navigation, create, select, communities | **Port behavior and component structure**; replace Tauri request calls and Warlock workspace props |
| `KnowledgeGraph.tsx` and `src/features/graph/render/GraphRenderScene.tsx` | Three.js graph display | **Reuse**, including camera, picking, pan/zoom/rotation, labels and selection |
| `src/features/graph/render/{client,clientContract,transport,types,binary,boundsIndex,lod,labels}.ts` | Prepared-generation client and validation | **Reuse** same binary/manifest semantics; no fallback to rich whole-graph objects |
| `src/features/graph/render/{RenderNodeChunk,RenderEdgeChunk,RenderLabels,RenderTerritories,CameraViewport,BoundedPicker,renderColors}.tsx/ts` | Scene presentation | **Reuse** viewport, spatial hierarchy, chunk LOD, picking and appearance |
| `KnowledgeInspector.tsx`, `KnowledgeRelationsEditor.tsx`, `GraphSelectionInspector.tsx`, `knowledgeUi.ts` | Inspector and user mutation experience | **Port** to Hermes-authenticated read/write operations while retaining accepted-cut/revision controls |
| `knowledgeApi.ts` | API shapes and intent reference | **Do not copy Tauri invokes**; create exactly one Hermes Knowledge client |
| `GraphSourceControls.tsx`, `arcanaGraphApi.ts` | Optional Arcana rendering | **Defer**, unless current Hermes has a trusted Arcana source/mount contract; hide unavailable selector rather than simulate it |
| `WorkspaceShell.tsx`, `ScopeControls.tsx`, `MountedScopeActions.tsx` | Navigation/REL-PHY setup reference | **Reuse relevant UX intent**; do not port Warlock's entire workspace, repository, conversation, settings or Tauri lifecycle into Hermes |
| `src-tauri/src/graph_render*.rs` incl. `graph_render.rs`, `graph_render_prepare.rs`, `graph_render_contract.rs`, `graph_render_source.rs`, binary, chunk, layout and identity modules | Host-side prepared graph projection | **Move/port the actual renderer code** to a self-contained host-side rendering module with no Tauri or Warlock workspace dependency |
| `src-tauri/src/workspace_graph_render_adapter.rs` | REL source conversion reference | **Reimplement the thin source adapter** through public Reliquary Root/Instance read interfaces, not internal stores |
| `src-tauri/src/graph_render_commands.rs`, `src/features/graph/render/tauriTransport.ts` | Tauri transport reference | **Replace**, not retain, with Hermes authenticated transport |
| `docs/GRAPH_RENDER_ARCHITECTURE.md` and `GRAPH_RENDER_BASELINE_2026-09-28.md` | Visualization contract and characterization | **Acceptance authority** for renderer invariants, with environment-specific measurements retaken in Hermes |

## Target architecture

```text
Hermes Web SDK / Desktop SDK
    └── host-owned profile, auth, UI theme, native controls, navigation
          └── one shared Warlock-derived React Knowledge experience
                ├── Knowledge/list/inspector/community/mutations
                │      └── authenticated Hermes Knowledge client (JSON, bounded, cut-checked)
                ├── graph scene + GraphRenderClient (binary chunks)
                │      └── authenticated Hermes graph-render transport
                └── Hermes-only Setup and Sources views
                       └── existing setup-v1 and sources-v1 backends

Hermes dashboard adapter (profile-authenticated, no user credentials in browser)
    ├── existing dashboard-v1 read/mutation contract
    ├── existing setup-v1 and sources-v1 routes
    └── new graph-render generation/manifest/chunk/resolve routes
         └── existing Rust loopback host under authenticated profile
               └── reused Warlock-derived Rust GraphRenderService
                     └── PUBLIC Reliquary read-only semantic graph/knowledge source
```

**Ownership:**
- **Reliquary Root** owns semantic Memories, graph, communities, lifecycle, history, provenance, authorization, and durable writes.
- **Graph render module (inside this plugin's Rust host or a single deliberate renderer crate)** owns disposable projection, render generations, spatial layout, chunks, hierarchy, LOD, generation-local IDs and binary encoding. It must not open REL/PHY lower stores or own semantic truth.
- **Shared React Knowledge UI** owns interaction, camera, bounded chunk residency, picking, layout of panels, visual selection, and view state. It does not construct all semantic nodes/edges as a rich frontend graph.
- **Hermes adapters** own authenticated profile isolation, entrypoint registration, Web/Desktop controls, OS dialogs, fetch/transport, and mutation permissions.
- **Existing Hermes plugin backend** keeps source lifecycle, import, setup, account configuration, session routing and memory provider behavior. Do not move or rewrite it as part of UI cutover.

### Canonical frontend seams

A single shared, typed React application built once for Web and Desktop, with **one host-boundary interface** providing:
1. authenticated Knowledge read/write operations (capabilities, owner/session selection, search, page, detail/history/provenance, create/edit/retire, relation edits, community edits);
2. graph-render transport implementing Warlock's `GraphRenderTransport`: `prepare(ownerId)`, `nodeChunk(generationId, chunkId)`, `edgeChunk(generationId, chunkId)`, `resolveNode(generationId, renderId)`;
3. host-native controls/dialogs/identity, authorized owner topology and lifecycle invalidation; and
4. existing Setup/Sources operations.

The graph transport is a **real deployment seam**; the Warlock Tauri adapter and the Hermes HTTP/Desktop adapters are concrete implementations. Do not add a generic client facade for every individual component. One data service and one rendering transport suffice.

For browser and Desktop, make only host-specific adapter edges. Do **not** fork the Knowledge UI or implement two renderers. Use Hermes theme tokens/native controls for ordinary input, buttons, tabs, selects and dialogs, while preserving Warlock's graph-specific visual behavior and scene presentation. Warlock's styling and panel structure are the reference; map host theme variables at one boundary rather than wholesale visual redesign.

### Canonical backend data and wire contracts

Preserve the public **Warlock Graph Render Generation** semantics:
- immutable manifest with schema version, generation ID, owner ID, source community generation, total node count, hierarchy and global bounds, node/edge chunk descriptors;
- bounded binary node/edge chunks, version/magic/length checks, local render IDs, spatial layout, LOD and generation-bound picks;
- resolution from render ID to the authorized Memory ID, never untrusted client-supplied semantic identity;
- generation invalidation on REL change, owner remount, profile change and stale cut; preserve existing authorization checks per read;
- finite, bounded generation-cache lifetime per profile/owner (eviction on change/disconnect; no unbounded resident generations).

The current `ui.graph_page` **must not** become the final renderer transport or a 500-node ceiling. Its limit is for a bounded management neighborhood. The normal graph scene needs the complete render generation **through chunks**, not giant JSON arrays or repeated small pages.

**Important feasibility gate before implementing the browser adapter:** determine and verify how the Hermes authenticated Web and Desktop routes can return raw `application/octet-stream` chunk bytes, with matched profile/owner/generation authority. `ctx.rest` currently assumes JSON. Use the supported authenticated route/stream mechanism, or introduce the narrow authorized backend route needed; do not expose an unprotected loopback URL, embed credentials in URLs, or transfer multi-million-node payloads as enormous base64 JSON. If Desktop cannot consume the Web byte route, provide a real Desktop binary bridge at the same `GraphRenderTransport` seam, not a second rendering system. Do not claim scale parity until actual chunk transport is validated in both hosts.

Warlock's old `WorkspaceService::prepare_graph_render` uses `read_knowledge_for_owner` to acquire semantic Memories/relations/communities. The rebuilt Root's public management `MemoryGraphQuery` is **bounded** (`MAX_NODES=500`, `MAX_EDGES=1000`, `depth<=3`), includes only Memory-to-Memory edges and is **not** the same whole-graph source contract. Before porting projection, verify an appropriate public, read-only snapshot/iterator or implement the **smallest justified** Root interface for exact-cut semantic graph projection. No lower-store backdoor, no temporary aggregation of unbounded JSON DTOs, no silent edge omission, and no semantic/write authority migration to Hermes. That public interface is a genuine cross-repository dependency, not a UI-layer workaround.

Mutations remain on existing `dashboard-v1` write paths, with revision/cut, owner, user identity, idempotency, and capability checks. Port Warlock UI behavior without blindly copying its Tauri write payloads; use the already authorized Hermes mutation contract. If Warlock exposes a mutation not supported by current Root/Hermes (e.g. arbitrary relation-kind replacement versus only `user_association`), record a specific accepted-equivalent mapping or a real blocked feature; do not fake enabled controls or expand write authority casually.

### Product surface, Warlock parity and Hermes-specific sections

Default mounted-REL Knowledge view: a **full-page, resizable graph** with the Warlock camera/picking/label/territory experience; List tab with search, lifecycle and community navigation; inspector integrated with graph/list selection and revision/history/provenance; create, edit/replacement, retirement and explicitly authorized relation/community workflows. Switch between REL and PHY using Hermes' current profile-authorized owner set. Read-only and limited capabilities must be visible with accurate explanations, not deceptive disabled elements.

Use Warlock's scope rail/overview as the reference for REL/PHY owner navigation and metadata. Do not recreate Warlock's chats, Files panel, project repository bootstrap, Arcana integration, switchboard or app settings inside Hermes: Hermes already owns its host surfaces and projects; an unavailable feature must not be represented as working. The previously approved REL dependency DAG is not implemented in rebuilt Root; its management UI must not pretend to be functional or treat the Hermes project mapping as the DAG.

Keep **Hermes-only Setup and Sources** as first-class navigable sections, using existing backend operations and the same cohesive visual language. Retain manual existing-session import, profile-enrollment/capture indicators, owner selection/creation and safe native/open dialogs. Those do not exist as drop-in Warlock features; reconstruct their **presentation** within the new application but do not reimplement their backend.

## Implementation decisions

1. **Canonical source.** Freeze Warlock renderer + Knowledge UI source revision, dependency versions and existing visual/function acceptance captures. Preserve source provenance for maintainability. Do not modify the two reference Warlock worktree Cargo files already locally changed.
2. **One application codebase.** Replace the hand-concatenated `dashboard/src/*.js` presentation system with a TypeScript/React build that bundles for Web and Desktop from a common source. Host-specific entrypoints only. Do not pull in Warlock's complete Tauri app.
3. **Actual renderer reuse.** Extract/port original Warlock render algorithms and TS client at their final owner once. Maintain manifest v2 and binary encoding unless a concrete Hermes boundary forces a versioned protocol change. Reuse tests and benchmark fixtures; no duplicated SVG graph.
4. **One bounded UI client.** Express owner/cut authorization, mutation confirmation, stale cursor, selected Memory and provenance in the shared Knowledge client. Page list/inspector data independently; do not load all Memory bodies in graph mode.
5. **No behavioral type/scope coupling.** Existing REL/PHY owner roles follow configured mounts and grants. Legacy `OwnerScope` metadata must not filter graph display. The temporary General-REL compatibility hack stays in the *backend*, pending the separately roadmapped root correction.
6. **Current backend separation.** Do not rewrite Rust provider/service, source import, onboarding setup orchestration, or session routing. Add only specifically required graph projection/transport endpoints and cut-safe data access.
7. **Preserve security and state.** Profile switching cancels in-flight reads, clears selections/render generations, and avoids stale cross-owner results. No raw Hermes history DB access, no credentials/client authority escalation, no mutation on graph read or hover. Keep source tombstones and historical-import contracts.
8. **No silent capability inflation.** Graph source selection defaults to Reliquary only; Arcana remains deliberately absent until an actual authorized Hermetic source adapter exists. Do not show Warlock-only workflow controls that cannot function in Hermes.
9. **No source-data mutations for visual tests.** Test with copies of `C:\!bin\workspace-data\reliquary-oc09-live-2026-11-08\project.rel` and `user.phy`; reference processed REL verifies 13 Memories and graph version 10, PHY verifies 4 Memories. A live test may use an isolated owner copy, but never run UI mutations against the reference data.

## Hard-cut execution strategy (no intermediate legacy frontend)

**Migration window:** declare the UI subtree red while rebuilding. Existing Hermes dashboard components may stop compiling or rendering during the cut; the provider/service/Sources backend and owner files remain intact. Targeted module tests are appropriate until the integration gates below. Do not preserve the old UI using a dual dashboard switch, wrappers or a temporary fallback.

1. **Freeze/recon:** Record Warlock reference commit, UI parity inventory and interaction screenshots, current Hermes plugin revision, API gap matrix and existing host/security tests. Resolve the binary Web/Desktop transport feasibility and needed public Root read seam *before* committing to render service wiring. Concrete output: signed-off source→target matrix and wire contract.
2. **Renderer target:** Port the Rust graph render projection and the TS `GraphRenderClient` + Three.js scene directly to their final modules. Implement an actual public Root read-only graph source if needed and the profile-authenticated binary transport. Verify full render generation and selection without the old SVG or `ui.graph_page`.
3. **Warlock Knowledge target:** Port KnowledgePanel, KnowledgeGraph, List, Inspector, relation/community interactions and graph-selection navigation. Adapt only genuine host-bound Tauri differences at the one Hermes Knowledge-client boundary, retaining grants, cut/revision semantics, source provenance and safe mutations.
4. **Hermes host integration:** Mount the single shared React application from Web SDK and Desktop SDK; use Hermes-native controls and themes. Integrate existing Setup/Sources behaviors and REL/PHY switching into the Warlock-derived experience. No old `createReliquarySurface` runtime, shared-JS modules or duplicate skin.
5. **Hard cut + deletion:** Delete the old dashboard presentation tree, old SVG graph, fixture-only graph implementation, legacy shared UI packager and redundant desktop presentation wrappers. Replace only required entrypoint, build, test and manifest files with final equivalents. The backend `dashboard/plugin_api.py` and authorized `dashboard-v1`, `setup-v1`, `sources-v1` routes stay if still consumed. Old `ui.graph_page` backend may remain a genuine external bounded inspection API **only if there is a named non-renderer consumer**; otherwise remove its no-longer-used UI contract and tests. Do not delete source-ingest, auth or setup tests because they were co-located with the old frontend.
6. **Integration gate:** Run all relevant Rust, JS/TS, browser, Desktop, documentation, security and real-corpus tests; inspect the final source for surviving legacy UI consumers and generated assets; verify the installed plugin uses the new bundles only. No separate old screen remains accessible.

### Expected deletion inventory

Delete/replace rather than port forward:
- `dashboard/src/{graph.js,owner_content.js,views.js,graph_mutations.js,memory_mutations.js,state.js,surface.js,index.js,fixtures.js,client.js,live.js,live_transport.js,web_components.js,onboarding.js,sources.js,setup_client.js}` **as presentation implementation** (copy required domain behavior into new components; preserve backend behavior).
- `dashboard/scripts/{build.cjs,live-bundle.cjs}` legacy concatenation, `dashboard/styles.css` old visual layer, fixture graph/data mocks and old presentation-specific tests.
- `desktop/src/plugin.js` shared-surface coupling and `desktop/scripts/build.cjs` old concatenation pipeline; keep a minimal Hermes registration/fetch/native-dialog adapter in the new build.
- Generated `dashboard/dist/*` and `desktop/plugin.js` replaced at final cut. Adjust documented installation packaging.

Avoid wholesale deletion of `dashboard/plugin_api.py`, existing setup/source services, root `host/src/dashboard*.rs` unrelated to obsolete rendering, `host/src/registry.rs`, provider integrations, or authority fixtures. Such code is backend capability, not failed UI composition. Make each deletion conditional on **actual final consumers**, not file-name similarity.

### Completion integration gates (all required)

**Function and parity**
- Warlock Knowledge list, search, filter, selected Memory, edit/replacement, lifecycle/history, provenance, community, relation and graph-selection interactions are demonstrably available in Hermes Web and Desktop with matching semantics. Any host-only exception is specifically documented and justified by an actual SDK limitation; no silent stub or misleading UI.
- Graph is the **Warlock-style Three.js visualizer**, including 3D camera, pan, zoom, rotate, picking, labels, territories, chunk LOD and stable render-ID selection. No concentric/oval SVG replacement.
- On the **processed November 8 corpus copy**, all **13 REL Memories** are represented by the render-generation's node count (subject to exact current read visibility), and its accepted Memory/Memory relations are represented as edges; compare independently to exact Root graph cut instead of assuming `graph_version=10` equals ten edges. The four-node limit and orphaned “result limited” state are gone.
- Graph and list include PHY where authorized; correct owner identity displayed; switching owners cancels stale requests, prevents stale details and refreshes source generation.
- Hermes-only Setup/Select/Create and Sources/manual import remain functional for Web/Desktop per the existing trust gates; fresh enrollment/copy, tombstone/foreign-profile denial and restart tests continue to pass.

**Transport, performance, security**
- Manifest/chunk schema and binary data decode byte-for-byte between Rust host and TS client, with wrong generation/owner/chunk, corrupt/truncated data, profile confusion and forged selection rejected.
- Requests use only authorized profile-scoped Hermes plugin paths; no client tokens, guessed-owner or direct loopback unauthenticated reads; no new lower-store APIs exported.
- Validate basic graph performance at 13-node real-corpus scale, medium synthetic scale and a large synthetic characterization tier. Preserve bounded request/chunk memory behavior and no O(N) whole-graph frontend representation. Compare performance to Warlock's documented architecture and explicitly report differences; do not assert desktop million-node parity solely from a small screenshot.
- Ensure typed build and package works in Hermes-hosted browser and Desktop, not merely standalone Vite; no Tauri imports in production Hermes bundles.

**Hard-cut cleanup**
- All existing service/provider/host tests, focused renderer parity tests, new UI tests, browser-host and Desktop smoke checks, JS/TS typecheck, Rust format/check/tests, generation/build and docs checker pass or have an explicitly identified unrelated blocker. Verify output bundles and install signatures.
- Grep/structural audit proves no surviving `GraphView` SVG old path, `node_limit:4` default, `createReliquarySurface` UI runtime or legacy build/load references.
- Final repository has one Knowledge interface, one render pipeline and two thin host adapters. No feature-flagged old/new UI, compatibility alias, old fixture app or duplicate CSS system.
- The existing owner setup, service, selected-return and source-ingestion contracts remain stable; no REL/PHY file format or profile routing migration is bundled into this work.

## Test ownership and expected evidence

- Renderer algorithms/format: port Warlock `graph_render_*_tests.rs` and `scripts/graph-render-client/check.ts`, verify source-ID matching, generation/cut, binary chunk round trips, hierarchy, viewport budgets, node picking and reuse.
- Hermes Rust integration: extend `host/tests/setup_validation.rs`, dashboard graph source/transport and host-owner security tests at public API boundary, not private storage.
- Shared React: component tests for navigation, mutations, inspector, profile/cut change, generation invalidation, empty graph, empty communities, create/edit/history, error/retry and user privacy.
- Web/Desktop: real SDK smoke tests for native controls, page sizing, authenticated binary transport, setup dialogs and profile switching, not just mocked fixtures.
- Real end-to-end: isolated copy of November 8 REL/PHY, independent Root verify and graph edge count, live Web and Desktop render, click through a real Memory and see provenance, verify no semantic writes on pure browsing.
- Release: old UI deletion inventory with direct source-search plus Git diff, build manifest and deployed artifact hash reconciliation.

## Out of scope

- Implementing the inter-REL dependency DAG or removing legacy `OwnerScope` persistence (tracked in `C:\!bin\workspace\Reliquary\docs\rel-homogeneity-and-dependency-roadmap-2026-11-10.md`).
- D01–D03 authentic 2.0→2.1 corpus conversion and full corpus reprocessing.
- Reworking Hermes itself, rewriting Reliquary core semantic algorithms, or recreating Warlock Files/Conversations/Model Settings/Project repository management in Hermes.
- Adding Arcana graph source without an authorized source integration and explicit product scope.
- Extending the current SVG dashboard, tweaking its node limit as the final solution, or maintaining a compatibility UI.

## References

- Warlock: `docs/GRAPH_RENDER_ARCHITECTURE.md`; `docs/GRAPH_RENDER_BASELINE_2026-09-28.md`; `src/features/workspace/KnowledgePanel.tsx`; `src/features/graph/render/*`; `src-tauri/src/graph_render*.rs`; `src-tauri/src/workspace_graph_render.rs`; `src-tauri/src/workspace_graph_render_adapter.rs`.
- Hermes: `dashboard/src/owner_content.js`; `dashboard/src/graph.js`; `host/src/dashboard_graph.rs`; `dashboard/scripts/live-bundle.cjs`; `desktop/src/plugin.js`; `docs/ui-contract.md`, `docs/hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md`, `docs/hu07-hermes-native-presentation-spec-2026-11-09.md`, `docs/roadmap.md`.
- Real evidence: `C:\!bin\workspace-data\reliquary-oc09-live-2026-11-08\fresh-process-reopen.json`; `postprocess-resume-2.stdout.log`.
