# Reliquary Hermes documentation

- [Local service and provider](local-service.md) covers configuration, routing, startup, security and recovery.
- [Maintainer map](maintainer-map.md) routes changes to their implementation and verification owners.

- [HP04 crash/reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md) defines runtime leases, crash fencing, transcript reconciliation and clean host shutdown.
- [Host audit](host-audit.md): pinned revision, real lifecycle/message identity and observed capability gaps.
- [Protocol and authority](protocol.md): strict DTOs, server-owned grants, copied source and bounded model tools.
- [Web-dashboard typed DTOs](ui-contract.md): complete HU01/HU02 contract, views, user actions, cuts/cursors and owner capabilities.
- [HU03 dashboard authorization](hu03-dashboard-authorization-2026-11-08.md): approved live authorization mapping from Hermes-authenticated profile scope to the configured Reliquary topology; unblocks `ui.owner_sessions`.
- [HU05 cross-surface onboarding specification and 2026-11-09 project-aware amendment](hu05-cross-surface-onboarding-desktop-spec-2026-11-08.md) records the accepted setup baseline and the proposed Select/Create, secure web browsing, Hermes project inventory, General fallback, and durable routing correction.
- [HU06 stock Hermes compatibility specification](hu06-stock-hermes-desktop-mutation-compat-spec-2026-11-09.md) defines the Desktop capability gate and the stock and fixed host acceptance matrix.
- [HU07 Hermes-native presentation specification](hu07-hermes-native-presentation-spec-2026-11-09.md) moves visual presentation ownership to Hermes-native web and Desktop controls and limits Reliquary CSS to structural/layout concerns.
- [HU05 two-track release/routing specification](hu05-release-fallback-and-hermes-attribution-spec-2026-11-09.md) separates stock-Hermes General REL release from a minimal upstream Hermes session-project metadata PR.
- [HU08 new-session ingestion and manual history import specification](hu08-session-ingestion-policy-and-manual-import-spec-2026-11-09.md) defines default historical-session exclusion and a selective Sources import workflow.
- [HU09 native file-dialog onboarding specification](hu09-native-file-dialogs-onboarding-spec-2026-11-09.md) defines the plugin-local Tk Open File and Save As dialogs on Windows and the explicit manual-path fallback.
- [Warlock-parity Hermes UI hard-cut rebuild](warlock-ui-hard-cut-rebuild-spec-2026-11-10.md): canonical Warlock component inventory, Rust graph renderer reuse, authenticated transport seams, deletion scope, implementation phases and acceptance gates. Supersedes the existing dashboard as the UI implementation target; the old contracts remain reference evidence until cutover.
- [Original vs scalable Warlock graph audit](warlock-graph-original-vs-scalable-audit-2026-11-10.md): source-verified feature matrix, historical revisions, visual/interaction regressions, scalability gains, and restoration requirements; both revisions preserved in detached comparison worktrees.
- [Rich Warlock graph on scalable renderer — implementation spec](warlock-rich-scalable-graph-spec-2026-11-10.md): relation-aware Rust hierarchical layout, semantic community spheres and labels, hover/focus/edge highlights, shared Knowledge selection and filters, schema and reuse rules, hard-cut stages, and acceptance gates.
- [Original Warlock React graph component hard-cut](warlock-original-react-graph-component-hard-cut-spec-2026-11-10.md): source-first transplant of original GraphScene, NodeCloud, EdgeLines, NodeLabels and Territories onto the accepted binary-chunk renderer; includes exact visual parity, no lookalike replacement, and hard-cut acceptance.
- [Verification and later gates](verification.md): exact commands, evidence, ownership impact and unimplemented capabilities.
- [Roadmap](roadmap.md): deferred service-lifecycle work that remains intentionally outside the current acceptance scope.
- [Documentation policy and procedure](documentation-policy.md): service profile, canonical owners and required checks.
- [Repository entry point](../README.md): status, usage and maintenance.