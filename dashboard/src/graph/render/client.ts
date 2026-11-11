import { decodeEdgeChunk, decodeNodeChunk } from "./binary";
import { GraphRenderBoundsIndex } from "./boundsIndex";
import {
  buildEdgeIndexes,
  isGraphVec3,
  isMemoryId,
  isU32,
  validateManifest,
  validateRenderId,
  validateViewport,
} from "./clientContract";
import {
  GRAPH_RENDER_DETAIL_CHUNK_BUDGET,
  GRAPH_RENDER_HIERARCHY_BUDGET,
  GRAPH_RENDER_INTERMEDIATE_EDGE_BUDGET,
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
  GraphRenderFilterScope,
  GraphRenderHierarchyDescriptor,
  GraphRenderManifest,
  GraphRenderNodeChunk,
  GraphRenderNodeChunkDescriptor,
  GraphRenderNodeResolution,
  GraphRenderNodeInspection,
  GraphRenderVec3,
  GraphRenderViewport,
} from "./types";

const RESOLUTION_CACHE_LIMIT = 128;
const INCIDENT_EDGE_LIMIT = 128;
const RESIDENT_CHUNK_LIMIT = 2 * GRAPH_RENDER_DETAIL_CHUNK_BUDGET;
// Overview may eagerly admit modest complete point clouds, independently of edge LOD.
// The cap bounds raw chunk residency even if a future host changes chunk sizing.
export const GRAPH_RENDER_NODE_OVERVIEW_BYTE_BUDGET = 16 * 1024 * 1024;
const GRAPH_RENDER_DETAIL_EDGE_BYTE_BUDGET = 16 * 1024 * 1024;

function retain<T>(cache: Map<number, T>, id: number, value: T, limit = RESIDENT_CHUNK_LIMIT) {
  cache.delete(id);
  cache.set(id, value);
  if (cache.size > limit) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return value;
}

export class GraphRenderClient {
  readonly manifest: GraphRenderManifest;

  private readonly transport: GraphRenderTransport;
  readonly nodeOverviewFits: boolean;
  private readonly detailEdgesFit: boolean;
  private readonly hierarchyIndex: GraphRenderBoundsIndex<GraphRenderHierarchyDescriptor>;
  private readonly nodeIndex: GraphRenderBoundsIndex<GraphRenderNodeChunkDescriptor>;
  private readonly edgeIndexes: Record<GraphRenderEdgeLod, GraphRenderBoundsIndex<GraphRenderEdgeChunkDescriptor>>;
  private pickIndex = new GraphRenderBoundsIndex<GraphRenderNodeChunkDescriptor>([]);
  private readonly nodeResidents = new Map<number, GraphRenderNodeChunk>();
  private readonly edgeResidents = new Map<number, GraphRenderEdgeChunk>();
  private readonly nodeRequests = new Map<number, Promise<GraphRenderNodeChunk>>();
  private readonly edgeRequests = new Map<number, Promise<GraphRenderEdgeChunk>>();
  private readonly resolutions = new Map<number, GraphRenderNodeResolution>();
  private readonly inspections = new Map<number, GraphRenderNodeInspection>();
  private loadVersion = 0;

  viewport: GraphRenderViewport | null = null;
  selectedRenderId: number | null = null;
  hoveredRenderId: number | null = null;

  private constructor(manifest: GraphRenderManifest, transport: GraphRenderTransport) {
    validateManifest(manifest);
    this.manifest = manifest;
    this.transport = transport;
    const detailEdgeCount = manifest.edgeChunks.filter(chunk => chunk.lod === "detail").length;
    const intermediateEdgeCount = manifest.edgeChunks.filter(chunk => chunk.lod === "intermediate").length;
    const nodeBytes = manifest.nodeChunks.reduce((total, chunk) => total + chunk.byteLen, 0);
    this.nodeOverviewFits = manifest.nodeChunks.length <= GRAPH_RENDER_DETAIL_CHUNK_BUDGET
      && nodeBytes <= GRAPH_RENDER_NODE_OVERVIEW_BYTE_BUDGET;
    const detailEdgeBytes = manifest.edgeChunks
      .filter(chunk => chunk.lod === "detail")
      .reduce((total, chunk) => total + chunk.byteLen, 0);
    this.detailEdgesFit = detailEdgeCount <= GRAPH_RENDER_DETAIL_CHUNK_BUDGET
      && detailEdgeBytes <= GRAPH_RENDER_DETAIL_EDGE_BYTE_BUDGET;
    this.hierarchyIndex = new GraphRenderBoundsIndex(
      manifest.hierarchy.map((value) => ({ bounds: value.bounds, value })),
    );
    this.nodeIndex = new GraphRenderBoundsIndex(
      manifest.nodeChunks.map((value) => ({ bounds: value.bounds, value })),
    );
    this.edgeIndexes = buildEdgeIndexes(manifest);
  }

