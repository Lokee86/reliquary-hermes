# Documentation policy and procedure

## Purpose

Keep the Python contract, pinned Hermes source evidence and executable Rust host behavior reproducible.

## Overview

The Reliquary integration maintainers own this standalone repository. The shared engineering standard permits its `minimal` profile for fixtures and narrow utilities. The HP02 selected-return bridge is a detached library component. Reevaluate the profile when HP03 introduces a service or HP06 packages the provider.

There is no baseline and no blanket document or source exemption. The root index links every document, substantive documents retain Purpose/Overview/Related docs/Notes, and code/test paths map to canonical owners:

- `protocol.py`, `validation.py`, `tools.py`: [protocol](protocol.md).
- `authority.py`, `source.py`: [protocol](protocol.md) and [host audit](host-audit.md).
- `__init__.py` and the pinned source probes are owned by [host audit](host-audit.md) and [verification](verification.md).
- `ui_schema.py`, `ui_contract.py` and exported `contracts/dashboard-v1.schema.json`: [web-dashboard DTO contract](ui-contract.md).
- Tests and test configuration are owned by [verification](verification.md).
- The detached Rust host crate is covered by [protocol](protocol.md) and [verification](verification.md).
- Planning, limitations and behavioral evidence remain in the verification owner's later-gates sections. A separate maintainer map/coverage/roadmap/limits hierarchy is unnecessary for this small contract fixture; these explicit owners satisfy the narrow fixture scope, rather than pretending a production profile is complete.

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

The config adopts the shared deterministic documentation checks for this fixture. A vendored checker snapshot, CI wiring, Archivist ledger and Pitlord semantic policy are not installed and are not claimed. Their production adoption belongs to later repository/tooling work, with the profile reevaluated against the actual shipped system. No sibling standards registry was changed by this task.
