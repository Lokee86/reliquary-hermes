import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [url, playwrightModule, mode] = process.argv.slice(2);
assert.ok(url && playwrightModule && (mode === undefined || mode === "--disabled"),
  "Usage: node dashboard/tests/hermes-host-smoke.mjs <loopback URL> <Playwright index.mjs> [--disabled]");
const base = new URL(url);
assert.ok(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "Run this smoke test against an isolated loopback dashboard.");

const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ baseURL: base.origin, acceptDownloads: false });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.hu01Alerts = 0;
    window.alert = () => { window.hu01Alerts += 1; };
  });
  const manifests = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/dashboard/plugins");
  await page.goto(base.href);
  const manifestResponse = await manifests;
  assert.equal(manifestResponse.status(), 200);
  const manifest = (await manifestResponse.json()).find(({ name }) => name === "reliquary-hermes");
  const profile = new URL(manifestResponse.url()).searchParams.get("profile");
  const scope = profile ? `@${encodeURIComponent(profile)}/` : "";
  const assetRoot = `/dashboard-plugins/${scope}reliquary-hermes/`;
  const tab = page.getByRole("link", { name: "Reliquary", exact: true });
  await page.waitForFunction(() => window.__HERMES_PLUGIN_SDK__?.sdkVersion === "1.1.0");

  if (mode === "--disabled") {
    assert.equal(manifest, undefined);
    assert.equal((await page.request.get(`${assetRoot}dist/index.js`)).status(), 404);
    assert.equal(await tab.count(), 0);
    assert.equal(await page.locator(".rly-dashboard").count(), 0);
    assert.deepEqual(errors, []);
    console.log("Disabled Reliquary tab and assets withheld.");
  } else {
    assert.equal(manifest.tab.path, "/reliquary");
    assert.equal(manifest.has_api, false);
    for (const asset of ["dist/index.js", "dist/style.css"]) {
      const response = await page.request.get(`${assetRoot}${asset}`);
      assert.equal(response.status(), 200);
      assert.deepEqual(await response.body(), readFileSync(new URL(`../${asset}`, import.meta.url)));
    }
    const sdk = await page.evaluate(async () => {
      const sdk = window.__HERMES_PLUGIN_SDK__;
      const response = await sdk.authedFetch("/api/plugins/reliquary-hermes/operational-status");
      return { react: sdk.React.version, hostHook: sdk.hooks.useState === sdk.React.useState, apiStatus: response.status };
    });
    assert.equal(sdk.hostHook, true);
    assert.equal(sdk.apiStatus, 404);

    await tab.click();
    await page.getByRole("heading", { name: "Reliquary Memory", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/reliquary");
    assert.equal(await page.locator(".rly-dashboard").evaluate((element) => getComputedStyle(element).display), "flex");
    assert.match(await page.locator(".rly-live-notice").innerText(), /Synthetic fixture only/);
    const rel = page.getByRole("combobox", { name: "REL", exact: true });
    const session = page.getByRole("combobox", { name: "Session", exact: true });
    const activePhy = page.getByRole("combobox", { name: "Active PHY", exact: true });
    const browse = page.getByRole("combobox", { name: "Browse owner", exact: true });
    const inspector = page.locator(".rly-inspector");
    const graphNodes = page.locator(".rly-graph-node");
    const memoryButtons = page.locator(".rly-memory-button");
    const listMode = page.getByRole("button", { name: "List page", exact: true });
    const graphMode = page.getByRole("button", { name: "Graph page", exact: true });
    await rel.waitFor();
    assert.equal(await rel.inputValue(), "fixture-rel");
    assert.equal(await session.inputValue(), "fixture-session");
    assert.equal(await activePhy.inputValue(), "fixture-phy");

    await activePhy.selectOption("fixture-alt-phy");
    await page.getByText("fixture-alt-phy", { exact: true }).waitFor();
    assert.equal(await rel.inputValue(), "fixture-rel");
    await browse.selectOption("PHY");
    await page.getByText("No graph nodes on this page.", { exact: true }).waitFor();
    await listMode.click();
    await page.getByText("No Memories match this page.", { exact: true }).waitFor();
    await browse.selectOption("REL");
    await activePhy.selectOption("");
    await page.getByText("Reliquary user ID", { exact: true }).waitFor();
    assert.equal(await browse.locator('option[value="PHY"]').count(), 0);
    await activePhy.selectOption("fixture-phy");
    await page.getByText("fixture-phy", { exact: true }).waitFor();

    await graphNodes.first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await inspector.getByText("fixture-rel-memory-2", { exact: true }).waitFor();

    await listMode.click();
    const selected = page.locator('.rly-memory-button[aria-current="true"]');
    await selected.waitFor();
    assert.match(await selected.innerText(), /Synthetic related memory 2/);
    await selected.focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await inspector.getByText("fixture-rel-memory", { exact: true }).waitFor();

    await page.getByRole("button", { name: /Revision 1.*pruned/ }).click();
    await inspector.getByText("Body availability is pruned.", { exact: true }).waitFor();
    await inspector.getByRole("button", { name: "Show current revision" }).click();
    await inspector.getByText("Hermes source / copied snapshot", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Next Memory page", exact: true }).click();
    await memoryButtons.filter({ hasText: "Synthetic related memory 5" }).waitFor();
    assert.equal(await memoryButtons.count(), 2);
    await page.getByRole("button", { name: "Previous Memory page", exact: true }).click();
    await memoryButtons.filter({ hasText: "Synthetic session memory" }).waitFor();

    const search = page.getByRole("searchbox", { name: "Search Memories", exact: true });
    await search.fill("no fixture matches");
    await page.getByText("No Memories match this page.", { exact: true }).waitFor();
    await search.clear();
    await memoryButtons.first().waitFor();
    await page.getByText("Filters", { exact: true }).click();
    const category = page.getByRole("textbox", { name: "Category", exact: true });
    await category.fill("bad id");
    await page.getByText(/Could not load Memory list/).waitFor();
    await category.clear();
    await memoryButtons.first().waitFor();

    await graphMode.click();
    const edge = page.locator(".rly-graph-edge-hit").first();
    await edge.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("complementary", { name: "Selected graph item" }).getByText("From / to", { exact: true }).waitFor();
    await graphNodes.first().focus();
    await page.keyboard.press("e");
    await page.getByText("6 nodes · 5 edges", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Reset graph", exact: true }).click();

    await page.getByRole("button", { name: /Synthetic cluster/ }).click();
    await page.locator(".rly-community-members").getByRole("button", { name: "fixture-rel-memory", exact: true }).click();
    await inspector.getByText("fixture-rel-memory", { exact: true }).waitFor();

    await session.selectOption("fixture-project-session");
    await page.getByText("Tombstoned source", { exact: true }).waitFor();
    assert.equal(await rel.inputValue(), "fixture-project-rel");
    assert.equal(await activePhy.inputValue(), "fixture-phy");
    assert.doesNotMatch(await inspector.innerText(), /fixture-rel-memory/);

    await listMode.click();
    await memoryButtons.first().click();
    await inspector.getByText("Source unavailable", { exact: true }).waitFor();
    const detail = await inspector.innerText();
    assert.match(detail, /Lifecycle\s+active/);
    assert.match(detail, /Source unavailable.*deleted/s);
    assert.match(detail, /<img src=x onerror=alert\(1\)>/);
    assert.equal(await inspector.locator("img, script").count(), 0);
    assert.equal(await page.evaluate(() => window.hu01Alerts), 0);

    await rel.selectOption("fixture-rel");
    await page.getByText("Mapped REL", { exact: true }).waitFor();
    assert.equal(await session.inputValue(), "fixture-session");
    assert.equal(await activePhy.inputValue(), "fixture-phy");
    assert.doesNotMatch(await inspector.innerText(), /fixture-project-rel-memory/);
    assert.deepEqual(errors, []);
    console.log(`Reliquary HU02 fixture tab passed with Hermes SDK 1.1.0 and host React ${sdk.react}.`);
  }
} finally {
  await browser.close();
}
