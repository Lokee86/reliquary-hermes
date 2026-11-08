# Hermes integration verification and remaining gates

## Purpose

Record reproducible checks for the standalone provider and dashboard contracts.

## Overview

HP01 verifies the pinned Hermes interfaces and the Python provider, owner routing and copied-source fixtures. HP02 verifies the selected-return bridge, copied-source import and dashboard product operations through the public Root API.

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

The HP02 dashboard contract passed all 298 Python tests with the same Hermes pin. It verifies correction through an immutable successor, terminal results without synthetic body IDs, REL-only management authority, mutation cut advancement within one history generation, and community member paging at an exact generation.

## HP02 host and product facade verification

Use the sibling `Reliquary` checkout at `8363ec377f044c0e00a699266e14090284829477` and a Rust toolchain with the offline dependency cache available. From this repository in PowerShell:

```powershell
$hostScratch = Join-Path (Get-Location) 'host\.test-tmp'
New-Item -ItemType Directory -Force -Path $hostScratch | Out-Null
$env:TEMP = $hostScratch
$env:TMP = $hostScratch
$env:TMPDIR = $hostScratch
cargo fmt --manifest-path host/Cargo.toml --check
cargo test --manifest-path host/Cargo.toml --locked --offline -j 1
python -B ../Reliquary/scripts/check_architecture.py
```

The host proof seeds a Freshness-enrolled Memory through public Root import and processing. A deterministic loopback decision endpoint chooses the selection. Candidate and inspection reads leave the REL unchanged. Two concurrent calls share one return object and produce one content return. The Root historical proof counts one additional retained record. Exact replay through a newly opened Gateway preserves that proof and the resulting REL byte for byte. The negative cases cover a revoked credential, a truncated projection, mismatched delivery evidence and a selected Memory without Freshness enrollment.

The copied-source tests cover source identity, author and branch metadata, REL-only processing, foreign binding denial and terminal replay after reopen. The Root-only product tests cover checked creation, correction, retirement, association and community management. The mixed-write test reopens a single owner and replays four prior mutation receipts without changing its bytes. The maintenance regressions cover reference closure, pruning recovery and safe refusal when a rewrite or divergent merge cannot preserve write authority.

The local suites passed 8 Rust host tests, 668 product workspace tests, 17 CLI tests and 14 detached Root consumer tests. The architecture guard reported 23 production packages and 76 production dependency edges. The composed G4 gate passed two matching semantic runs and the separate cohort-dependent Root consumer test. Fresh processes checked 48 authored turns and recorded 27 CLI observations with unchanged source bytes. The runner checks both supported PHY reads and rejection when a CLI command targets the wrong owner kind.

The selected-return shim requires the exact preview and an accepted Freshness write for the whole selected set. A truncated projection or a selection containing an unenrolled Memory fails before content is released. Directly authored Memories, including correction successors, currently lack automatic Freshness enrollment. Community reads and rename require an accepted current partition. Exact source-turn bytes are available for authorized provenance, while extraction-quote offsets are unavailable. These acceptance runs used deterministic local endpoints.

From the sibling product root, use the existing offline G4, GM and P01 checks. The composed G4 script creates two fresh deterministic cohorts and exercises the real CLI and Root-only consumer in separate processes. All generated owner files and logs stay in the local repository.

```powershell
$productScratch = Join-Path (Get-Location) '.test-tmp\hp02-final'
New-Item -ItemType Directory -Force -Path $productScratch | Out-Null
$env:TEMP = $productScratch
$env:TMP = $productScratch
$env:TMPDIR = $productScratch
python -B scripts/check_architecture.py
cargo fmt --all --check
cargo fmt --manifest-path cli/Cargo.toml --check
cargo fmt --manifest-path tests/external-consumer/Cargo.toml --check
cargo check --workspace --locked --offline
cargo test --workspace --locked --offline -- --test-threads=1
cargo test --manifest-path cli/Cargo.toml --locked --offline -- --test-threads=1
cargo check --manifest-path tests/external-consumer/Cargo.toml --locked --offline
cargo test --manifest-path tests/external-consumer/Cargo.toml --locked --offline -- --test-threads=1
& ./scripts/run_g4_acceptance.ps1
```

