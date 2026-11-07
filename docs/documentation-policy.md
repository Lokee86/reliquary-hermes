# Documentation policy and procedure

## Purpose

Keep HP01's current executable fixture behavior, audited host facts, proposed interfaces and later production work distinct and reproducible.

## Overview

The Reliquary integration maintainers maintain this standalone repository for HP01. The shared engineering standard explicitly permits its `minimal` profile for fixtures and narrow utilities. This repository currently ships only deterministic contract values/tests, not a library release, plugin installation, durable service or UI. `docs-standard.json` therefore selects `minimal` plus the protocol capability. Reevaluate the profile before HP03 introduces a real service or HP06 a distributable provider.

There is no baseline and no blanket document or source exemption. The root index links every document, substantive documents retain Purpose/Overview/Related docs/Notes, and code/test paths map to canonical owners:

- `protocol.py`, `validation.py`, `tools.py`: [protocol](protocol.md).
- `authority.py`, `source.py`: [protocol](protocol.md) and [host audit](host-audit.md).
- `consumption.py` and pinned capability constants: [handoff contract](handoff-contract.md) and [host audit](host-audit.md).
- `ui_schema.py`, `ui_contract.py` and exported `contracts/dashboard-v1.schema.json`: [web-dashboard DTO contract](ui-contract.md).
- Tests and test configuration: [verification](verification.md).
- Planning, limitations and behavioral evidence remain in the verification owner's later-gates sections. A separate maintainer map/coverage/roadmap/limits hierarchy is unnecessary for this small contract fixture; these explicit owners satisfy the narrow fixture scope, rather than pretending a production profile is complete.

## Change procedure

1. Confirm the requested change belongs to the standalone contract. Do not alter Hermes, product source, private stores, caches or credentials as a documentation side effect.
2. Update the canonical owner with changed current behavior and separately labeled proposed behavior or remaining gaps. Keep source revision/API facts source-backed.
3. Update the matching behavioral tests and run the frozen command in [verification](verification.md).
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

The config adopts the shared deterministic documentation checks for this fixture. A vendored checker snapshot, CI wiring, Archivist ledger and Pitlord semantic policy are not installed and are not claimed. Their production adoption belongs to later repository/tooling work, with the profile reevaluated against the actual shipped system. No sibling standards registry was changed by this task.
