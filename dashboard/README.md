# Hermes Reliquary dashboard

## Purpose

The Reliquary tab uses the current `dashboard-v1` contract. The manifest registers `/reliquary` through the Hermes web dashboard SDK 1.1.0. The classic script uses the host's React and hooks.

## Overview

The default build queries the admitted Hermes profile through its authenticated SDK. The live tab lists configured RELs and the active PHY, and resolves exact known session IDs to their REL. The separate fixture build serves a general REL, a project child REL and independently selected PHY scenarios. In fixture mode the tab provides paged search and filters, a bounded graph with keyboard selection and expansion, Memory detail and revision history, provenance, community membership, and operational status. Recall status distinguishes candidate, selected and returned Memory sets.

Build and check from the repository root:

```powershell
node dashboard/scripts/build.cjs
node dashboard/scripts/build.cjs --fixture
node --test dashboard/tests/dashboard.test.cjs
tsc --noEmit -p dashboard/tsconfig.json
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
$env:PYTHONDONTWRITEBYTECODE = "1"
python -B -m pytest -q --basetemp .pytest_tmp tests/test_ui_contract.py tests/test_dashboard_api.py dashboard/tests/test_fixtures.py
```

The JSDoc type check uses a local TypeScript compiler. The Python check validates every bundled response against the exported schema and the canonical DTO rules.

## Related docs

- [Dashboard DTO contract](../docs/ui-contract.md)
- [Host and web SDK audit](../docs/host-audit.md)
- [Verification and real-service gates](../docs/verification.md)

## Notes

The fixture build stages a standalone dashboard directory under `host/.test-tmp/dashboard-fixture`. The live manifest loads `plugin_api.py` alongside its compiled assets. The HU02 fixture smoke passed on Hermes v0.23.0 with SDK 1.1.0 and the host React runtime. [Acceptance and reproduction steps](../docs/verification.md#hu02-read-only-dashboard-acceptance)
