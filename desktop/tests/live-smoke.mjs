import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [fixturePath] = process.argv.slice(2);
assert(fixturePath, "Pass the isolated Desktop acceptance fixture JSON path.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const readOnly = fixture.expectDesktopReadOnly === true;
const appearance = fixture.appearance;
assert(appearance === undefined || appearance === "dark" || appearance === "light");
assert(!readOnly || !fixture.verifyMemoryWrite, "A read-only fixture cannot request native writes.");
const { HU05_DESKTOP_EXE, HU05_DESKTOP_APP, HU05_PLAYWRIGHT, HP01_HERMES_CHECKOUT,
  HU05_DESKTOP_PYTHON, HU07_SCREENSHOT_DIR } = process.env;
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
    const { mainRel, activePhy, configPath, createPhy, projectRel } = fixture.candidate;
    await app.evaluate(({ dialog }, files) => {
      const showOpenDialog = dialog.showOpenDialog.bind(dialog);
      const queues = new Map([
        ["Choose a Reliquary REL", [null, files.mainRel, files.projectRel]],
        ["Choose a Reliquary PHY", [files.activePhy]],
        ["Choose a Reliquary configuration", [files.configPath]],
      ]);
      dialog.showOpenDialog = async (...args) => {
        const queue = queues.get(args.at(-1)?.title);
        if (!queue) return showOpenDialog(...args);
        const path = queue.shift();
        return { canceled: !path, filePaths: path ? [path] : [] };
      };
      if (files.createPhy) {
        const showSaveDialog = dialog.showSaveDialog.bind(dialog);
        const destinations = [null, files.createPhy];
        dialog.showSaveDialog = async (...args) => {
          if (args.at(-1)?.title !== "Create a Reliquary PHY") return showSaveDialog(...args);
          const path = destinations.shift();
          return { canceled: !path, filePath: path ?? undefined };
        };
      }
    }, { mainRel, activePhy, configPath, createPhy, projectRel });
  }

  const page = await app.firstWindow({ timeout: 90_000 });
  await page.route(/^https?:\/\//, (route) => {
    const { hostname } = new URL(route.request().url());
    return ["127.0.0.1", "localhost", "[::1]"].includes(hostname) ? route.continue() : route.abort();
  });
  // Use the ordinary plugin opt-in and "choose a provider later" in the isolated renderer.
  await page.addInitScript((mode) => {
    localStorage.setItem("hermes.desktop.pluginDecisions.v2", JSON.stringify({ "reliquary-hermes": true }));
    localStorage.setItem("hermes-onboarding-skipped-v1", "1");
    if (mode) localStorage.setItem("hermes-desktop-mode-v1", mode);
  }, appearance);
  await page.reload();
  await page.getByRole("button", { name: "Reliquary", exact: true }).click({ timeout: 90_000 });
  const root = page.locator(".rly-desktop");
  await root.waitFor();
  if (appearance) await page.waitForFunction((mode) => document.documentElement.dataset.hermesMode === mode, appearance);
  if (HU07_SCREENSHOT_DIR) await mkdir(HU07_SCREENSHOT_DIR, { recursive: true });

  const connect = root.getByRole("button", { name: "Review and connect", exact: true });
  const compatibilityNotice = root.getByRole("note").filter({
    hasText: "Use the Reliquary web dashboard for setup and write management.",
  });
  if (readOnly) await compatibilityNotice.waitFor();

  async function checkGeneralOnly() {
    const projects = root.getByRole("region", { name: "Project memories", exact: true });
    await projects.getByText("Unavailable on this Hermes build", { exact: true }).waitFor();
    await projects.getByText("Project conversations use General memory on this Hermes version.", { exact: true }).waitFor();
    const project = projects.getByRole("region", { name: fixture.projectName, exact: true });
    await project.waitFor();
    assert.equal(await projects.getByRole("button", { name: /^(Select REL|Create REL|Use General)$/ }).count(), 0);
    assert.equal(await root.getByText(fixture.projectName + " REL path", { exact: true }).count(), 0);
    if (fixture.savedProjectRel) {
      await project.getByText("Saved project REL", { exact: true }).waitFor();
      await project.getByText(fixture.savedProjectRel, { exact: true }).waitFor();
    }
  }

  if (fixture.candidate) {
    const { mainRel, activePhy, configPath, createPhy, projectRel, projectName } = fixture.candidate;
    const general = root.getByRole("region", { name: "General memory", exact: true });
    const identity = root.getByRole("region", { name: "Active identity", exact: true });
    const selectRel = general.getByRole("button", { name: "Select REL", exact: true });
    const input = (label) => root.getByRole("textbox", { name: label, exact: true });
    await connect.waitFor();
    await selectRel.click();
    await general.getByText("A General REL is required.", { exact: true }).waitFor();
    await selectRel.click();
    await general.getByText(mainRel, { exact: true }).waitFor();
    if (createPhy && !readOnly) {
      const create = identity.getByRole("button", { name: "Create PHY", exact: true });
      const confirm = root.getByRole("region", { name: "Confirm owner creation", exact: true });
      await create.click();
      await identity.getByText("An active PHY is required.", { exact: true }).waitFor();
      await create.click();
      await confirm.getByText(createPhy, { exact: true }).waitFor();
      await confirm.getByRole("button", { name: "Create owner file", exact: true }).click();
      await root.getByText("Created owner files remain on disk if connection fails.").waitFor();
      await identity.getByText(createPhy, { exact: true }).waitFor();
    } else {
      await identity.getByRole("button", { name: "Select PHY", exact: true }).click();
      await identity.getByText(activePhy, { exact: true }).waitFor();
    }
    await root.getByRole("button", { name: "Create Hermes project", exact: true }).click();
    await root.getByText(/In Hermes Desktop Chat, choose New project/).waitFor();
    await root.getByRole("button", { name: "Refresh projects", exact: true }).click();
    if (fixture.expectGeneralOnly) {
      await checkGeneralOnly();
    } else if (projectRel) {
      assert(projectName);
      const project = root.getByRole("region", { name: projectName, exact: true });
      await project.getByRole("button", { name: "Select REL", exact: true }).click();
      await project.getByText(projectRel, { exact: true }).waitFor();
    }
    await root.getByText("Advanced", { exact: true }).click();
    const main = input("Main REL path");
    assert.equal(await main.inputValue(), mainRel);
    assert.equal(await main.getAttribute("data-slot"), "input");
    await main.press("Tab");
    assert.equal(await input("Active PHY path").evaluate((field) => field.matches(":focus-visible")), true);
    assert.equal(await root.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
    if (configPath) {
      await root.getByRole("button", { name: "Select configuration", exact: true }).click();
      assert.equal(await input("Reliquary config path (optional)").inputValue(), configPath);
    }
    const validate = root.getByRole("button", { name: "Validate", exact: true });
    if (HU07_SCREENSHOT_DIR) await page.screenshot({ path: join(HU07_SCREENSHOT_DIR, `desktop-setup-${appearance}.png`) });
    if (readOnly) {
      assert(await validate.isDisabled());
      assert(await connect.isDisabled());
    } else {
      await validate.click();
      await root.getByText("Validation passed.", { exact: true }).waitFor();
      if (createPhy) {
        const result = await identity.getByText(/^Accepted · PHY · /).textContent();
        fixture.ownerIds[1] = result.split(" · ")[2];
      }
      for (const id of fixture.ownerIds) await root.getByText(id, { exact: false }).first().waitFor();
      await connect.click();
      const review = root.getByRole("region", { name: "Review connection", exact: true });
      if (fixture.expectGeneralOnly) {
        await review.getByRole("button", { name: "Connect Reliquary", exact: true }).waitFor();
        assert.equal(await review.getByRole("button", { name: "Continue", exact: true }).count(), 0);
      } else if (fixture.fallbackCount) {
        await review.getByText(new RegExp("^" + fixture.fallbackCount + " projects? will use General memory")).waitFor();
      }
      await review.getByRole("button", { name: /^(Continue|Connect Reliquary)$/ }).click();
    }
  }

  if (readOnly && fixture.candidate) {
    console.log("Desktop setup and picker remained visible with Validate and Connect disabled.");
  } else {
    await browseOwners(root, page, connect, compatibilityNotice);
    if (fixture.expectGeneralOnly) {
      await root.getByRole("button", { name: "Manage memory setup", exact: true }).click();
      await checkGeneralOnly();
      await root.getByRole("button", { name: "Back to dashboard", exact: true }).click();
      console.log("Desktop confirmed stock General-only setup on the configured profile.");
    }
  }
} finally {
  await app.close();
}

