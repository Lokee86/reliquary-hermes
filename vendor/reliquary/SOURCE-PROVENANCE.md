# Vendored Root source

## Purpose

This source-only snapshot pins Reliquary Core at `91b6ea7081d4b5c2e7bf1eaab1145da345235abd`.
The Hermes host uses the public `reliquary-memory` API for leased owner mounts.
Core restores verified REL checkpoints, replays recent writes, and reads older history on demand.
This revision includes same-REL Perception, hosted native decision binding, and typed Observation recall through shared hybrid retrieval, and durable source deletion and rewind.

## Overview

The snapshot contains 813 Git-verified files. It includes the Cargo workspace and lock,
Rust sources and tests, the referenced G4 fixture, the MPL 2.0 license, and the pinned Quinn source and licenses.

Cargo resolves `lodestone-core` and `lodestone-packed` at the public Git pin
`ba67b28a463b63c65e9dbe1120bd8205f1784cdd` and `lore` at
`c49390be048fa273ab47ff7d43bc4994ba7be8ce`. The workspace and detached consumer
manifests and lockfiles match the Core revision. The detached host lock is resolved against
this source snapshot.

## Related docs

- [Integration verification](../../docs/verification.md)

## Notes

The inventory excludes Core documentation, tooling, Git history, executables, profiles,
owner files, and build output. The historical export records the Lodestone source and license
used by earlier packages. [Lodestone provenance](../lodestone/SOURCE-PROVENANCE.md)
