#!/usr/bin/env bash
# Build a reproducible host on its native runner without reading a tracked executable.
set -euo pipefail

target="$1"
source_root="$(pwd -P)"
scratch="${RUNNER_TEMP:?}/reliquary-bundled-build"
output="${RUNNER_TEMP}/reliquary-bundled-host"
test "$(git rev-parse HEAD)" = "${GITHUB_SHA:?}"
test "$(rustc -vV | sed -n 's/^host: //p')" = "$target"
test "$(rustc -vV | sed -n 's/^release: //p')" = 1.100.0
mkdir "$scratch" "$output"

# Use the same fresh target path and build inputs in separate seed and verify runs.
# Vergen build scripts otherwise inject a timestamp into dependencies.
export CARGO_TARGET_DIR="$scratch/target"
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
export CARGO_INCREMENTAL=0
export SOURCE_DATE_EPOCH=1704067200
export VERGEN_IDEMPOTENT=1

rustc -vV
cargo --version
if [[ "$RUNNER_OS" == macOS ]]; then
    export DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer
    export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
    export CC="$(xcrun --sdk macosx --find clang)"
    export CXX="$(xcrun --sdk macosx --find clang++)"
    xcodebuild -version
    xcrun --sdk macosx --show-sdk-version
    sw_vers
else
    export CC=/usr/bin/gcc-11
    export CXX=/usr/bin/g++-11
    ld --version
    getconf GNU_LIBC_VERSION
fi
"$CC" --version

export RUSTFLAGS="-C linker=$CC --remap-path-prefix=$source_root=/reliquary/source --remap-path-prefix=$scratch=/reliquary/build"
export CFLAGS="-ffile-prefix-map=$source_root=/reliquary/source -ffile-prefix-map=$scratch=/reliquary/build"
export CXXFLAGS="$CFLAGS"
cargo build --manifest-path host/Cargo.toml --locked --release --target "$target" -j 2
host="$output/reliquary-hermes-host"
install -m 0755 "$CARGO_TARGET_DIR/$target/release/reliquary-hermes-host" "$host"
if [[ "$RUNNER_OS" == macOS ]]; then
    codesign --force --sign - --timestamp=none --identifier reliquary-hermes-host "$host"
    codesign --verify --strict "$host"
fi
file "$host"
shasum -a 256 "$host"
