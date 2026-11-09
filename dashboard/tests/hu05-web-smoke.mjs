import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [address, playwright, evidencePath, mode] = process.argv.slice(2);
assert(address && playwright && evidencePath && (mode === undefined || mode === "--configured"));
const base = new URL(address);
assert.equal(base.protocol, "http:");
assert.equal(base.hostname, "127.0.0.1");
const { paths, ids, projectName, profilePath, createOwner, fallbackCount } = JSON.parse(await readFile(evidencePath, "utf8"));
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
  if (mode !== "--configured") {
    const main = page.getByRole("textbox", { name: "Main REL path" });
    const phy = page.getByRole("textbox", { name: "Active PHY path" });
    const config = page.getByRole("textbox", { name: "Reliquary config path (optional)" });
    const validate = page.getByRole("button", { name: "Validate", exact: true });
    await setupHeading.waitFor();
    assert.equal(await owner.count(), 0);
    const general = page.getByRole("region", { name: "General memory", exact: true });
    const identity = page.getByRole("region", { name: "Active identity", exact: true });
    const picker = page.getByRole("region", { name: "Browse Hermes host files" });
    const advanced = page.getByText("Advanced", { exact: true });
    await general.getByRole("button", { name: "Select REL", exact: true }).click();
    await picker.getByText("Browsing files on the machine hosting Hermes.").waitFor();
    await picker.getByRole("button", { name: "Cancel", exact: true }).click();
    await advanced.click();
    await main.waitFor();
    assert.equal(await page.getByRole("textbox", { name: /^Project \d+ ID$/ }).count(), 0);
    await page.getByRole("button", { name: "Create Hermes project", exact: true }).click();
    await page.getByText("hermes project create <name>", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Refresh projects", exact: true }).click();

    async function pick(region, kind, path) {
      await region.getByRole("button", { name: "Select " + kind, exact: true }).click();
      await picker.getByTitle(profilePath, { exact: true }).click();
      await picker.getByRole("button", { name: path.split(/[\\/]/).at(-1), exact: true }).click();
    }
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
    if (createOwner) {
      assert(profilePath);
      await general.getByRole("button", { name: "Create REL", exact: true }).click();
      await picker.getByTitle(profilePath, { exact: true }).click();
      await picker.getByRole("textbox", { name: "New file name" }).fill(createOwner);
      await picker.getByRole("button", { name: "Use this destination" }).click();
      await page.getByRole("button", { name: "Create owner file", exact: true }).click();
      await page.getByText("Created owner files remain on disk if connection fails.").waitFor();
    }
    if (profilePath) {
      await pick(general, "REL", paths.main);
      await pick(identity, "PHY", paths.phy);
    } else {
      await main.fill(paths.main);
      await phy.fill(paths.phy);
    }
    if (paths.project) {
      assert(projectName, "Pass the actual Hermes project display name as projectName.");
      const project = page.getByRole("region", { name: projectName, exact: true });
      await project.getByText("Using General memory", { exact: true }).waitFor();
      if (profilePath) await pick(project, "REL", paths.project);
      else await page.getByRole("textbox", { name: projectName + " REL path", exact: true }).fill(paths.project);
      await project.getByText(/^Dedicated REL/).waitFor();
    }
    await validate.click();
    await page.getByText("Validation passed.", { exact: true }).waitFor();
    for (const id of Object.values(ids)) await page.getByText(new RegExp("Accepted · .*" + id)).waitFor();
    await page.getByRole("button", { name: "Review and connect" }).click();
    const review = page.getByRole("region", { name: "Review connection" });
    await review.waitFor();
    if (fallbackCount) {
      await review.getByText(new RegExp("^" + fallbackCount + " projects? will use General memory")).waitFor();
      await review.getByRole("button", { name: "Back to edit", exact: true }).click();
      await page.getByRole("button", { name: "Review and connect" }).click();
      await review.waitFor();
    }
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
  if (projectName) await page.getByRole("region", { name: projectName, exact: true }).getByText(/^Dedicated REL/).waitFor();
  await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
  await owner.waitFor();
  assert.deepEqual(errors, []);
  console.log(mode === "--configured" ? "Chrome verified configured reopen." :
    "Chrome verified web-first validation, setup, owner discovery, and reload.");
} finally {
  await browser.close();
}
