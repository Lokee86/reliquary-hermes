import type {
  GraphRenderManifest,
  GraphRenderFilterScope,
  GraphRenderNeighborhood,
  GraphRenderNodeInspection,
  GraphRenderNodeLocation,
  GraphRenderNodeResolution,
} from "./types";

export interface GraphRenderTransport {
  prepare(ownerId: string, filters: GraphRenderFilterScope): Promise<GraphRenderManifest>;
  nodeChunk(generationId: string, chunkId: number): Promise<Uint8Array>;
  edgeChunk(generationId: string, chunkId: number): Promise<Uint8Array>;
  resolveNode(generationId: string, renderId: number): Promise<GraphRenderNodeResolution>;
  inspectNode(generationId: string, renderId: number, signal?: AbortSignal): Promise<GraphRenderNodeInspection>;
  neighborhood(generationId: string, renderId: number, signal?: AbortSignal): Promise<GraphRenderNeighborhood>;
  locateMemory(generationId: string, memoryId: string, signal?: AbortSignal): Promise<GraphRenderNodeLocation | null>;
}
