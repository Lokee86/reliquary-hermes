# Hermes Reliquary Knowledge

## Purpose

The Reliquary tab mounts one Warlock-derived React Knowledge experience in Hermes Web and Desktop. The Web SDK 1.1.0 manifest registers `/reliquary`. Desktop registers the same route through the plugin SDK.

## Overview

Knowledge opens on the selected authorized owner’s spatial graph. The REL and PHY rail follows the active Hermes profile. List and inspector reads use the existing bounded `dashboard-v1` contract. The graph uses manifest v2 and binary chunks through `graph-render-v1`. Setup and Sources use their existing profile-scoped APIs.

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
- [Warlock rebuild specification](../docs/warlock-ui-hard-cut-rebuild-spec-2026-11-10.md)

## Notes

`dashboard/dist/index.js`, `dashboard/dist/index.css`, and `desktop/plugin.js` are generated. Ship them from the same build.
