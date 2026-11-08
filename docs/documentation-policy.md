# Documentation policy and procedure

## Purpose

Keep the Python contract, pinned Hermes source evidence and executable Rust host behavior reproducible.

## Overview

The Reliquary integration maintainers own this standalone repository. HP03 adopts the shared `service` profile. The local service guide owns architecture, configuration, operation, recovery, security and limits. The verification guide owns acceptance and planned integration gates. [Local service](local-service.md) · [Verification](verification.md)

There is no baseline and no blanket document or source exemption. The root index links every document, substantive documents retain Purpose/Overview/Related docs/Notes, and code/test paths map to canonical owners:

- `protocol.py`, `validation.py`, `tools.py`: [protocol](protocol.md).
- `authority.py`, `source.py`: [protocol](protocol.md) and [host audit](host-audit.md).
- `__init__.py` and the pinned source probes are owned by [host audit](host-audit.md) and [verification](verification.md).
- `ui_schema.py`, `ui_contract.py` and exported `contracts/dashboard-v1.schema.json`: [web-dashboard DTO contract](ui-contract.md).
- Tests and test configuration are owned by [verification](verification.md).
- The detached Rust host crate is covered by [protocol](protocol.md) and [verification](verification.md).
- The Python client, provider settings, registration and Rust service map to the [local service](local-service.md), [protocol](protocol.md) and [maintainer map](maintainer-map.md). Machine-readable coverage lives in `docs-standard.json`.

## Change procedure

1. Confirm the requested change belongs to the standalone integration. Do not alter Hermes, product source, private stores, caches or credentials as a documentation side effect.
2. Update the canonical owner with changed current behavior and separately labeled proposed behavior or remaining gaps. Keep source revision/API facts source-backed.
3. Update the matching behavioral tests and run the applicable checks in [verification](verification.md).
4. Run the shared checker from the existing sibling checkout without copying or mutating it:

```powershell
python -B ../engineering-standards/tools/docs_policy/check.py --repo .
python -B ../engineering-standards/tools/docs_policy/check.py --repo . --changed-from c54c4298aa8996ca631d07534c97f202f619abb6
```

The change-impact check compares commits through HEAD, so run it after committing, as well as the full current-tree check before committing. Run `git diff --cached --check` on the entire staged artifact set. Never add a baseline merely to hide new findings.

## Related docs

- [Contract index](INDEX.md)
- [Verification and later gates](verification.md)
- [Repository entry point](../README.md)

## Notes

This repository runs the shared deterministic documentation checker directly from the local engineering standards checkout. Reevaluate deployment, upgrade and maintenance documentation when HP06 packages the provider.
