"""Acceptance against a pinned Hermes dashboard and signed Reliquary processes."""

from contextlib import ExitStack
import os
from pathlib import Path
from shutil import copyfile

import pytest

from hu04_harness import start_dashboard, start_profile
from hu04_read_checks import MEMORY_FILTERS, check_community, run_read_checks
from hu04_write_checks import run_community_write_check, run_write_checks
from reliquary_hermes.ui_schema import MUTATIONS, OP_CAPABILITY
from reliquary_hermes.validation import decode
from test_hp03_host import binaries
from test_hp04_host import _cli


FULL_GATE = os.environ.get("HU04_LIVE_ACCEPTANCE") == "1"
MUTATION_CAPABILITIES = {"manage"} | {OP_CAPABILITY[op] for op in MUTATIONS}


def _community_input(cli, scratch):
    value = os.environ.get("HU04_COMMUNITY_REL")
    assert value, "Set HU04_COMMUNITY_REL to a synthetic REL with a current accepted community partition"
    snapshot = Path(value).resolve()
    manifest = snapshot.with_suffix(".json")
    assert snapshot.suffix.lower() == ".rel" and snapshot.is_file() and manifest.is_file(), (
        "Supply a synthetic .rel and its same-stem .json community expectation manifest"
    )
    expected = decode(manifest.read_bytes())
    assert set(expected) == {"community_id", "generation", "name", "name_origin", "members"}
    assert isinstance(expected["members"], list)
    assert len(set(expected["members"])) == len(expected["members"]) >= 2
    # Corroborate the manifest against the public product read before starting the dashboard.
    local = scratch / "community-input.rel"
    copyfile(snapshot, local)
    page = _cli(cli, "rel", "community", "list", local)["page"]
    rows = [item["value"] for item in page["items"]]
    meta, = (row for row in rows if bytes(row["id"]).hex() == expected["community_id"])
    assert meta["current"] and str(meta["generation"]) == expected["generation"]
    assert (meta["name"], meta["name_origin"], meta["member_count"]) == (
        expected["name"], expected["name_origin"], len(expected["members"]),
    )
    return local, expected


@pytest.fixture
def runtime(tmp_path, request):
    required = ("HP01_HERMES_CHECKOUT", "HP03_HOST_BINARY", "HP03_RELIQUARY_CLI")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        message = "Set " + ", ".join(missing) + " for the HU04 process tests"
        if FULL_GATE:
            pytest.fail(message)
        pytest.skip(message)
    checkout = request.getfixturevalue("pinned_checkout")
    process_binaries = request.getfixturevalue("binaries")
    snapshot = expected = None
    if getattr(request, "param", None) == "community":
        snapshot, expected = _community_input(process_binaries[1], tmp_path)
    seed_main = None
    if FULL_GATE:
        from hu04_seed import seed_foreign_memory

        seed_main = seed_foreign_memory
    home = tmp_path / "hermes"
    with ExitStack() as cleanup:
        primary = start_profile(home, "primary", process_binaries, cleanup, project=True, project_snapshot=snapshot)
        foreign = start_profile(home / "profiles/secondary", "secondary", process_binaries, cleanup,
                                seed_main=seed_main)
        dashboard, secondary = start_dashboard(primary, foreign, checkout, tmp_path, cleanup)
        yield primary, foreign, dashboard, secondary, checkout, process_binaries, cleanup, expected


def test_hu04_live_owner_and_session_enumeration(runtime):
    primary, foreign, dashboard, secondary, *_ = runtime
    dashboard.refresh()
    secondary.refresh()
    assert set(dashboard.bindings).isdisjoint(secondary.bindings)
    for client, profile in ((dashboard, primary), (secondary, foreign)):
        assert client.binding(profile.ids["main"])["owner_kind"] == "REL"
        phy = client.binding(profile.ids["phy"])
        assert phy["owner_kind"] == "PHY" and phy["capabilities"]["view"]
        assert all(not phy["capabilities"][name] for name in MUTATION_CAPABILITIES)
        active = client.topology(session_id=profile.general_session)
        assert active["active_session_id"] == profile.general_session
        assert active["session_owner_id"] == profile.ids["main"]
        default = client.topology()
        assert default["active_session_id"] is None and default["session_owner_id"] is None
        assert all(binding["capabilities"]["view"] for binding in default["owners"]["items"])

    project = dashboard.topology(session_id="session-project")
    assert project["session_owner_id"] == primary.ids["project"]
    assert dashboard.binding(primary.ids["project"])["owner_kind"] == "REL"

    first = dashboard.topology(limit=1)
    assert first["owners"]["truncated"] and first["owners"]["next_cursor"]
    cursor = first["owners"]["next_cursor"]
    dashboard.topology(limit=1, cursor=cursor, session_id="session-project", status="stale_cursor")
    secondary.topology(limit=1, cursor=cursor, status="stale_cursor")
    pages = first["owners"]["items"]
    seen = set()
    while cursor is not None:
        assert cursor not in seen, "owner enumeration repeated a cursor"
        seen.add(cursor)
        page = dashboard.topology(limit=1, cursor=cursor)["owners"]
        pages.extend(page["items"])
        cursor = page["next_cursor"]
    assert len(pages) == len(primary.ids)
    assert {row["owner_id"]: row for row in pages} == dashboard.bindings

    spoofed = dashboard.topology(browser_identity=("secondary", foreign.ids["phy"]))
    assert {row["owner_id"] for row in spoofed["owners"]["items"]} == set(primary.ids.values())
    assert spoofed["active_phy_id"] == primary.ids["phy"]
    dashboard.topology(session_id=foreign.general_session, status="denied")
    secondary.topology(session_id="session-project", status="denied")
    request = dashboard.request("ui.owner_sessions", {"cursor": None, "limit": 128})
    assert dashboard.send(request, authenticated=False)[0] == 401


