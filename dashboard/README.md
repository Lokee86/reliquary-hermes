# Hermes dashboard fixture shell

## Purpose

HU01-R1 reuses the Reliquary tab shell against the current `dashboard-v1` contract. The manifest registers `/reliquary` through the Hermes web dashboard SDK 1.1.0. The classic script uses the host's React and hooks.

## Overview

The synthetic fixture covers a general REL, a project child REL and a separately bound active PHY. Browsing an owner leaves the active PHY and its stable Reliquary user ID intact. The inspector displays unavailable provenance separately from the copied-source tombstone and the Memory lifecycle. Fixture recall status shows candidate, selected and returned stages.

Build and check from the repository root:

```powershell
node dashboard/scripts/build.cjs
node --test dashboard/tests/hu01.test.cjs
tsc --noEmit -p dashboard/tsconfig.json
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
$env:PYTHONDONTWRITEBYTECODE = "1"
python -B -m pytest -q --basetemp .pytest_tmp tests/test_ui_contract.py dashboard/tests/test_fixtures.py
```

The JSDoc type check uses a local TypeScript compiler. The Python check validates every bundled response against the exported schema and the canonical DTO rules.

## Related docs

- [Dashboard DTO contract](../docs/ui-contract.md)
- [Host and web SDK audit](../docs/host-audit.md)
- [Verification and real-service gates](../docs/verification.md)

## Notes

The current shell uses deterministic data and an SDK stub for component tests. U2 introduces the typed client boundary. U3 owns the independent REL and PHY selectors. U7 verifies the bundle in the stable Hermes host.
