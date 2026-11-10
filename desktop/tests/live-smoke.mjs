import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exerciseKnowledge, verifyLocalFixture } from "../../dashboard/tests/knowledge-live.mjs";

const [fixturePath] = process.argv.slice(2);
assert(fixturePath, "Pass an isolated Desktop smoke profile fixture.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
await verifyLocalFixture(fixturePath, fixture);
const { HU05_DESKTOP_EXE, HU05_DESKTOP_APP, HU05_PLAYWRIGHT, HP01_HERMES_CHECKOUT, HU05_DESKTOP_PYTHON } = process.env;
assert(HU05_DESKTOP_EXE && HU05_PLAYWRIGHT && HP01_HERMES_CHECKOUT && HU05_DESKTOP_PYTHON,
  "Set the local Electron, Playwright, Hermes checkout, and Python paths.");
const { _electron } = await import(pathToFileURL(HU05_PLAYWRIGHT).href);
const scratch = resolve(dirname(fixturePath), "electron");
const userData = join(scratch, "user-data");
const localData = join(scratch, "local-data");
await Promise.all([mkdir(userData, { recursive: true }), mkdir(localData, { recursive: true })]);
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => /^(Path|Pathext|SystemRoot|Windir|ProgramFiles(\(x86\))?|ComSpec)$/i.test(key)));

const args = [];
if (HU05_DESKTOP_APP) {
  const launch = join(scratch, "launcher");
  const sourceApp = resolve(HU05_DESKTOP_APP);
  await mkdir(launch, { recursive: true });
  await writeFile(join(launch, "package.json"), JSON.stringify({
    name: "hermes-reliquary-smoke", version: "0.23.0", type: "module", main: "entry.mjs",
  }));
  await writeFile(join(launch, "entry.mjs"), [
    'import { app } from "electron";',
    'app.setPath("appData", process.env.APPDATA);',
    'app.setPath("userData", process.env.HERMES_DESKTOP_USER_DATA_DIR);',
    'app.setPath("home", process.env.USERPROFILE);',
    'app.setPath("temp", process.env.TEMP);',
    "app.setAppPath(" + JSON.stringify(sourceApp) + ");",
    "await import(" + JSON.stringify(pathToFileURL(join(sourceApp, "dist/electron-main.mjs")).href) + ");",
  ].join("\n"));
  args.push(launch);
}

