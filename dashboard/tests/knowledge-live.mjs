import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export async function verifyLocalFixture(fixturePath, fixture) {
  const worktree = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
  async function requireWorktree(path) {
    const inside = relative(worktree, await realpath(path));
    assert(inside && !isAbsolute(inside) && inside !== ".." && !inside.startsWith(".." + sep),
      "Smoke fixtures must use isolated paths inside this worktree.");
  }
  await requireWorktree(fixturePath);
  await requireWorktree(fixture.home);
  if (fixture.candidate) {
    await requireWorktree(fixture.candidate.mainRel);
    await requireWorktree(fixture.candidate.activePhy);
    if (fixture.candidate.createPhy) await requireWorktree(dirname(fixture.candidate.createPhy));
  }
}

export async function verifyOwnerScope(app, ownerId, kind) {
  const details = app.locator("details.scope-options");
  const summary = details.locator("summary").first();
  const scope = app.getByRole("group", { name: "Owner scope", exact: true });
  await summary.waitFor({ timeout: 30000 });
  async function open() {
    if (await details.getAttribute("open") === null) await summary.click();
  }
  await open();
  if (kind) {
    await scope.getByRole("button", { name: new RegExp("\\b" + kind + "$") }).first().click();
    await app.locator(".knowledge-heading").getByText(new RegExp("^" + kind + " · ")).waitFor();
    await open();
  }
  await scope.getByText(ownerId, { exact: true }).waitFor({ timeout: 30000 });
  await summary.click();
}

