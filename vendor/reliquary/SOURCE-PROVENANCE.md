# Vendored Root source

## Purpose

This source-only snapshot pins Reliquary Core at `5e530a99b7087a03bcfa0fd519950e6f5ecea6d4`.
The Hermes host uses the public `reliquary-memory` API for leased owner mounts.
Core restores verified REL checkpoints, replays recent writes, and reads older history on demand.
This revision includes same-REL Perception, hosted native decision binding, and typed Observation recall through shared hybrid retrieval, durable source deletion and rewind, Ego package and controls, and paged initial auditing. The active PHY supports native verified claims, retained history and joint ordinary recall with REL owners. Automatic copied-source staging seals the original PHY, preserves trusted per-turn attribution through routed Insomnia publication, and settles the personal Memories for ordinary recall.

## Overview

The snapshot contains 863 files from the pinned Core revision. It includes the Cargo workspace and lock,
Rust sources and tests, the referenced G4 fixture, the MPL 2.0 license, and the pinned Quinn source and licenses.

Cargo resolves `lodestone-core` and `lodestone-packed` at the public Git pin
`ba67b28a463b63c65e9dbe1120bd8205f1784cdd` and `lore` at
`c49390be048fa273ab47ff7d43bc4994ba7be8ce`. The workspace and detached consumer
manifests and lockfiles match the Core revision. The detached host lock is resolved against
this source snapshot.

The pinned Core release's `quinn-proto` 0.11.13 carries the upstream fix for `GHSA-4w2j-m93h-cj5j`. The patch keeps the version required by Lore. [Upstream Quinn fix](https://github.com/quinn-rs/quinn/commit/fed0321a9a672819662caab37f5662f1ad91308e)

## Related docs

- [Integration verification](../../docs/verification.md)

## Notes

The inventory excludes Core documentation, tooling, Git history, executables, profiles,
owner files, and build output. The historical export records the Lodestone source and license
used by earlier packages. [Lodestone provenance](../lodestone/SOURCE-PROVENANCE.md)
