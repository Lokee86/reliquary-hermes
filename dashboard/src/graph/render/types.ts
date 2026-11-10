export type GraphRenderVec3 = readonly [number, number, number];

export interface GraphRenderBounds {
  min: GraphRenderVec3;
  max: GraphRenderVec3;
}

export type GraphRenderHierarchyKind = "graph" | "territory" | "subgroup" | "leaf";
export type GraphRenderEdgeLod = "overview" | "intermediate" | "detail";

export interface GraphRenderHierarchyDescriptor {
  id: number;
  parentId: number | null;
  kind: GraphRenderHierarchyKind;
  bounds: GraphRenderBounds;
  nodeCount: number;
  chunkId: number | null;
}

export interface GraphRenderLabelCandidateDescriptor {
  renderId: number;
  itemIndex: number;
  importance: number;
  label: string;
}

export interface GraphRenderNodeChunkDescriptor {
  chunkId: number;
  parentHierarchyId: number;
  bounds: GraphRenderBounds;
  nodeCount: number;
  byteLen: number;
  labelCandidates: GraphRenderLabelCandidateDescriptor[];
}

export interface GraphRenderEdgeChunkDescriptor {
  chunkId: number;
  lod: GraphRenderEdgeLod;
  bounds: GraphRenderBounds;
  segmentCount: number;
  byteLen: number;
}

export interface GraphRenderManifest {
  schemaVersion: number;
  generationId: string;
  ownerId: string;
  sourceCommunityGeneration: string | null;
  totalNodeCount: number;
  rootHierarchyId: number;
  globalBounds: GraphRenderBounds;
  hierarchy: GraphRenderHierarchyDescriptor[];
  nodeChunks: GraphRenderNodeChunkDescriptor[];
  edgeChunks: GraphRenderEdgeChunkDescriptor[];
}

export interface GraphRenderNodeChunk {
  raw: Uint8Array;
  generationId: bigint;
  chunkId: number;
  nodeCount: number;
  positions: Float32Array;
  packedColors: Uint32Array;
  sizes: Float32Array;
  renderIds: Uint32Array;
  bounds: GraphRenderBounds;
  labelCandidates: GraphRenderLabelCandidateDescriptor[];
}

export interface GraphRenderEdgeChunk {
  raw: Uint8Array;
  generationId: bigint;
  chunkId: number;
  segmentCount: number;
  endpoints: Float32Array;
  weights: Float32Array;
  packedColors: Uint32Array;
}

export interface GraphRenderViewport {
  center: GraphRenderVec3;
  radius: number;
}

export interface GraphRenderLabel {
  renderId: number;
  label: string;
  importance: number;
  position: GraphRenderVec3;
}

export interface GraphRenderFrame {
  lod: GraphRenderEdgeLod;
  viewport: GraphRenderViewport;
  hierarchy: GraphRenderHierarchyDescriptor[];
  nodeChunks: GraphRenderNodeChunk[];
  edgeChunks: GraphRenderEdgeChunk[];
  labels: GraphRenderLabel[];
}

export type GraphRenderSource = { kind: "reliquary" };

export type GraphRenderNodeResolution = { memoryId: string };
