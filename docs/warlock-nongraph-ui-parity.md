# Warlock non-graph source parity

## Purpose

Record the Warlock source behind the Hermes Knowledge presentation and the changes at the host boundary.

## Overview

The original source is Warlock commit d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b. The Hermes implementation started at c32b4f132d9e5b88f433cb16decb2e6ba9fd7f77 on an isolated branch because the active graph checkout already had changes in the shared panel and stylesheet.

| Warlock source | Hermes implementation | Host adaptation |
| --- | --- | --- |
| src/features/workspace/KnowledgePanel.tsx | dashboard/src/knowledge/KnowledgePanel.tsx and KnowledgeNavigation.tsx | Original navigation, center heading and view switch, Memory rows, New Memory disclosure, archive control, community rows and rename. Bounded pages and authenticated writes replace the whole-owner snapshot. The center mounts the existing Graph and uses its Memory selection callback to populate the same inspector as List. |
| src/features/workspace/KnowledgeInspector.tsx | dashboard/src/knowledge/KnowledgeInspector.tsx | Original title, replacement editor, detail grid, relationship section and source evidence cards. Hermes adds exact revision history, terminal retirement and typed unavailable provenance. State and community fields use the returned DTO. |
| src/features/workspace/KnowledgeRelationsEditor.tsx | dashboard/src/knowledge/KnowledgeRelationsEditor.tsx | Original endpoint and direction rows and direction/target controls. Hermes supplies a bounded neighborhood and endpoint revisions. Only user associations offer link and unlink actions. Other types and inactive edges appear as evidence. |
| src/features/workspace/knowledgeUi.ts | dashboard/src/knowledge/knowledgeUi.ts | The existing copy has the same short ID, community fallback and relation labels with the Hermes community field name. |
| src/features/workspace/WorkspaceShell.tsx, ScopeControls.tsx, MountedScopeActions.tsx | dashboard/src/app.tsx, dashboard/src/knowledge/KnowledgeScope.tsx, dashboard/src/setup.tsx | Warlock scope chips and scope options sit inside Knowledge navigation. Owner choices come from the authorized profile. Setup still uses the existing validated and confirmed Hermes path operations and platform pickers. |
| src/styles.css | dashboard/src/knowledge/knowledge.css, dashboard/src/app.css | The original non-graph Knowledge rules and scope styles carry over. Hermes embeds the panel in its own route and uses its inherited font. Below 850 px the inspector spans the second row. Below 560 px the three panels stack with separate scrolling. |
| Warlock Knowledge list and inspector patterns | dashboard/src/sources.tsx and dashboard/src/warlock-workflows.css | Sources uses the same list, navigation and review frame. Enrollment, selection, explicit review, import and status polling stay with the existing Sources flow. |

The shared panel passes search, category, type, lifecycle and community filters to both List and the in-progress Graph, and forwards a single selected Memory ID between List, Graph and the inspector. The graph component, scene stylesheet, renderer, transport and backend come from the active graph worktree.

### Source inventory

These SHA-256 hashes were computed from the pinned Warlock checkout.

| File | SHA-256 |
| --- | --- |
| KnowledgePanel.tsx | f8a27fa9c46f95d5250f2319029ff1b2d0ccff166966313d0d4ab1c3bc8eaca3 |
| KnowledgeInspector.tsx | e0b67ef92f5af40a2c8c824b91848f07645a7e4ca717062bb24039be9126c60e |
| KnowledgeRelationsEditor.tsx | 14a646c44189a653bc02651450f396e47767fe8902ceac260046b78374485d8c |
| knowledgeUi.ts | f7571c158e8daa10877b23b8c57e68cc3c55ace5192d67c432bffa1c032bb408 |
| WorkspaceShell.tsx | 7cac5ff5d6940254adc1e34f12bc1313d26228d6853a524ea6d0d7becd32648e |
| ScopeControls.tsx | 54f9c659bfd731455f4a5297ec416333c0a5c3fba1ac3ff1cd674f7a853930c5 |
| MountedScopeActions.tsx | 089a680ef82517e11bb43a9116ba3f12bbd6da008d968be93e7adc0d6c6ecd7f |
| styles.css | 00267dc1ca15985e85e87b6157fc9041dfb82c2d13cf6b612c5d48e8a8e4d8d2 |

