const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/onboarding.js"), "utf8");
const status = {
  configured: false,
  runtime_detected: true,
  defaults: { projects: {}, main_rel: "C:/synthetic/main.rel", active_phy: "C:/synthetic/active.phy",
    config_path: "C:/synthetic/detected.cfg" },
};

function renderOnboarding(pickers = {}) {
  const states = [];
  const cleanups = [];
  const creations = [];
  const validations = [];
  let slot = 0;
  const runtime = {
    AbortController,
    ReliquaryDashboardHost: {
      React: { createElement: (type, props, ...children) => ({ type, props, children }) },
      components: { Button: "button", Input: "input" },
      hooks: {
        useState(initial) {
          const index = slot++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], (update) => {
            states[index] = typeof update === "function" ? update(states[index]) : update;
          }];
        },
        useRef(initial) {
          const index = slot++;
          if (!(index in states)) states[index] = { current: initial };
          return states[index];
        },
        useEffect(effect) {
          const index = slot++;
          if (!(index in cleanups)) cleanups[index] = effect();
        },
      },
    },
    ReliquarySetupClient: {
      candidate: (main, phy, config) => ({ main, phy, config }),
      message: (error) => error.message,
    },
    ReliquaryDashboardViews: { meta() {} },
  };
  vm.runInNewContext(source, runtime);
  const setup = {
    projects() { throw new Error("Initial onboarding must not fetch projects"); },
    async create({ kind, path }) {
      creations.push([kind, path]);
      return { path };
    },
    async validate(candidate) {
      validations.push(candidate);
      return { valid: true };
    },
  };
  return {
    creations, validations,
    render() {
      slot = 0;
      return runtime.ReliquaryOnboarding.Onboarding({ status, setup, mutationsEnabled: true, ...pickers });
    },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

function find(tree, matches) {
  if (Array.isArray(tree)) return tree.map((child) => find(child, matches)).find(Boolean);
  if (!tree || typeof tree !== "object") return undefined;
  return matches(tree) ? tree : find(tree.children, matches);
}
const button = (tree, text) => find(tree, (node) => node.type === "button" && node.children.includes(text));
const region = (tree, label) => find(tree, (node) => node.type === "section" && node.props?.["aria-label"] === label);
const text = (tree, value) => find(tree, (node) => node.children?.includes(value));

test("native selections are inert on cancel and Save As requires an independent confirmation", async () => {
  const calls = [];
  const harness = renderOnboarding({
    async pickOpenPath(kind) {
      calls.push("open " + kind);
      return { REL: "D:/selected.rel", PHY: null, config: "D:/chosen.cfg" }[kind];
    },
    async pickSavePath(kind) {
      calls.push("save " + kind);
      return "D:/created." + kind.toLowerCase();
    },
  });
  const render = () => harness.render();
  assert.ok(text(render(), "C:/synthetic/detected.cfg"));
  assert.equal(find(render(), (node) => node.type === "input"), undefined);
  await button(render(), "Select REL").props.onClick();
  await button(render(), "Select PHY").props.onClick();
  await button(render(), "Change configuration").props.onClick();
  assert.ok(text(render(), "D:/selected.rel"));
  assert.ok(text(render(), "C:/synthetic/active.phy"));
  assert.ok(text(render(), "D:/chosen.cfg"));
  assert.equal(find(render(), (node) => node.props?.role === "alert"), undefined);

  await button(render(), "Create REL").props.onClick();
  let confirmation = region(render(), "Confirm owner creation");
  assert.ok(text(confirmation, "D:/created.rel"));
  assert.deepEqual(harness.creations, []);
  assert.deepEqual(harness.validations, []);
  await button(confirmation, "Create REL").props.onClick();
  assert.ok(text(region(render(), "General memory"), "D:/created.rel"));

  await button(render(), "Create PHY").props.onClick();
  confirmation = region(render(), "Confirm owner creation");
  assert.ok(text(confirmation, "D:/created.phy"));
  await button(confirmation, "Create PHY").props.onClick();
  assert.ok(text(region(render(), "Active identity"), "D:/created.phy"));
  assert.deepEqual(calls, ["open REL", "open PHY", "open config", "save REL", "save PHY"]);
  assert.deepEqual(harness.creations, [["general_rel", "D:/created.rel"], ["phy", "D:/created.phy"]]);
  assert.deepEqual(harness.validations, []);
});

test("typed cancellation is inert and unavailable dialogs keep manual fallback available", async () => {
  const harness = renderOnboarding({
    async pickOpenPath() { return { status: "cancelled" }; },
    async pickSavePath() { return { status: "unavailable" }; },
  });
  await button(harness.render(), "Select REL").props.onClick();
  assert.ok(text(region(harness.render(), "General memory"), "C:/synthetic/main.rel"));
  await button(harness.render(), "Create REL").props.onClick();
  assert.equal(region(harness.render(), "Confirm owner creation"), undefined);
  assert.ok(text(harness.render(), "Native file dialogs are unavailable for this connection. Try again or enter the path manually."));
  assert.ok(button(harness.render(), "Enter path manually"));
  assert.deepEqual(harness.creations, []);
});

test("unavailable native dialogs offer only explicit manual path entry", async () => {
  const harness = renderOnboarding();
  let view = harness.render();
  assert.ok(text(view, "Native file dialogs unavailable for this connection"));
  for (const label of ["Select REL", "Select PHY", "Create REL", "Create PHY", "Change configuration"]) {
    assert.equal(button(view, label).props.disabled, true);
  }
  assert.equal(find(view, (node) => node.type === "input"), undefined);
  button(view, "Enter path manually").props.onClick();

  view = harness.render();
  const main = find(region(view, "General memory"), (node) => node.type === "input");
  main.props.onChange({ currentTarget: { value: "D:/manual.rel" } });
  button(harness.render(), "Create REL at this path").props.onClick();
  assert.deepEqual(harness.creations, []);
  const confirmation = region(harness.render(), "Confirm owner creation");
  assert.ok(text(confirmation, "D:/manual.rel"));
  await button(confirmation, "Create REL").props.onClick();
  assert.deepEqual(harness.creations, [["general_rel", "D:/manual.rel"]]);
  await button(harness.render(), "Validate").props.onClick();
  assert.deepEqual(harness.validations, [{
    main: "D:/manual.rel", phy: "C:/synthetic/active.phy", config: "C:/synthetic/detected.cfg",
  }]);
});

test("picker requests are single-flight and late results after unmount are discarded", async () => {
  let calls = 0;
  let release;
  const harness = renderOnboarding({
    pickOpenPath() {
      calls++;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const select = button(harness.render(), "Select REL");
  const first = select.props.onClick();
  const second = select.props.onClick();
  assert.equal(calls, 1);
  assert.equal(find(harness.render(), (node) => node.type === "fieldset").props.disabled, true);
  harness.unmount();
  release("D:/stale.rel");
  await Promise.all([first, second]);
  assert.ok(text(region(harness.render(), "General memory"), "C:/synthetic/main.rel"));
  assert.deepEqual(harness.creations, []);
  assert.deepEqual(harness.validations, []);
});

test("Save As cancellation has no effects and picker errors leave manual entry available", async () => {
  const harness = renderOnboarding({
    async pickOpenPath() { throw new Error("untrusted private detail"); },
    async pickSavePath() { return null; },
  });
  await button(harness.render(), "Create REL").props.onClick();
  assert.equal(region(harness.render(), "Confirm owner creation"), undefined);
  assert.equal(find(harness.render(), (node) => node.props?.role === "alert"), undefined);
  await button(harness.render(), "Select REL").props.onClick();
  assert.ok(text(harness.render(), "Could not open the native file dialog. Try again or enter the path manually."));
  assert.equal(text(harness.render(), "untrusted private detail"), undefined);
  assert.ok(button(harness.render(), "Enter path manually"));
  assert.deepEqual(harness.creations, []);
  assert.deepEqual(harness.validations, []);
});
