const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createClient } = require("../src/client.js");
const { createFixtureClient } = require("../src/fixtures.js");
const fixture = require("../fixtures/mock-responses.json");

const general = fixture.owner_sessions["fixture-session"][0].result.owners.items.find((owner) => owner.owner_id === "fixture-rel");
const scope = { owner: general, sessionId: "fixture-session" };
const signal = new AbortController().signal;
const list = { cursor: null, limit: 3, filters: { query: "", category: null, memory_type: null, lifecycle: null, community_id: null } };
const graph = { cursor: null, seed_ids: [], community_id: null, depth: 1, node_limit: 4, edge_limit: 12 };

function result(read) {
  assert.equal(read.status, "ok", JSON.stringify(read));
  return read.value;
}

test("fixture enumeration returns only the explicitly active PHY for both RELs", async () => {
  for (const activePhyId of ["fixture-phy", "fixture-alt-phy", null]) {
    const client = createFixtureClient(fixture, activePhyId);
    assert.deepEqual(client.phys().map(({ phyId }) => phyId), ["fixture-phy", "fixture-alt-phy"]);
    for (const { sessionId, relId } of client.sessions()) {
      const discovery = result(await client.read("ui.owner_sessions", { owner: null, sessionId }, { cursor: null, limit: 128 }, signal));
      assert.equal(discovery.active_session_id, sessionId);
      assert.equal(discovery.session_owner_id, relId);
      assert.equal(discovery.active_phy_id, activePhyId);
      assert.deepEqual(discovery.owners.items.filter((owner) => owner.owner_kind === "PHY").map((owner) => owner.owner_id),
        activePhyId ? [activePhyId] : []);
    }
    const inactive = fixture.memory_lists[activePhyId === "fixture-phy" ? "fixture-alt-phy" : "fixture-phy"].binding;
    assert.equal((await client.read("ui.memory_list", { owner: inactive, sessionId: null }, list, signal)).status, "denied");
  }
});

test("list cursors are bounded and tied to filters, owner scope, and remount", async () => {
  const client = createFixtureClient(fixture);
  const first = result(await client.read("ui.memory_list", scope, list, signal));
  assert.equal(first.items.length, 3);
  assert.ok(first.next_cursor);
  const next = { ...list, cursor: first.next_cursor };
  const second = result(await client.read("ui.memory_list", scope, next, signal));
  assert.equal(second.items.length, 2);
  assert.equal(second.next_cursor, null);
  assert.ok(second.items.every((item) => !first.items.some((previous) => previous.memory_id === item.memory_id)));
  assert.equal((await client.read("ui.memory_list", scope, { ...next, filters: { ...list.filters, query: "different" } }, signal)).status, "stale_cursor");
  assert.equal((await client.read("ui.memory_list", { ...scope, sessionId: null }, next, signal)).status, "stale_cursor");
  client.invalidate();
  assert.equal((await client.read("ui.memory_list", scope, next, signal)).status, "stale_cursor");
});

test("history and provenance preserve exact revisions and unavailable bodies", async () => {
  const client = createFixtureClient(fixture);
  const memory_id = "fixture-rel-memory";
  const history = result(await client.read("ui.memory_history", scope, { memory_id, cursor: null, limit: 3 }, signal));
  const pruned = history.revisions.items.find((revision) => revision.availability === "pruned");
  assert.ok(pruned);
  const args = { memory_id, revision: pruned.revision };
  const detail = result(await client.read("ui.memory_detail", scope, args, signal));
  assert.equal(detail.body.revision, pruned.revision);
  assert.equal(detail.body.availability, "pruned");
  assert.equal(detail.body.content, null);
  assert.equal(result(await client.read("ui.provenance", scope, args, signal)).revision, pruned.revision);
  assert.equal((await client.read("ui.memory_detail", scope, { ...args, revision: "999" }, signal)).status, "unavailable");
});

