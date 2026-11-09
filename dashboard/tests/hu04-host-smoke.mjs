import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [base, playwright, evidencePath] = process.argv.slice(2);
assert(base && playwright && evidencePath);
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const { chromium } = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("link", { name: "Reliquary", exact: true }).click();
  const owners = page.getByRole("combobox", { name: "Browse authorized owner" });
  await owners.waitFor();
  const values = await owners.locator("option").evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(new Set(values), new Set(Object.values(evidence.owners)));

  const scope = page.locator(".rly-owner-meta");
  const activity = page.locator(".rly-status-card");
  const session = page.getByRole("textbox", { name: "Hermes session ID" });
  async function lookup(id) {
    await session.fill(id);
    await page.getByRole("button", { name: "Look up session" }).click();
    await scope.getByText(id, { exact: true }).waitFor();
  }

  await lookup("session-project");
  assert.equal(await owners.inputValue(), evidence.owners.project);
  await owners.selectOption(evidence.owners.phy);
  await scope.getByText("PHY", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Create Memory", exact: true }).count(), 0);

  await lookup(evidence.sourceSession);
  assert.equal(await owners.inputValue(), evidence.owners.main);
  if (evidence.archived) {
    await activity.getByText("Tombstoned source", { exact: true }).waitFor();
  } else {
    await page.locator(".rly-graph-node").first().waitFor();
    const edge = page.locator(".rly-graph-edge-hit").first();
    await edge.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("complementary", { name: "Selected graph item" }).getByText("From / to", { exact: true }).waitFor();
    await page.getByRole("button", { name: "List page", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search Memories" }).fill(evidence.memoryTitle);
    await page.locator(".rly-memory-button").filter({ hasText: evidence.memoryTitle }).click();
    const inspector = page.getByRole("complementary", { name: "Selected Memory inspector" });
    await inspector.getByRole("heading", { name: evidence.memoryTitle, exact: true }).waitFor();
    await inspector.getByRole("button", { name: /^Revision [0-9]+ · available$/, pressed: true }).waitFor();
    await inspector.getByText("Hermes source / copied snapshot", { exact: true }).waitFor();
    const sourceIdentity = `${evidence.profileId} · Session ${evidence.sourceSession} · Message ${evidence.messageUid}`;
    await inspector.getByText(sourceIdentity, { exact: true }).waitFor();
    await inspector.getByText("Exact grounding quote span unavailable.", { exact: true }).waitFor();

    await lookup(evidence.recallSession);
    await activity.getByText("returned", { exact: true }).waitFor();
    const returned = activity.getByText("Returned Memories", { exact: true }).locator("xpath=following-sibling::dd");
    assert.equal(await returned.innerText(), evidence.returnedIds.join(", "));
  }
  assert.deepEqual(errors, []);
  console.log("HU04 Chrome verified " + (evidence.archived ? "source tombstone" : "scope, graph, history, provenance and returned recall"));
} finally {
  await browser.close();
}
