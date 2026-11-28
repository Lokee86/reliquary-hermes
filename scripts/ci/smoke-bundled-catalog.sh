#!/usr/bin/env bash
# Exercise catalog installation using the published Hermes release.
set -euo pipefail

target=${1:?usage: smoke-bundled-catalog.sh TARGET}
project=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
checkout=$(git -C "$project" rev-parse HEAD)
: "${GITHUB_REPOSITORY:?the candidate must be reachable from its GitHub repository}"
test "$checkout" = "${GITHUB_SHA:-$checkout}"
pin=${CATALOG_PIN:-$checkout}
test "$pin" = "$(git -C "$project" rev-parse --verify "$pin^{commit}")"

scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/reliquary-stock-catalog.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT

stock="$scratch/hermes"
git init --quiet "$stock"
git -C "$stock" fetch --quiet --depth=1 --no-tags https://github.com/NousResearch/hermes-agent.git \
  refs/tags/v0.23.4:refs/tags/v0.23.4
git -C "$stock" checkout --quiet --detach refs/tags/v0.23.4
test "$(git -C "$stock" rev-parse HEAD)" = 8fc0374447313e276f6b9a2764bfc750190c966a

# Run the stock PM bootstrap with private action-output files.
cd "$stock"
export HERMES_RUNTIME_DIR="$scratch/pm/tools"
export UV_CACHE_DIR="$scratch/uv-cache"
export GIT_TERMINAL_PROMPT=0
export PYTHONDONTWRITEBYTECODE=1
GITHUB_OUTPUT="$scratch/tool-output" GITHUB_ENV="$scratch/tool-env" GITHUB_PATH="$scratch/tool-path" \
  python3 -S scripts/ci/setup_toolchain.py install --toolchain python --home "$scratch/pm"
tool_python=$(sed -n 's/^python-path=//p' "$scratch/tool-output")
GITHUB_OUTPUT="$scratch/runtime-output" GITHUB_ENV="$scratch/runtime-env" GITHUB_PATH="$scratch/runtime-path" \
  "$tool_python" -S scripts/ci/setup_toolchain.py dependencies --toolchain python --home "$scratch/pm" --extras '[]'
hermes_python=$(sed -n 's/^python-path=//p' "$scratch/runtime-output")

case "$target" in
  linux-x86_64)
    uv=$(sed -n 's/^uv-path=//p' "$scratch/tool-output")
    (
      cd "$project"
      PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$uv" run --isolated --no-project --with pytest==9.1.1 \
        --python "$tool_python" python -B -m pytest -q --basetemp "$scratch/pytest" tests/test_bundled_host.py
    )
    ;;
  macos-arm64)
    if /usr/bin/arch -x86_64 /usr/bin/true 2>/dev/null; then
      # Use the same locked Intel Python that stock Hermes installs on Intel Macs.
      read -r url digest <<< "$("$tool_python" -S - <<'PY'
import json
from pathlib import Path

artifact = json.loads(Path("pm/lock.json").read_text(encoding="utf-8"))["packages"]["python"]["artifacts"]["darwin-x64"]
print(artifact["url"], artifact["sha256"])
PY
      )"
      archive="$scratch/rosetta-python.tar.gz"
      curl --fail --silent --show-error --location "$url" --output "$archive"
      printf '%s  %s\n' "$digest" "$archive" | shasum -a 256 -c -
      mkdir "$scratch/rosetta"
      tar -xzf "$archive" -C "$scratch/rosetta"
      PYTHONPATH="$project/src" /usr/bin/arch -x86_64 "$scratch/rosetta/python/bin/python3" -B - <<'PY'
import platform
from reliquary_hermes.native_host import _target, _under_rosetta

assert platform.machine() == "x86_64" and _under_rosetta()
assert _target("Darwin") == "macos-arm64"
print("Rosetta translated Python selected the Apple Silicon host.")
PY
    else
      echo "Rosetta probe skipped because translation is unavailable on this runner."
    fi
    ;;
esac

PYTHONPATH="$stock" "$hermes_python" -B "$project/scripts/ci/smoke_bundled_catalog.py" \
  "https://github.com/$GITHUB_REPOSITORY" "$pin" "$target" "$scratch/profile"