def _verify_foreign_scope(primary, foreign, dashboard, secondary):
    before = dashboard.bindings.copy(), secondary.bindings.copy()
    filters = {"cursor": None, "limit": 1, "filters": MEMORY_FILTERS}
    create = {"title": "HU04 forbidden write", "body": "This body must never be committed.",
              "category": "fact", "memory_type": "project"}
    target = {"memory_id": foreign.seeded_memory_id, "revision": None}
    detail = secondary.read("ui.memory_detail", target)["result"]
    assert detail["memory"]["memory_id"] == foreign.seeded_memory_id
    dashboard.rejected(dashboard.request("ui.memory_detail", target, binding=secondary.binding(),
                                         browser_identity=("secondary", foreign.ids["phy"])))
    for client, other, other_session in (
        (dashboard, secondary, foreign.general_session),
        (secondary, dashboard, primary.general_session),
    ):
        identity = (other.profile_id, other.ids["phy"])
        client.rejected(client.request("ui.memory_list", filters, binding=other.binding(),
                                       browser_identity=identity))
        client.rejected(client.request("ui.operational_status", {}, binding=client.binding(),
                                       session_id=other_session, browser_identity=identity))
        client.rejected(client.request("ui.memory_create", create, binding=other.binding(),
                                       key="hu04-denied-foreign", browser_identity=identity))

    dashboard.rejected(dashboard.request("ui.operational_status", {}, binding=dashboard.binding(),
                                         session_id="session-project"))
    dashboard.rejected(dashboard.request("ui.memory_create", create,
                                         binding=dashboard.binding(primary.ids["phy"]), key="hu04-denied-phy"))
    dashboard.rejected(dashboard.request("ui.memory_create", create, binding=dashboard.binding(),
                                         key="hu04-denied-origin"), cross_origin=True)
    dashboard.refresh()
    secondary.refresh()
    assert (dashboard.bindings, secondary.bindings) == before


@pytest.mark.skipif(not FULL_GATE, reason="Set HU04_LIVE_ACCEPTANCE=1 when HU03 live operations are ready")
def test_hu04_live_reads_writes_and_restart(runtime):
    from hu04_seed import seed_profile

    primary, foreign, dashboard, secondary, checkout, process_binaries, cleanup, _ = runtime
    seed = seed_profile(primary.home, checkout, process_binaries, primary.client, cleanup)
    seed.update(project_owner_id=primary.ids["project"], phy_owner_id=primary.ids["phy"],
                general_session_id=primary.general_session, project_session_id="session-project")
    dashboard.refresh()
    expected = (set(OP_CAPABILITY.values()) | {"manage"}) - {"community_rename"}
    capabilities = dashboard.binding()["capabilities"]
    missing = sorted(name for name in expected if not capabilities[name])
    assert not missing, f"HU03 live API capabilities still missing: {', '.join(missing)}"

    phy = dashboard.read("ui.memory_list", {"cursor": None, "limit": 1, "filters": MEMORY_FILTERS},
                         owner_id=primary.ids["phy"])
    assert phy["binding"]["owner_kind"] == "PHY"
    assert phy["result"] == {"items": [], "next_cursor": None, "truncated": False}
    secondary.refresh()
    run_read_checks(dashboard, seed)
    _verify_foreign_scope(primary, foreign, dashboard, secondary)
    listing = {"cursor": None, "limit": 1, "filters": MEMORY_FILTERS}
    cursor = dashboard.read("ui.memory_list", listing)["result"]["next_cursor"]
    assert cursor is not None
    run_write_checks(dashboard, seed, primary.restart)
    dashboard.read("ui.memory_list", {**listing, "cursor": cursor}, status="stale_cursor")
    archived = dashboard.read("ui.operational_status", {}, owner_id=primary.ids["project"],
                              session_id="session-project")["result"]
    assert archived["source_state"] == "tombstoned"


@pytest.mark.skipif(not FULL_GATE, reason="Set HU04_LIVE_ACCEPTANCE=1 when HU03 live operations are ready")
@pytest.mark.parametrize("runtime", ["community"], indirect=True)
def test_hu04_live_community_members_rename_and_restart(runtime):
    primary, _, dashboard, _, _, _, _, expected = runtime
    dashboard.default_owner_id = primary.ids["project"]
    dashboard.refresh()
    capabilities = dashboard.binding()["capabilities"]
    assert all(capabilities[name] for name in ("community", "manage", "community_rename"))
    community = check_community(dashboard, expected)
    run_community_write_check(dashboard, community, primary.restart)
