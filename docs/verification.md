# Hermes integration verification and remaining gates

## Purpose

Record reproducible checks for the standalone provider and dashboard contracts.

## Overview

HP01 verifies the pinned Hermes interfaces and the Python provider, owner routing and copied-source fixtures. The first HP02 slice verifies the selected-return bridge against the real Root API and its durable REL receipt.

## Standalone checks

From the plugin repository with Python 3.11+, pytest 9.1.x, jsonschema 4.x, the pinned Hermes runtime dependencies and the audited checkout available:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent-reliquary-hp01-pin'
python -B -m pytest -q --basetemp .pytest_tmp
git diff --check
```

The checkout must be at the exact SHA in [host audit](host-audit.md). Without `HP01_HERMES_CHECKOUT`, checkout-based probes skip explicitly. The Python suite uses deterministic inputs and keeps pytest state in this worktree. The shared documentation checker and commit comparison commands are in the [documentation policy](documentation-policy.md).

## Evidence covered

- Strict bounded request and response DTOs reject spoofed authority, extra fields, malformed wire data and mismatched IDs, cuts or provenance. Each selected Memory has one correlated source-provenance entry.
- Provider grants require authenticated profile and principal and a configured session REL. General and project sessions resolve independently of the active PHY. Profile/bot changes preserve the selected PHY's stable user ID. Only exact trusted attribution to that active human can route a source row to the PHY.
- The fixture queues a bounded copy of filtered source input with exact IDs and timestamps. Bound-source import verifies scopes, digests and row attribution without treating the current speaker as the author of earlier messages. Fixture receipts express replay and revision semantics in memory.
- Session/branch/rewind changes invalidate scoped recall. Explicit archive and delete mark the same session tombstone, stop recall and reject old or newly scoped replay. Transient invalidation rejects old source epochs after resync.
- The dashboard contract distinguishes candidate, selected and returned Memory sets and validates authorized REL/PHY scope, paging, cuts, tombstone state, user edits and bounded graph/provenance reads.
- Pinned host facts, dependency boundaries and lifecycle coverage are recorded in [host audit](host-audit.md).

The integrated HP01 suite passed all 290 tests with the upstream pin enabled. The shared minimal-profile documentation check and Git whitespace check passed.

## HP02 host and product facade verification

Use the sibling `Reliquary` checkout at `9d2b333e2412b120bcd797c4c842b26781ea6c8d` and a Rust toolchain with the offline dependency cache available. From this repository in PowerShell:

```powershell
$hostScratch = Join-Path (Get-Location) 'host\.test-tmp'
New-Item -ItemType Directory -Force -Path $hostScratch | Out-Null
$env:TEMP = $hostScratch
$env:TMP = $hostScratch
cargo fmt --manifest-path host/Cargo.toml --check
cargo test --manifest-path host/Cargo.toml --locked --offline -j 1
python -B ../Reliquary/scripts/check_architecture.py
```

The external consumer seeds a Freshness-enrolled Memory through public Root import and processing. A deterministic loopback decision endpoint chooses the selection. The proof observes the REL before inspection and after the first return. Two concurrent calls share one return object. Exact replay through a newly opened Gateway preserves the resulting REL byte for byte. The negative cases cover a revoked credential, a truncated projection and mismatched delivery evidence. It verifies that the bridge returns the exact selected Memory set and records its durable receipt once.

Seven host tests passed on the pinned product checkout. The copied-source cases covered source identity, author and branch metadata, REL-only processing, foreign binding denial and terminal replay after reopen. Two detached Root-only checked-create tests passed. Four OC06 tests passed using the same offline dependency set and the tracked product test source. The product lock's Archive suite passed 25 tests. The architecture guard reported 23 packages and 76 production edges.

## Remaining gates

- HP02 now covers selected retrieval return, initial copied-source staging and tombstoning, checked manual creation, filtered Memory summaries and bounded graph neighborhoods. Memory correction requires an atomic successor workflow under ADR 0013 and a matching dashboard result contract. Broader retirement, association edits, persistent community names, and the full G4/GM/P01 gate remain open.
- HP03 implements the authenticated loopback service and provider setup, persistent general/project session mappings, active PHY binding, single-writer lease and restart behavior.
- HP04 implements supported source recovery, durable copied imports, post-commit lifecycle handling, retry reconciliation and tombstone persistence. Hermes stays the history and resume authority. Reliquary maintenance owns pruning.
- HP05 wires real query/refine/traverse and prefetch. The acceptance test must distinguish candidate inspection from returned results and prove retrieval is recorded once.
- HP06 packages and validates the standalone plugin against an isolated Hermes profile. HP07 and HU04 require real-service evidence. HP07 additionally requires an authorized real model run.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own these checks. Reaudit the pinned checkout before changing any host capability claim.
