import assert from "node:assert/strict";
import test from "node:test";
import { GraphRenderClient } from "../src/graph/render/client";
import { findFrameLabel } from "../src/graph/render/labels";
import type { GraphRenderTransport } from "../src/graph/render/transport";
import type { GraphRenderManifest } from "../src/graph/render/types";

test("GraphRenderClient preserves binary, LOD, cache, selection and budget invariants", async () => {
const generationId = "7";
const bounds = { min: [-100,-100,-100] as const, max: [100,100,100] as const };
const leafBounds = { min: [-10,-10,-10] as const, max: [10,10,10] as const };
const manifest: GraphRenderManifest = {
  schemaVersion: 3,
  generationId,
  ownerId: "owner",
  sourceCommunityGeneration: "3",
  totalNodeCount: 2,
  rootHierarchyId: 0,
  globalBounds: bounds,
  hierarchy: [
    { id:0,parentId:null,kind:"graph",bounds,nodeCount:2,chunkId:null },
    { id:1,parentId:0,kind:"territory",bounds:leafBounds,nodeCount:2,chunkId:null,
      territory: { kind: "unassigned", communityId: null, label: "Unassigned",
        color: [0.5,0.5,0.5], center: [0,0,0], radius: 10 } },
    { id:2,parentId:1,kind:"leaf",bounds:leafBounds,nodeCount:2,chunkId:0 },
  ],
  nodeChunks: [{
    chunkId:0,
    parentHierarchyId:2,
    bounds:leafBounds,
    nodeCount:2,
    byteLen:80,
    labelCandidates:[
      { renderId:11,itemIndex:1,importance:4,label:"Eleven" },
      { renderId:10,itemIndex:0,importance:1,label:"Ten" },
    ],
  }],
  edgeChunks: [
    { chunkId:0,lod:"overview",bounds,segmentCount:1,byteLen:64 },
    { chunkId:2,lod:"intermediate",bounds,segmentCount:1,byteLen:64 },
    { chunkId:1,lod:"detail",bounds:leafBounds,segmentCount:1,byteLen:64 },
  ],
};

let nodeFetches = 0;
let edgeFetches = 0;
let resolves = 0;
let inspections = 0;
const memoryId = "a".repeat(64);
const transport: GraphRenderTransport = {
  async prepare() { return manifest; },
  async nodeChunk(_generationId, chunkId) {
    nodeFetches += 1;
    return nodePayload(chunkId);
  },
  async edgeChunk(_generationId, chunkId) { edgeFetches += 1; return edgePayload(chunkId); },
  async resolveNode(_generationId, renderId) {
    resolves += 1;
    return { memoryId: `m-${renderId}` };
  },
  async inspectNode() {
    inspections += 1;
    return { memoryId, title: "Selected Memory", position: [1, 2, 3] };
  },
  async locateMemory(_generationId, id) {
    return id === memoryId ? { renderId: 0, position: [1, 2, 3] } : null;
  },
  async neighborhood() {
    return { totalCount: 1, truncated: false, edges: [{
      sourceRenderId: 0, targetRenderId: 1, sourcePosition: [1, 2, 3], targetPosition: [4, 5, 6],
      style: { packedColor: 0x38bdf8ff, relationKind: "References" }, directed: true, weight: 1.35,
    }] };
  },
};

await assert.rejects(GraphRenderClient.prepare("owner", {
  ...transport, async prepare() { return { ...manifest, schemaVersion: 2 }; },
}), /unsupported graph render manifest version/);

await assert.rejects(
  GraphRenderClient.prepare("owner", {
    ...transport,
    async prepare() {
      return {
        ...manifest,
        nodeChunks: [{
          ...manifest.nodeChunks[0],
          labelCandidates: Array.from({ length: 5 }, (_, renderId) => ({
            renderId,
            itemIndex: 0,
            importance: 1,
            label: "too many",
          })),
        }],
      };
    },
  }),
  /label candidate budget exceeded/,
);

const client = await GraphRenderClient.prepare("owner", transport);
assert.equal((await client.inspectNode(0)).title, "Selected Memory");
assert.equal((await client.inspectNode(0)).memoryId, memoryId);
assert.equal(inspections, 1);
await assert.rejects(client.inspectNode(0, AbortSignal.abort()), { name: "AbortError" });
assert.deepEqual(await client.locateMemory(memoryId), { renderId: 0, position: [1, 2, 3] });
assert.equal(await client.locateMemory("b".repeat(64)), null);
assert.equal((await client.neighborhood(0)).edges[0].targetRenderId, 1);
await assert.rejects(client.neighborhood(2), /invalid graph incident relationships/);
const overview = client.planViewport({ center:[0,0,0], radius:100 });
assert.equal(overview.lod, "overview");
assert.equal(overview.nodeChunks.length, 1);
assert.equal(overview.edgeChunks.length, 1);
assert.deepEqual(overview.edgeChunks.map(chunk => chunk.chunkId), [1]);

const detailView = { center:[0,0,0] as const, radius:5 };
const first = await client.loadViewport(detailView);
assert.equal(first.lod, "detail");
assert.equal(first.nodeChunks.length, 1);
assert.equal(first.edgeChunks.length, 1);
assert.deepEqual(first.edgeChunks.map(chunk => chunk.chunkId), [1]);
assert.equal(first.nodeChunks[0].positions[3], 4);
assert.equal(first.nodeChunks[0].renderIds[1], 11);
assert.equal(first.nodeChunks[0].positions.buffer, first.nodeChunks[0].raw.buffer);
assert.equal(first.edgeChunks[0].endpoints[5], 6);
assert.equal(first.edgeChunks[0].endpoints.buffer, first.edgeChunks[0].raw.buffer);
assert.deepEqual(
  first.labels.map(({ renderId, label, importance, position, size, packedColor }) => (
    [renderId, label, importance, position, size, packedColor]
  )),
  [
    [11, "Eleven", 4, [4,5,6], 2.5, 0x445566ff],
    [10, "Ten", 1, [1,2,3], 1.5, 0x112233ff],
  ],
);
const chunkWithoutLabels = { ...first.nodeChunks[0], labelCandidates: [] };
assert.deepEqual(findFrameLabel([chunkWithoutLabels], 11, "Selected Memory"), {
  renderId: 11,
  label: "Selected Memory",
  position: [4, 5, 6],
  size: 2.5,
  packedColor: 0x445566ff,
});
assert.equal(findFrameLabel([chunkWithoutLabels], 12, "Nonresident Memory"), null);
assert.deepEqual(
  client.pickNodeChunkIds([0,0,-100], [0,0,1]),
  [0],
);
assert.deepEqual(
  client.pickNodeChunkIds([100,100,-100], [0,0,1]),
  [],
);
assert.equal(nodeFetches, 1);
assert.equal(edgeFetches, 1);

await client.loadViewport(detailView);
assert.equal(nodeFetches, 1);
assert.equal(edgeFetches, 1);

assert.deepEqual(await client.resolveNode(11), { memoryId:"m-11" });
assert.deepEqual(await client.resolveNode(11), { memoryId:"m-11" });
assert.equal(resolves, 1);

client.setSelectedRenderId(11);
client.setHoveredRenderId(10);
assert.equal(client.selectedRenderId, 11);
assert.equal(client.hoveredRenderId, 10);
assert.throws(() => client.setSelectedRenderId(2 ** 32));

const crowdedManifest: GraphRenderManifest = {
  ...manifest,
  totalNodeCount: 80,
  nodeChunks: Array.from({ length: 40 }, (_, chunkId) => ({
    chunkId,
    parentHierarchyId: 1,
    bounds: leafBounds,
    nodeCount: 2,
    byteLen: 80,
    labelCandidates: [],
  })),
  edgeChunks: Array.from({ length: 40 }, (_, chunkId) => ({
    chunkId,
    lod: "detail" as const,
    bounds: leafBounds,
    segmentCount: 1,
    byteLen: 64,
  })),
};
const crowded = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() { return crowdedManifest; },
});
assert.equal(crowded.planViewport({ center: [0, 0, 0], radius: 100 }).lod, "overview");
assert.equal(crowded.planViewport({ center: [0, 0, 0], radius: 20 }).lod, "intermediate");
const crowdedPlan = crowded.planViewport(detailView);
assert.equal(crowdedPlan.nodeChunks.length, 32);
assert.equal(crowdedPlan.edgeChunks.length, 32);

