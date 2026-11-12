# Vendored Root source

## Purpose

This directory is a source-only snapshot of the Reliquary Root repository at
`dca06ffa9933f8a6105036b05814cabbbccb17ef` (`Restore partial community decoding
for Hermes graph rendering`), with the narrow hosted inference changes listed
below. The host depends on the public `reliquary-memory` API.

## Overview

The hosted inference seam and authorized active-vector inspection are applied
from Root commits `2941cd86d3b66ee6ad83018d77b65f1cb99f928b`,
`10863a84be0230fc5550f9b07d161f3ac9510861`,
`e176c8399c0cd309f0302ab7ac55b9286da72801`, and
`0b0838933eb4d45ce8a40bb1fd2794809ff62d9f`. Only their `src/` and `crates/`
changes are included. These changes add no storage schema or provider dependency.
They preserve standalone configured inference. The preexisting graph snapshot
and approved dependency packaging remain the distribution baseline.

Packaging changes replace the vector-store's private Lodestone Git reference with
the approved local `vendor/lodestone/crates/packed` source subset. The corresponding
Lodestone Git source entries are removed from the Root and host lockfiles; other
dependency versions retain their pins. See [Lodestone provenance](../lodestone/SOURCE-PROVENANCE.md).

The application and owner-session development dependencies also use that same
local subset, so the vendored Switchboard tests run with `--locked --offline`.
This corrects the source package's remaining development-only Git references;
the lockfiles and the approved Lodestone source are unchanged.

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