### Isolated port verification

- The stylesheet comparison matched 68 original non-graph CSS lines and the full existing Hermes graph CSS block. The source audit found no old dashboard rail or Tauri imports in either entrypoint.
- Chrome rendered both the pinned Warlock components and the port with synthetic Memories. Both had 230 px navigation, 790 px center and 420 px inspector at a 1440 px viewport. The port stayed within the viewport at 600 px and 390 px.
- In the synthetic comparison, the port passed search and selection, Memory creation and replacement, association unlink and relink, and the Graph transport fallback. Sources sent a session-list GET without sending an import POST. Both production bundles also passed isolated browser mounts with stand-in Hermes SDKs, including List search, inspector history, Setup and Sources browsing.
- The dashboard check passed TypeScript, all four Node tests and both bundle builds. The pinned Python suite passed 374 tests with 23 skips for optional fixtures and process checks. A separate targeted run with local host binaries passed 12 tests for dashboard authorization, setup and graph API contracts.
- The rebuilt Web bundle loaded in real Hermes and rendered unconfigured Setup without browser errors. A separate authenticated Web run used fresh synthetic owners and passed Memory create, association link and unlink, replacement, terminal retirement, REL to read-only PHY switching and Sources browsing without an import POST.
- An isolated Desktop launch reached Hermes. The backend remained offline and the connecting overlay blocked navigation to Setup. The authenticated Desktop acceptance gate remains open.
- At the isolated port checkpoint, the active checkout's status and the hashes of all 56 modified or untracked files matched the pre-port snapshot.

### Shared boundary integration

- The non-graph stylesheet retains all 68 original Knowledge selector rules. The shell has one Knowledge panel and one List/Graph switch. The existing graph scene stylesheet still owns graph tooltips.
- Chrome mounted the combined Web bundle with a fixture SDK at 1440, 600 and 390 pixels. At the matching 1440 × 920 reference viewport, the navigation, list and inspector measured 230, 790 and 420 pixels. The captures covered independent scrolling, responsive collapse, the selected inspector, the relationship editor, and empty and loading states.
- The combined source passed the dashboard typecheck and four Node tests. Both production bundles built and reproduced byte for byte. The 13 targeted Python setup and graph API tests and 30 source contract and lifecycle tests passed with isolated fixtures and the local Hermes and graph host pins.
- Authenticated Hermes Web passed create, association link and unlink, replacement and retirement on synthetic owners. A separate read-only run exercised 11 active REL Memories and 4 PHY Memories, binary reads and denial checks, Graph/List selection, history, provenance, Setup and Sources browsing. The source and browsed corpus copies retained their starting hashes.
- Installed Hermes Desktop validated and connected the copied owners through Setup, opened the 11-node REL graph, displayed a selected List Memory and its provenance, opened Sources, and switched to the 4-node read-only PHY graph. Both Desktop owner files matched their source copies byte for byte.
- A browser fixture intercepted Sources writes and status polling. It verified selection, explicit review and one submission to the selected authorized REL, with Queued, Processing and Complete states.
- The documentation checker reports four existing section findings in the separate original graph component hard-cut specification.

## Related docs

- [Canonical Warlock UI hard-cut specification](warlock-ui-hard-cut-rebuild-spec-2026-11-10.md)
- [Verification and later gates](verification.md)
- [Dashboard build](../dashboard/README.md)

## Notes

The Web and Desktop bundles are produced together by `dashboard/scripts/build.mjs`. The separate original graph component hard cut remains tracked in its own specification.
