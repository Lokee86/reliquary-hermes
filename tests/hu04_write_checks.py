"""HU04 live dashboard mutation and restart assertions."""


def _changed(client, operation, arguments, *, key, revision=None):
    before = client.binding()
    accepted = client.mutate(operation, arguments, key=key, revision=revision, binding=before)
    assert accepted["result"]["changed"], operation
    assert accepted["binding"]["generation"] == before["generation"], operation
    assert accepted["binding"]["cut"] != before["cut"], operation
    client.refresh()
    assert client.binding() == accepted["binding"], operation
    return before, accepted


def _replay(client, accepted, arguments, before, *, revision=None):
    result = accepted["result"]
    current = client.binding()
    retry = client.mutate(
        accepted["operation"], arguments, key=result["idempotency_key"],
        revision=revision, binding=before,
    )
    for field in ("receipt_id", "idempotency_key", "changed", "committed"):
        assert retry["result"][field] == result[field], (accepted["operation"], field)
    client.refresh()
    assert client.binding() == current, accepted["operation"]


def _detail(client, memory_id, revision=None):
    return client.read("ui.memory_detail", {"memory_id": memory_id, "revision": revision})["result"]


def _authored(detail, arguments, principal):
    assert detail["memory"]["title"] == arguments["title"]
    assert detail["body"]["content"] == arguments["body"]
    assert detail["body"]["availability"] == "available"
    assert detail["body"]["body_id"] == detail["memory"]["body_id"]
    assert detail["body"]["revision"] == detail["memory"]["revision"]
    assert detail["memory"]["lifecycle"] == "active"
    assert not detail["tombstone"]
    assert detail["provenance"], detail["memory"]["memory_id"]
    assert all(source["kind"] == "user_origin" and source["principal_id"] == principal
               for source in detail["provenance"])


def _graph(client, *node_ids):
    graph = client.read("ui.graph_page", {
        "seed_ids": list(node_ids), "community_id": None, "depth": 1,
        "node_limit": 32, "edge_limit": 32, "cursor": None,
    })["result"]
    assert not graph["truncated"] and graph["next_cursor"] is None
    assert set(node_ids) <= {node["node_id"] for node in graph["nodes"]}
    return graph


def run_community_write_check(client, community, restart):
    """Rename a verified current community and replay the receipt after restart."""
    rename = {"community_id": community["community_id"], "name": "HU04 operator community"}
    before, accepted = _changed(
        client, "ui.community_rename", rename, key="hu04-community-rename",
        revision=community["generation"],
    )
    renamed = accepted["result"]["committed"]
    assert renamed["name_origin"] == "user"
    assert renamed["member_count"] == community["member_count"]

    restart()
    client.refresh()
    page = client.read("ui.community_list", {"cursor": None, "limit": 128})["result"]["communities"]
    assert not page["truncated"] and page["next_cursor"] is None
    persisted, = (row for row in page["items"] if row["community_id"] == community["community_id"])
    for field in ("generation", "member_count", "name", "name_origin"):
        assert persisted[field] == renamed[field], field
    _replay(client, accepted, rename, before, revision=community["generation"])


def _association(client, source, target):
    graph = _graph(client)
    nodes = {node["memory_id"]: node["node_id"] for node in graph["nodes"] if node["kind"] == "memory"}
    source_id = nodes[source["memory"]["memory_id"]]
    target_id = nodes[target["memory"]["memory_id"]]
    link = {
        "source_id": source_id, "target_id": target_id,
        "source_revision": source["memory"]["revision"], "target_revision": target["memory"]["revision"],
        "action": "link", "relation_kind": "user_association", "edge_id": None,
    }
    before = client.binding()
    stale = {**link, "target_revision": str(int(link["target_revision"]) + 1)}
    client.mutate("ui.relation_change", stale, key="hu04-link-stale-target", status="conflict")
    client.refresh()
    assert client.binding() == before

    _, accepted = _changed(client, "ui.relation_change", link, key="hu04-link")
    edge = accepted["result"]["committed"]
    assert edge in _graph(client, source_id, target_id)["edges"]
    unlink = {**link, "action": "unlink", "edge_id": edge["edge_id"]}
    _, accepted = _changed(
        client, "ui.relation_change", unlink, key="hu04-unlink", revision=edge["revision"],
    )
    unlinked = accepted["result"]["committed"]
    assert not unlinked["active"] and int(unlinked["revision"]) > int(edge["revision"])
    _assert_unlinked(client, unlinked)
    return unlinked


