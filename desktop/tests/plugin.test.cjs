const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createContext, SourceTextModule, SyntheticModule } = require("node:vm");
const { buildDesktopBundle } = require("../scripts/build.cjs");

const sharedStub = [
  "function createReliquarySurface(options) {",
  "  record(options);",
  "  return function SharedSurface() {};",
  "}",
].join("\n");

async function load({ rest, pickOpenPath, pickSavePath } = {}) {
  const contributions = [];
  const options = [];
  const routing = { epoch: 1, profile: "default" };
  const context = createContext({ DOMException, record: (value) => options.push(value) });
  const react = {
    createElement(type, props, ...children) { return { type, props, children }; },
    useMemo: (create) => create(),
  };
  const sdk = {
    Button() {}, Checkbox() {}, Input() {}, Textarea() {}, Select() {}, SelectTrigger() {}, SelectValue() {},
    SelectContent() {}, SelectItem() {},
    ROUTES_AREA: "routes",
    SIDEBAR_NAV_AREA: "sidebar.nav",
    gatewayActivationEpoch: () => routing.epoch,
    useGatewayActivationEpoch: () => routing.epoch,
    host: { state: { profile: { get: () => routing.profile } } },
    useValue: (atom) => atom.get(),
  };
  function mock(exports) {
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  }
  const imports = new Map([["react", mock(react)], ["@hermes/plugin-sdk", mock(sdk)]]);
  const plugin = new SourceTextModule(buildDesktopBundle(sharedStub, ".rly-dashboard {}"), { context });
  await plugin.link((name) => imports.get(name));
  await plugin.evaluate();
  const contribution = plugin.namespace.default;
  contribution.register({
    registerMany(items) { contributions.push(...items); },
    rest,
    os: { pickOpenPath, pickSavePath },
  });

  function render() {
    const page = contributions.find((item) => item.area === sdk.ROUTES_AREA);
    const element = page.render();
    const pane = element.type(element.props);
    return { pane, surface: options.at(-1) };
  }

  return { contribution, contributions, render, routing, sdk };
}

const url = (path) => "/api/plugins/reliquary-hermes" + path;

test("registers the Reliquary route and sidebar, and renders the shared surface", async () => {
  const { contribution, contributions, render } = await load();
  assert.equal(contribution.id, "reliquary-hermes");
  assert.equal(contributions.length, 2);
  const [page, nav] = contributions;
  assert.equal(page.area, "routes");
  assert.equal(nav.area, "sidebar.nav");
  assert.equal(nav.data.label, "Reliquary");
  assert.equal(nav.data.path, page.data.path);
  const { pane, surface } = render();
  assert.equal(pane.props.className, "rly-desktop");
  assert.equal(pane.children[0].children[0], ".rly-dashboard {}");
  assert.equal(pane.children[1].type.name, "SharedSurface");
  assert.equal(surface.surfaceLabel, "HERMES DESKTOP PLUGIN");
});

test("only verified native support enables Desktop writes", async () => {
  const { render } = await load();
  const { mutationBlockReason } = render().surface;
  for (const value of [false, undefined, "true", 1]) {
    const notice = mutationBlockReason({ desktop_native_mutations: value });
    assert.match(notice, /secure Desktop writes for isolated plugins/);
    assert.match(notice, /web dashboard for setup and write management/);
  }
  assert.equal(mutationBlockReason({ desktop_native_mutations: true }), undefined);
});

test("passes Desktop SDK controls and keeps empty select options usable", async () => {
  const { render, sdk } = await load();
  const { pane, surface } = render();
  assert.deepEqual(Object.keys(pane.props.style).sort(), ["height", "overflow", "width"]);
  const toggle = surface.components.Button({ "aria-pressed": false });
  assert.equal(toggle.type, sdk.Button);
  assert.equal(toggle.props.variant, "ghost");
  assert.equal(surface.components.Button({ "aria-pressed": true }).props.variant, "default");
  for (const name of ["Checkbox", "Input", "Textarea"]) assert.equal(surface.components[name], sdk[name]);
  let selected;
  const control = surface.components.Select({ label: "Owner", value: "",
    options: [{ value: "", label: "None" }, { value: "rel", label: "REL" }],
    onValueChange(value) { selected = value; } });
  assert.equal(control.type, sdk.Select);
  assert.equal(control.children[0].type, sdk.SelectTrigger);
  assert.equal(control.children[0].props["aria-label"], "Owner");
  const empty = control.children[1].children[0];
  assert.equal(empty.type, sdk.SelectItem);
  assert.ok(empty.props.value);
  assert.equal(control.props.value, empty.props.value);
  control.props.onValueChange(empty.props.value);
  assert.equal(selected, "");
});

