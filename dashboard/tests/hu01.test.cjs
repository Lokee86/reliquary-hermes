const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const dashboard = path.resolve(__dirname, "..");
const fixture = require("../fixtures/mock-responses.json");
globalThis.ReliquaryDashboardFixture = fixture;
const state = require("../src/state.js");
const mock = require("../src/mock.js");

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function textContent(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return (node.children || []).map(textContent).filter(Boolean).join(" ");
}

test("owner switching clears selection, scoped pages, detail and pending requests", () => {
  const rel = mock.getDefaultOwner();
  const project = mock.getOwners().find((owner) => owner.owner_id === "fixture-project-rel");
  assert.ok(rel && project);
  let current = mock.hydrate(state.createState(null), rel);
  current = mock.select(current, "fixture-rel-memory");
  assert.equal(current.selectedMemoryId, "fixture-rel-memory");
  assert.ok(current.listPage && current.graphPage && current.detail && current.provenance);

  const late = JSON.parse(JSON.stringify(fixture.graph_pages[rel.owner_id]));
  late.request_id = "late-rel-graph";
  current = state.beginRequest(current, late.operation, late.request_id);
  const switched = mock.hydrate(current, project);
  assert.equal(switched.owner.owner_id, "fixture-project-rel");
  assert.equal(mock.getActivePhy().owner_id, "fixture-phy");
  assert.equal(switched.selectedMemoryId, null);
  assert.equal(switched.detail, null);
  assert.equal(switched.provenance, null);
  assert.equal(switched.listPage.items[0].memory_id, "fixture-project-rel-memory");
  assert.equal(switched.graphPage.nodes[0].memory_id, "fixture-project-rel-memory");
  assert.equal(switched.operationalStatus.source_state, "tombstoned");
  assert.deepEqual(switched.operationalStatus.latest_recall.returned_ids, []);
  assert.deepEqual(switched.pendingRequests, {});
  assert.equal(state.acceptsResponse(switched, late), false);
  assert.strictEqual(state.applyResponse(switched, late), switched);
});

test("generation or cut changes also invalidate all owner-bound state", () => {
  const owner = mock.getDefaultOwner();
  const current = mock.hydrate(state.createState(null), owner);
  const oldPage = fixture.graph_pages[owner.owner_id];
  for (const update of [{ generation: "2" }, { cut: "fixture-rel-v2" }]) {
    const switched = state.changeOwner(current, { ...owner, ...update });
    assert.equal(switched.listPage, null);
    assert.equal(switched.graphPage, null);
    assert.equal(switched.operationalStatus, null);

    const pending = state.beginRequest(switched, oldPage.operation, oldPage.request_id);
    assert.strictEqual(state.applyResponse(pending, oldPage), pending);
  }
});

test("capability-only owner binding changes clear cached private state and reject old responses", () => {
  const owner = mock.getDefaultOwner();
  let current = mock.hydrate(state.createState(null), owner);
  current = mock.select(current, "fixture-rel-memory");
  const late = JSON.parse(JSON.stringify(fixture.graph_pages[owner.owner_id]));
  late.request_id = "late-before-capability-revocation";
  current = state.beginRequest(current, late.operation, late.request_id);
  assert.equal(state.acceptsResponse(current, late), true);

  const revoked = { ...owner, capabilities: { ...owner.capabilities, provenance: false } };
  const switched = state.changeOwner(current, revoked);
  assert.equal(switched.owner.owner_id, owner.owner_id);
  assert.equal(switched.owner.cut, owner.cut);
  assert.equal(switched.owner.capabilities.provenance, false);
  assert.equal(switched.selectedMemoryId, null);
  assert.equal(switched.listPage, null);
  assert.equal(switched.graphPage, null);
  assert.equal(switched.detail, null);
  assert.equal(switched.provenance, null);
  assert.deepEqual(switched.pendingRequests, {});
  assert.equal(state.acceptsResponse(switched, late), false);
  assert.strictEqual(state.applyResponse(switched, late), switched);
  const hydrated = mock.hydrate(current, revoked);
  assert.equal(hydrated.graphPage, null);
  assert.equal(hydrated.detail, null);
  assert.equal(hydrated.provenance, null);
  assert.deepEqual(hydrated.pendingRequests, {});
});

