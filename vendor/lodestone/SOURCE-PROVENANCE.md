# Vendored Lodestone source

## Purpose

This directory contains the minimum source subset required by Reliquary's vector-store dependency on `lodestone-packed`. It is derived from upstream Lodestone commit `7b4b3e02b2bd3f3e474fef1a31c8632f8bbea49f` at <https://github.com/Lokee86/lodestone>. The source is licensed under Apache-2.0; the upstream `LICENSE.md` is included.

## Overview

The export contains the workspace manifest fields inherited by `lodestone-packed`, the complete package manifest and implementation, and the upstream license. The workspace member list is narrowed to `crates/packed`. Reliquary's vector-store manifest points to this local package. These are packaging changes; the package files and license retain their upstream contents. No other Lodestone crates, tests, documentation, generated artifacts, or Git history are included. The package has no nested Git dependencies.

| Upstream file at the pinned commit | Bytes | SHA-256 |
| --- | ---: | --- |
| `Cargo.toml` | 377 | `056fc7fbef5320720a8752bc55870384b287d132720351bc0316d9639a2f4bf0` |
| `crates/packed/Cargo.toml` | 141 | `533fa00984cb16bf929597890697e31833ddf7fa64442ea2993325a7e35e3bcb` |
| `crates/packed/src/lib.rs` | 4,912 | `456bbf7fd3da70abbb6a3e32fae9645eecbe147661f277b165973b88778f1551` |
| `LICENSE.md` | 10,727 | `1015d002785f71e789c2c4e9efe59503c6a477580c6f7e8e080654cc426724ca` |

The four upstream files total 16,157 bytes. The Cargo.toml member list was narrowed for packaging; its upstream hash above is for the original manifest before that edit. The other three files were verified byte-for-byte against the pinned Git commit.

## Related docs

- [Integration installation and disclosures](../../README.md)
- [Verification](../../docs/verification.md)

## Notes

The pinned Lodestone source and its license remain unmodified. The Root snapshot's source provenance is documented in [vendor/reliquary](../reliquary/SOURCE-PROVENANCE.md).
