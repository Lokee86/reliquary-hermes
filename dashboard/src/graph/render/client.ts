import { decodeEdgeChunk, decodeNodeChunk } from "./binary";
import { GraphRenderBoundsIndex } from "./boundsIndex";
import {
  buildEdgeIndexes,
  validateManifest,
  validateRenderId,
  validateViewport,
} from "./clientContract";
import {
  GRAPH_RENDER_DETAIL_CHUNK_BUDGET,
  GRAPH_RENDER_HIERARCHY_BUDGET,
  GRAPH_RENDER_PICK_CHUNK_BUDGET,
  edgeBudget,
  selectGraphRenderLod,
} from "./lod";
import { selectFrameLabels } from "./labels";
import type { GraphRenderTransport } from "./transport";
import type {
  GraphRenderEdgeChunk,
  GraphRenderEdgeChunkDescriptor,
  GraphRenderEdgeLod,
  GraphRenderFrame,
  GraphRenderHierarchyDescriptor,
  GraphRenderManifest,
  GraphRenderNodeChunk,
  GraphRenderNodeChunkDescriptor,
  GraphRenderNodeResolution,
  GraphRenderSource,
  GraphRenderVec3,
  GraphRenderViewport,
} from "./types";

const RESOLUTION_CACHE_LIMIT = 128;
const RESIDENT_CHUNK_LIMIT = 2 * GRAPH_RENDER_DETAIL_CHUNK_BUDGET;
const SMALL_GRAPH_NODE_LIMIT = 256;

