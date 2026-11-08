const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDir = path.resolve(root, "dist");
if (!outputDir.startsWith(root + path.sep)) throw new Error("Refusing output outside dashboard package.");

const fixturePath = path.resolve(root, "fixtures", "mock-responses.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const sources = ["src/state.js", "src/mock.js", "src/index.js"];
const sourceText = sources.map((name) => {
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) throw new Error(`Refusing source outside dashboard package: ${name}`);
  return fs.readFileSync(file, "utf8");
});
const forbidden = /@tauri-apps|@hermes\/plugin-sdk|\binvoke\s*\(|__HERMES_SESSION_TOKEN__/;
if (forbidden.test(sourceText.join("\n"))) throw new Error("Dashboard source includes a forbidden native, direct invoke, or credential surface.");

const fixtureScript = `(function (root) { root.ReliquaryDashboardFixture = ${JSON.stringify(fixture)}; })(globalThis);`;
const bundle = ["/* Generated from src/ with synthetic fixture data. Rebuild with node scripts/build.cjs. */", sourceText[0], fixtureScript, sourceText[1], sourceText[2]].join("\n\n");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "index.js"), bundle, "utf8");
fs.copyFileSync(path.resolve(root, "styles.css"), path.join(outputDir, "style.css"));
console.log(`Built ${path.relative(root, path.join(outputDir, "index.js"))} and style.css from mock-only sources.`);
