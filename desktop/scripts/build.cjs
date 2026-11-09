const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const desktop = resolve(__dirname, "..");

function buildDesktopBundle(common, styles) {
  const entry = readFileSync(resolve(desktop, "src/plugin.js"), "utf8");
  return [
    "/* Generated from dashboard/src and desktop/src. Rebuild with node desktop/scripts/build.cjs. */",
    "const reliquaryStyles = " + JSON.stringify(styles) + ";",
    common,
    entry,
  ].join("\n");
}

if (require.main === module) {
  const { buildLiveBundle } = require("../../dashboard/scripts/live-bundle.cjs");
  const styles = readFileSync(resolve(desktop, "../dashboard/styles.css"), "utf8");
  const destination = resolve(process.argv[2] || resolve(desktop, "plugin.js"));
  writeFileSync(destination, buildDesktopBundle(buildLiveBundle(), styles), "utf8");
  console.log("Built Hermes Desktop contribution at " + destination);
}

module.exports = { buildDesktopBundle };
