import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [address, playwright, evidencePath, mode] = process.argv.slice(2);
assert(address && playwright && evidencePath && (mode === undefined || mode === "--configured"));
const base = new URL(address);
assert.equal(base.protocol, "http:");
assert.equal(base.hostname, "127.0.0.1");
const { paths, ids } = JSON.parse(await readFile(evidencePath, "utf8"));
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
    await main.waitFor();
    assert.equal(await owner.count(), 0);
    assert.equal(await page.getByRole("button", { name: /^Browse for / }).count(), 0);
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
    await main.fill(paths.main);
    await phy.fill(paths.phy);
    await page.getByRole("button", { name: "Add project REL" }).click();
    await page.getByRole("textbox", { name: "Project 1 ID" }).fill("lantern");
    await page.getByRole("textbox", { name: "Project 1 REL path" }).fill(paths.project);
    await validate.click();
    await page.getByText("Validation passed.", { exact: true }).waitFor();
    for (const id of Object.values(ids)) await page.getByText(new RegExp("Accepted · .*" + id)).waitFor();
    await page.getByRole("button", { name: "Connect Reliquary" }).click();
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
  assert.deepEqual(new Set(await menu.getByRole("option").allTextContents()), new Set(["REL · Main REL", "REL · Project 1", "PHY · Active user"]));
  await menu.getByRole("option", { name: "PHY · Active user", exact: true }).click();
  await page.locator(".rly-owner-meta").getByText("PHY", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);
  await page.reload();
  await owner.waitFor();
  assert.equal(await setupHeading.count(), 0);
  if (screenshots) await page.screenshot({ path: join(screenshots, "web-configured.png") });
  assert.deepEqual(errors, []);
  console.log(mode === "--configured" ? "Chrome verified configured reopen." :
    "Chrome verified web-first validation, setup, owner discovery, and reload.");
} finally {
  await browser.close();
}
