const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createClient } = require("../src/client.js");
const { createFixtureClient } = require("../src/fixtures.js");
const { createLiveClient, createLiveMutation } = require("../src/live_transport.js");
const { createSetupClient, candidate, message } = require("../src/setup_client.js");
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
  assert.equal((await client.read("ui.memory_detail", scope, { ...args, revision: "bad" }, signal)).status, "invalid");
  assert.equal((await client.read("ui.provenance", scope, { ...args, memory_id: "bad id" }, signal)).status, "invalid");
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
  const edgeLimited = result(await client.read("ui.graph_page", scope, { ...graph, seed_ids: [seed], node_limit: 6, edge_limit: 1 }, signal));
  assert.equal(edgeLimited.edges.length, 1);
  assert.equal(edgeLimited.truncated, true);
  assert.equal(edgeLimited.next_cursor, null);
  const communities = result(await client.read("ui.community_list", scope, { cursor: null, limit: 3 }, signal));
  const community = communities.communities.items[0];
  const args = { community_id: community.community_id, expected_generation: community.generation, limit: 3, cursor: null };
  const members = result(await client.read("ui.community_members", scope, args, signal));
  assert.ok(members.members.items.includes("fixture-rel-memory"));
  assert.notEqual((await client.read("ui.community_members", scope, { ...args, expected_generation: "999" }, signal)).status, "ok");
  assert.equal((await client.read("ui.community_members", scope, { ...args, expected_generation: "01" }, signal)).status, "invalid");
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