def _assert_unlinked(client, unlinked):
    graph = _graph(client, unlinked["source_id"], unlinked["target_id"])
    # Live graph reads can omit inactive edges. If returned, the edge must be terminal.
    for edge in graph["edges"]:
        if edge["edge_id"] == unlinked["edge_id"]:
            assert not edge["active"] and edge["revision"] == unlinked["revision"]
        assert not (edge["active"] and edge["kind"] == "user_association"
                    and edge["source_id"] == unlinked["source_id"]
                    and edge["target_id"] == unlinked["target_id"])


def run_write_checks(client, seed, restart):
    """Exercise the named v1 Memory and association writes against persisted service state."""
    principal = seed["phy_owner_id"]
    create = {"title": "HU04 original note", "body": "Original user-authored café note.",
              "category": "fact", "memory_type": "note"}
    before, accepted = _changed(client, "ui.memory_create", create, key="hu04-create")
    original = accepted["result"]["committed"]
    original_id = original["memory"]["memory_id"]
    original_revision = original["memory"]["revision"]
    _authored(original, create, principal)
    assert (original["memory"]["category"], original["memory"]["memory_type"]) == ("fact", "note")
    _replay(client, accepted, create, before)
    current = client.binding()
    client.mutate(
        "ui.memory_create", {**create, "body": "Different content under the accepted key."},
        key="hu04-create", status="conflict", binding=before,
    )
    client.refresh()
    assert client.binding() == current
    _authored(_detail(client, original_id), create, principal)

    correction = {"memory_id": original_id, "title": "HU04 corrected note",
                  "body": "Corrected user-authored café note."}
    client.mutate(
        "ui.memory_edit", correction, key="hu04-correct-stale", status="conflict",
        revision=str(int(original_revision) + 1),
    )
    client.refresh()
    assert client.binding() == current
    _, accepted = _changed(
        client, "ui.memory_edit", correction, key="hu04-correct", revision=original_revision,
    )
    corrected = accepted["result"]["committed"]
    replacement = corrected["replacement"]
    replacement_id = replacement["memory"]["memory_id"]
    assert replacement_id != original_id
    assert replacement["body"]["body_id"] != original["body"]["body_id"]
    _authored(replacement, correction, principal)
    superseded = _detail(client, original_id)
    assert superseded["memory"]["revision"] == corrected["original_revision"]
    assert superseded["memory"]["lifecycle"] == "superseded"
    assert superseded["superseded_by"] == replacement_id
    assert _detail(client, original_id, original_revision)["body"] == original["body"]

    _, accepted = _changed(
        client, "ui.memory_create",
        {**create, "title": "HU04 association peer", "body": "Independent user-authored peer."},
        key="hu04-create-peer",
    )
    peer = accepted["result"]["committed"]
    peer_id = peer["memory"]["memory_id"]
    unlinked = _association(client, replacement, peer)

    retire = {"memory_id": original_id, "effect": "retire"}
    before, accepted = _changed(
        client, "ui.memory_retire", retire, key="hu04-retire", revision=corrected["original_revision"],
    )
    retirement = accepted["result"]["committed"]
    restart()
    client.refresh()
    tombstone = _detail(client, original_id)
    assert tombstone["tombstone"]
    assert tombstone["memory"]["lifecycle"] == retirement["lifecycle"] == "tombstoned"
    assert tombstone["memory"]["revision"] == retirement["revision"]
    assert tombstone["body"]["availability"] == "terminal"
    assert tombstone["body"]["content"] is None
    persisted = _detail(client, replacement_id)
    _authored(persisted, correction, principal)
    assert persisted["body"] == replacement["body"]
    assert _detail(client, peer_id)["body"] == peer["body"]
    _assert_unlinked(client, unlinked)
    _replay(client, accepted, retire, before, revision=corrected["original_revision"])
