import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dashboard = dirname(dirname(fileURLToPath(import.meta.url)));
const common = {
  absWorkingDir: dashboard,
  bundle: true,
  target: "chrome130",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  inject: [resolve(dashboard, "scripts/react-jsx.mjs")],
  minify: true,
  legalComments: "linked",
  define: { "process.env.NODE_ENV": '"production"' },
};

const webReact = {
  name: "hermes-web-react",
  setup(plugin) {
    plugin.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hermes" }));
    plugin.onLoad({ filter: /.*/, namespace: "hermes" }, () => ({
      loader: "js",
      contents: "module.exports = window.__HERMES_PLUGIN_SDK__.React",
    }));
  },
};

await build({ ...common, entryPoints: ["src/web.tsx"], outfile: "dist/index.js",
  format: "iife", plugins: [webReact] });

const styles = await readFile(resolve(dashboard, "dist/index.css"), "utf8");
const desktopStyles = {
  name: "hermes-desktop-styles",
  setup(plugin) {
    plugin.onResolve({ filter: /^reliquary:styles$/ }, () => ({ path: "styles", namespace: "hermes" }));
    plugin.onLoad({ filter: /.*/, namespace: "hermes" }, () => ({
      loader: "text", contents: styles,
    }));
  },
};
await build({ ...common, entryPoints: ["../desktop/src/plugin.tsx"], outfile: "../desktop/plugin.js",
  format: "esm", loader: { ".css": "empty" }, plugins: [desktopStyles],
  external: ["react", "react/jsx-runtime", "@hermes/plugin-sdk"] });