test("provenance must match the selected detail's body revision", () => {
  const owner = mock.getDefaultOwner();
  let current = mock.hydrate(state.createState(null), owner);
  current = mock.select(current, "fixture-rel-memory");
  const stale = structuredClone(fixture.provenance[owner.owner_id]);
  stale.result.revision = "999";
  current = state.beginRequest(current, stale.operation, stale.request_id);
  assert.strictEqual(state.applyResponse(current, stale), current);
});

test("manifest points at a host IIFE and the bundle registers via the host SDK only", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dashboard, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "reliquary-hermes");
  assert.equal(manifest.tab.path, "/reliquary");
  assert.equal(manifest.tab.position, "after:skills");
  assert.equal(manifest.entry, "dist/index.js");
  assert.equal(manifest.css, "dist/style.css");
  const bundle = fs.readFileSync(path.join(dashboard, manifest.entry), "utf8");
  assert.doesNotMatch(bundle, /@tauri-apps|@hermes\/plugin-sdk|\binvoke\s*\(|__HERMES_SESSION_TOKEN__/);
  assert.match(bundle, /__HERMES_PLUGIN_SDK__/);
  assert.match(bundle, /registry\.register\("reliquary-hermes"/);

  let registration = null;
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const registry = { register: (name, component) => { registration = { name, component }; } };
  let storedState;
  let hasStoredState = false;
  const hooks = {
    useState: (initial) => {
      if (!hasStoredState) {
        storedState = typeof initial === "function" ? initial() : initial;
        hasStoredState = true;
      }
      const setState = (next) => { storedState = typeof next === "function" ? next(storedState) : next; };
      return [storedState, setState];
    },
  };
  const window = {
    __HERMES_PLUGIN_SDK__: { sdkVersion: "1.1.0", React, hooks },
    __HERMES_PLUGINS__: registry,
  };
  const context = { window, console };
  vm.runInNewContext(bundle, context, { filename: manifest.entry });
  assert.equal(registration.name, manifest.name);
  const tree = registration.component();
  const rendered = textContent(tree);
  assert.match(rendered, /Synthetic fixture only/);
  assert.match(rendered, /Owner \/ scope/);
  assert.match(rendered, /INSPECTOR/);
  assert.match(rendered, /Active PHY/);
  assert.match(rendered, /Reliquary user ID fixture-phy/);
  assert.match(rendered, /Latest recall returned/);
  assert.match(rendered, /Returned Memories fixture-rel-memory/);
  let selectButton = null;
  walk(tree, (node) => {
    if (node.type === "button" && String(node.props.className || "").includes("rly-graph-node")) selectButton = node;
  });
  assert.ok(selectButton);
  selectButton.props.onClick();
  const selectedTree = registration.component();
  const selectedText = textContent(selectedTree);
  assert.match(selectedText, /Source unavailable/);
  assert.match(selectedText, /stale/);
  assert.doesNotMatch(selectedText, /User-origin record/);

  let ownerPicker;
  let listButton;
  walk(selectedTree, (node) => {
    if (node.type === "select") ownerPicker = node;
    if (node.type === "button" && node.children.includes("List page")) listButton = node;
    assert.ok(!node.props.dangerouslySetInnerHTML);
  });
  assert.ok(ownerPicker && listButton);
  listButton.props.onClick();
  assert.match(textContent(registration.component()), /Memory ID fixture-rel-memory/);

  ownerPicker.props.onChange({ currentTarget: { value: "fixture-project-rel" } });
  const projectTree = registration.component();
  const projectText = textContent(projectTree);
  assert.match(projectText, /Bound session fixture-project-session/);
  assert.match(projectText, /Reliquary user ID fixture-phy/);
  assert.match(projectText, /Copied source Tombstoned source/);
  assert.match(projectText, /Latest recall selected/);
  assert.match(projectText, /Returned Memories None/);
  assert.doesNotMatch(projectText, /Memory ID fixture-rel-memory/);

  let projectMemory;
  walk(projectTree, (node) => {
    if (node.type === "button" && String(node.props.className || "").includes("rly-memory-button")) projectMemory = node;
  });
  assert.ok(projectMemory);
  projectMemory.props.onClick();
  const projectDetail = registration.component();
  const detailText = textContent(projectDetail);
  assert.match(detailText, /Lifecycle active/);
  assert.match(detailText, /Source unavailable.*deleted/);
  assert.match(detailText, /<img src=x onerror=alert\(1\)>/);
  walk(projectDetail, (node) => {
    assert.notEqual(node.type, "img");
    assert.ok(!node.props.dangerouslySetInnerHTML);
  });
});
