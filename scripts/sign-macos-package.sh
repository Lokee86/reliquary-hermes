#!/usr/bin/env bash
set -euo pipefail

# Sign the actual host and submit the exact ZIP that will be tested and released.
plugin=$1
archive=$2
: "${MACOS_CERTIFICATE_P12_BASE64:?Missing Mac Developer ID certificate}"
: "${MACOS_CERTIFICATE_PASSWORD:?Missing Mac certificate password}"
: "${APPLE_NOTARY_KEY_P8_BASE64:?Missing Apple notary API key}"
: "${APPLE_NOTARY_KEY_ID:?Missing Apple notary key ID}"
: "${APPLE_NOTARY_ISSUER_ID:?Missing Apple notary issuer ID}"

umask 077
signing_dir="$(mktemp -d "$TMPDIR/signing.XXXXXX")"
keychain="$signing_dir/release.keychain-db"
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -f "$signing_dir/identity.p12" "$signing_dir/notary.p8" "$signing_dir/notary.json"
  rmdir "$signing_dir" 2>/dev/null || true
}
trap cleanup EXIT

keychain_password="$(openssl rand -hex 24)"
printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 -D > "$signing_dir/identity.p12"
printf '%s' "$APPLE_NOTARY_KEY_P8_BASE64" | base64 -D > "$signing_dir/notary.p8"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing_dir/identity.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null

identity="$(security find-identity -v -p codesigning "$keychain" | awk '/"Developer ID Application:/ { print $2 }')"
if [[ ! "$identity" =~ ^[[:xdigit:]]{40}$ ]]; then
  echo "Expected exactly one usable Developer ID Application identity" >&2
  exit 1
fi
host="$plugin/host/reliquary-hermes-host"
codesign --force --options runtime --timestamp --sign "$identity" --keychain "$keychain" "$host"
codesign --verify --strict "$host"
ditto -c -k --keepParent "$plugin" "$archive"
xcrun notarytool submit "$archive" --key "$signing_dir/notary.p8" \
  --key-id "$APPLE_NOTARY_KEY_ID" --issuer "$APPLE_NOTARY_ISSUER_ID" --wait --output-format json \
  > "$signing_dir/notary.json"
python3 - "$signing_dir/notary.json" <<'PY'
import json
from pathlib import Path
import sys

result = json.loads(Path(sys.argv[1]).read_text())
print("Apple notarization:", result["status"], result["id"])
if result["status"] != "Accepted":
    raise SystemExit(1)
PY
