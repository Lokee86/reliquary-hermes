"""Read-side acceptance against the real dashboard, with independently seeded expectations."""

MEMORY_IDENTITY = ("memory_id", "revision", "body_id", "title", "category", "memory_type")
MEMORY_FILTERS = {
    "query": "",
    "category": None,
    "memory_type": None,
    "lifecycle": None,
    "community_id": None,
}


def _items(client, operation, arguments, *, page_key=None, first_page=None, owner_id=None):
    items, seen = [], set()
    cursor, page = None, first_page
    while True:
        if page is None:
            result = client.read(operation, {**arguments, "cursor": cursor}, owner_id=owner_id)["result"]
            page = result if page_key is None else result[page_key]
        items.extend(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            return items
        assert cursor not in seen, f"{operation} repeated a cursor"
        seen.add(cursor)
        page = None


def _by_title(items, title):
    matches = [item for item in items if item["title"] == title]
    assert len(matches) == 1, f"expected one Memory titled {title!r}, found {len(matches)}"
    return matches[0]


def _assert_fields(actual, expected):
    for key, value in expected.items():
        assert actual[key] == value, f"{key} differs from the seeded value"


def _seed_memory(memories, expected):
    memory = _by_title(memories, expected["title"])
    _assert_fields(memory, {key: expected[key] for key in MEMORY_IDENTITY})
    return memory


def _check_memory(client, memory, expected):
    memory_id, revision, body_id = memory["memory_id"], memory["revision"], memory["body_id"]
    assert memory["lifecycle"] == "active"
    assert body_id is not None

    latest = client.read("ui.memory_detail", {"memory_id": memory_id, "revision": None})["result"]
    exact = client.read("ui.memory_detail", {"memory_id": memory_id, "revision": revision})["result"]
    assert latest == exact
    _assert_fields(exact["memory"], {key: memory[key] for key in MEMORY_IDENTITY})
    assert exact["memory"]["lifecycle"] == "active"
    assert not exact["tombstone"]
    assert exact["superseded_by"] is None
    assert exact["body"] == {
        "revision": revision, "body_id": body_id,
        "availability": "available", "content": expected["body"],
    }

    history = _items(client, "ui.memory_history", {"memory_id": memory_id, "limit": 1}, page_key="revisions")
    revisions = {entry["revision"]: entry for entry in history}
    assert len(revisions) == len(history), "history repeated a revision across pages"
    assert revision in exact["retained_revisions"]
    _assert_fields(revisions[revision], {
        "body_id": body_id, "availability": "available", "created_at_ms": expected["created_at_ms"],
    })

    provenance = client.read("ui.provenance", {"memory_id": memory_id, "revision": revision})["result"]
    assert provenance["sources"] == exact["provenance"]
    sources = [source for source in provenance["sources"] if source["kind"] == "hermes_snapshot"]
    assert any(all(source[key] == value for key, value in expected["source"].items()) for source in sources), (
        "copied Memory did not return the authorized source identity and digest with a null quote span"
    )


def check_community(client, expected):
    """Check the published partition in a separately provided synthetic owner."""
    community_id = expected["community_id"]
    communities = _items(client, "ui.community_list", {"limit": 1}, page_key="communities")
    by_id = {item["community_id"]: item for item in communities}
    assert len(by_id) == len(communities), "community list repeated an ID across pages"
    community = by_id[community_id]
    _assert_fields(community, {key: expected[key] for key in ("community_id", "generation", "name", "name_origin")})
    members = _items(
        client, "ui.community_members",
        {"community_id": community_id, "expected_generation": community["generation"], "limit": 1},
        page_key="members",
    )
    assert len(set(members)) == len(members) == int(community["member_count"])
    assert set(members) == set(expected["members"])
    return community


def _check_graph(client, copied, companion, expected):
    arguments = {
        "seed_ids": [], "community_id": None, "depth": 1,
        "node_limit": 16, "edge_limit": 16, "cursor": None,
    }
    graph = client.read("ui.graph_page", arguments)["result"]
    node_ids = {node["memory_id"]: node["node_id"] for node in graph["nodes"] if node["kind"] == "memory"}
    seed_nodes = [node_ids[copied["memory_id"]], node_ids[companion["memory_id"]]]
    expected_endpoints = set(seed_nodes)
    edges = [
        edge for edge in graph["edges"]
        if edge["active"] and edge["origin"] == expected["origin"] and edge["kind"].lower() == expected["kind"]
        and {edge["source_id"], edge["target_id"]} == expected_endpoints
    ]
    assert edges, "seeded topical edge did not connect the expected Memory nodes"

    expanded = client.read("ui.graph_page", {**arguments, "seed_ids": seed_nodes})["result"]
    assert expected_endpoints <= {node["node_id"] for node in expanded["nodes"]}
    assert {edge["edge_id"] for edge in edges} <= {edge["edge_id"] for edge in expanded["edges"]}
    bounded = client.read("ui.graph_page", {**arguments, "node_limit": 1, "edge_limit": 1})["result"]
    assert len(bounded["nodes"]) == 1 and not bounded["edges"]
    assert bounded["truncated"]


def _check_archived_provenance(client, seed):
    owner_id = seed["project_owner_id"]
    memories = _items(
        client, "ui.memory_list", {"limit": 128, "filters": MEMORY_FILTERS}, owner_id=owner_id,
    )
    archived = _seed_memory(memories, seed["archived_memory"])
    assert archived["lifecycle"] == "active", "source tombstone altered the retained Memory"
    provenance = client.read(
        "ui.provenance", {"memory_id": archived["memory_id"], "revision": archived["revision"]}, owner_id=owner_id,
    )["result"]
    assert provenance["sources"]
    assert all(source["kind"] == "source_unavailable" for source in provenance["sources"])


def run_read_checks(client, seed):
    """Check live reads against the prepared fixture before any dashboard mutation."""
    required = ("view", "history", "provenance", "graph", "community", "status")
    capabilities = client.binding()["capabilities"]
    missing = [capability for capability in required if not capabilities[capability]]
    assert not missing, f"HU03 main REL is missing live read capabilities {missing}"

    general_scope = {"session_id": seed["general_session_id"]}
    project_scope = {"owner_id": seed["project_owner_id"], "session_id": seed["project_session_id"]}
    general = client.read("ui.operational_status", {}, **general_scope)
    project = client.read("ui.operational_status", {}, **project_scope)
    _assert_fields(general["result"], seed["operational"]["general"])
    _assert_fields(project["result"], seed["operational"]["project"])
    assert general["result"]["source_state"] == "active"
    assert general["result"]["accepted_source_cursor"] is not None
    assert general["result"]["last_completed_receipt"] is not None
    assert project["result"]["source_state"] == "tombstoned"
    assert general["result"]["latest_recall"]["state"] == project["result"]["latest_recall"]["state"] == "none"

    arguments = {"cursor": None, "limit": 1, "filters": MEMORY_FILTERS}
    first = client.read("ui.memory_list", arguments)
    cursor = first["result"]["next_cursor"]
    assert cursor is not None, "seeded Memories did not span the requested page size"
    client.read(
        "ui.memory_list", {**arguments, "cursor": cursor, "filters": {**MEMORY_FILTERS, "lifecycle": "active"}},
        status="stale_cursor",
    )
    memories = _items(client, "ui.memory_list", arguments, first_page=first["result"])
    summaries = {item["memory_id"]: item for item in memories}
    assert len(summaries) == len(memories), "Memory list repeated an ID across pages"
    copied = _seed_memory(memories, seed["copied_memory"])
    companion = _seed_memory(memories, seed["companion_memory"])
    filters = {key: copied[key] for key in ("category", "memory_type", "lifecycle")}
    filtered = _items(client, "ui.memory_list", {"limit": 1, "filters": {**MEMORY_FILTERS, **filters}})
    assert {item["memory_id"] for item in filtered} == {
        item["memory_id"] for item in memories if all(item[key] == value for key, value in filters.items())
    }
    searched = _items(
        client, "ui.memory_list",
        {"limit": 1, "filters": {**MEMORY_FILTERS, "query": seed["copied_memory"]["title"]}},
    )
    assert [item["memory_id"] for item in searched] == [copied["memory_id"]]

    _check_memory(client, copied, seed["copied_memory"])
    _check_graph(client, copied, companion, seed["graph"])
    client.read("ui.community_list", {"cursor": None, "limit": 1}, status="unavailable")
    _check_archived_provenance(client, seed)

    # Inspection must leave the owner binding, reported Freshness and recall status unchanged.
    after = client.read("ui.memory_list", {"cursor": None, "limit": 128, "filters": MEMORY_FILTERS})
    assert after["binding"] == first["binding"]
    assert {item["memory_id"]: item for item in after["result"]["items"]} == summaries
    assert client.read("ui.operational_status", {}, **general_scope)["result"] == general["result"]
    assert client.read("ui.operational_status", {}, **project_scope)["result"] == project["result"]
