const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const Button = function Button() {};
const Input = function Input() {};
const Select = function Select() {};
const Checkbox = function Checkbox() {};

function harness({ fetch, initialState = [], runPolling = false }) {
  const state = [...initialState];
  const effects = [];
  const pendingEffects = [];
  let stateCursor = 0;
  let effectCursor = 0;
  const originalHost = globalThis.ReliquaryDashboardHost;
  const originalSources = globalThis.ReliquaryDashboardSources;
  const React = { createElement(type, props, ...children) { return { type, props: props ?? {}, children }; } };
  globalThis.ReliquaryDashboardHost = {
    React,
    hooks: {
      useState(initial) {
        const index = stateCursor++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (next) => {
          state[index] = typeof next === "function" ? next(state[index]) : next;
        }];
      },
      useEffect(callback, deps) {
        const index = effectCursor++;
        if (index === 0) { effects[index] = { deps: [...deps], cleanup: undefined }; return; }
        if (index === 1 && !runPolling) { effects[index] = { deps: [...deps], cleanup: undefined }; return; }
        const prior = effects[index];
        if (!prior || deps.length !== prior.deps.length || deps.some((item, pos) => item !== prior.deps[pos])) {
          if (prior?.cleanup) prior.cleanup();
          effects[index] = { deps: [...deps], cleanup: undefined };
          pendingEffects.push({ index, callback });
        }
      },
    },
    components: { Button, Input, Select, Checkbox },
  };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../src/sources.js"), "utf8"));
  const Component = globalThis.ReliquaryDashboardSources.ImportSessions;
  let tree;
  function render() {
    stateCursor = 0; effectCursor = 0;
    tree = Component({ authedFetch: fetch });
    while (pendingEffects.length) {
      const { index, callback } = pendingEffects.shift();
      effects[index].cleanup = callback() ?? undefined;
    }
    return tree;
  }
  async function flush() {
    for (let i = 0; i < 50; i++) {
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    }
    render();
  }
  async function tick() {
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await flush();
  }
  function dispose() {
    for (const effect of effects) effect?.cleanup?.();
    if (originalHost === undefined) delete globalThis.ReliquaryDashboardHost; else globalThis.ReliquaryDashboardHost = originalHost;
    if (originalSources === undefined) delete globalThis.ReliquaryDashboardSources; else globalThis.ReliquaryDashboardSources = originalSources;
  }
  return { render, flush, tick, get tree() { return tree; }, state, dispose };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...(tree.children ?? []).flatMap((child) => Array.isArray(child) ? child.flatMap(nodes) : nodes(child))];
}

function button(tree, label) {
  return nodes(tree).find((node) => node.type === Button && node.children.includes(label));
}

function visibleText(tree) {
  return nodes(tree).flatMap((node) => node.children ?? []).filter((child) => typeof child === "string").join(" ");
}

const destinations = [
  { owner_id: "rel-general", label: "General REL" },
  { owner_id: "rel-project", label: "Project REL · Notes" },
];
const session = (session_id, title, status = "available", retryable = false) => ({
  session_id, title, started_at: 1_700_000_000, last_activity_at: 1_700_000_600, message_count: 12,
  project_name: null, status, reason: null, retryable,
});

test("requires explicit selection, destination, review, and confirmation before multi-session import", async (t) => {
  const calls = [];
  let poll = 0;
  const fetch = (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options?.method ?? "GET", body });
    if (url.includes("/sessions?")) return Promise.resolve({ ok: true, json: () => ({ available: true, destinations,
      sessions: [session("s1", "Design notes"), session("s2", "Implementation plan")], next_offset: null }) });
    if (url.endsWith("/import")) return Promise.resolve({ ok: true, json: () => ({ sessions: body.session_ids.map((session_id) => ({
      session_id, status: "queued", reason: null, retryable: false,
    })) }) });
    if (url.endsWith("/status")) {
      poll++;
      const status = poll === 1 ? "processing" : "complete";
      return Promise.resolve({ ok: true, json: () => ({ sessions: body.session_ids.map((session_id) => ({ session_id, status, reason: null, retryable: false })) }) });
    }
    throw new Error("Unexpected request " + url);
  };
  const app = harness({ fetch, runPolling: true, initialState: [true, "", "", 0, { available: true, destinations,
    sessions: [session("s1", "Design notes"), session("s2", "Implementation plan")], next_offset: null },
    false, "", [], "", false, false, {}, 0] });
  t.after(app.dispose);
  app.render();
  let checks = nodes(app.tree).filter((node) => node.type === Checkbox);
  assert.equal(checks.length, 2);
  assert.equal(checks.some((node) => node.props.checked), false);
  assert.equal(button(app.tree, "Review selected (0)").props.disabled, true);

  checks.forEach((node) => node.props.onCheckedChange());
  app.render();
  nodes(app.tree).find((node) => node.type === Select).props.onValueChange("rel-project");
  app.render();
  button(app.tree, "Review selected (2)").props.onClick();
  app.render();
  let text = visibleText(app.tree);
  assert.match(text, /Import 2 selected conversations into Project REL · Notes/);
  assert.match(text, /Design notes/);
  assert.match(text, /Implementation plan/);
  button(app.tree, "Cancel").props.onClick();
  app.render();
  assert.equal(calls.filter((call) => call.url.endsWith("/import")).length, 0);
  assert.ok(button(app.tree, "Review selected (2)"));

  button(app.tree, "Review selected (2)").props.onClick();
  app.render();
  await button(app.tree, "Import selected").props.onClick();
  app.render();
  const importCall = calls.find((call) => call.url.endsWith("/import"));
  assert.deepEqual(importCall.body, { session_ids: ["s1", "s2"], owner_id: "rel-project", confirm: true });
  await app.tick();
  assert.match(visibleText(app.tree), /Processing/);
  await app.tick();
  assert.match(visibleText(app.tree), /Complete/);
  assert.ok(calls.filter((call) => call.url.endsWith("/status")).every((call) => call.method === "POST" && call.body.session_ids.length <= 8));
});

