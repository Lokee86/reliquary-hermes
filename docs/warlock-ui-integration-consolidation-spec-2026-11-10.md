# Warlock UI — consolidated integration and installation specification

**Date:** 2026-11-10
**Status:** Executed. Accepted source is deployed and post-install verified; scoped cleanup is complete. See [consolidated acceptance and deployment receipt](verification.md#consolidated-warlock-ui-acceptance--november-10-2026).
**Repository:** `C:\!bin\workspace\reliquary-hermes`.
## Purpose

**Goal:** One tested, committed, source-derived Warlock Knowledge interface in `main`, with original graph appearance, bounded Rust renderer, non-graph Knowledge shell, Inspector, Setup and Sources; the same verified build installed in Hermes Web and Desktop.

## Overview

This is an **execution/integration plan**, not a new UI design. The product and implementation specifications remain [full UI hard cut](warlock-ui-hard-cut-rebuild-spec-2026-11-10.md) and [original React graph component port](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md), with the [rich/scalable graph requirements](warlock-rich-scalable-graph-spec-2026-11-10.md). Where historical source references differ, the original React checkout at `d9e38cb9` controls appearance and the bounded Rust implementation controls data scaling.

## Verified baseline and change provenance

Inspection of the local repository showed `main` at `9aad117` (canonical UI documentation), plus a **dirty working tree with ~67 modified/deleted/untracked paths**. This worktree contains graph, app, Knowledge, Setup, Sources, host, build artifacts, test and documentation changes; **it is neither disposable nor equivalent to a clean release branch**.

| Integration input | Verified tip | Role / disposition |
| --- | --- | --- |
| `warlock/original-react-graph` | `05d8749` (implementation `5650802`) | Original React graph port, bounded renderer, hosted verification; **primary graph integration source** |
| `warlock-ui/nongraph-direct-port` | `4bf34e4` | Port of original Knowledge layout, navigation, inspector/relations, scope, Setup/Sources presentation, parity ledger; **primary non-graph source** |
| `warlock-ui/nongraph-details` | `fe32dc6` | Inspector/relations substream already represented in non-graph direct port; **do not independently merge** |
| `warlock-ui/nongraph-host` | `190f86b` | Setup/Sources substream already represented in non-graph direct port; **do not independently merge** |
| Dirty `main` | `9aad117` plus local changes | Preserve and reconcile all unique verified graph, host, shell, tests, documentation, and non-graph edits; **never reset, clean, or overwrite wholesale** |
| Older `warlock-ui/integration` and `warlock-ui/knowledge` | `3642a3a`, `033e358` | Historical inputs; audit for unique not-yet-integrated changes only, no automatic re-merge |

**Observed overlap:** both primary branches touch `dashboard/src/knowledge/KnowledgePanel.tsx`, `dashboard/src/knowledge/knowledge.css`, `dashboard/src/host.ts`/related graph boundary, and built Web/Desktop output. Dirty `main` also overlaps both. A naive merge or copying one branch over another can silently discard graph/List selection, CSS, or Hermes authorization. **Prefer one deliberate integration worktree** built from a recorded snapshot and side-by-side source reconciliation. Do not mutate the original dirty checkout to stage the work.

## Historical installation finding (pre-consolidation)

At the pre-integration audit, the installed Web JS, Web CSS and Desktop module matched `C:\!bin\workspace\reliquary-hermes-original-react-graph`, not dirty `main` or the non-graph direct-port worktree. This recorded the graph-only deployment baseline at that time; it is superseded by the final installed-release receipt in [verification](verification.md#consolidated-warlock-ui-acceptance--november-10-2026).

## Integration ownership and conflict rules

- **Graph source of truth:** `warlock/original-react-graph` for `dashboard/src/graph/render/*`, graph-specific renderer visual content, host graph projection/transport, retained binary chunk/LOD contract and graph tests. Preserve original source-first component styling, camera/interaction and the Rust scalable projection.
- **Non-graph source of truth:** `warlock-ui/nongraph-direct-port` for app shell, Knowledge navigation, Inspector and RelationsEditor, original non-graph CSS, Setup and Sources. It must integrate the graph through the existing `KnowledgeGraph` public boundary, not replace the renderer.
- **Shared integration ownership:** `KnowledgePanel.tsx`, `KnowledgeGraph.tsx`, `knowledge.css`, `app.tsx`, `host.ts`, selected Memory / owner / cut / filter state, `desktop/plugin.js` and output bundles. Reconcile these **semantically**, keeping graph↔List↔Inspector selection and filtering, no duplicate sidebars or view modes, and full authorization. Tests validate behavior, not one branch's file timestamp.
- **Dirty-main preservation:** inventory the exact dirty diff **including untracked files** and compare each against the graph and non-graph branch versions. Record which changes are duplicates, improvements or unique. Preserve unique changes in the integrated result or document an evidenced reason for exclusion. Do not `git reset --hard`, `git clean`, blanket `git checkout`, or use a stash as the only durable copy.
- **Rust/Root dependency:** the graph work includes `host/src/graph_render_root_projection.rs` and `patches/reliquary-fa574eec-filtered-graph-projection.patch`. Confirm whether the required public exact-cut Root graph projection exists in the current sibling `Reliquary` checkout. Reconcile by explicit API contract and tests; do not silently depend on an uncommitted foreign-repository patch or mutate user data. Record a clear blocker if upstream Root is incompatible.
- **Generated artifacts:** `dashboard/dist/index.{js,css}` and `desktop/plugin.js` are **outputs** of one canonical build, never merge authorities. Rebuild them after the source cut; stage output only per the repository's existing packaging policy.
- **No Tauri dependency** in Hermes production modules; original Warlock presentation remains React/Three.js on top of Hermes authenticated hosts.
- Do not introduce compatibility wrappers, old/new UI flags, second renderers or lookalike fallback components.

## Executable consolidation sequence

1. **Freeze/check input identity without backing up installed components.** Record exact Git tips, worktree statuses, all dirty/untracked paths and hashes, installed asset hashes, current Root contract revision and active provider/owner configuration. Git already preserves committed versions. For unique dirty work, make a *Git commit in a separately owned integration branch/worktree* after staged review; no extra copies of installed binaries and no rewriting of original dirty `main`.
2. **Create one clean integration worktree** from `main` at `9aad117`, with a dedicated integration branch. Keep dirty `main` and all source worktrees untouched until reconciliation is complete.
3. **Integrate the primary graph branch** as code history when ancestry permits; otherwise import explicitly verified changes with provenance. Resolve host/Root patch requirements and generated output separately. Do not use `-X ours`/`-X theirs` wholesale.
4. **Integrate the primary non-graph branch** with source-aware conflict resolution. Do **not** separately replay `nongraph-details` or `nongraph-host` without evidence of missing commits/features. The final three-panel Knowledge shell must contain original 230px navigation, flexible Graph/List center and 300–420px inspector, original CSS, REL/PHY scope switch, Setup and Sources UI. Graph is the original Warlock-derived React port rather than a styled substitute.
5. **Reconcile dirty-main changes selectively** against the integrated candidate. Use a tracked file-by-file matrix for graph, Knowledge/shared state, host, tests, docs and generated assets: source branch(s), selected implementation and reason. Resolve overlapping `KnowledgePanel`, `knowledge.css`, `host.ts` and Desktop entrypoint by testing the combined behavior. Do not discard unique changes merely because a newer branch exists.
6. **Delete superseded presentation** (duplicate owner rail/header, old lookalike graph, dead CSS, redundant UI layers) after a consumer search. Retain authenticated APIs, imports, setup, provider, graph transport and valid Hermes-only operations. No unresolved conflict markers or parallel UI stacks.
7. **Verify complete acceptance** on the integrated worktree, then commit the reconciled source, tests, documentation and generated artifacts as coherent commits. Do not commit a known failing integration.
8. **Fast-forward or safely merge** the accepted integration branch into `main` only after assessing the live dirty worktree; never overwrite uncommitted state. If blocked by an active dirty `main`, stop at a fully verified integration branch and state precisely which local edits need user/agent reconciliation rather than forcibly switching files.
9. **Build and deploy the single integrated plugin** to the existing Hermes Web and Desktop plugin locations only after acceptance. Refresh/reload the respective host as needed, without changing REL/PHY files, configuration, source enrollment or active profile mappings. **No redundant installed-file backups.** Verify installed Web JS/CSS and Desktop hashes against the *integrated release* output and verify the actual running Web route serves those same bytes. Check the Rust host binary/pin **only if its build changed**; do not replace unrelated host components.
10. **Retire worktrees/branches only after proof:** categorize historical HU05/HU08 and Warlock subbranches as in-scope or out-of-scope independently. Never mass-prune branch families just because the UI merged. Verify merge ancestry and clean worktree ownership before deleting a branch or removing a worktree.

## Acceptance matrix

| Gate | Required evidence |
| --- | --- |
| Source fidelity | Original Warlock React graph NodeCloud/Territories/EdgeLines/Labels/Scene and non-graph Knowledge components are the final source-derived owners; no invented lookalikes |
| Combined visual parity | Same-fixture, same-viewport Web/Desktop captures show expected graph territories/nodes/labels/edges, three-panel layout, inspector, relations, scope, Setup and Sources; record deviations |
| Interactions | Hover/tooltip, select/focus, rotate/pan/reset, graph↔List↔Inspector selection, search/community/type/lifecycle filters, cross-community relationships and original node readability |
| Data and security | Exact-cut generation/owner checks, authorized REL/PHY, stale request cancellation, revision-safe create/edit/retire, read-only relation kinds, provenance/history, no auto historical import |
| Rust/transport | GraphRoot projection contract resolves; locked Rust tests, signed binary chunk/LOD, endpoint denial and million-node benchmark regression characterization; do not infer GPU parity from SwiftShader |
| Web/Desktop | TypeScript check, full dashboard tests and builds, pinned Python suite with explicit skips, hosted Chrome and Electron smoke on copied owners, no Tauri import |
| Deletion/cleanliness | No duplicate shell, second renderer, dead component imports or old build pipeline; documentation links and Git whitespace checks pass |
| Installed result | Integrated assets have exact SHA-256 equality with installed Web JS/CSS and Desktop module, running Web delivers same bytes; release commit and deployed version recorded |
| Safety | REL/PHY reference and test-copy file hashes unchanged where tests are read-only; existing config/profile/session routing and host service behavior preserved |

**Relevant pre-integration evidence:** graph branch `5650802` / `05d8749` reports 95 Rust tests, hosted Web and Electron smoke, eight native-GPU screenshot pairs and a 1M-node/10M-edge benchmark. Non-graph branch `4bf34e4` records shared React Knowledge parity, verified Web and Desktop flows and a parity ledger. These are **branch-local evidence**, not evidence that the combined application has passed.

## Final integration report contract

Record the integration branch and final `main` commit, each input branch tip, dirty-worktree preservation result, semantic conflict decisions, missing/retained features, exact test pass/skip counts, screenshot evidence, Root dependency status, old code deletion and installed byte hashes. **A branch being merged does not itself establish acceptance.** The goal is one verifiably coherent, deployed, Git-backed UI implementation, not additional specification branches.

## Related docs

- [Canonical UI specification](warlock-ui-hard-cut-rebuild-spec-2026-11-10.md)
- [Original graph component specification](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md)
- [Integration reconciliation](warlock-ui-integration-reconciliation-2026-11-10.md)

## Notes

### Scope boundaries

This plan consolidates **the current Warlock UI work** only. It does not authorize rewriting REL/PHY storage, changing source-import policy, adding unrelated UI features, merging all historical HU05/HU08 branches, pushing to remote, or pruning worktrees without verifying their unique work. Do not automatically start another UI redesign or change graph visual components beyond a specific parity defect.
