import type {
  GraphRenderManifest,
  GraphRenderNodeResolution,
  GraphRenderSource,
} from "./types";

export interface GraphRenderTransport {
  prepare(ownerId: string, source?: GraphRenderSource): Promise<GraphRenderManifest>;
  nodeChunk(generationId: string, chunkId: number): Promise<Uint8Array>;
  edgeChunk(generationId: string, chunkId: number): Promise<Uint8Array>;
  resolveNode(generationId: string, renderId: number): Promise<GraphRenderNodeResolution>;
}