const labelHeavyManifest: GraphRenderManifest = {
  ...manifest,
  totalNodeCount: 64,
  nodeChunks: Array.from({ length: 32 }, (_, chunkId) => ({
    chunkId,
    parentHierarchyId: 1,
    bounds: leafBounds,
    nodeCount: 2,
    byteLen: 80,
    labelCandidates: [
      { renderId:10,itemIndex:0,importance:chunkId,label:`A-${chunkId}` },
      { renderId:11,itemIndex:1,importance:chunkId,label:`B-${chunkId}` },
    ],
  })),
};
const labelHeavy = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() { return labelHeavyManifest; },
  async nodeChunk(_generationId, chunkId) {
    return nodePayload(chunkId);
  },
});
const labelFrame = await labelHeavy.loadViewport(detailView);
assert.equal(labelFrame.labels.length, 48);
assert.ok(labelFrame.labels[0].importance >= labelFrame.labels[47].importance);
assert.equal(labelHeavy.pickNodeChunkIds([0,0,-100], [0,0,1]).length, 8);

const relChunks: GraphRenderManifest["nodeChunks"] = Array.from({ length: 13 }, (_, chunkId) => ({
  chunkId,
  parentHierarchyId: 1,
  bounds,
  nodeCount: chunkId < 7 ? 169 : 168,
  byteLen: 32 + (chunkId < 7 ? 169 : 168) * 24,
  labelCandidates: [],
}));
const relManifest: GraphRenderManifest = {
  ...manifest,
  totalNodeCount: 2_191,
  nodeChunks: relChunks,
  edgeChunks: [manifest.edgeChunks[0]],
};
const rel = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() { return relManifest; },
  async nodeChunk(_generationId, chunkId) {
    return nodePayload(chunkId, relChunks[chunkId].nodeCount);
  },
});
const relCloseView = rel.planViewport({ center: [0, 0, 0], radius: 1 });
assert.equal(relCloseView.lod, "detail", "edge LOD follows the viewport independently");
assert.equal(relCloseView.nodeChunks.length, 13, "full-fit nodes ignore viewport bounds");
const relOverview = rel.planViewport({ center: [0, 0, 0], radius: 100 });
assert.equal(relOverview.lod, "overview");
assert.equal(relOverview.nodeChunks.length, 13, "all bounded node chunks are requested at overview");
assert.equal(relOverview.nodeChunks.reduce((count, chunk) => count + chunk.nodeCount, 0), 2_191);
assert.equal(rel.nodeOverviewFits, true);
const relFrame = await rel.loadViewport({ center: [0, 0, 0], radius: 1 });
assert.equal(relFrame.nodeChunks.length, 13, "all node chunks decode before any zoom");
assert.equal(relFrame.nodeChunks.reduce((count, chunk) => count + chunk.nodeCount, 0), 2_191);