test("graph expansion and community membership respect stable IDs, limits and cut", async () => {
  const client = createFixtureClient(fixture);
  const first = result(await client.read("ui.graph_page", scope, graph, signal));
  assert.equal(first.nodes.length, 4);
  assert.ok(first.next_cursor);
  const seed = first.nodes[0].node_id;
  const expanded = result(await client.read("ui.graph_page", scope, { ...graph, seed_ids: [seed], depth: 2, node_limit: 6 }, signal));
  const ids = new Set(expanded.nodes.map((node) => node.node_id));
  assert.ok(ids.has(seed));
  assert.ok(expanded.nodes.some((node) => !first.nodes.some((previous) => previous.node_id === node.node_id)));
  assert.ok(expanded.edges.every((edge) => edge.cut === general.cut && ids.has(edge.source_id) && ids.has(edge.target_id)));
  const communities = result(await client.read("ui.community_list", scope, { cursor: null, limit: 3 }, signal));
  const community = communities.communities.items[0];
  const args = { community_id: community.community_id, expected_generation: community.generation, limit: 3, cursor: null };
  const members = result(await client.read("ui.community_members", scope, args, signal));
  assert.ok(members.members.items.includes("fixture-rel-memory"));
  assert.notEqual((await client.read("ui.community_members", scope, { ...args, expected_generation: "999" }, signal)).status, "ok");
});

test("wire arguments remain exact and typed server errors survive correlation", async () => {
  const args = { memory_id: "fixture-rel-memory", revision: "1" };
  const client = createClient(async (request) => {
    assert.deepEqual(request.arguments, args);
    return {
      protocol_version: 1, request_id: request.request_id, operation: request.operation,
      status: "unavailable", binding: null, result: { code: "revision_missing", retryable: false },
    };
  });
  assert.deepEqual(await client.read("ui.memory_detail", scope, args, signal),
    { status: "unavailable", code: "revision_missing", retryable: false });
});

test("client rejects old scope, widened grants, and the wrong provenance revision", async () => {
  for (const change of [
    (response) => { response.request_id = "old-request"; },
    (response) => { response.binding.owner_id = "foreign-owner"; },
    (response) => { response.binding.generation = "999"; },
    (response) => { response.binding.cut = "stale-cut"; },
    (response) => { response.binding.capabilities.manage = true; },
    (response) => { response.result.revision = "999"; },
  ]) {
    const base = fixture.provenance["fixture-rel"][0];
    const client = createClient(async (request) => {
      const response = { ...structuredClone(base), request_id: request.request_id };
      change(response);
      return response;
    });
    const args = { memory_id: base.result.memory_id, revision: base.result.revision };
    assert.equal((await client.read("ui.provenance", scope, args, signal)).status, "conflict");
  }
});

test("late results from transports that ignore cancellation are discarded", async () => {
  const controller = new AbortController();
  const deferred = () => {
    let finish;
    const client = createClient((request) => new Promise((resolve) => {
      finish = () => resolve({ ...fixture.memory_lists["fixture-rel"], request_id: request.request_id });
    }));
    return { client, finish: () => finish() };
  };
  const aborted = deferred();
  const pendingAbort = aborted.client.read("ui.memory_list", scope, { ...list, limit: 10 }, controller.signal);
  controller.abort();
  aborted.finish();
  await assert.rejects(pendingAbort, { name: "AbortError" });

  const invalidated = deferred();
  const pendingScope = invalidated.client.read("ui.memory_list", scope, { ...list, limit: 10 }, signal);
  invalidated.client.invalidate();
  invalidated.finish();
  assert.equal((await pendingScope).status, "conflict");
});

test("manifest bundle registers a tab with the host SDK and ships no service transport", () => {
  const dashboard = path.resolve(__dirname, "..");
  const manifest = require("../manifest.json");
  assert.equal(manifest.tab.path, "/reliquary");
  assert.equal(manifest.api, undefined);
  assert.ok(fs.existsSync(path.join(dashboard, manifest.css)));
  const bundle = fs.readFileSync(path.join(dashboard, manifest.entry), "utf8");
  assert.doesNotMatch(bundle, /@tauri-apps|@hermes\/plugin-sdk|__HERMES_SESSION_TOKEN__|\bfetch\s*\(/);
  let registration;
  const window = {
    __HERMES_PLUGIN_SDK__: { sdkVersion: "1.1.0", React: { createElement() {} }, hooks: {} },
    __HERMES_PLUGINS__: { register: (name, component) => { registration = { name, component }; } },
  };
  vm.runInNewContext(bundle, { window }, { filename: manifest.entry });
  assert.equal(registration.name, manifest.name);
  assert.equal(typeof registration.component, "function");
});
