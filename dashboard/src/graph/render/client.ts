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
const RESIDENT_NODE_BYTE_LIMIT = 32 * 1024 * 1024;
const RESIDENT_EDGE_BYTE_LIMIT = 32 * 1024 * 1024;
export const GRAPH_RENDER_CHUNK_REQUEST_CONCURRENCY = 8;
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

function retainChunk<T extends { raw: Uint8Array }>(
  cache: Map<number, T>, id: number, value: T, byteLimit: number,
) {
  cache.delete(id);
  cache.set(id, value);
  let bytes = 0;
  for (const chunk of cache.values()) bytes += chunk.raw.byteLength;
  while (cache.size > RESIDENT_CHUNK_LIMIT || bytes > byteLimit) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const removed = cache.get(oldest.value);
    cache.delete(oldest.value);
    bytes -= removed?.raw.byteLength ?? 0;
  }
  return value;
}

interface ScheduledChunkRequest<T> {
  key: string;
  version: number;
  controller?: AbortController;
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
  run(signal: AbortSignal, isCurrent: () => boolean): Promise<T>;
}

class StaleGraphRenderRequestError extends Error {
  constructor() { super("graph render viewport request was superseded"); }
}

export class GraphRenderClient {
  readonly manifest: GraphRenderManifest;

  private readonly transport: GraphRenderTransport;
  readonly nodeOverviewFits: boolean;
  private readonly overviewNodeChunks: GraphRenderNodeChunkDescriptor[];
  private readonly detailEdgesFit: boolean;
  private readonly hierarchyIndex: GraphRenderBoundsIndex<GraphRenderHierarchyDescriptor>;
  private readonly nodeIndex: GraphRenderBoundsIndex<GraphRenderNodeChunkDescriptor>;
  private readonly edgeIndexes: Record<GraphRenderEdgeLod, GraphRenderBoundsIndex<GraphRenderEdgeChunkDescriptor>>;
  private pickIndex = new GraphRenderBoundsIndex<GraphRenderNodeChunkDescriptor>([]);
  private readonly nodeResidents = new Map<number, GraphRenderNodeChunk>();
  private readonly edgeResidents = new Map<number, GraphRenderEdgeChunk>();
  private readonly chunkRequests = new Map<string, ScheduledChunkRequest<unknown>>();
  private readonly pendingChunkRequests: ScheduledChunkRequest<unknown>[] = [];
  private activeChunkRequests = 0;
  private viewportRequestVersion = 0;
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
    const nodeBytes = manifest.nodeChunks.reduce((total, chunk) => total + chunk.byteLen, 0);
    this.nodeOverviewFits = manifest.nodeChunks.length <= GRAPH_RENDER_DETAIL_CHUNK_BUDGET
      && nodeBytes <= GRAPH_RENDER_NODE_OVERVIEW_BYTE_BUDGET;
    this.overviewNodeChunks = selectSpatialNodeSample(manifest.nodeChunks, manifest.globalBounds);
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
    const nodeCandidates = this.nodeOverviewFits
      ? this.manifest.nodeChunks
      : lod === "overview"
        ? this.overviewNodeChunks
        : this.nodeIndex.querySphere(viewport.center, viewport.radius, GRAPH_RENDER_DETAIL_CHUNK_BUDGET);
    const nodeChunks = selectBoundedNodeChunks(nodeCandidates);
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
    return {
      lod,
      hierarchy,
      nodeChunks,
      edgeChunks: selectBoundedEdgeChunks(
        edgeChunks,
        this.detailEdgesFit ? GRAPH_RENDER_DETAIL_CHUNK_BUDGET : edgeBudget(lod),
      ),
    };
  }

  async loadViewport(viewport: GraphRenderViewport): Promise<GraphRenderFrame> {
    const version = ++this.loadVersion;
    this.viewportRequestVersion = version;
    const plan = this.planViewport(viewport);
    this.viewport = viewport;
    const nodeRequest = Promise.all(plan.nodeChunks.map((descriptor) => this.ensureNodeChunk(descriptor, version)));
    const edgeRequest = Promise.all(plan.edgeChunks.map((descriptor) => this.ensureEdgeChunk(descriptor, version)));
    this.discardStaleQueuedRequests(version);
    this.abortStaleRunningRequests(version);
    const [nodeChunks, edgeChunks] = await Promise.all([nodeRequest, edgeRequest]);
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

  get activeChunkRequestCount() { return this.activeChunkRequests; }
  get queuedChunkRequestCount() { return this.pendingChunkRequests.length; }
  get residentNodeByteCount() {
    return [...this.nodeResidents.values()].reduce((total, chunk) => total + chunk.raw.byteLength, 0);
  }
  get residentEdgeByteCount() {
    return [...this.edgeResidents.values()].reduce((total, chunk) => total + chunk.raw.byteLength, 0);
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

  private ensureNodeChunk(descriptor: GraphRenderNodeChunkDescriptor, version: number) {
    const resident = this.nodeResidents.get(descriptor.chunkId);
    if (resident) return Promise.resolve(retainChunk(this.nodeResidents, descriptor.chunkId, resident, RESIDENT_NODE_BYTE_LIMIT));
    return this.scheduleChunkRequest(`node:${descriptor.chunkId}`, version, async (signal, isCurrent) => {
      const raw = await this.transport.nodeChunk(this.manifest.generationId, descriptor.chunkId, signal);
      if (!isCurrent()) throw new StaleGraphRenderRequestError();
      if (raw.byteLength !== descriptor.byteLen) throw new Error("graph render node chunk byte length mismatch");
      const chunk = decodeNodeChunk(
        raw,
        this.manifest.generationId,
        descriptor,
      );
      return retainChunk(this.nodeResidents, descriptor.chunkId, chunk, RESIDENT_NODE_BYTE_LIMIT);
    });
  }

  private ensureEdgeChunk(descriptor: GraphRenderEdgeChunkDescriptor, version: number) {
    const resident = this.edgeResidents.get(descriptor.chunkId);
    if (resident) return Promise.resolve(retainChunk(this.edgeResidents, descriptor.chunkId, resident, RESIDENT_EDGE_BYTE_LIMIT));
    return this.scheduleChunkRequest(`edge:${descriptor.chunkId}`, version, async (signal, isCurrent) => {
      const raw = await this.transport.edgeChunk(this.manifest.generationId, descriptor.chunkId, signal);
      if (!isCurrent()) throw new StaleGraphRenderRequestError();
      if (raw.byteLength !== descriptor.byteLen) throw new Error("graph render edge chunk byte length mismatch");
      const chunk = decodeEdgeChunk(
        raw,
        this.manifest.generationId,
        descriptor.chunkId,
        descriptor.segmentCount,
      );
      return retainChunk(this.edgeResidents, descriptor.chunkId, chunk, RESIDENT_EDGE_BYTE_LIMIT);
    });
  }

  private scheduleChunkRequest<T>(
    key: string,
    version: number,
    run: (signal: AbortSignal, isCurrent: () => boolean) => Promise<T>,
  ) {
    const existing = this.chunkRequests.get(key) as ScheduledChunkRequest<T> | undefined;
    if (existing) {
      existing.version = version;
      return existing.promise;
    }
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    const task: ScheduledChunkRequest<T> = { key, version, promise, resolve, reject, run };
    this.chunkRequests.set(key, task as ScheduledChunkRequest<unknown>);
    this.pendingChunkRequests.push(task as ScheduledChunkRequest<unknown>);
    this.drainChunkRequests();
    return promise;
  }

  private discardStaleQueuedRequests(version: number) {
    for (let index = this.pendingChunkRequests.length - 1; index >= 0; index -= 1) {
      const task = this.pendingChunkRequests[index];
      if (task.version === version) continue;
      this.pendingChunkRequests.splice(index, 1);
      if (this.chunkRequests.get(task.key) === task) this.chunkRequests.delete(task.key);
      task.reject(new StaleGraphRenderRequestError());
    }
  }

  private abortStaleRunningRequests(version: number) {
    for (const task of this.chunkRequests.values()) {
      if (task.version !== version) task.controller?.abort();
    }
  }

  private drainChunkRequests() {
    while (this.activeChunkRequests < GRAPH_RENDER_CHUNK_REQUEST_CONCURRENCY
        && this.pendingChunkRequests.length > 0) {
      const task = this.pendingChunkRequests.shift()!;
      if (task.version !== this.viewportRequestVersion) {
        if (this.chunkRequests.get(task.key) === task) this.chunkRequests.delete(task.key);
        task.reject(new StaleGraphRenderRequestError());
        continue;
      }
      const controller = new AbortController();
      task.controller = controller;
      this.activeChunkRequests += 1;
      task.run(controller.signal, () => task.version === this.viewportRequestVersion && !controller.signal.aborted)
        .then(
          value => task.resolve(value),
          error => task.reject(task.version !== this.viewportRequestVersion
            ? new StaleGraphRenderRequestError()
            : error instanceof Error ? error : new Error(String(error))),
        )
        .finally(() => {
          this.activeChunkRequests -= 1;
          task.controller = undefined;
          if (this.chunkRequests.get(task.key) === task) this.chunkRequests.delete(task.key);
          this.drainChunkRequests();
        });
    }
  }
}

function selectBoundedNodeChunks(candidates: GraphRenderNodeChunkDescriptor[]) {
  const selected: GraphRenderNodeChunkDescriptor[] = [];
  let bytes = 0;
  for (const chunk of candidates) {
    if (selected.length >= GRAPH_RENDER_DETAIL_CHUNK_BUDGET) break;
    if (chunk.byteLen > GRAPH_RENDER_NODE_OVERVIEW_BYTE_BUDGET
        || bytes + chunk.byteLen > GRAPH_RENDER_NODE_OVERVIEW_BYTE_BUDGET) continue;
    selected.push(chunk);
    bytes += chunk.byteLen;
  }
  return selected;
}

function selectBoundedEdgeChunks(candidates: GraphRenderEdgeChunkDescriptor[], chunkBudget: number) {
  const selected: GraphRenderEdgeChunkDescriptor[] = [];
  let bytes = 0;
  for (const chunk of candidates) {
    if (selected.length >= chunkBudget) break;
    if (chunk.byteLen > GRAPH_RENDER_DETAIL_EDGE_BYTE_BUDGET
        || bytes + chunk.byteLen > GRAPH_RENDER_DETAIL_EDGE_BYTE_BUDGET) continue;
    selected.push(chunk);
    bytes += chunk.byteLen;
  }
  return selected;
}

function selectSpatialNodeSample(
  chunks: GraphRenderNodeChunkDescriptor[],
  bounds: GraphRenderManifest["globalBounds"],
) {
  if (chunks.length === 0) return [];
  const grid = [4, 4, 2] as const;
  const buckets = new Map<number, GraphRenderNodeChunkDescriptor[]>();
  for (const chunk of chunks) {
    const center = [0, 1, 2].map(axis =>
      (chunk.bounds.min[axis] + chunk.bounds.max[axis]) * 0.5,
    );
    const cell = center.map((value, axis) => Math.min(grid[axis] - 1, Math.max(0,
      Math.floor((value - bounds.min[axis]) / Math.max(1e-9, bounds.max[axis] - bounds.min[axis]) * grid[axis]),
    )));
    const key = cell[0] + grid[0] * (cell[1] + grid[1] * cell[2]);
    const items = buckets.get(key) ?? [];
    items.push(chunk);
    buckets.set(key, items);
  }
  const orderedBuckets = [...buckets.entries()].sort(([left], [right]) => left - right);
  const selected: GraphRenderNodeChunkDescriptor[] = [];
  for (const [, items] of orderedBuckets) {
    items.sort((left, right) => left.chunkId - right.chunkId);
    selected.push(items[0]);
  }
  // Fill unused slots in deterministic round-robin passes across spatial buckets.
  for (let offset = 1; selected.length < GRAPH_RENDER_DETAIL_CHUNK_BUDGET; offset += 1) {
    let added = false;
    for (const [, items] of orderedBuckets) {
      if (items[offset]) {
        selected.push(items[offset]);
        added = true;
        if (selected.length >= GRAPH_RENDER_DETAIL_CHUNK_BUDGET) break;
      }
    }
    if (!added) break;
  }
  return selected;
}