test("live and fixture builds register separately with the host SDK", () => {
  const dashboard = path.resolve(__dirname, "..");
  const manifest = require("../manifest.json");
  assert.equal(manifest.tab.path, "/reliquary");
  assert.equal(manifest.api, "plugin_api.py");
  assert.ok(fs.existsSync(path.join(dashboard, manifest.css)));
  const bundle = fs.readFileSync(path.join(dashboard, manifest.entry), "utf8");
  assert.doesNotMatch(bundle, /@tauri-apps|@hermes\/plugin-sdk|__HERMES_SESSION_TOKEN__|\bfetch\s*\(/);
  assert.doesNotMatch(bundle, /fixture-rel-memory|Synthetic fixture only/);
  let registration;
  const window = {
    __HERMES_PLUGIN_SDK__: { sdkVersion: "1.1.0", React: { createElement() {} }, hooks: {}, authedFetch() {} },
    __HERMES_PLUGINS__: { register: (name, component) => { registration = { name, component }; } },
  };
  vm.runInNewContext(bundle, { window }, { filename: manifest.entry });
  assert.equal(registration.name, manifest.name);
  assert.equal(typeof registration.component, "function");

  const fixtureDir = path.resolve(dashboard, "../host/.test-tmp/dashboard-fixture");
  const fixtureManifest = require(path.join(fixtureDir, "manifest.json"));
  assert.equal(fixtureManifest.api, undefined);
  vm.runInNewContext(fs.readFileSync(path.join(fixtureDir, fixtureManifest.entry), "utf8"), { window });
  assert.equal(registration.name, manifest.name);
});

test("live owner discovery and scoped reads use the Hermes SDK route", async () => {
  let calls = 0;
  const client = createLiveClient(async (url, init) => {
    calls += 1;
    assert.equal(url, "/api/plugins/reliquary-hermes/dashboard-v1");
    assert.equal(init.method, "POST");
    assert.equal(init.signal, signal);
    const request = JSON.parse(init.body);
    assert.equal(request.profile_id, "dashboard");
    assert.equal(request.principal_id, "dashboard");
    if (request.operation === "ui.owner_sessions") {
      assert.equal(request.owner_id, null);
      const base = fixture.owner_sessions["fixture-session"][0];
      return Response.json({ ...base, request_id: request.request_id });
    }
    assert.equal(request.operation, "ui.memory_list");
    assert.equal(request.owner_id, scope.owner.owner_id);
    return Response.json({ protocol_version: 1, request_id: request.request_id, operation: request.operation,
      status: "unavailable", binding: null, result: { code: "owner_unavailable", retryable: true } });
  });
  const result = await client.read("ui.owner_sessions", { owner: null, sessionId: "fixture-session" }, { cursor: null, limit: 128 }, signal);
  assert.equal(result.status, "ok");
  assert.deepEqual(await client.read("ui.memory_list", scope, list, signal),
    { status: "unavailable", code: "owner_unavailable", retryable: true });
  assert.equal(calls, 2);
  const denied = createLiveClient(async () => new Response(null, { status: 401 }));
  assert.equal((await denied.read("ui.owner_sessions", { owner: null, sessionId: null }, { cursor: null, limit: 128 }, signal)).status, "denied");
});

test("live writes bind the submitted cut and correlate durable receipts", async () => {
  const owner = { ...general, capabilities: { ...general.capabilities, manage: true, memory_edit: true } };
  let calls = 0;
  const args = { memory_id: "fixture-memory", title: "Updated title", body: "Body" };
  const write = createLiveMutation(async (_url, init) => {
    const request = JSON.parse(init.body);
    calls += 1;
    assert.equal(request.owner_id, owner.owner_id);
    assert.equal(request.generation, owner.generation);
    assert.equal(request.cut, owner.cut);
    assert.equal(request.expected_revision, "1");
    assert.equal(request.idempotency_key, "draft-key");
    assert.notEqual(request.request_id, request.idempotency_key);
    assert.deepEqual(request.arguments, args);
    return Response.json({ protocol_version: 1, status: "ok", operation: request.operation,
      request_id: request.request_id, binding: { ...owner, cut: "new-cut" },
      result: { request_id: calls === 1 ? request.request_id : "other-request", idempotency_key: "draft-key",
        receipt_id: "stable-receipt", changed: true, committed: {} } });
  });
  assert.equal((await write("ui.memory_edit", { ...scope, owner }, args, "1", "draft-key", signal)).status, "ok");
  assert.equal((await write("ui.memory_edit", { ...scope, owner }, args, "1", "draft-key", signal)).status, "conflict");
  const phy = { ...owner, owner_kind: "PHY" };
  assert.equal((await write("ui.memory_edit", { ...scope, owner: phy }, args, "1", "draft-key", signal)).status, "denied");
  assert.equal(calls, 2);
});

test("setup candidate carries only validated owner and config paths", () => {
  assert.throws(() => candidate("relative.rel", "C:/test/active.phy", "", []), /main_path/);
  assert.throws(() => candidate("C:/test/main.rel", "//server/share/active.phy", "", []), /phy_path/);
  const row = { id: "lantern", path: "C:/test/lantern.rel" };
  assert.throws(() => candidate("C:/test/main.rel", "C:/test/active.phy", "", [row, row]), /project_id/);
  assert.deepEqual(candidate(" C:/test/main.rel ", "C:/test/active.phy", "", [row]), {
    main_rel: "C:/test/main.rel", active_phy: "C:/test/active.phy",
    projects: { lantern: "C:/test/lantern.rel" }, config_path: null,
  });
});

test("setup client uses the admitted Hermes transport and redacts unknown failures", async () => {
  const initial = { configured: false, runtime_detected: true, config_path: null,
    defaults: { main_rel: null, active_phy: null, projects: {}, config_path: null } };
  const selection = candidate("C:/test/main.rel", "C:/test/active.phy", "", []);
  const replies = [Response.json(initial), Response.json({ valid: true, configured: true }),
    Response.json({ detail: "hidden diagnostic" }, { status: 503 })];
  const calls = [];
  const setup = createSetupClient(async (url, init) => { calls.push([url, init]); return replies.shift(); });
  assert.deepEqual(await setup.status(signal), initial);
  assert.deepEqual(await setup.apply(selection, signal), { valid: true, configured: true });
  await assert.rejects(setup.validate(selection, signal), (error) =>
    message(error) === "Could not reach Reliquary setup. Try again.");
  assert.deepEqual(calls.map(([url, init]) => [url, init.method]), [
    ["/api/plugins/reliquary-hermes/setup-v1/status", "GET"],
    ["/api/plugins/reliquary-hermes/setup-v1/apply", "POST"],
    ["/api/plugins/reliquary-hermes/setup-v1/validate", "POST"],
  ]);
  assert.deepEqual(JSON.parse(calls[1][1].body), selection);
  assert.equal(calls[0][1].signal, signal);
});

test("the common live surface installs no globals when another shell injects React", () => {
  const { buildLiveBundle } = require("../scripts/live-bundle.cjs");
  const context = { input: { React: { createElement() {} }, hooks: {}, authedFetch() {}, surfaceLabel: "Desktop" } };
  const create = vm.runInNewContext(`(function () {
    ${buildLiveBundle()}
    return createReliquarySurface(input);
  })()`, context);
  assert.equal(typeof create, "function");
  assert.deepEqual(Object.keys(context), ["input"]);
});
