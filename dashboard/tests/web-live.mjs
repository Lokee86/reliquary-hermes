import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { exerciseKnowledge, verifyLocalFixture, verifyOwnerScope } from "./knowledge-live.mjs";

const [address, playwright, fixturePath] = process.argv.slice(2);
assert(address && playwright && fixturePath, "Pass the isolated Hermes URL, local Playwright index.mjs and fixture JSON.");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
await verifyLocalFixture(fixturePath, fixture);
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(address).hostname));
const { chromium } = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  await page.route(/^https?:\/\//, route =>
    new URL(route.request().url()).origin === new URL(address).origin ? route.continue() : route.abort());
  const chunks = [];
  const nodeChunks = [];
  const nodeChunkBodies = new Map();
  const manifests = [];
  const manifestValues = [];
  page.on("response", reply => {
    const pathname = new URL(reply.url()).pathname;
    if (/\/graph-render-v1\/(node|edge)-chunk$/.test(pathname) && reply.ok()) chunks.push(reply);
    if (pathname.endsWith("/graph-render-v1/node-chunk") && reply.ok()) {
      nodeChunks.push(reply);
      nodeChunkBodies.set(reply, reply.body());
    }
    if (pathname.endsWith("/graph-render-v1/prepare") && reply.ok()) {
      manifests.push(reply);
      manifestValues.push(reply.json());
    }
  });
  await page.goto(new URL("/reliquary", address).href);
  await exerciseKnowledge(page, fixture, "web");
  assert(chunks.some(reply => new URL(reply.url()).pathname.endsWith("/node-chunk")));
  const accepted = await Promise.all(manifestValues);
  if (fixture.expectedEdges !== undefined) {
    const lod = fixture.expectedEdgeLod ?? "detail";
    assert(["overview", "intermediate", "detail"].includes(lod), "Unknown fixture edge LOD.");
    const rel = accepted.find(value => value.ownerId === fixture.ownerIds.main);
    assert.equal(rel?.edgeChunks.filter(chunk => chunk.lod === lod)
      .reduce((count, chunk) => count + chunk.segmentCount, 0), fixture.expectedEdges);
    if (fixture.expectedEdges > 0) {
      assert(chunks.some(reply => new URL(reply.url()).pathname.endsWith("/edge-chunk")));
    }
  }
  const latest = manifests.at(-1);
  const active = accepted.at(-1);
  assert(latest && active?.ownerId === fixture.ownerIds.phy && active.nodeChunks.length);
  const scope = latest.request().postDataJSON();
  delete scope.filters;
  const selectors = await page.evaluate(async ({ scope, manifest }) => {
    const path = "/api/plugins/reliquary-hermes/graph-render-v1/";
    const post = (operation, body) => window.__HERMES_PLUGIN_SDK__.authedFetch(path + operation, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const request = { ...scope, generation_id: manifest.generationId, chunk_id: manifest.nodeChunks[0].chunkId };
    const forgedOwner = await post("node-chunk", { ...request, owner_id: "unknown-owner" });
    const forgedAuthority = await post("node-chunk", { ...request, principal_id: "unknown-principal" });
    const stale = await post("node-chunk", { ...request, generation_id: "4294967296" });
    const invalid = await post("resolve", {
      ...scope, generation_id: manifest.generationId, render_id: 4294967295,
    });
    const valid = await post("node-chunk", request);
    return [forgedOwner.status, forgedAuthority.status, stale.status, invalid.status,
      valid.status, (await valid.arrayBuffer()).byteLength];
  }, { scope, manifest: active });
  assert.deepEqual(selectors, [403, 400, 409, 409, 200, active.nodeChunks[0].byteLen]);
  for (const reply of chunks) {
    assert.equal(reply.headers()["content-type"], "application/octet-stream");
    assert((await reply.body()).length > 32);
  }
  await exerciseGraphSelection(page, fixture, manifestValues, nodeChunks, nodeChunkBodies);
} finally {
  await browser.close();
}

