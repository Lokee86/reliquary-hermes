"""Use stock Hermes to install and re-pin Reliquary on a native CI runner."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import sys


SOURCE_RELEASE = "0ad300940c0d6d77d39ad0078ab0a8674dd421b5"
TARGETS = ("linux-x86_64", "linux-arm64", "macos-x86_64", "macos-arm64")
HOST = "reliquary-hermes-host"
HOST_PATHS = {f"host/bundled/{target}/{HOST}" for target in TARGETS}
SMOKE = "tests/smoke_packaged_host.py"


def select_catalog_pin(profile, repo, pin, *, bundled=True):
    entry = {
        "name": "reliquary",
        "description": "Reliquary native catalog acceptance",
        "repo": repo,
        "sha": pin,
        "version": "0.3.2" if bundled else "0.3.0",
        "tier": "community",
        "category": "memory",
        "platforms": ["linux", "macos"],
        "requires_hermes": ">=0.23.0",
        "attested_binaries": sorted(HOST_PATHS) if bundled else [],
    }
    cache = profile / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": [entry],
        "removed": [],
    }
    (cache / "plugin-catalog.json").write_text(json.dumps(snapshot), encoding="utf-8")
    results = json.loads(hermes("search", "reliquary", "--json", capture_stdout=True))["results"]
    selected = next((result for result in results if result["name"] == "reliquary"), {})
    assert (selected.get("repo"), selected.get("sha"), selected.get("platforms")) == (
        repo, pin, entry["platforms"],
    ), f"stock CLI selected a different catalog entry: {selected.get('repo')} @ {selected.get('sha')}"
    print(f"Stock Hermes resolved the fixture catalog pin {pin}.", flush=True)


def hermes(*arguments, capture_stdout=False):
    return subprocess.run(
        [sys.executable, "-B", "-m", "hermes_cli.main", "plugins", *arguments],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if capture_stdout else None,
        check=True, timeout=360,
    ).stdout


def git_paths(plugin, *args):
    result = subprocess.check_output(["git", "-C", str(plugin), *args], text=True, timeout=60)
    return set(result.splitlines())


def check_pin(plugin, pin):
    assert git_paths(plugin, "rev-parse", "HEAD") == {pin}, "stock Hermes installed a different source pin"
    path = plugin.parent / ".install-metadata.json"
    record = json.loads(path.read_text(encoding="utf-8"))["reliquary"]
    assert record["revision"] == pin and record["catalog"]["pin"] == pin, "catalog provenance was not recorded"


def check_hosts(plugin, expected):
    present = {path.relative_to(plugin).as_posix() for path in (plugin / "host" / "bundled").glob(f"*/{HOST}")}
    assert present == expected, (present, expected)
    assert all(
        not (plugin / path).is_symlink() and (plugin / path).is_file() and os.access(plugin / path, os.X_OK)
        for path in expected
    ), "a shipped host was not a regular executable"


def disk_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_preserved_memory(profile, plugin, expected_host):
    smoke = runpy.run_path(str(plugin / SMOKE))
    settings = smoke["read_settings"](profile)
    assert settings.binary == plugin / expected_host, "saved setup did not resolve the restored host"
    pair = json.loads((plugin / "tests" / "support" / "packaged-owner-pair.json").read_text(encoding="utf-8"))
    owner_ids = {kind: pair[kind]["owner_id"] for kind in ("REL", "PHY")}
    with smoke["running_host"](settings, secrets.token_hex(32)) as (host, binding, _instance):
        owners = smoke["owner_rows"](host, binding, owner_ids)
        read = smoke["dashboard"]
        page = read(host, settings, binding, owners["REL"], "ui.memory_list", {
            "cursor": None,
            "limit": 128,
            "filters": {"query": "", "category": None, "memory_type": None, "lifecycle": None, "community_id": None},
        })
        memory, = (item for item in page["items"] if item["title"] == "Packaged host smoke test")
        detail = read(host, settings, binding, owners["REL"], "ui.memory_detail", {
            "memory_id": memory["memory_id"], "revision": memory["revision"],
        })
        assert detail["body"]["content"] == smoke["BODY"], "re-pinning lost the previous REL write"


def smoke_repin(profile, plugin, repo, pin, expected_host):
    assert git_paths(plugin, "ls-files", "--deleted", "--", "host/bundled") == HOST_PATHS - {expected_host}, (
        "the source of the update was not a stock owned checkout with three tracked hosts pruned"
    )
    user_file = plugin / "catalog-smoke-note.txt"
    user_file.write_text("Profile-owned catalog smoke note\n", encoding="utf-8")
    saved = [profile / "reliquary" / item for item in ("owners.json", "provider.json", "archive.rel", "private.phy")]
    digests = {path: disk_digest(path) for path in [*saved, user_file]}
    host_digest = disk_digest(plugin / expected_host)

    # Move off the pruned checkout and back using two real published pins. The
    # source-only v0.3.0 checkout is a transient fixture and is never activated.
    select_catalog_pin(profile, repo, SOURCE_RELEASE, bundled=False)
    hermes("update", "reliquary")
    check_pin(plugin, SOURCE_RELEASE)
    check_hosts(plugin, set())
    assert {path: disk_digest(path) for path in digests} == digests, "the outgoing re-pin changed user data"

    select_catalog_pin(profile, repo, pin)
    hermes("update", "reliquary")
    check_pin(plugin, pin)
    check_hosts(plugin, HOST_PATHS)
    assert {path: disk_digest(path) for path in digests} == digests, "the returning re-pin changed user data"
    assert disk_digest(plugin / expected_host) == host_digest, "the returning re-pin restored different host bytes"
    read_preserved_memory(profile, plugin, expected_host)
    check_hosts(plugin, {expected_host})
    print("Stock Hermes re-pinned the pruned checkout, preserved settings and both owners, and pruned again.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo")
    parser.add_argument("pin")
    parser.add_argument("target", choices=TARGETS)
    parser.add_argument("profile", type=Path)
    args = parser.parse_args()
    profile = args.profile.resolve()
    profile.mkdir()
    os.environ["HERMES_HOME"] = str(profile)

    # Keep the background default-plugin installer out of this explicit install.
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
    # Stock Hermes clears catalog caches during its first boot for a new
    # installation revision. Let the disposable profile finish that boot first.
    hermes("list", "--user", "--json", capture_stdout=True)
    select_catalog_pin(profile, args.repo, args.pin)
    hermes("install", "reliquary", "--no-enable", "--yes-deps")
    plugin = profile / "plugins" / "reliquary"
    expected_host = f"host/bundled/{args.target}/{HOST}"
    check_pin(plugin, args.pin)
    check_hosts(plugin, HOST_PATHS)
    subprocess.run([sys.executable, "-B", str(plugin / SMOKE), str(profile)], check=True, timeout=120)
    check_hosts(plugin, {expected_host})
    print(f"Stock Hermes installed four hosts and retained only {args.target} after authenticated startup.", flush=True)
    if args.target == "linux-x86_64":
        smoke_repin(profile, plugin, args.repo, args.pin, expected_host)


if __name__ == "__main__":
    main()
