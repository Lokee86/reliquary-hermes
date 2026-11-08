# Reliquary Hermes

This repository contains the frozen HP01 Python contracts and the first HP02 Rust host component. The Rust bridge records selected retrieval through Reliquary's public Root APIs. Provider installation and the loopback service belong to later tickets.

Hermes remains canonical history. Reliquary receives privacy-filtered, source-ID-preserving copied snapshots through future supported import operations. A copied snapshot never becomes a Hermes resume source.

The Reliquary integration maintainers own the contracts, the host bridge and the staged verification gates.

## Contract and evidence

- [Documentation index and ownership](docs/INDEX.md): canonical document owners and minimal fixture policy.
- [Pinned host audit](docs/host-audit.md): actual APIs, source identity, profile/thread behavior and validation commands.
- [Protocol and authority](docs/protocol.md): version-one DTOs, limits, actor grants and copied-snapshot rules.
- [Web-dashboard DTOs](docs/ui-contract.md): standard typed schema for all required HU views and user actions.
- [Verification and remaining gates](docs/verification.md): exact test commands, observed results and HP02+ gaps.

Hermes is pinned to upstream `cf4f3a7396814ffcaef69d9af09f7cfdade3ddbe`. The canonical planning files are in the Reliquary Git repository at `bd1acf2c10ab3ffb2887928b8497608fcd5c21f7:docs/architecture/`, including `hermes-reliquary-plugin-implementation-spec-2026-11-06.md` and the post-G4 execution DAG. The accepted G4 product evidence is anchored at `a3c3a964`.

## Python contract tests

Run from this repository using an existing Python 3.11+ interpreter with pytest 9.1.x, jsonschema 4.x and the pinned Hermes runtime dependencies:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent-reliquary-hp01-pin'
python -B -m pytest -q --basetemp=.pytest_tmp
```

The source probes use synthetic history and an isolated Hermes profile. They require no model credentials, network calls or Cargo builds. Without `HP01_HERMES_CHECKOUT`, the pinned-ABC provider tests are explicitly skipped; that reduced run is not equivalent evidence.

## Rust host proofs

Run `cargo test --manifest-path host/Cargo.toml --locked --offline -j 1` with the accepted product checkout at the sibling `Reliquary` path. The tests exercise real Root retrieval, copied-source import and tombstone replay with deterministic loopback model responses. The exact product revision, workspace-local temp paths and verification steps are in [verification](docs/verification.md).
