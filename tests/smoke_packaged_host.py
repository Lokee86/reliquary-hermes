"""Open a synthetic native pair and restart the installed host after a REL write."""

import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import secrets
import sys

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "src"))

from reliquary_hermes.client import HostClient
from reliquary_hermes.settings import profile_home, read_settings
from reliquary_hermes.setup import _candidate, _defaults, _preflight
from reliquary_hermes.validation import canonical


SESSION = "packaged-host-smoke"
BODY = "Synthetic REL Memory for the packaged host smoke test."


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@contextmanager
def running_host(settings, token):
    host = HostClient(
        settings.state_dir, settings.profile_id, settings.principal_id, token,
        binary=settings.binary,
    )
    try:
        binding = host.attach(SESSION)
        assert host._process is not None and host._process.poll() is None
        discovery = json.loads((settings.state_dir / "discovery.json").read_bytes())
        yield host, binding, discovery["instance_id"]
    finally:
        host.cancel_startup()


def dashboard(host, settings, binding, owner, operation, arguments, *, write_key=None):
    request = {
        "protocol_version": 1,
        "request_id": operation.replace(".", "-"),
        "operation": operation,
        "profile_id": settings.profile_id,
        "principal_id": binding.user_id,
        "session_id": None,
        "owner_id": owner["owner_id"],
        "generation": owner["generation"],
        "cut": owner["cut"],
        "expected_revision": None,
        "idempotency_key": write_key,
        "arguments": arguments,
    }
    response = host.read_dashboard_request(
        request, None, same_origin=write_key is not None
    )["response"]
    assert response["status"] == "ok", (operation, response["status"])
    return response["result"]


def owner_rows(host, binding, expected):
    assert (binding.rel_id, binding.user_id) == (expected["REL"], expected["PHY"])
    rows = {row["owner_kind"]: row for row in host.read_dashboard_topology(SESSION)["owners"]}
    assert {kind: row["owner_id"] for kind, row in rows.items()} == expected
    assert rows["REL"]["capabilities"]["memory_create"]
    assert not rows["PHY"]["capabilities"]["memory_create"]
    return rows


def smoke(home):
    assert PACKAGE == home / "plugins" / "reliquary", "expected the extracted plugin in this profile"
    state = home / "reliquary"
    state.mkdir()

    fixtures = json.loads((PACKAGE / "tests" / "support" / "packaged-owner-pair.json").read_bytes())
    paths = {"REL": state / "archive.rel", "PHY": state / "private.phy"}
    expected = {kind: fixtures[kind]["owner_id"] for kind in paths}
    starting_hashes = {kind: fixtures[kind]["sha256"] for kind in paths}
    for kind, path in paths.items():
        with path.open("xb") as output:
            output.write(base64.b64decode(fixtures[kind]["base64"], validate=True))
        assert file_hash(path) == starting_hashes[kind]

    prior, binary, defaults = _defaults(home)
    assert binary.is_relative_to(PACKAGE / "host") and binary.is_file(), "packaged host was not discovered"
    request = _candidate(home, {
        "main_rel": str(paths["REL"]), "active_phy": str(paths["PHY"]),
    }, prior, defaults)
    report = _preflight(home, binary, request)
    assert report["valid"], "Setup could not open the synthetic owner pair"
    assert report["main_rel"]["owner_id"] == expected["REL"]
    assert report["active_phy"]["owner_id"] == expected["PHY"]
    assert {kind: file_hash(path) for kind, path in paths.items()} == starting_hashes

    (state / "owners.json").write_bytes(canonical(request["owners"]))
    (state / "provider.json").write_bytes(canonical({"binary": str(binary)}))
    settings = read_settings(home)
    token = secrets.token_hex(32)
    retained = fixtures["retained_phy_memory"]
    with running_host(settings, token) as (host, binding, first_instance):
        owners = owner_rows(host, binding, expected)
        private = dashboard(host, settings, binding, owners["PHY"], "ui.memory_detail", {
            "memory_id": retained["memory_id"], "revision": retained["revision"],
        })
        assert private["memory"]["memory_id"] == retained["memory_id"]
        assert private["memory"]["revision"] == retained["revision"]
        assert private["body"]["content"] == retained["content"]

        written = dashboard(host, settings, binding, owners["REL"], "ui.memory_create", {
            "title": "Packaged host smoke test", "body": BODY,
            "category": "fact", "memory_type": "semantic",
        }, write_key="packaged-host-write")
        assert written["changed"]
        committed = written["committed"]
        assert committed["body"]["content"] == BODY

    with running_host(settings, token) as (host, binding, second_instance):
        assert second_instance != first_instance
        owners = owner_rows(host, binding, expected)
        memory = committed["memory"]
        reopened = dashboard(host, settings, binding, owners["REL"], "ui.memory_detail", {
            "memory_id": memory["memory_id"], "revision": None,
        })
        assert reopened["memory"]["memory_id"] == memory["memory_id"]
        assert reopened["memory"]["revision"] == memory["revision"]
        assert reopened["body"]["body_id"] == committed["body"]["body_id"]
        assert reopened["body"]["content"] == BODY

    assert file_hash(paths["REL"]) != starting_hashes["REL"]
    assert file_hash(paths["PHY"]) == starting_hashes["PHY"]
    print("Packaged host opened both owners, read a retained PHY revision, and reopened a REL write")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path, help="absolute path to the disposable Hermes profile")
    smoke(profile_home(parser.parse_args().profile))
