import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [address, playwright, evidencePath, mode] = process.argv.slice(2);
assert(address && playwright && evidencePath && (mode === undefined || mode === "--configured"));
const base = new URL(address);
assert.equal(base.protocol, "http:");
assert.equal(base.hostname, "127.0.0.1");
const { paths, ids } = JSON.parse(await readFile(evidencePath, "utf8"));
const { chromium } = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
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
  await page.locator(".rly-owner-meta").getByText(paths.config, { exact: true }).waitFor();
  const values = await owner.locator("option").evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(new Set(values), new Set(Object.values(ids)));
  await owner.selectOption(ids.phy);
  await page.locator(".rly-owner-meta").getByText("PHY", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);
  await page.reload();
  await owner.waitFor();
  assert.equal(await setupHeading.count(), 0);
  assert.deepEqual(errors, []);
  console.log(mode === "--configured" ? "Chrome verified configured reopen." :
    "Chrome verified web-first validation, setup, owner discovery, and reload.");
} finally {
  await browser.close();
}