const oversizedChunks: GraphRenderManifest["nodeChunks"] = Array.from({ length: 32 }, (_, chunkId) => {
  const x = chunkId < 16 ? -80 : 80;
  const chunkBounds = { min: [x - 1, -1, -1] as const, max: [x + 1, 1, 1] as const };
  return {
    chunkId, parentHierarchyId: 1, bounds: chunkBounds, nodeCount: 1,
    byteLen: 1024 * 1024, labelCandidates: [],
  };
});
const oversized = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() {
    return { ...manifest, totalNodeCount: 32, nodeChunks: oversizedChunks };
  },
});
const oversizedPlan = oversized.planViewport({ center: [0, 0, 0], radius: 100 });
assert.equal(oversized.nodeOverviewFits, false, "chunk byte cap triggers downsampling even under the chunk-count cap");
assert.ok(oversizedPlan.nodeChunks.length <= 16);
assert.ok(oversizedPlan.nodeChunks.reduce((bytes, chunk) => bytes + chunk.byteLen, 0)
  <= 16 * 1024 * 1024, "planned node bytes stay within the residency budget");
const selectedXs = oversizedPlan.nodeChunks.map(chunk => (chunk.bounds.min[0] + chunk.bounds.max[0]) * 0.5);
assert.ok(Math.max(...selectedXs) - Math.min(...selectedXs) > 80,
  "oversized overview samples chunks across the spatial extent");