async function browseOwners(root, page, connect, compatibilityNotice) {
  const inspector = root.locator(".rly-inspector");
  async function expectBody(content) {
    const body = inspector.locator(".rly-body").filter({ hasText: content });
    await body.waitFor();
    assert.equal(await body.textContent(), content);
  }

  const owners = root.getByRole("combobox", { name: "Browse authorized owner" });
  await owners.waitFor({ timeout: 45_000 });
  await root.locator(".rly-owner-meta").getByText(fixture.ownerIds[1], { exact: true }).waitFor();
  await owners.click();
  const menu = page.getByRole("listbox");
  const main = menu.getByRole("option", { name: "REL · Main REL", exact: true });
  await main.waitFor();
  const names = ["REL · Main REL", "PHY · Active user"];
  for (let project = 1; project <= fixture.ownerIds.length - 2; project += 1) names.push(`REL · Project ${project}`);
  assert.deepEqual(new Set(await menu.getByRole("option").allTextContents()), new Set(names));
  await main.click();
  assert.equal(await connect.count(), 0);
  if (fixture.expectedConfigPath) {
    await root.locator(".rly-owner-meta").getByText(fixture.expectedConfigPath, { exact: true }).waitFor();
  }
  if (readOnly) {
    const list = root.getByRole("list", { name: "Memories in this page" });
    await root.getByRole("button", { name: "List page", exact: true }).click();
    if (fixture.expectedMemory) {
      await list.waitFor();
      await list.getByRole("button", { name: new RegExp(fixture.expectedMemory.title) }).click();
      await expectBody(fixture.expectedMemory.body);
    } else {
      await list.or(root.getByText("No Memories match this page.", { exact: true })).waitFor();
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
    await expectBody(body);

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
    await expectBody(replacementBody);

    await list.getByRole("button", { name: new RegExp(title) }).click();
    await expectBody(body);
    const retire = formFor("Retire superseded Memory");
    await retire.getByRole("checkbox", { name: "Confirm terminal retirement of this revision" }).click();
    await retire.getByRole("button", { name: "Retire Memory", exact: true }).click();
    const retirementResult = retire.locator(".rly-write-success, .rly-write-error");
    // The retirement form can unmount when the selected Memory becomes terminal.
    const receipt = await Promise.race([
      retirementResult.waitFor({ timeout: 30_000 }).then(() => retirementResult.textContent()),
      retire.waitFor({ state: "hidden", timeout: 30_000 }).then(() => null),
    ]);
    if (receipt !== null) assert.match(receipt, /^Saved\. Receipt /);
    await refresh.click();
    await inspector.getByText("Tombstoned Memory", { exact: true }).waitFor();
    console.log("Desktop Memory create, correction, and retirement passed.");
  }
  await owners.click();
  await menu.getByRole("option", { name: "PHY · Active user", exact: true }).click();
  await root.getByText("PHY", { exact: true }).first().waitFor();
  assert.equal(await root.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);
  if (HU07_SCREENSHOT_DIR) {
    await root.getByText("Loading graph…", { exact: true }).waitFor({ state: "hidden" });
    await page.screenshot({ path: join(HU07_SCREENSHOT_DIR, `desktop-configured-${appearance}.png`) });
  }
  console.log(fixture.candidate ? "Desktop first-run setup and owner management passed."
    : "Desktop reopened the configured profile and browsed the same owners.");
}
