# Vendored Root source

## Purpose

This source-only snapshot pins Reliquary Core at `010974130fb5cf7f0b5f624de9faa2ebcdac409d`.
The Hermes host uses the public `reliquary-memory` API for leased owner mounts.
Core restores verified REL checkpoints, replays recent writes, and reads older history on demand.

## Overview

The snapshot contains 712 Git-verified files. It includes the Cargo workspace and lock,
Rust sources and tests, the referenced G4 fixture, and the existing Quinn source and licenses.

Cargo resolves `lodestone-core` and `lodestone-packed` at the public Git pin
`ba67b28a463b63c65e9dbe1120bd8205f1784cdd` and `lore` at
`c49390be048fa273ab47ff7d43bc4994ba7be8ce`. The workspace and detached consumer
manifests and lockfiles match the Core revision. The native host lock uses the dependency
versions from Core's CLI lock at that same revision.

## Related docs

- [Integration verification](../../docs/verification.md)

## Notes

The inventory excludes Core documentation, tooling, Git history, executables, profiles,
owner files, and build output. The historical export records the Lodestone source and license
used by earlier packages. [Lodestone provenance](../lodestone/SOURCE-PROVENANCE.md)
