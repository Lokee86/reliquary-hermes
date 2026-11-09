const fs = require("node:fs");
const path = require("node:path");

const src = path.resolve(__dirname, "../src");
const views = ["state.js", "views.js", "graph.js", "memory_mutations.js", "graph_mutations.js", "owner_content.js"];

function readSources(names) {
  const content = names.map((name) => fs.readFileSync(path.join(src, name), "utf8")).join("\n\n");
  if (/@tauri-apps|@hermes\/plugin-sdk|\binvoke\s*\(|__HERMES_SESSION_TOKEN__/.test(content)) {
    throw new Error("Dashboard source includes a forbidden native, direct invoke, or credential surface.");
  }
  return content;
}

// The dashboard modules exchange dependencies in this bundle-local object.
// Shadow their original module root without publishing anything to the shell.
function scopedSources(names) {
  return `(function (globalThis, module) {
${readSources(names)}
})(runtime);`;
}

function buildLiveBundle() {
  return `function createReliquarySurface(options) {
  const { React, hooks = React, components } = options;
  const runtime = { crypto: globalThis.crypto, ReliquaryDashboardHost: { React, hooks, components } };
  ${scopedSources(["client.js", "live_transport.js", ...views, "setup_client.js", "onboarding.js", "surface.js"])}
  return runtime.ReliquaryDashboardSurface(options);
}`;
}

function buildFixtureBundle(fixture) {
  return `(function (sdk) {
  ${readSources(["web_components.js"])}
  const { React, hooks } = sdk;
  const runtime = { crypto: globalThis.crypto, ReliquaryDashboardHost: { React, hooks, components: webComponents(sdk) }, ReliquaryDashboardFixture: ${JSON.stringify(fixture)} };
  ${scopedSources(["client.js", "fixtures.js", ...views, "index.js"])}
})(window.__HERMES_PLUGIN_SDK__);`;
}

module.exports = { buildLiveBundle, buildFixtureBundle, readSources };
