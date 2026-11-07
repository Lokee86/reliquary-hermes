# Reliquary Hermes

HP01 freezes a bounded contract for a standalone Reliquary memory integration. **This repository is not yet an installable plugin, service, Rust host, or completed product integration.** Its executable artifacts are pure Python DTO validators, grant checks, model-tool schemas and deterministic contract fixtures.

Hermes remains canonical history. Reliquary receives privacy-filtered, source-ID-preserving copied snapshots through future supported import operations. A copied snapshot never becomes a Hermes resume source.

Maintained by the Reliquary integration maintainers as an HP01 contract fixture. Its current limitations and future service/plugin gates are explicit below; this is not a production release.

## Contract and evidence

- [Documentation index and ownership](docs/INDEX.md): canonical document owners and minimal fixture policy.
- [Pinned host audit](docs/host-audit.md): actual APIs, source identity, profile/thread behavior and validation commands.
- [Protocol and authority](docs/protocol.md): version-one DTOs, limits, actor grants and copied-snapshot rules.
- [Web-dashboard DTOs](docs/ui-contract.md): standard typed schema for all required HU views and user actions.
- [Proposed handoff boundary](docs/handoff-contract.md): the generic hook missing from the pinned host and the strict no-false-consumption rule.
- [Verification and remaining gates](docs/verification.md): exact test commands, observed results and HP02+ gaps.

Pinned Hermes checkout: `11c1f1bbe65fca1cf8bcaa005443473a67915712`. Planning authority: `Reliquary-crate-first/docs/architecture/hermes-reliquary-plugin-implementation-spec-2026-11-06.md`, post-G4 plan commit `5d96db99`. Accepted product audit target: `Reliquary-rebuild` at `a3c3a964`.

## Focused tests

Run from this repository using an existing Python 3.11+ interpreter with pytest 9.1.x and jsonschema 4.x:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent'
python -B -m pytest -q --basetemp=.test-tmp
```

No model credentials, network calls, Hermes configuration imports or Cargo builds are needed. Without `HP01_HERMES_CHECKOUT`, the pinned-ABC provider tests are explicitly skipped; that reduced run is not equivalent evidence.