## HP03 local process verification

Use the same pinned Hermes and Reliquary checkouts. The following Windows commands build the actual host and product CLI, then run the Python suite with all process proofs enabled. The local-service guide owns runtime setup. [Local service](local-service.md)

```powershell
$scratch = Join-Path (Get-Location) 'host\.test-tmp\hp03'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
$env:TMPDIR = $scratch
cargo fmt --manifest-path host/Cargo.toml --check
cargo test --manifest-path host/Cargo.toml --locked --offline -- --test-threads=1
cargo build --manifest-path host/Cargo.toml --locked --offline
cargo build --manifest-path ../Reliquary/cli/Cargo.toml --locked --offline --target-dir host/target
$env:HP03_HOST_BINARY = (Resolve-Path host/target/debug/reliquary-hermes-host.exe).Path
$env:HP03_RELIQUARY_CLI = (Resolve-Path host/target/debug/reliquary.exe).Path
$env:HP01_HERMES_CHECKOUT = 'C:\!bin\workspace\hermes-agent-reliquary-hp01-pin'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -B -m pytest -q --basetemp .pytest_tmp
python -B ../Reliquary/scripts/check_architecture.py
```

The process tests create native owners with the product CLI. They exercise startup, authenticated attachment to a running host, invalid credentials, competing processes, cross-profile writer denial, outage and restart. A real pinned Hermes setup hook provisions an isolated profile and the provider attaches to the Rust process, recovers after its exit and leaves the REL unchanged during source callbacks. Separate profiles with distinct REL writers retain the same explicitly selected PHY identity. Unit tests cover stale attach completion, transport authentication and framing, durable registry conflicts and actual Root status.

The HP03 gate passed 16 Rust tests and 311 Python tests with the pinned Hermes and real-process probes enabled. The architecture guard reported 23 production packages and 76 production dependency edges. All runs used synthetic owners under the local plugin worktree.

## HP04 provisional local verification

The current implementation was exercised against the same audited Hermes pin used for HP03 and the sibling Reliquary commit `b31aaee577fc0e1caa3b9d7913c18f8155c4f972`. Use the HP03 local build and Python commands above to enable the HP04 process probes. Run `cargo test --manifest-path ../Reliquary/tests/external-consumer/Cargo.toml --locked --offline --test operational_processing` for the independent Root extension proof. Tests use synthetic owner files and deterministic loopback endpoints.

The probes cover the pinned privacy projection, stable logical IDs and timestamps, real provider delivery, completed native append, exact older receipt replay, restart before acknowledgment, a late same-session rewind callback, the cold archive/delete observer and native terminal replay. The product workspace passed all 668 tests. The three detached Root processing tests passed, including completed append and divergent maintenance replay. The architecture guard still reports 23 production packages and 76 production edges.

A replay of the private outbox covers delivered callback data. Provider-equivalent history export and a durable lifecycle replay interface are still needed for events that never reached it. HP04 acceptance remains provisional on this pin.

## Remaining gates
- HP04 implements supported source recovery, durable copied imports, post-commit lifecycle handling, retry reconciliation and tombstone persistence. Hermes stays the history and resume authority. Reliquary maintenance owns pruning.
- HP05 wires real query/refine/traverse and prefetch. The acceptance test must distinguish candidate inspection from returned results and prove retrieval is recorded once.
- HP06 packages and validates the standalone plugin against an isolated Hermes profile. HP07 and HU04 require real-service evidence. HP07 additionally requires an authorized real model run.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own these checks. Reaudit the pinned checkout before changing any host capability claim.