async function exerciseGraphSelection(page, fixture, manifestValues, nodeChunks, nodeChunkBodies) {
  const app = page.getByRole("region", { name: "Reliquary", exact: true });
  const sections = app.getByRole("navigation", { name: "Reliquary sections" });
  await sections.getByRole("button", { name: "Knowledge", exact: true }).click();
  await verifyOwnerScope(app, fixture.ownerIds.main, "REL");
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  const graph = app.locator(".knowledge-graph-wrap");
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  if (fixture.community) {
    const nav = app.getByRole("complementary", { name: "Knowledge navigation" });
    if (fixture.community.onNextPage) await nav.getByRole("button", { name: "Next community page", exact: true }).click();
    await nav.getByRole("button").filter({ hasText: fixture.community.renamed ?? fixture.community.name }).first().click();
    await graph.locator(`[data-graph-node-count="${fixture.community.memberCount}"]`).waitFor({ timeout: 40000 });
    await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  }

  const expectedCount = fixture.community?.memberCount ?? fixture.counts.main;
  const manifests = await Promise.all(manifestValues);
  const manifest = [...manifests].reverse().find(value =>
    value.ownerId === fixture.ownerIds.main && value.totalNodeCount === Number(expectedCount));
  assert(manifest, "The filtered REL graph manifest was not captured.");
  const chunkResponse = nodeChunks.find(reply => {
    const request = reply.request().postDataJSON();
    return String(request.generation_id) === manifest.generationId && request.chunk_id === manifest.nodeChunks[0]?.chunkId;
  });
  assert(chunkResponse, "The filtered REL graph node chunk was not captured.");
  const raw = await nodeChunkBodies.get(chunkResponse);
  const count = raw.readUInt32LE(28);
  const center = [0, 1, 2].map(axis => (manifest.globalBounds.min[axis] + manifest.globalBounds.max[axis]) * 0.5);
  let extent = Math.max(8, ...[0, 1, 2].map(axis =>
    (manifest.globalBounds.max[axis] - manifest.globalBounds.min[axis]) * 0.5));
  for (const node of manifest.hierarchy) {
    const territory = node.kind === "territory" ? node.territory : null;
    if (territory?.kind !== "community") continue;
    const centerDistance = Math.hypot(...territory.center.map((coordinate, axis) => coordinate - center[axis]));
    extent = Math.max(extent, centerDistance + territory.radius);
  }
  const cameraZ = center[2] + extent * 2.4;
  const tanHalfFov = Math.tan(25 * Math.PI / 180);
  const canvas = graph.locator("canvas");
  const box = await canvas.boundingBox();
  assert(box, "Graph canvas has no visible bounds.");
  const points = Array.from({ length: count }, (_, index) => {
    const x = raw.readFloatLE(32 + index * 12);
    const y = raw.readFloatLE(32 + index * 12 + 4);
    const z = raw.readFloatLE(32 + index * 12 + 8);
    const distance = cameraZ - z;
    const ndcX = (x - center[0]) / (distance * tanHalfFov * (box.width / box.height));
    const ndcY = (y - center[1]) / (distance * tanHalfFov);
    return { x: box.x + ((ndcX + 1) * box.width) / 2, y: box.y + ((1 - ndcY) * box.height) / 2,
      centerDistance: ndcX * ndcX + ndcY * ndcY };
  }).filter(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height)
    .sort((left, right) => left.centerDistance - right.centerDistance);
  assert(points.length > 0, "No graph nodes project into the visible canvas.");
  await page.mouse.click(points[0].x, points[0].y);
  const inspector = app.getByRole("complementary", { name: "Memory inspector" });
  await inspector.locator(".knowledge-details").waitFor({ timeout: 30000 });
  await inspector.getByText("State", { exact: true }).waitFor();

  await app.getByRole("button", { name: "List", exact: true }).click();
  await app.locator(".knowledge-memory-row[aria-pressed='true']").waitFor({ timeout: 30000 });
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  await inspector.getByText("State", { exact: true }).waitFor();
}
