import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exerciseKnowledge } from "../../dashboard/tests/knowledge-live.mjs";

const [fixturePath] = process.argv.slice(2);
assert(fixturePath, "Pass an isolated Desktop smoke profile fixture.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
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
    HERMES_DESKTOP_APP_NAME: "HermesReliquarySmoke",
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
} catch (error) {
  const page = app.windows()[0];
  if (page) await page.screenshot({ path: join(scratch, "failed-desktop.png"), timeout: 10000 }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