export async function exerciseKnowledge(page, fixture, surface) {
  const app = page.getByRole("region", { name: "Reliquary", exact: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await app.getByRole("navigation", { name: "Reliquary sections" }).waitFor({ timeout: 30000 });
  if (fixture.candidate) {
    const setup = app.getByRole("region", { name: "Reliquary setup" });
    if (surface === "desktop") {
      if (fixture.candidate.createPhy) {
        await setup.getByRole("button", { name: "Create PHY", exact: true }).click();
        const confirm = setup.getByRole("region", { name: "Confirm owner creation" });
        await confirm.getByRole("button", { name: "Create PHY", exact: true }).click();
        await setup.getByText("Created owner files remain on disk if connection fails.").waitFor();
      }
      await setup.getByRole("button", { name: "Select REL", exact: true }).click();
      await setup.getByText(fixture.candidate.mainRel, { exact: true }).waitFor();
      await setup.getByRole("button", { name: "Select PHY", exact: true }).click();
      await setup.getByText(fixture.candidate.activePhy, { exact: true }).waitFor();
    } else {
      await setup.getByRole("button", { name: "Enter path manually" }).click();
      await setup.getByLabel("General memory path").fill(fixture.candidate.mainRel);
      await setup.getByLabel("Active identity path").fill(fixture.candidate.activePhy);
    }
    await setup.getByRole("button", { name: "Review and connect" }).click();
    await setup.getByRole("button", { name: "Connect Reliquary" }).click({ timeout: 30000 });
  }
  await verifyOwnerScope(app, fixture.ownerIds.main);
  if (fixture.retiredOnly) {
    await app.getByRole("button", { name: "List", exact: true }).click();
    await app.getByRole("checkbox", { name: "Show non-active memories", exact: true }).click();
    await app.getByRole("button", { name: /Retired Memory.*tombstoned/i }).click();
    const inspector = app.getByRole("complementary", { name: "Memory inspector" });
    await inspector.getByText("This Memory is retired.", { exact: true }).waitFor();
    await inspector.getByText("History is unavailable after terminal retirement.", { exact: true }).waitFor();
    console.log(surface + ": terminal inspector passed after reopen");
    return;
  }
  if (fixture.syntheticWrites) {
    await exerciseWrites(app);
    console.log(surface + ": Memory creation, association link/unlink, replacement and retirement passed");
    return;
  }
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  const graph = app.locator(".knowledge-graph-wrap");
  async function graphReady(count) {
    await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
    assert.equal(await graph.getAttribute("data-graph-node-count"), String(count));
    const bounds = await graph.locator("canvas").boundingBox();
    assert(bounds && bounds.width >= 320 && bounds.height >= 220, "Graph viewport must be usable");
    return bounds;
  }
  const bounds = await graphReady(fixture.counts.main);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 40, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -220);
  const screenshotDir = process.env.RELIQUARY_SMOKE_SCREENSHOTS;
  async function screenshot(view) {
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await app.screenshot({ path: join(screenshotDir, surface + "-" + view + ".png"), timeout: 30000 });
    }
  }
  await screenshot("graph");
  await app.getByRole("button", { name: "List", exact: true }).click();
  const memory = fixture.memoryTitle ?? "GDScript input packet fields";
  await app.getByLabel("Search memories").fill(memory);
  await app.getByRole("button", { name: new RegExp(memory, "i") }).first().click({ timeout: 30000 });
  const inspector = app.getByRole("complementary", { name: "Memory inspector" });
  await inspector.getByRole("heading", { name: "Provenance", exact: true }).waitFor();
  await inspector.getByRole("heading", { name: "History", exact: true }).waitFor();
  await screenshot("inspector");
  if (fixture.community) {
    await exerciseCommunity(app, fixture.community, screenshot, surface);
    console.log(surface + (surface === "desktop"
      ? ": community navigation and filtering passed (read-only Desktop)"
      : ": community navigation, filtering and rename passed"));
  }
  await verifyOwnerScope(app, fixture.ownerIds.phy, "PHY");
  await app.getByText("PHY · Read only", { exact: true }).waitFor();
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  await graphReady(fixture.counts.phy);
  await inspector.getByText("Select a memory.", { exact: true }).waitFor();
  const nav = app.getByRole("navigation", { name: "Reliquary sections" });
  await nav.getByRole("button", { name: "Sources", exact: true }).click();
  await app.getByRole("button", { name: "Import Existing Sessions" }).click();
  await app.getByLabel("Search conversations").waitFor();
  await nav.getByRole("button", { name: "Setup", exact: true }).click();
  await app.getByRole("heading", { name: "Connect owners" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(surface + ": setup, both owners and binary canvases, search, inspector, provenance, history, and Sources passed");
}


async function exerciseCommunity(app, community, screenshot, surface) {
  const nav = app.getByRole("complementary", { name: "Knowledge navigation" });
  const list = app.getByRole("region", { name: "Memory list" });
  const rows = list.locator(".knowledge-memory-row");
  const next = nav.getByRole("button", { name: "Next community page", exact: true });
  const first = nav.getByRole("button", { name: "First community page", exact: true });
  const communityButton = name => nav.getByRole("button").filter({ hasText: name });
  const original = communityButton(community.name);

  await app.getByLabel("Search memories").fill("");
  await rows.nth(1).waitFor({ timeout: 30000 });
  if (community.onNextPage) {
    await next.waitFor({ timeout: 30000 });
    assert.equal(await original.count(), 0);
    await next.click();
  }
  await original.click({ timeout: 30000 });
  await rows.filter({ hasText: community.memberTitle }).waitFor({ timeout: 30000 });
  await rows.nth(community.memberCount).waitFor({ state: "hidden", timeout: 30000 });
  assert.equal(await rows.count(), community.memberCount);
  await screenshot("community");

  if (community.onNextPage) {
    await first.click();
    await next.waitFor({ timeout: 30000 });
    await rows.nth(1).waitFor({ timeout: 30000 });
    assert.equal(await original.count(), 0);
    await next.click();
    await original.click({ timeout: 30000 });
  }
  if (surface === "desktop") return;
  await nav.getByLabel("Community name").fill(community.renamed);
  await nav.getByRole("button", { name: "Rename", exact: true }).click();
  if (community.onNextPage) await next.click({ timeout: 30000 });
  await communityButton(community.renamed).waitFor({ timeout: 30000 });
  assert.equal(await original.count(), 0);
}
async function exerciseWrites(app) {
  await app.getByRole("button", { name: "List", exact: true }).click();
  const inspector = app.getByRole("complementary", { name: "Memory inspector" });
  async function create(title, body) {
    await app.getByText("New Memory", { exact: true }).click();
    await app.getByLabel("Memory title").fill(title);
    await app.getByLabel("Memory body").fill(body);
    await app.getByRole("button", { name: "Create", exact: true }).click();
    await inspector.getByRole("heading", { name: title, exact: true }).waitFor({ timeout: 25000 });
  }
  await create("Synthetic graph anchor", "This is a synthetic anchor for testing Memory links.");
  await create("Synthetic graph target", "This is the original synthetic test body.");
  await inspector.getByRole("button", { name: "Link Memories", exact: true }).click();
  const unlink = inspector.getByRole("button", { name: "Remove user association", exact: true });
  await unlink.waitFor({ timeout: 25000 });
  await unlink.click();
  await unlink.waitFor({ state: "hidden", timeout: 25000 });
  await inspector.getByRole("button", { name: "Edit", exact: true }).click();
  await inspector.getByLabel("Replacement title").fill("Synthetic graph replacement");
  await inspector.getByLabel("Replacement body").fill("This is the corrected synthetic test body.");
  await inspector.getByRole("button", { name: "Save replacement", exact: true }).click();
  await inspector.getByRole("heading", { name: "Synthetic graph replacement", exact: true }).waitFor({ timeout: 25000 });
  await app.getByRole("checkbox", { name: "Show non-active memories", exact: true }).click();
  await app.getByRole("button", { name: /Synthetic graph target.*superseded/i }).click();
  await inspector.getByRole("checkbox", { name: "Confirm terminal retirement", exact: true }).click();
  await inspector.getByRole("button", { name: "Retire superseded Memory", exact: true }).click();
  await inspector.getByText("tombstoned", { exact: true }).waitFor({ timeout: 25000 });
}