const app = await _electron.launch({
  executablePath: HU05_DESKTOP_EXE,
  args: [...args, "--user-data-dir=" + userData, "--enable-webgl", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--no-sandbox"],
  cwd: scratch,
  env: {
    ...env,
    HOME: scratch, USERPROFILE: scratch, APPDATA: userData, LOCALAPPDATA: localData,
    TEMP: scratch, TMP: scratch, TMPDIR: scratch,
    HERMES_HOME: fixture.home,
    HERMES_DESKTOP_HERMES_ROOT: HP01_HERMES_CHECKOUT,
    HERMES_DESKTOP_PYTHON: HU05_DESKTOP_PYTHON,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_DESKTOP_IGNORE_EXISTING: "1",
    HERMES_DESKTOP_ISOLATED_BACKEND: "1",
    HERMES_DESKTOP_SKIP_QUIT_CONFIRM: "1",
    HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION: "1",
    HERMES_DESKTOP_APP_NAME: `HermesReliquarySmoke-${process.pid}-${Date.now()}`,
    HERMES_DISABLE_LAZY_INSTALLS: "1",
    GIT_NO_LAZY_FETCH: "1", UV_OFFLINE: "1", PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPATH: [HP01_HERMES_CHECKOUT, fixture.integrationSrc].filter(Boolean).join(delimiter),
    TEST_WORKER_INDEX: "0",
  },
  timeout: 90000,
});

try {
  if (fixture.candidate) {
    await app.evaluate(({ dialog }, candidate) => {
      const open = dialog.showOpenDialog.bind(dialog);
      const save = dialog.showSaveDialog.bind(dialog);
      dialog.showOpenDialog = async (...args) => {
        const title = args.at(-1)?.title;
        const chosen = title === "Choose a Reliquary REL" ? candidate.mainRel :
          title === "Choose a Reliquary PHY" ? candidate.activePhy : null;
        return chosen ? { canceled: false, filePaths: [chosen] } : open(...args);
      };
      dialog.showSaveDialog = async (...args) => {
        if (candidate.createPhy && args.at(-1)?.title === "Create a Reliquary PHY") {
          return { canceled: false, filePath: candidate.createPhy };
        }
        return save(...args);
      };
    }, fixture.candidate);
  }
  const page = await app.firstWindow({ timeout: 90000 });
  await page.route(/^https?:\/\//, route => {
    const { hostname } = new URL(route.request().url());
    return ["127.0.0.1", "localhost", "[::1]"].includes(hostname) ? route.continue() : route.abort();
  });
  await page.setViewportSize({ width: 1440, height: 920 });
  page.on("pageerror", error => console.error(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /reliquary|plugin failed|unsupported import|WebGL/i.test(message.text())) console.error(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("hermes.desktop.pluginDecisions.v2", JSON.stringify({ "reliquary-hermes": true }));
    localStorage.setItem("hermes-onboarding-skipped-v1", "1");
  });
  await page.reload();
  const nav = page.getByRole("button", { name: "Reliquary", exact: true })
    .or(page.getByRole("link", { name: "Reliquary", exact: true }));
  await nav.first().click({ timeout: 240000 });
  await exerciseKnowledge(page, fixture, "desktop");
  await exerciseGraphSelection(page, fixture, "desktop");
} catch (error) {
  const page = app.windows()[0];
  if (page) await page.screenshot({ path: join(scratch, "failed-desktop.png"), timeout: 10000 }).catch(() => {});
  throw error;
} finally {
  await app.close();
}

async function exerciseGraphSelection(page, fixture, surface) {
  const app = page.locator(".rly-app");
  const sections = app.getByRole("navigation", { name: "Reliquary sections" });
  await sections.getByRole("button", { name: "Knowledge", exact: true }).click();
  await app.getByRole("complementary", { name: "Owner scope" })
    .getByRole("button", { name: /^REL\b/ }).click();
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  const graph = app.locator(".knowledge-graph-wrap");
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  if (fixture.community) {
    const nav = app.getByRole("complementary", { name: "Knowledge navigation" });
    if (fixture.community.onNextPage) await nav.getByRole("button", { name: "Next community page", exact: true }).click();
    const communityName = surface === "desktop" ? fixture.community.name : fixture.community.renamed ?? fixture.community.name;
    await nav.getByRole("button").filter({ hasText: communityName }).first().click();
    await page.waitForFunction((count) => document.querySelector(".knowledge-graph-wrap")
      ?.getAttribute("data-graph-node-count") === String(count), fixture.community.memberCount, { timeout: 40000 });
    await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  }

  const canvas = graph.locator("canvas");
  const box = await canvas.boundingBox();
  assert(box, "Graph canvas has no visible bounds.");
  const inspector = app.getByRole("complementary", { name: "Memory inspector" });
  let selected = false;
  const xSamples = fixture.community ? [0.40, 0.44, 0.48, 0.52, 0.56, 0.60] : [0.15, 0.325, 0.5, 0.675, 0.85];
  const ySamples = fixture.community ? [0.32, 0.36, 0.40, 0.44, 0.48, 0.52] : [0.15, 0.325, 0.5, 0.675, 0.85];
  for (const fy of ySamples) {
    for (const fx of xSamples) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      try {
        await inspector.getByText("Lifecycle", { exact: true }).waitFor({ timeout: fixture.community ? 250 : 500 });
        selected = true;
        break;
      } catch { /* Try the next visible point location. */ }
    }
    if (selected) break;
  }
  assert(selected, "Clicking visible graph node locations did not select a Memory.");
  await app.getByRole("button", { name: "List", exact: true }).click();
  await app.locator(".knowledge-memory-row[aria-pressed='true']").waitFor({ timeout: 30000 });
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  await inspector.getByText("Lifecycle", { exact: true }).waitFor({ timeout: 30000 });
}