function retain<T>(cache: Map<number, T>, id: number, value: T) {
  cache.delete(id);
  cache.set(id, value);
  if (cache.size > RESIDENT_CHUNK_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return value;
}

export class GraphRenderClient {
  readonly manifest: GraphRenderManifest;

  private readonly transport: GraphRenderTransport;
  private readonly detailFits: boolean;
  private readonly hierarchyIndex: GraphRenderBoundsIndex<GraphRenderHierarchyDescriptor>;
  private readonly nodeIndex: GraphRenderBoundsIndex<GraphRenderNodeChunkDescriptor>;
  private readonly edgeIndexes: Record<GraphRenderEdgeLod, GraphRenderBoundsIndex<GraphRenderEdgeChunkDescriptor>>;
  private pickIndex = new GraphRenderBoundsIndex<GraphRenderNodeChunkDescriptor>([]);
  private readonly nodeResidents = new Map<number, GraphRenderNodeChunk>();
  private readonly edgeResidents = new Map<number, GraphRenderEdgeChunk>();
  private readonly nodeRequests = new Map<number, Promise<GraphRenderNodeChunk>>();
  private readonly edgeRequests = new Map<number, Promise<GraphRenderEdgeChunk>>();
  private readonly resolutions = new Map<number, GraphRenderNodeResolution>();
  private loadVersion = 0;

  viewport: GraphRenderViewport | null = null;
  selectedRenderId: number | null = null;
  hoveredRenderId: number | null = null;

  private constructor(manifest: GraphRenderManifest, transport: GraphRenderTransport) {
    validateManifest(manifest);
    this.manifest = manifest;
    this.transport = transport;
    this.detailFits = manifest.totalNodeCount <= SMALL_GRAPH_NODE_LIMIT
      && manifest.nodeChunks.length <= GRAPH_RENDER_DETAIL_CHUNK_BUDGET
      && manifest.edgeChunks.filter(chunk => chunk.lod === "detail").length <= GRAPH_RENDER_DETAIL_CHUNK_BUDGET;
    this.hierarchyIndex = new GraphRenderBoundsIndex(
      manifest.hierarchy.map((value) => ({ bounds: value.bounds, value })),
    );
    this.nodeIndex = new GraphRenderBoundsIndex(
      manifest.nodeChunks.map((value) => ({ bounds: value.bounds, value })),
    );
    this.edgeIndexes = buildEdgeIndexes(manifest);
  }

  static async prepare(ownerId: string, transport: GraphRenderTransport, source?: GraphRenderSource) {
    return new GraphRenderClient(await transport.prepare(ownerId, source), transport);
  }

  planViewport(viewport: GraphRenderViewport) {
    validateViewport(viewport);
    // Small owners fit in the existing detail budgets at the initial camera distance.
    // Their unpartitioned relations can exist only in detail chunks.
    const lod = this.detailFits ? "detail" : selectGraphRenderLod(viewport, this.manifest.globalBounds);
    const hierarchy = this.hierarchyIndex.querySphere(
      viewport.center,
      viewport.radius,
      GRAPH_RENDER_HIERARCHY_BUDGET,
    );
    const nodeChunks = lod === "detail"
      ? this.nodeIndex.querySphere(viewport.center, viewport.radius, GRAPH_RENDER_DETAIL_CHUNK_BUDGET)
      : [];
    const edgeChunks = this.edgeIndexes[lod].querySphere(
      viewport.center,
      viewport.radius,
      edgeBudget(lod),
    );
    return { lod, hierarchy, nodeChunks, edgeChunks };
  }

  async loadViewport(viewport: GraphRenderViewport): Promise<GraphRenderFrame> {
    const version = ++this.loadVersion;
    const plan = this.planViewport(viewport);
    this.viewport = viewport;
    const [nodeChunks, edgeChunks] = await Promise.all([
      Promise.all(plan.nodeChunks.map((descriptor) => this.ensureNodeChunk(descriptor))),
      Promise.all(plan.edgeChunks.map((descriptor) => this.ensureEdgeChunk(descriptor))),
    ]);
    if (version === this.loadVersion) {
      this.pickIndex = new GraphRenderBoundsIndex(
        plan.nodeChunks.map((value) => ({ bounds: value.bounds, value })),
      );
    }
    return {
      lod: plan.lod,
      viewport,
      hierarchy: plan.hierarchy,
      nodeChunks,
      edgeChunks,
      labels: plan.lod === "detail" ? selectFrameLabels(nodeChunks) : [],
    };
  }

  pickNodeChunkIds(
    origin: GraphRenderVec3,
    direction: GraphRenderVec3,
  ) {
    return this.pickIndex
      .queryRay(origin, direction, GRAPH_RENDER_PICK_CHUNK_BUDGET)
      .map((descriptor) => descriptor.chunkId);
  }

  setSelectedRenderId(renderId: number | null) {
    this.selectedRenderId = validateRenderId(renderId);
  }

  setHoveredRenderId(renderId: number | null) {
    this.hoveredRenderId = validateRenderId(renderId);
  }

  async resolveNode(renderId: number): Promise<GraphRenderNodeResolution> {
    validateRenderId(renderId);
    const cached = this.resolutions.get(renderId);
    if (cached) {
      this.resolutions.delete(renderId);
      this.resolutions.set(renderId, cached);
      return cached;
    }
    const resolution = await this.transport.resolveNode(this.manifest.generationId, renderId);
    this.resolutions.set(renderId, resolution);
    while (this.resolutions.size > RESOLUTION_CACHE_LIMIT) {
      const oldest = this.resolutions.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.resolutions.delete(oldest);
    }
    return resolution;
  }

  private ensureNodeChunk(descriptor: GraphRenderNodeChunkDescriptor) {
    const resident = this.nodeResidents.get(descriptor.chunkId);
    if (resident) return Promise.resolve(retain(this.nodeResidents, descriptor.chunkId, resident));
    const requested = this.nodeRequests.get(descriptor.chunkId);
    if (requested) return requested;

    const request = this.transport
      .nodeChunk(this.manifest.generationId, descriptor.chunkId)
      .then((raw) => {
        if (raw.byteLength !== descriptor.byteLen) throw new Error("graph render node chunk byte length mismatch");
        const chunk = decodeNodeChunk(
          raw,
          this.manifest.generationId,
          descriptor,
        );
        return retain(this.nodeResidents, descriptor.chunkId, chunk);
      })
      .finally(() => this.nodeRequests.delete(descriptor.chunkId));
    this.nodeRequests.set(descriptor.chunkId, request);
    return request;
  }

  private ensureEdgeChunk(descriptor: GraphRenderEdgeChunkDescriptor) {
    const resident = this.edgeResidents.get(descriptor.chunkId);
    if (resident) return Promise.resolve(retain(this.edgeResidents, descriptor.chunkId, resident));
    const requested = this.edgeRequests.get(descriptor.chunkId);
    if (requested) return requested;

    const request = this.transport
      .edgeChunk(this.manifest.generationId, descriptor.chunkId)
      .then((raw) => {
        if (raw.byteLength !== descriptor.byteLen) throw new Error("graph render edge chunk byte length mismatch");
        const chunk = decodeEdgeChunk(
          raw,
          this.manifest.generationId,
          descriptor.chunkId,
          descriptor.segmentCount,
        );
        return retain(this.edgeResidents, descriptor.chunkId, chunk);
      })
      .finally(() => this.edgeRequests.delete(descriptor.chunkId));
    this.edgeRequests.set(descriptor.chunkId, request);
    return request;
  }
}