test("uses the SDK profile scope for status, project inventory, creation, validation and management", async () => {
  const calls = [];
  const { render, routing } = await load({
    rest: async (path, options) => {
      calls.push({ path, profile: routing.profile, method: options.method, body: options.body });
      return path.endsWith("/apply") ? { valid: true, configured: true } : { status: "ok" };
    },
  });
  const { surface } = render();
  assert((await surface.authedFetch(url("/setup-v1/status"))).ok);
  routing.profile = "work";
  routing.epoch += 1;
  await assert.rejects(surface.authedFetch(url("/setup-v1/status")), { name: "AbortError" });
  const current = render().surface;
  assert((await current.authedFetch(url("/setup-v1/projects"))).ok);
  const creation = JSON.stringify({ kind: "phy", path: "C:/work/user.phy" });
  await current.authedFetch(url("/setup-v1/create"), { method: "POST", body: creation });
  const body = JSON.stringify({ main_rel: "C:/work/main.rel", active_phy: "C:/work/user.phy" });
  assert((await current.authedFetch(url("/setup-v1/validate"), { method: "POST", body })).ok);
  const applied = await current.authedFetch(url("/setup-v1/apply"), { method: "POST", body });
  assert.deepEqual(await applied.json(), { valid: true, configured: true });
  const dashboard = JSON.stringify({ operation: "ui.owner_sessions" });
  await current.authedFetch(url("/dashboard-v1"), { method: "POST", body: dashboard });
  assert.deepEqual(calls.map(({ path, profile, method }) => [path, profile, method]), [
    ["/setup-v1/status", "default", "GET"],
    ["/setup-v1/projects", "work", "GET"],
    ["/setup-v1/create", "work", "POST"],
    ["/setup-v1/validate", "work", "POST"],
    ["/setup-v1/apply", "work", "POST"],
    ["/dashboard-v1", "work", "POST"],
  ]);
  assert.equal(JSON.stringify(calls[2].body), creation);
  assert.equal(JSON.stringify(calls[4].body), body);
  await assert.rejects(current.authedFetch("/api/config"), /Unsupported Reliquary API request/);
  assert.equal(calls.length, 6);
});

test("allows only the scoped Sources history and import routes through the SDK REST bridge", async () => {
  const calls = [];
  const { render } = await load({ rest: async (path, options) => {
    calls.push({ path, method: options.method, body: options.body });
    return { available: true, destinations: [], sessions: [], next_offset: null };
  } });
  const { surface } = render();
  const list = await surface.authedFetch(url("/sources-v1/sessions?offset=0&q=design"));
  assert.equal(list.ok, true);
  await surface.authedFetch(url("/sources-v1/status"), { method: "POST", body: JSON.stringify({ session_ids: ["s1"] }) });
  await surface.authedFetch(url("/sources-v1/import"), { method: "POST", body: JSON.stringify({ session_ids: ["s1"], owner_id: "rel1", confirm: true }) });
  assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
    ["/sources-v1/sessions?offset=0&q=design", "GET"],
    ["/sources-v1/status", "POST"],
    ["/sources-v1/import", "POST"],
  ]);
  assert.equal(JSON.stringify(calls[2].body), JSON.stringify({ session_ids: ["s1"], owner_id: "rel1", confirm: true }));
  await assert.rejects(surface.authedFetch(url("/sources-v1/sessions?offset=-1&q=x")), /Unsupported Reliquary API request/);
  await assert.rejects(surface.authedFetch(url("/sources-v1/import")), /Unsupported Reliquary API request/);
  assert.equal(calls.length, 3);
});

test("uses the native picker for REL, PHY and config and keeps cancel inert", async () => {
  const calls = [];
  const selections = ["C:/work/main.rel", null, "C:/work/local.cfg"];
  const { render } = await load({
    pickOpenPath: async (options) => {
      calls.push(options);
      return selections.shift();
    },
  });
  const { surface } = render();
  assert.equal(await surface.pickOpenPath("REL"), "C:/work/main.rel");
  assert.equal(await surface.pickOpenPath("PHY"), null);
  assert.equal(await surface.pickOpenPath("config"), "C:/work/local.cfg");
  assert.equal(calls[0].filters[0].extensions[0], "rel");
  assert.equal(calls[1].filters[0].extensions[0], "phy");
  assert.match(calls[2].title, /configuration/);
});

test("uses the native save picker for new owners and discards canceled destinations", async () => {
  const calls = [];
  const selections = [null, "C:/work/new.phy"];
  const { render } = await load({
    pickSavePath: async (options) => {
      calls.push(options);
      return selections.shift();
    },
  });
  const { surface } = render();
  assert.equal(await surface.pickSavePath("REL"), null);
  assert.equal(await surface.pickSavePath("PHY"), "C:/work/new.phy");
  assert.equal(calls[0].title, "Create a Reliquary REL");
  assert.equal(calls[1].filters[0].extensions[0], "phy");
});

test("drops an in-flight path or response after a same-profile backend switch", async () => {
  let finishRead, finishPicker;
  const { render, routing } = await load({
    rest: () => new Promise((resolve) => { finishRead = resolve; }),
    pickOpenPath: () => new Promise((resolve) => { finishPicker = resolve; }),
  });
  const { surface } = render();
  const response = surface.authedFetch(url("/setup-v1/status"));
  const selection = surface.pickOpenPath("REL");
  routing.epoch += 1;
  finishRead({ configured: true });
  finishPicker("C:/work/old.rel");
  await assert.rejects(response, { name: "AbortError" });
  assert.equal(await selection, null);
});

test("keeps typed setup errors from the bridge", async () => {
  const { render } = await load({
    rest: async () => { throw new Error('Error invoking remote method: Error: 409: {"detail":"service_restart_required"}'); },
  });
  const response = await render().surface.authedFetch(url("/setup-v1/apply"), { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).detail, "service_restart_required");
});

test("reports Hermes REST failures without forwarding bridge diagnostics", async () => {
  const { render } = await load({
    rest: async () => { throw new Error("Error invoking remote method: Error: 403: private data"); },
  });
  const response = await render().surface.authedFetch(url("/setup-v1/status"));
  assert.equal(response.ok, false);
  assert.equal(response.status, 403);
  assert.equal(await response.json(), null);
});
