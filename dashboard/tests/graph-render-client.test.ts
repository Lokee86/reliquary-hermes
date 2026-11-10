import assert from "node:assert/strict";
import test from "node:test";
import { GraphRenderClient } from "../src/graph/render/client";
import type { GraphRenderTransport } from "../src/graph/render/transport";
import type { GraphRenderManifest } from "../src/graph/render/types";

test("GraphRenderClient preserves binary, LOD, cache, selection and budget invariants", async () => {
const generationId = "7";
const bounds = { min: [-100,-100,-100] as const, max: [100,100,100] as const };
const leafBounds = { min: [-10,-10,-10] as const, max: [10,10,10] as const };
const manifest: GraphRenderManifest = {
  schemaVersion: 2,
  generationId,
  ownerId: "owner",
  sourceCommunityGeneration: "3",
  totalNodeCount: 2,
  rootHierarchyId: 0,
  globalBounds: bounds,
  hierarchy: [
    { id:0,parentId:null,kind:"graph",bounds,nodeCount:2,chunkId:null },
    { id:1,parentId:0,kind:"leaf",bounds:leafBounds,nodeCount:2,chunkId:0 },
  ],
  nodeChunks: [{
    chunkId:0,
    parentHierarchyId:1,
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
};

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
const overview = client.planViewport({ center:[0,0,0], radius:100 });
assert.equal(overview.lod, "detail");
assert.equal(overview.nodeChunks.length, 1);
assert.equal(overview.edgeChunks.length, 2);
assert.deepEqual(overview.edgeChunks.map(chunk => chunk.chunkId).sort(), [1, 2]);

const detailView = { center:[0,0,0] as const, radius:5 };
const first = await client.loadViewport(detailView);
assert.equal(first.lod, "detail");
assert.equal(first.nodeChunks.length, 1);
assert.equal(first.edgeChunks.length, 2);
assert.deepEqual(first.edgeChunks.map(chunk => chunk.chunkId).sort(), [1, 2]);
assert.equal(first.nodeChunks[0].positions[3], 4);
assert.equal(first.nodeChunks[0].renderIds[1], 11);
assert.equal(first.nodeChunks[0].positions.buffer, first.nodeChunks[0].raw.buffer);
assert.equal(first.edgeChunks[0].endpoints[5], 6);
assert.equal(first.edgeChunks[0].endpoints.buffer, first.edgeChunks[0].raw.buffer);
assert.deepEqual(
  first.labels.map((label) => [label.renderId, label.label, label.importance, label.position]),
  [
    [11, "Eleven", 4, [4,5,6]],
    [10, "Ten", 1, [1,2,3]],
  ],
);
assert.deepEqual(
  client.pickNodeChunkIds([0,0,-100], [0,0,1]),
  [0],
);
assert.deepEqual(
  client.pickNodeChunkIds([100,100,-100], [0,0,1]),
  [],
);
assert.equal(nodeFetches, 1);
assert.equal(edgeFetches, 2);

await client.loadViewport(detailView);
assert.equal(nodeFetches, 1);
assert.equal(edgeFetches, 2);

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

console.log("Hermes graph render client checks passed");

function nodePayload(chunkId = 0) {
  const raw = new Uint8Array(80);
  const view = new DataView(raw.buffer);
  writeMagic(raw, "WRNODE");
  writeHeader(view, chunkId, 2);
  new Float32Array(raw.buffer, 32, 6).set([1,2,3,4,5,6]);
  new Uint32Array(raw.buffer, 56, 2).set([0x112233ff, 0x445566ff]);
  new Float32Array(raw.buffer, 64, 2).set([1.5, 2.5]);
  new Uint32Array(raw.buffer, 72, 2).set([10,11]);
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
});
