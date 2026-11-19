# Vendored Root source

## Purpose

This directory is a source-only snapshot of Reliquary Core at
`0cb1c37630f456b5f0cb2abd9b98c1ca4a36ad41` (Allow trusted hosts to detach a read-only PHY). The host depends on the public `reliquary-memory` API.

## Overview

This revision supplies trusted read-only PHY detach for live owner switching.
It includes the active-Memory Leiden recompute and durable REL dependency support. It carries forward the prior snapshot's partial Community
decode and exact-cut graph projection, plus the already integrated hosted
inference and authorized active-vector changes.

The application, owner-session, and vector-store manifests resolve
`lodestone-packed` through the approved local
`vendor/lodestone/crates/packed` source subset. The vendored workspace and
detached consumer lockfiles omit the Git source field for that package.
The workspace, consumer, and host lockfiles add `leiden-rs` 0.8.1 and retain their
existing dependency pins. See [Lodestone provenance](../lodestone/SOURCE-PROVENANCE.md).

The snapshot contains the Root Cargo workspace manifests and lockfile, Rust
sources and tests, the referenced G4 JSON test fixture, and the packaged
`quinn-proto` source. It preserves the existing Apache-2.0 and MIT license
files. Its inventory excludes Git history, Root documentation and tooling,
build output, executables, profile configuration, credentials, and REL/PHY
owner files.

## Related docs

- [Integration installation and disclosures](../../README.md)
- [Verification](../../docs/verification.md)

## Notes

The Root source repository at this revision has no top-level license file. The
existing third-party license files remain alongside their sources.
