# Reliquary Hermes maintainer map

## Purpose

Route integration changes to the owning contract, implementation boundary and verification suite.

## Overview

| Change area | Canonical documentation | Implementation and verification |
| --- | --- | --- |
| Hermes setup, pinned hooks and profile isolation | [Host audit](host-audit.md) and [local service](local-service.md) | `provider.py`, `settings.py`, standalone registration and pinned provider tests |
| Authenticated transport and response correlation | [Protocol](protocol.md) | `client.py`, Rust service protocol and HTTP modules, local transport and process tests |
| Owner grants, leases and durable routing | [Local service](local-service.md) | Rust registry and registry storage, Root-backed process and registry tests |
| Copied source and retrieval return | [Protocol](protocol.md) | Source and authority DTOs, `retrieval_hack.rs`, copied-source and selected-return proofs |
| Dashboard DTOs and mutation expectations | [Dashboard contract](ui-contract.md) | `ui_schema.py`, `ui_contract.py`, schema export and contract tests |
| Acceptance, scope and later gates | [Verification](verification.md) | Pinned Python suite, locked offline Cargo tests and real local process witnesses |

The checker maps implementation paths to their documentation owners in `docs-standard.json`. Product-domain changes belong to the sibling Reliquary repository and enter this plugin through public Root. The implementation plan remains in the archived canonical planning tree linked by the README.

## Related docs

- [Documentation policy](documentation-policy.md)
- [Documentation index](INDEX.md)
- [Repository entry point](../README.md)

## Notes

The Reliquary integration maintainers own the service and provider. Hermes and Reliquary retain ownership of their respective source and product contracts.
