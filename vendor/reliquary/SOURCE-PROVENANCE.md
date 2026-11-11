# Vendored Root source

## Purpose

This directory is a source-only snapshot of the Reliquary Root repository at
`dca06ffa9933f8a6105036b05814cabbbccb17ef` (`Restore partial community decoding
for Hermes graph rendering`). The host depends on the public `reliquary-memory`
API and this exact revision is the one recorded by the integration's installed
host acceptance.

## Overview

The snapshot contains the Root Cargo workspace manifests and lockfile, Rust
sources (including test modules), the Rust workspace crate manifests and sources,
the referenced G4 JSON test fixture, and the patched `quinn-proto` source. It
preserves the vendored package's existing Apache-2.0 and MIT license files. It
omits Git history, Root documentation and tooling, generated build output,
executables, profile configuration, credentials, and REL/PHY owner files.

## Related docs

- [Integration installation and disclosures](../../README.md)
- [Verification](../../docs/verification.md)

## Notes

The Root source repository at this revision has no top-level license file. This
provenance record does not grant an additional license. The existing third-party
license files remain alongside their sources.
