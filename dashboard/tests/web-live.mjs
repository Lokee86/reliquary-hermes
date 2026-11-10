import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { exerciseKnowledge, verifyLocalFixture } from "./knowledge-live.mjs";

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
  const manifests = [];
  page.on("response", reply => {
    if (/\/graph-render-v1\/(node|edge)-chunk$/.test(new URL(reply.url()).pathname) && reply.ok()) chunks.push(reply);
    if (new URL(reply.url()).pathname.endsWith("/graph-render-v1/prepare") && reply.ok()) manifests.push(reply);
  });
  await page.goto(new URL("/reliquary", address).href);
  await exerciseKnowledge(page, fixture, "web");
  assert(chunks.some(reply => new URL(reply.url()).pathname.endsWith("/node-chunk")));
  const accepted = await Promise.all(manifests.map(reply => reply.json()));
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
  }, { scope: latest.request().postDataJSON(), manifest: active });
  assert.deepEqual(selectors, [403, 400, 409, 409, 200, active.nodeChunks[0].byteLen]);
  for (const reply of chunks) {
    assert.equal(reply.headers()["content-type"], "application/octet-stream");
    assert((await reply.body()).length > 32);
  }
} finally {
  await browser.close();
}
