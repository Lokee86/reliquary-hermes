import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [fixturePath] = process.argv.slice(2);
assert(fixturePath, "Pass the isolated Desktop acceptance fixture JSON path.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const { HU05_DESKTOP_EXE, HU05_DESKTOP_APP, HU05_PLAYWRIGHT, HP01_HERMES_CHECKOUT,
  HU05_DESKTOP_PYTHON } = process.env;
assert(HU05_DESKTOP_EXE && HU05_PLAYWRIGHT && HP01_HERMES_CHECKOUT && HU05_DESKTOP_PYTHON,
  "Set HU05_DESKTOP_EXE, HU05_PLAYWRIGHT, HP01_HERMES_CHECKOUT and HU05_DESKTOP_PYTHON.");
const { _electron } = await import(pathToFileURL(HU05_PLAYWRIGHT).href);
const scratch = resolve(dirname(fixturePath), "electron");
const userData = join(scratch, "user-data");
const localData = join(scratch, "local-data");
await Promise.all([mkdir(userData, { recursive: true }), mkdir(localData, { recursive: true })]);
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => /^(Path|Pathext|SystemRoot|Windir|ProgramFiles(\(x86\))?|ComSpec)$/i.test(key)));

const args = [];
if (HU05_DESKTOP_APP) {
  // Electron may resolve Known Folders before Hermes applies its own path override.
  // Bootstrap an isolated user-data path, then import the unchanged source-built main.
  const launchDir = join(scratch, "launcher");
  const sourceApp = resolve(HU05_DESKTOP_APP);
  await mkdir(launchDir, { recursive: true });
  await writeFile(join(launchDir, "package.json"), JSON.stringify({
    name: "hermes-hu05-test", version: "0.23.0", type: "module", main: "entry.mjs",
  }));
  await writeFile(join(launchDir, "entry.mjs"), [
    'import { app } from "electron";',
    'app.setPath("appData", process.env.APPDATA);',
    'app.setPath("userData", process.env.HERMES_DESKTOP_USER_DATA_DIR);',
    'app.setPath("home", process.env.USERPROFILE);',
    'app.setPath("temp", process.env.TEMP);',
    "app.setAppPath(" + JSON.stringify(sourceApp) + ");",
    "await import(" + JSON.stringify(pathToFileURL(join(sourceApp, "dist/electron-main.mjs")).href) + ");",
  ].join("\n"));
  args.push(launchDir);
}

const app = await _electron.launch({
  executablePath: HU05_DESKTOP_EXE,
  args: [...args, "--user-data-dir=" + userData,
    "--disable-gpu", "--no-sandbox"],
  cwd: scratch,
  env: {
    ...env,
    HOME: scratch,
    USERPROFILE: scratch,
    APPDATA: userData,
    LOCALAPPDATA: localData,
    TEMP: scratch,
    TMP: scratch,
    TMPDIR: scratch,
    HERMES_HOME: fixture.home,
    HERMES_DESKTOP_HERMES_ROOT: HP01_HERMES_CHECKOUT,
    HERMES_DESKTOP_PYTHON: HU05_DESKTOP_PYTHON,
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_DESKTOP_IGNORE_EXISTING: "1",
    HERMES_DESKTOP_ISOLATED_BACKEND: "1",
    HERMES_DESKTOP_SKIP_QUIT_CONFIRM: "1",
    HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION: "1",
    HERMES_DESKTOP_APP_NAME: "HermesHU05Acceptance",
    HERMES_DISABLE_LAZY_INSTALLS: "1",
    GIT_NO_LAZY_FETCH: "1",
    UV_OFFLINE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPATH: [HP01_HERMES_CHECKOUT, fixture.integrationSrc].filter(Boolean).join(delimiter),
    TEST_WORKER_INDEX: "0",
  },
  timeout: 90_000,
});

try {
  if (fixture.candidate) {
    const { mainRel, activePhy, configPath } = fixture.candidate;
    await app.evaluate(({ dialog }, files) => {
      const showOpenDialog = dialog.showOpenDialog.bind(dialog);
      const queues = new Map([
        ["Choose a Reliquary REL", [null, files.mainRel]],
        ["Choose a Reliquary PHY", [files.activePhy]],
        ["Choose a Reliquary configuration", [files.configPath]],
      ]);
      dialog.showOpenDialog = async (...args) => {
        const queue = queues.get(args.at(-1)?.title);
        if (!queue) return showOpenDialog(...args);
        const path = queue.shift();
        return { canceled: !path, filePaths: path ? [path] : [] };
      };
    }, { mainRel, activePhy, configPath });
  }

  const page = await app.firstWindow({ timeout: 90_000 });
  // Seed the ordinary plugin opt-in in this test window's isolated renderer data.
  await page.addInitScript(() => localStorage.setItem("hermes.desktop.pluginDecisions.v2",
    JSON.stringify({ "reliquary-hermes": true })));
  await page.reload();
  await page.getByRole("button", { name: "Reliquary", exact: true }).click({ timeout: 90_000 });
  const root = page.locator(".rly-desktop");
  await root.waitFor();

  const connect = root.getByRole("button", { name: "Connect Reliquary", exact: true });
  if (fixture.candidate) {
    const { mainRel, activePhy, configPath } = fixture.candidate;
    const browse = (label) => root.getByRole("button", { name: "Browse for " + label, exact: true });
    const input = (label) => root.getByRole("textbox", { name: label, exact: true });
    await connect.waitFor();
    await browse("Main REL path").click();
    assert.equal(await input("Main REL path").inputValue(), "");
    await browse("Main REL path").click();
    await browse("Active PHY path").click();
    assert.equal(await input("Main REL path").inputValue(), mainRel);
    assert.equal(await input("Active PHY path").inputValue(), activePhy);
    if (configPath) {
      await browse("Reliquary config path (optional)").click();
      assert.equal(await input("Reliquary config path (optional)").inputValue(), configPath);
    }
    await root.getByRole("button", { name: "Validate", exact: true }).click();
    for (const id of fixture.ownerIds) await root.getByText(id, { exact: false }).first().waitFor();
    await connect.click();
  }

  const owners = root.getByRole("combobox", { name: "Browse authorized owner" });
  await owners.waitFor({ timeout: 45_000 });
  const ids = await owners.locator("option").evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(new Set(ids), new Set(fixture.ownerIds));
  assert.equal(await connect.count(), 0);
  if (fixture.expectedConfigPath) {
    await root.locator(".rly-owner-meta").getByText(fixture.expectedConfigPath, { exact: true }).waitFor();
  }
  await owners.selectOption(fixture.ownerIds[1]);
  await root.getByText("PHY", { exact: true }).first().waitFor();
  assert.equal(await root.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);
  console.log(fixture.candidate ? "Desktop first-run setup and owner management passed."
    : "Desktop reopened the configured profile and browsed the same owners.");
} finally {
  await app.close();
}