test("retry opens a fresh review and stock or unsupported history stays visibly unavailable", async (t) => {
  const calls = [];
  const fetch = (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options?.method ?? "GET", body });
    if (url.includes("/sessions?")) return Promise.resolve({ ok: true, json: () => stockUnavailable
      ? { available: false, destinations: [], sessions: [], next_offset: null }
      : { available: true, destinations, sessions: [session("s3", "Retryable conversation", "failed", true)], next_offset: null } });
    if (url.endsWith("/import")) return Promise.resolve({ ok: true, json: () => ({ sessions: body.session_ids.map((session_id) => ({
      session_id, status: "already_imported", reason: null, retryable: false,
    })) }) });
    throw new Error("Unexpected request " + url);
  };
  const app = harness({ fetch, initialState: [true, "", "", 0, { available: true, destinations,
    sessions: [session("s3", "Retryable conversation", "failed", true)], next_offset: null },
    false, "", [], "", false, false, {}, 0] });
  t.after(app.dispose);
  app.render();
  nodes(app.tree).find((node) => node.type === Select).props.onValueChange("rel-general"); app.render();
  button(app.tree, "Retry import").props.onClick(); app.render();
  assert.equal(calls.filter((call) => call.url.endsWith("/import")).length, 0);
  assert.match(visibleText(app.tree), /Import 1 selected conversation into General REL/);
  button(app.tree, "Import selected").props.onClick(); app.render();
  assert.deepEqual(calls.find((call) => call.url.endsWith("/import")).body,
    { session_ids: ["s3"], owner_id: "rel-general", confirm: true });
  const unavailable = harness({ fetch, initialState: [true, "", "", 0,
    { available: false, destinations: [], sessions: [], next_offset: null }, false, "", [], "", false, false, {}, 0] });
  t.after(unavailable.dispose);
  unavailable.render();
  assert.match(visibleText(unavailable.tree), /unavailable on this Hermes build/);
  assert.equal(nodes(unavailable.tree).filter((node) => node.type === Checkbox).length, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("/import")).length, 1);

  const unsupported = session("large", "Long conversation", "unavailable", false);
  unsupported.reason = "history_too_large";
  const unavailableHistory = harness({ fetch, initialState: [true, "", "", 0,
    { available: true, destinations, sessions: [unsupported], next_offset: null }, false, "", [], "", false, false, {}, 0] });
  t.after(unavailableHistory.dispose);
  unavailableHistory.render();
  assert.match(visibleText(unavailableHistory.tree), /cannot be imported completely/);
  assert.doesNotMatch(visibleText(unavailableHistory.tree), /history_too_large/);

  const imported = session("done", "Already imported", "already_imported", false);
  const previouslyImported = harness({ fetch, initialState: [true, "", "", 0,
    { available: true, destinations, sessions: [imported], next_offset: null }, false, "", [], "", false, false, {}, 0] });
  t.after(previouslyImported.dispose);
  previouslyImported.render();
  assert.match(visibleText(previouslyImported.tree), /Already imported/);
  assert.equal(nodes(previouslyImported.tree).find((node) => node.type === Checkbox).props.disabled, true);
});

test("resumes status polling for already queued imports and bounds each status request", async (t) => {
  const calls = [];
  const fetch = (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, method: options.method, body });
    return Promise.resolve({ ok: true, json: () => ({ sessions: body.session_ids.map((session_id) => ({
      session_id, status: "processing", reason: null, retryable: false,
    })) }) });
  };
  const rows = Array.from({ length: 11 }, (_, index) => session("active-" + index, "Active " + index, "processing"));
  const statusById = Object.fromEntries(rows.map((row) => [row.session_id, { session_id: row.session_id, status: "processing", reason: null, retryable: false }]));
  const app = harness({ fetch, runPolling: true, initialState: [true, "", "", 0,
    { available: true, destinations, sessions: rows, next_offset: null }, false, "", [], "", false, false, statusById, 1] });
  t.after(app.dispose);
  app.render();
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await app.flush();
  const poll = calls.find((call) => call.url.endsWith("/status"));
  assert.ok(poll);
  assert.equal(poll.method, "POST");
  assert.equal(poll.body.session_ids.length, 8);
  assert.match(visibleText(app.tree), /Processing/);
});