  static async prepare(
    ownerId: string, transport: GraphRenderTransport, filters: GraphRenderFilterScope = { includeArchived: false },
  ) {
    const manifest = await transport.prepare(ownerId, filters);
    if (manifest.ownerId !== ownerId) throw new Error("graph render owner mismatch");
    return new GraphRenderClient(manifest, transport);
  }

  planViewport(viewport: GraphRenderViewport) {
    validateViewport(viewport);
    // Node residency is based on bounded chunk count and bytes. Edge LOD is independent.
    const lod = selectGraphRenderLod(viewport, this.manifest.globalBounds);
    const hierarchy = this.hierarchyIndex.querySphere(
      viewport.center,
      viewport.radius,
      GRAPH_RENDER_HIERARCHY_BUDGET,
    );
    const nodeChunks = this.nodeIndex.querySphere(
      viewport.center,
      viewport.radius,
      GRAPH_RENDER_DETAIL_CHUNK_BUDGET,
    );
    const edgeChunks = this.detailEdgesFit
      ? this.edgeIndexes.detail.querySphere(
          viewport.center,
          viewport.radius,
          GRAPH_RENDER_DETAIL_CHUNK_BUDGET,
        )
      : this.edgeIndexes[lod].querySphere(
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
    if (cached) return retain(this.resolutions, renderId, cached, RESOLUTION_CACHE_LIMIT);
    const resolution = await this.transport.resolveNode(this.manifest.generationId, renderId);
    return retain(this.resolutions, renderId, resolution, RESOLUTION_CACHE_LIMIT);
  }

  async inspectNode(renderId: number, signal?: AbortSignal) {
    validateRenderId(renderId);
    signal?.throwIfAborted();
    const cached = this.inspections.get(renderId);
    if (cached) return retain(this.inspections, renderId, cached, RESOLUTION_CACHE_LIMIT);
    const detail = await this.transport.inspectNode(this.manifest.generationId, renderId, signal);
    signal?.throwIfAborted();
    if (!detail || !isMemoryId(detail.memoryId) || !isGraphVec3(detail.position)
        || typeof detail.title !== "string" || !detail.title.trim() || [...detail.title].length > 256) {
      throw new Error("invalid graph node inspection");
    }
    return retain(this.inspections, renderId, detail, RESOLUTION_CACHE_LIMIT);
  }

  async locateMemory(memoryId: string, signal?: AbortSignal) {
    if (!isMemoryId(memoryId)) throw new Error("invalid Memory ID");
    const location = await this.transport.locateMemory(this.manifest.generationId, memoryId, signal);
    signal?.throwIfAborted();
    if (location !== null && (!this.isGenerationNode(location?.renderId) || !isGraphVec3(location.position))) {
      throw new Error("invalid graph node location");
    }
    return location;
  }

  async neighborhood(renderId: number, signal?: AbortSignal) {
    validateRenderId(renderId);
    const result = await this.transport.neighborhood(this.manifest.generationId, renderId, signal);
    signal?.throwIfAborted();
    if (!result || !Array.isArray(result.edges) || !isU32(result.totalCount)
        || result.edges.length !== Math.min(result.totalCount, INCIDENT_EDGE_LIMIT)
        || result.truncated !== (result.totalCount > INCIDENT_EDGE_LIMIT)
        || result.edges.some(edge => !edge || (edge.sourceRenderId !== renderId && edge.targetRenderId !== renderId)
          || !this.isGenerationNode(edge.sourceRenderId) || !this.isGenerationNode(edge.targetRenderId)
          || !isGraphVec3(edge.sourcePosition) || !isGraphVec3(edge.targetPosition)
          || typeof edge.directed !== "boolean" || !Number.isFinite(edge.weight) || edge.weight < 0
          || !isU32(edge.style?.packedColor) || typeof edge.style.relationKind !== "string")) {
      throw new Error("invalid graph incident relationships");
    }
    return result;
  }

  private isGenerationNode(renderId: unknown) {
    return isU32(renderId) && renderId < this.manifest.totalNodeCount;
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
