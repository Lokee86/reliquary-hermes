# Reliquary Hermes

Reliquary Hermes is the standalone memory provider and loopback host for the pinned Hermes revision. HP03 attaches Hermes sessions to existing Reliquary owners and keeps their routing durable across host restarts. The Rust host uses public Root APIs. The Reliquary integration maintainers own the service and contracts.

Hermes remains canonical history. HP04 copies the permitted transcript using stable Hermes source IDs and timestamps. Authenticated runtime leases coordinate clean shutdown and crash recovery, and archive and delete stay terminal across reconnects. Hermes resumes from its own history.

Use the local service guide to configure existing owners and activate the provider through `hermes memory setup`. HP04 owns live source copying. HP05 owns recall and model tools. HP06 owns distribution and installation acceptance. [Local service guide](docs/local-service.md)

## Contract and evidence

- [Documentation index and ownership](docs/INDEX.md): canonical document owners and minimal fixture policy.
- [Pinned host audit](docs/host-audit.md): actual APIs, source identity, profile/thread behavior and validation commands.
- [Protocol and authority](docs/protocol.md): version-one DTOs, limits, actor grants and copied-snapshot rules.
- [Web-dashboard DTOs](docs/ui-contract.md): standard typed schema for all required HU views and user actions.
- [Verification and remaining gates](docs/verification.md) records the test commands, observed results and remaining integration gates.

Hermes is pinned to stable `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`. The canonical planning files are in the Reliquary Git repository at `bd1acf2c10ab3ffb2887928b8497608fcd5c21f7:docs/architecture/`, including `hermes-reliquary-plugin-implementation-spec-2026-11-06.md` and the post-G4 execution DAG. The accepted G4 product evidence is anchored at `a3c3a964`.

## Python contract tests

Run from this repository using an existing Python 3.11+ interpreter with pytest 9.1.x, jsonschema 4.x and the pinned Hermes runtime dependencies:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent-reliquary-hp01-v023'
python -B -m pytest -q --basetemp=.pytest_tmp
```

The source probes use synthetic history and an isolated Hermes profile. They require no model credentials, network calls or Cargo builds. Without `HP01_HERMES_CHECKOUT`, the pinned-ABC provider tests are explicitly skipped; that reduced run is not equivalent evidence.

## Rust host proofs

Run `cargo test --manifest-path host/Cargo.toml --locked --offline -j 1` with the accepted product checkout at the sibling `Reliquary` path. The tests exercise real Root retrieval, copied-source import and tombstone replay with deterministic loopback model responses. The exact product revision, workspace-local temp paths and verification steps are in [verification](docs/verification.md).
