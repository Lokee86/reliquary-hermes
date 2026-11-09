const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const fixtureMode = args.length === 1 && args[0] === "--fixture";
if (args.length && !fixtureMode) throw new Error("Usage: node dashboard/scripts/build.cjs [--fixture]");

const packageDir = fixtureMode ? path.resolve(root, "../host/.test-tmp/dashboard-fixture") : root;
const outputDir = path.join(packageDir, "dist");
const sources = fixtureMode
  ? ["client.js", "fixtures.js", "state.js", "views.js", "graph.js", "memory_mutations.js", "graph_mutations.js", "owner_content.js", "index.js"]
  : ["client.js", "live_transport.js", "state.js", "views.js", "graph.js", "memory_mutations.js", "graph_mutations.js", "owner_content.js", "live.js"];
const sourceText = sources.map((name) => fs.readFileSync(path.join(root, "src", name), "utf8"));
const forbidden = /@tauri-apps|@hermes\/plugin-sdk|\binvoke\s*\(|__HERMES_SESSION_TOKEN__/;
if (forbidden.test(sourceText.join("\n"))) throw new Error("Dashboard source includes a forbidden native, direct invoke, or credential surface.");

const bundle = ["/* Generated from dashboard/src. Rebuild with node dashboard/scripts/build.cjs. */"];
if (fixtureMode) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "mock-responses.json"), "utf8"));
  bundle.push(`(function (root) { root.ReliquaryDashboardFixture = ${JSON.stringify(fixture)}; })(globalThis);`);
}
bundle.push(...sourceText);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "index.js"), bundle.join("\n\n"), "utf8");
fs.copyFileSync(path.join(root, "styles.css"), path.join(outputDir, "style.css"));
if (fixtureMode) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  delete manifest.api;
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(`Built ${fixtureMode ? "fixture" : "live"} dashboard in ${outputDir}.`);
