import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [fixturePath] = process.argv.slice(2);
assert(fixturePath, "Pass the isolated Desktop acceptance fixture JSON path.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const readOnly = fixture.expectDesktopReadOnly === true;
assert(!readOnly || !fixture.verifyMemoryWrite, "A read-only fixture cannot request native writes.");
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
  // Use the ordinary plugin opt-in and "choose a provider later" in the isolated renderer.
  await page.addInitScript(() => {
    localStorage.setItem("hermes.desktop.pluginDecisions.v2", JSON.stringify({ "reliquary-hermes": true }));
    localStorage.setItem("hermes-onboarding-skipped-v1", "1");
  });
  await page.reload();
  await page.getByRole("button", { name: "Reliquary", exact: true }).click({ timeout: 90_000 });
  const root = page.locator(".rly-desktop");
  await root.waitFor();

  const connect = root.getByRole("button", { name: "Connect Reliquary", exact: true });
  const compatibilityNotice = root.getByRole("note").filter({
    hasText: "Use the Reliquary web dashboard for setup and write management.",
  });
  if (readOnly) await compatibilityNotice.waitFor();
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
    const validate = root.getByRole("button", { name: "Validate", exact: true });
    if (readOnly) {
      assert(await validate.isDisabled());
      assert(await connect.isDisabled());
    } else {
      await validate.click();
      for (const id of fixture.ownerIds) await root.getByText(id, { exact: false }).first().waitFor();
      await connect.click();
    }
  }

  if (readOnly && fixture.candidate) {
    console.log("Desktop setup and picker remained visible with Validate and Connect disabled.");
  } else {
    await browseOwners(root, page, connect, compatibilityNotice);
  }
} finally {
  await app.close();
}

async function browseOwners(root, page, connect, compatibilityNotice) {
  const owners = root.getByRole("combobox", { name: "Browse authorized owner" });
  await owners.waitFor({ timeout: 45_000 });
  const ids = await owners.locator("option").evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(new Set(ids), new Set(fixture.ownerIds));
  assert.equal(await connect.count(), 0);
  if (fixture.expectedConfigPath) {
    await root.locator(".rly-owner-meta").getByText(fixture.expectedConfigPath, { exact: true }).waitFor();
  }
  if (readOnly) {
    await owners.selectOption(fixture.ownerIds[0]);
    const list = root.getByRole("list", { name: "Memories in this page" });
    await root.getByRole("button", { name: "List page", exact: true }).click();
    await list.waitFor();
    if (fixture.expectedMemory) {
      await list.getByRole("button", { name: new RegExp(fixture.expectedMemory.title) }).click();
      await root.locator(".rly-inspector").getByText(fixture.expectedMemory.body, { exact: true }).waitFor();
    }
    assert.equal(await root.locator(".rly-memory-write-form, .rly-graph-write-panel, .rly-community-rename").count(), 0);
    await compatibilityNotice.waitFor();
    console.log("Desktop read the web-configured profile and Memories without a mutation writer.");
  } else {
    assert.equal(await compatibilityNotice.count(), 0);
  }
  if (fixture.verifyMemoryWrite) {
    assert(fixture.candidate, "The write probe requires fresh isolated owners.");
    const title = "Hosted Desktop authority proof";
    const body = "Synthetic worker-verified Memory body.";
    const replacementTitle = "Corrected Desktop proof";
    const replacementBody = "Corrected worker-verified Memory body.";
    const inspector = root.locator(".rly-inspector");
    const refresh = root.getByRole("button", { name: "Refresh owner data", exact: true });
    const list = root.getByRole("list", { name: "Memories in this page" });
    const formFor = (name) => inspector.locator(".rly-memory-write-form")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    async function save(form, name) {
      await form.getByRole("button", { name, exact: true }).click();
      const result = form.locator(".rly-write-success, .rly-write-error");
      await result.waitFor({ timeout: 30_000 });
      assert.match(await result.textContent() ?? "", /^Saved\. Receipt /);
    }

    const create = formFor("Create user-origin Memory");
    await create.getByRole("textbox", { name: "Title" }).fill(title);
    await create.getByRole("textbox", { name: "Body" }).fill(body);
    await save(create, "Create Memory");
    await refresh.click();
    await root.getByRole("button", { name: "List page", exact: true }).click();
    await list.getByRole("button", { name: new RegExp(title) }).click();
    await inspector.getByText(body, { exact: true }).waitFor();

    const edit = formFor("Correct selected Memory");
    await edit.getByRole("button", { name: "Save correction", exact: true, disabled: false }).waitFor();
    const editTitle = edit.getByRole("textbox", { name: "Replacement title" });
    const editBody = edit.getByRole("textbox", { name: "Replacement body" });
    await editTitle.fill(replacementTitle);
    await editBody.fill(replacementBody);
    assert.equal(await editTitle.inputValue(), replacementTitle);
    assert.equal(await editBody.inputValue(), replacementBody);
    await save(edit, "Save correction");
    await refresh.click();
    await list.getByRole("button", { name: new RegExp(replacementTitle) }).click();
    await inspector.getByText(replacementBody, { exact: true }).waitFor();

    await list.getByRole("button", { name: new RegExp(title) }).click();
    const retire = formFor("Retire superseded Memory");
    await retire.getByRole("checkbox", { name: "Confirm terminal retirement of this revision" }).check();
    await save(retire, "Retire Memory");
    await refresh.click();
    await inspector.getByText("Tombstoned Memory", { exact: true }).waitFor();
    console.log("Desktop Memory create, correction, and retirement passed.");
  }
  await owners.selectOption(fixture.ownerIds[1]);
  await root.getByText("PHY", { exact: true }).first().waitFor();
  assert.equal(await root.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);
  console.log(fixture.candidate ? "Desktop first-run setup and owner management passed."
    : "Desktop reopened the configured profile and browsed the same owners.");
}
