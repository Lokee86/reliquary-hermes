import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [address, playwright, evidencePath, mode] = process.argv.slice(2);
assert(address && playwright && evidencePath && (mode === undefined || mode === "--configured"));
const base = new URL(address);
assert.equal(base.protocol, "http:");
assert.equal(base.hostname, "127.0.0.1");
const { paths, ids, projectName, profilePath, createOwner, createPhy, fallbackCount, expectGeneralOnly } =
  JSON.parse(await readFile(evidencePath, "utf8"));
const { chromium } = await import(pathToFileURL(playwright).href);
const screenshots = process.env.HU07_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // The installed smoke is local even when a theme declares a remote font.
  await page.route("**/*", (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base.href);
  await page.getByRole("link", { name: "Reliquary", exact: true }).click();
  const owner = page.getByRole("combobox", { name: "Browse authorized owner" });
  const setupHeading = page.getByRole("heading", { name: "Set up Reliquary" });

  async function checkGeneralOnly(savedPath) {
    const projects = page.getByRole("region", { name: "Project memories", exact: true });
    await projects.getByText("Unavailable on this Hermes build", { exact: true }).waitFor();
    await projects.getByText("Project conversations use General memory on this Hermes version.", { exact: true }).waitFor();
    const project = projects.getByRole("region", { name: projectName, exact: true });
    await project.waitFor();
    assert.equal(await projects.getByRole("button", { name: /^(Select REL|Create REL|Use General)$/ }).count(), 0);
    assert.equal(await page.getByText(projectName + " REL path", { exact: true }).count(), 0);
    if (savedPath) {
      await project.getByText("Saved project REL", { exact: true }).waitFor();
      await project.getByText(savedPath, { exact: true }).waitFor();
    }
  }

  if (mode !== "--configured") {
    const main = page.getByRole("textbox", { name: "Main REL path" });
    const phy = page.getByRole("textbox", { name: "Active PHY path" });
    const config = page.getByRole("textbox", { name: "Reliquary config path (optional)" });
    const validate = page.getByRole("button", { name: "Validate", exact: true });
    await setupHeading.waitFor();
    assert.equal(await owner.count(), 0);
    const general = page.getByRole("region", { name: "General memory", exact: true });
    const identity = page.getByRole("region", { name: "Active identity", exact: true });
    const hasNativeDialogs = await general.getByRole("button", { name: "Select REL", exact: true }).isEnabled();
    if (!hasNativeDialogs) {
      await page.getByText("Native file dialogs unavailable for this connection", { exact: true }).waitFor();
    }
    assert.equal(await main.count(), 0);
    assert.equal(await phy.count(), 0);
    assert.equal(await config.count(), 0);
    assert.equal(await page.getByText("Project memories", { exact: true }).count(), 0);
    for (const [region, kind] of [[general, "REL"], [identity, "PHY"]]) {
      for (const action of ["Select", "Create"]) {
        assert.equal(await region.getByRole("button", { name: action + " " + kind, exact: true }).isEnabled(), hasNativeDialogs);
      }
    }
    await page.getByRole("button", { name: "Enter path manually", exact: true }).click();
    await main.waitFor();

    const presentation = [];
    for (const [theme, mode] of [["Hermes Teal", "dark"], ["Nous Blue", "light"]]) {
      await page.getByRole("button", { name: "Switch theme" }).click();
      await page.getByRole("option", { name: new RegExp(`^${theme}(?:$| [^\\(])`) }).click();
      await main.fill(paths.main);
      await phy.fill(paths.phy);
      await main.press("Tab");
      assert.equal(await phy.evaluate((field) => field.matches(":focus-visible")), true);
      assert.equal(await main.inputValue(), paths.main);
      assert.equal(await phy.inputValue(), paths.phy);
      const panel = page.locator(".rly-dashboard");
      assert.equal(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
      presentation.push(await phy.evaluate((field) => {
        const style = getComputedStyle(field);
        return [style.color, style.backgroundColor];
      }));
      if (screenshots) await page.screenshot({ path: join(screenshots, `web-setup-${mode}.png`) });
    }
    assert.notDeepEqual(presentation[0], presentation[1], "Hermes theme switch recolors the setup fields");
    await main.clear();
    await phy.clear();
    await validate.click();
    await page.getByRole("alert").getByText("Enter an absolute local path for the main REL.").waitFor();
    await main.fill(paths.phy);
    await phy.fill(paths.main);
    await config.fill(paths.config);
    await validate.click();
    await page.getByRole("alert").getByText(/Validation failed/).waitFor();
    await page.getByText(/Rejected · PHY.*wrong owner kind/).waitFor();
    for (const [region, kind, filename] of [[general, "REL", createOwner], [identity, "PHY", createPhy]]) {
      if (!filename) continue;
      assert(profilePath);
      const destination = join(profilePath, filename);
      await (kind === "REL" ? main : phy).fill(destination);
      await region.getByRole("button", { name: "Create " + kind + " at this path", exact: true }).click();
      const confirmation = page.getByRole("region", { name: "Confirm owner creation", exact: true });
      await confirmation.getByText(destination, { exact: true }).waitFor();
      await confirmation.getByRole("button", { name: "Create " + kind, exact: true }).click();
      await page.getByText("Created owner files remain on disk if connection fails.").waitFor();
    }
    await main.fill(paths.main);
    await phy.fill(paths.phy);
    await validate.click();
    await page.getByText("Validation passed.", { exact: true }).waitFor();
    for (const id of [ids.main, ids.phy].filter(Boolean)) {
      await page.getByText(new RegExp("Accepted · .*" + id)).waitFor();
    }
    await connectSetup(0);

    if (paths.project && !expectGeneralOnly) {
      assert(projectName, "Pass the actual Hermes project display name as projectName.");
      await page.getByRole("button", { name: "Manage memory setup", exact: true }).click();
      await page.getByText("Project memories", { exact: true }).click();
      await page.getByRole("button", { name: "Enter path manually", exact: true }).click();
      await page.getByRole("textbox", { name: projectName + " REL path", exact: true }).fill(paths.project);
      await connectSetup(fallbackCount ?? 0);
    }
  }

  async function connectSetup(fallback) {
    await page.getByRole("button", { name: "Review and connect" }).click();
    const review = page.getByRole("region", { name: "Review connection" });
    if (fallback) await review.getByText(new RegExp("^" + fallback + " projects? will use General memory")).waitFor();
    else await review.getByRole("button", { name: "Connect Reliquary", exact: true }).waitFor();
    const applying = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/setup-v1/apply") && response.request().method() === "POST");
    await review.getByRole("button", { name: /^(Continue|Connect Reliquary)$/ }).click();
    const response = await applying;
    const result = await response.json();
    assert(response.ok() && result.configured === true,
      `Setup apply failed (HTTP ${response.status()}): ${result.detail ?? result.topology_error ?? "invalid response"}`);
  }

  await owner.waitFor();
  assert.equal(await setupHeading.count(), 0);
  for (const name of ["Refresh owner data", "Look up session"]) {
    const lines = await page.getByRole("button", { name, exact: true }).evaluate((button) => {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let segments = 0;
      while (walker.nextNode()) {
        range.selectNodeContents(walker.currentNode);
        segments += [...range.getClientRects()].filter((rect) => rect.width).length;
      }
      return segments;
    });
    assert.equal(lines, 1, `${name} stays on one line in the owner sidebar`);
  }
  await page.locator(".rly-owner-meta").getByText(paths.config, { exact: true }).waitFor();
  await page.locator(".rly-owner-meta").getByText(ids.phy, { exact: true }).waitFor();
  await owner.click();
  const menu = page.getByRole("listbox");
  await menu.getByRole("option", { name: "REL · Main REL", exact: true }).waitFor();
  const names = ["REL · Main REL", "PHY · Active user"];
  if (paths.project) names.push("REL · Project 1");
  assert.deepEqual(new Set(await menu.getByRole("option").allTextContents()), new Set(names));
  await menu.getByRole("option", { name: "PHY · Active user", exact: true }).click();
  await page.locator(".rly-owner-meta").getByText("PHY", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);
  await page.reload();
  await owner.waitFor();
  assert.equal(await setupHeading.count(), 0);
  if (screenshots) await page.screenshot({ path: join(screenshots, "web-configured.png") });
  await page.getByRole("button", { name: "Manage memory setup", exact: true }).click();
  if (expectGeneralOnly || projectName) {
    await page.getByText("Project memories", { exact: true }).click();
    if (expectGeneralOnly) await checkGeneralOnly(paths.project);
    else await page.getByRole("region", { name: projectName, exact: true }).getByText(/^Dedicated REL/).waitFor();
  }
  await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
  await owner.waitFor();
  assert.deepEqual(errors, []);
  console.log(mode === "--configured" ? "Chrome verified configured reopen." :
    "Chrome verified web-first validation, setup, owner discovery, and reload.");
} finally {
  await browser.close();
}