assert.ok(selectedXs.some(x => x < 0) && selectedXs.some(x => x > 0),
  "byte truncation keeps representatives from both sides when chunk count itself fits");

const panChunks: GraphRenderManifest["nodeChunks"] = Array.from({ length: 40 }, (_, chunkId) => {
  const x = chunkId < 20 ? -80 : 80;
  return {
    chunkId, parentHierarchyId: 1,
    bounds: { min: [x - 1, -1, -1] as const, max: [x + 1, 1, 1] as const },
    nodeCount: 1, byteLen: 56, labelCandidates: [],
  };
});
let panFetches = 0;
let panActive = 0;
let panPeakActive = 0;
const panReleases: Array<() => void> = [];
const panClient = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() { return { ...manifest, totalNodeCount: 40, nodeChunks: panChunks, edgeChunks: [] }; },
  async nodeChunk(_generationId, chunkId, signal) {
    panFetches += 1;
    panActive += 1;
    panPeakActive = Math.max(panPeakActive, panActive);
    return await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        panActive -= 1;
        signal?.removeEventListener("abort", abort);
        return true;
      };
      const abort = () => { if (finish()) reject(new DOMException("aborted", "AbortError")); };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      panReleases.push(() => {
        if (finish()) resolve(nodePayload(chunkId, 1));
      });
    });
  },
});
const stalePan = panClient.loadViewport({ center: [-80, 0, 0], radius: 5 });
await waitUntil(() => panFetches === 8);
assert.equal(panClient.activeChunkRequestCount, 8);
assert.equal(panClient.queuedChunkRequestCount, 12);
const currentPan = panClient.loadViewport({ center: [80, 0, 0], radius: 5 });
const stalePanResult = assert.rejects(stalePan, /superseded/);
assert.equal(panClient.queuedChunkRequestCount, 20, "old queued chunks are replaced by the newest viewport plan");
await waitUntil(() => panFetches === 16);
assert.equal(panActive, 8, "the latest viewport starts as soon as stale active fetches abort");
await releasePanBatch();
await waitUntil(() => panFetches === 24);
await releasePanBatch();
await waitUntil(() => panFetches === 28);
await releasePanBatch();
await stalePanResult;
const currentPanFrame = await currentPan;
assert.equal(currentPanFrame.nodeChunks.length, 20);
assert.ok(currentPanFrame.nodeChunks.every(chunk => chunk.chunkId >= 20), "only the latest viewport frame survives");
assert.ok(panPeakActive <= 8, "shared transport concurrency stays bounded during rapid pans");
assert.equal(panFetches, 28, "stale queued requests are discarded before transport fetch");

const reuseChunks = Array.from({ length: 13 }, (_, chunkId) => ({
  chunkId, parentHierarchyId: 1, bounds, nodeCount: 2, byteLen: 80, labelCandidates: [],
}));
let reuseFetches = 0;
const reuseReleases: Array<() => void> = [];
const reuseClient = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() { return { ...manifest, totalNodeCount: 26, nodeChunks: reuseChunks, edgeChunks: [] }; },
  async nodeChunk(_generationId, chunkId) {
    reuseFetches += 1;
    return await new Promise<Uint8Array>(resolve => {
      reuseReleases.push(() => resolve(nodePayload(chunkId)));
    });
  },
});
const firstReuseLoad = reuseClient.loadViewport({ center: [0, 0, 0], radius: 100 });
await waitUntil(() => reuseFetches === 8);
const secondReuseLoad = reuseClient.loadViewport({ center: [0, 0, 0], radius: 100 });
assert.equal(reuseClient.queuedChunkRequestCount, 5, "same chunks reuse active and queued requests across viewport versions");
await releaseReuseBatch();
await waitUntil(() => reuseFetches === 13);
await releaseReuseBatch();
assert.equal((await firstReuseLoad).nodeChunks.length, 13);
assert.equal((await secondReuseLoad).nodeChunks.length, 13);
assert.equal(reuseFetches, 13, "viewport refresh does not duplicate chunk fetches");

