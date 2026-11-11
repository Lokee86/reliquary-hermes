# Hermes Reliquary Knowledge

## Purpose

The Reliquary tab mounts one Warlock-derived React Knowledge experience in Hermes Web and Desktop. The Web SDK 1.1.0 manifest registers `/reliquary`. Desktop registers the same route through the plugin SDK.

## Overview

Knowledge opens on the selected authorized owner’s spatial graph. REL and PHY scope controls live in the Knowledge navigation and follow the active Hermes profile. Graph and List share filters, Memory selection and the inspector in Warlock’s original three-column composition. Navigation and inspector scroll independently; List scrolls in the center column and Graph fills that center column. The shared Knowledge surface establishes the named `reliquary` inline-size container required by its responsive collapse rules.

List and inspector reads use the bounded `dashboard-v1` contract. The graph uses manifest v3, binary chunks and bounded interaction reads through `graph-render-v1`. Setup and Sources use their existing profile-scoped APIs.

Build both entrypoints and the Web stylesheet from the repository root:

```powershell
npm --prefix dashboard ci
npm --prefix dashboard run check
```

Both bundles use the host’s React and control primitives. The shared graph stylesheet and Three.js scene preserve the Warlock graph presentation. Web uses the authenticated SDK fetch for binary responses. Desktop needs the SDK’s bounded `restBytes` method for graph chunks. The local patch and its exact upstream revision are recorded in the installation guide.

## Related docs

- [Installation and local service](../docs/local-service.md)
- [Dashboard and render contracts](../docs/ui-contract.md)
- [Verification](../docs/verification.md)
- [Source parity ledger](../docs/warlock-nongraph-ui-parity.md)
- [Warlock rebuild specification](../docs/warlock-ui-hard-cut-rebuild-spec-2026-11-10.md)

## Notes

`dashboard/dist/index.js`, `dashboard/dist/index.css`, and `desktop/plugin.js` are generated. Ship them from the same build.
