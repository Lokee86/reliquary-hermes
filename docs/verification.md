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
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent-reliquary-hp01-v023'
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

Use the stable Hermes checkout above and the sibling Reliquary checkout at the HP04 checkpoint below. The following Windows commands build the actual host and product CLI, then run the Python suite with all process proofs enabled. The local-service guide owns runtime setup. [Local service](local-service.md)

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
$env:HP01_HERMES_CHECKOUT = 'C:\!bin\workspace\hermes-agent-reliquary-hp01-v023'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -B -m pytest -q --basetemp .pytest_tmp
python -B ../Reliquary/scripts/check_architecture.py
```

The process tests create native owners with the product CLI. They exercise startup, authenticated attachment to a running host, invalid credentials, competing processes, cross-profile writer denial, outage and restart. A real pinned Hermes setup hook provisions an isolated profile and the provider attaches to the Rust process, recovers after its exit and leaves the REL unchanged during source callbacks. Separate profiles with distinct REL writers retain the same explicitly selected PHY identity. Unit tests cover stale attach completion, transport authentication and framing, durable registry conflicts and actual Root status.

The HP03 gate passed 16 Rust tests and 311 Python tests with the pinned Hermes and real-process probes enabled. The architecture guard reported 23 production packages and 76 production dependency edges. All runs used synthetic owners under the local plugin worktree.

## HP04 stable host and runtime verification

Use the HP03 build and test commands with Hermes `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` and the sibling Reliquary checkout at `b31aaee577fc0e1caa3b9d7913c18f8155c4f972`. The [host audit](host-audit.md) records the stable pin and provider callback evidence. The process proofs use synthetic owners and deterministic loopback processing endpoints.

The HP04 suite covers stable transcript IDs and timestamps, privacy-filtered provider delivery, native append and exact replay, same-session rewind, committed archive/delete notices and tombstone anti-resurrection. The runtime tests exercise heartbeat expiry, a durable scoped crash fence, reconnect with the original owner binding, authoritative recovery and final clean shutdown. The independent Root extension proof is:

```powershell
cargo test --manifest-path ../Reliquary/tests/external-consumer/Cargo.toml --target-dir host/target --locked --offline --test operational_processing
```

HP04 passed local acceptance on November 8, 2026. The final run passed 344 Python tests with both process binaries and the stable Hermes checkout enabled. It also passed 19 locked offline Rust host tests and all three detached Root processing tests. Rust formatting, Git whitespace and the Reliquary architecture guard passed.

The process suite killed an attached pinned provider and observed the durable fence after the production lease expired. The surviving host accepted a replacement provider with the same REL/PHY binding. A subsequent full callback imported the new row once, while stale snapshots and old lease messages were rejected. The restart proof found the existing fence when a live runtime added the affected scope, kept the fence while import was pending and advanced its epoch after another host restart. Registration recovered when an intermediate reattach attempt failed. Archive stayed terminal. Clean shutdown drained volatile captures to the outbox, removed discovery and released the owner leases for restart.

A crash can leave a fence until a supported Hermes callback supplies the required source overlap. An upstream event absent from that view can remain unrecoverable. See the [HP04 crash/reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md).

## HP05 stable retrieval verification

Use the HP03 process-test commands with the same stable Hermes and Reliquary pins as HP04. The focused Python process proof is `tests/test_hp05_retrieval.py`. It stages three copied Hermes turns through the authenticated host, processes them through the public Reliquary CLI, and uses deterministic loopback decisions for retrieval. The actual v0.23.0 Hermes memory manager exercises turn-start prefetch and all three tools against the Rust host.

Queued preparation and Root inspection leave the REL bytes and retained history unchanged. Turn-start prefetch reuses the prepared decision and, together with an exact replay, adds one retained record. Query, refinement and one-hop traversal add one record each and return distinct selections within the tool turn. The proof checks the exact accepted snapshot digest, rejection of deeper traversal, and refusal to return stale copied evidence after a rewind from another session bound to the same REL. The Rust selected-return proof separately covers concurrent and reopened replay through the same Root receipt.

HP05 passed local acceptance on November 8, 2026. The pinned suite passed 346 Python tests, 19 locked offline Rust host tests and all three detached Root processing tests. The focused process proof also passed with the exact digest and cross-session rewind assertions. Rust formatting, Git whitespace, the service documentation check and the Reliquary architecture guard passed.

The local model endpoint verifies routing, grounding and receipt behavior with fixed synthetic decisions. HP07 owns the authorized real-model run.

## Remaining gates

- HP06 packages and validates the standalone plugin against an isolated Hermes profile.
- HP07 and HU04 require real-service evidence. HP07 additionally requires an authorized real model run.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own these checks. Reaudit the pinned checkout before changing any host capability claim.