const cacheChunkBytes = 8 * 1024 * 1024;
const cacheNodeCount = (cacheChunkBytes - 32) / 24;
const cacheChunks: GraphRenderManifest["nodeChunks"] = Array.from({ length: 5 }, (_, chunkId) => {
  const x = -80 + chunkId * 40;
  return {
    chunkId, parentHierarchyId: 1,
    bounds: { min: [x - 1, -1, -1] as const, max: [x + 1, 1, 1] as const },
    nodeCount: cacheNodeCount, byteLen: cacheChunkBytes, labelCandidates: [],
  };
});
const cacheFetches = new Map<number, number>();
const cacheClient = await GraphRenderClient.prepare("owner", {
  ...transport,
  async prepare() {
    return { ...manifest, totalNodeCount: cacheNodeCount * cacheChunks.length, nodeChunks: cacheChunks, edgeChunks: [] };
  },
  async nodeChunk(_generationId, chunkId) {
    cacheFetches.set(chunkId, (cacheFetches.get(chunkId) ?? 0) + 1);
    return emptyNodePayload(chunkId, cacheNodeCount);
  },
});
for (let chunkId = 0; chunkId < cacheChunks.length; chunkId += 1) {
  const x = -80 + chunkId * 40;
  await cacheClient.loadViewport({ center: [x, 0, 0], radius: 1 });
  assert.ok(cacheClient.residentNodeByteCount <= 32 * 1024 * 1024,
    "resident node cache obeys its byte cap as chunks accumulate");
}
await cacheClient.loadViewport({ center: [-80, 0, 0], radius: 1 });
assert.equal(cacheFetches.get(0), 2, "the oldest byte-evicted node chunk is fetched again on demand");

console.log("Hermes graph render client checks passed");

function nodePayload(chunkId = 0, count = 2) {
  const raw = new Uint8Array(32 + count * 24);
  const view = new DataView(raw.buffer);
  writeMagic(raw, "WRNODE");
  writeHeader(view, chunkId, count);
  const positions = new Float32Array(raw.buffer, 32, count * 3);
  const colors = new Uint32Array(raw.buffer, 32 + count * 12, count);
  const sizes = new Float32Array(raw.buffer, 32 + count * 16, count);
  const renderIds = new Uint32Array(raw.buffer, 32 + count * 20, count);
  for (let index = 0; index < count; index += 1) {
    positions.set([index * 3 + 1, index * 3 + 2, index * 3 + 3], index * 3);
    colors[index] = index === 0 ? 0x112233ff : 0x445566ff;
    sizes[index] = index + 1.5;
    renderIds[index] = index + 10;
  }
  return raw;
}

function emptyNodePayload(chunkId:number, count:number) {
  const raw = new Uint8Array(32 + count * 24);
  writeMagic(raw, "WRNODE");
  writeHeader(new DataView(raw.buffer), chunkId, count);
  return raw;
}

function edgePayload(chunkId:number) {
  const raw = new Uint8Array(64);
  const view = new DataView(raw.buffer);
  writeMagic(raw, "WREDGE");
  writeHeader(view, chunkId, 1);
  new Float32Array(raw.buffer, 32, 6).set([1,2,3,4,5,6]);
  new Float32Array(raw.buffer, 56, 1).set([0.9]);
  new Uint32Array(raw.buffer, 60, 1).set([0x38bdf8ff]);
  return raw;
}

function writeMagic(raw:Uint8Array, value:string) {
  raw.set(new TextEncoder().encode(value), 0);
}

function writeHeader(view:DataView, payloadId:number, count:number) {
  view.setUint16(8, 1, true);
  view.setUint16(10, 32, true);
  view.setUint32(12, 0, true);
  view.setBigUint64(16, BigInt(generationId), true);
  view.setUint32(24, payloadId, true);
  view.setUint32(28, count, true);
}
async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail("timed out waiting for bounded graph chunk requests");
}

async function releasePanBatch() {
  const batch = panReleases.splice(0);
  for (const release of batch) release();
  await new Promise(resolve => setTimeout(resolve, 2));
}

async function releaseReuseBatch() {
  const batch = reuseReleases.splice(0);
  for (const release of batch) release();
  await new Promise(resolve => setTimeout(resolve, 2));
}
});
