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
    const owner = page.getByRole("combobox", { name: "Select REL or PHY to browse" });
    const inspector = page.locator(".rly-inspector");
    const phy = page.getByText("Reliquary user ID", { exact: true }).locator("xpath=following-sibling::dd");
    assert.equal(await owner.inputValue(), "fixture-rel");
    assert.equal(await phy.innerText(), "fixture-phy");
    await page.locator(".rly-graph-node").first().click();
    await page.getByRole("button", { name: "List page", exact: true }).click();
    assert.equal(await page.locator('.rly-memory-button[aria-current="true"]').count(), 1);
    assert.match(await inspector.innerText(), /fixture-rel-memory/);

    await owner.selectOption("fixture-project-rel");
    await page.getByText("Tombstoned source", { exact: true }).waitFor();
    assert.equal(await phy.innerText(), "fixture-phy");
    assert.equal(await page.locator('.rly-memory-button[aria-current="true"]').count(), 0);
    assert.doesNotMatch(await inspector.innerText(), /fixture-rel-memory/);
    await page.locator(".rly-memory-button").first().click();
    const detail = await inspector.innerText();
    assert.match(detail, /Lifecycle\s+active/);
    assert.match(detail, /Source unavailable.*deleted/s);
    assert.match(detail, /<img src=x onerror=alert\(1\)>/);
    assert.equal(await inspector.locator("img, script").count(), 0);
    assert.equal(await page.evaluate(() => window.hu01Alerts), 0);

    await owner.selectOption("fixture-phy");
    assert.equal(await phy.innerText(), "fixture-phy");
    assert.match(await inspector.innerText(), /PHY · Private PHY/);
    assert.deepEqual(errors, []);
    console.log(`Reliquary fixture tab passed with Hermes SDK 1.1.0 and host React ${sdk.react}.`);
  }
} finally {
  await browser.close();
}
