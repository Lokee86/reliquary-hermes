import { GraphRenderBoundsIndex } from "./boundsIndex";
import {
  GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK,
  GRAPH_RENDER_LABEL_MAX_CHARS,
} from "./lod";
import type {
  GraphRenderEdgeChunkDescriptor,
  GraphRenderEdgeLod,
  GraphRenderManifest,
  GraphRenderViewport,
  GraphRenderVec3,
} from "./types";

export function buildEdgeIndexes(manifest: GraphRenderManifest) {
  return Object.fromEntries(
    (["overview", "intermediate", "detail"] as const).map((lod) => [
      lod,
      new GraphRenderBoundsIndex(
        manifest.edgeChunks
          .filter((descriptor) => descriptor.lod === lod)
          .map((value) => ({ bounds: value.bounds, value })),
      ),
    ]),
  ) as Record<
    GraphRenderEdgeLod,
    GraphRenderBoundsIndex<GraphRenderEdgeChunkDescriptor>
  >;
}

export function validateManifest(manifest: GraphRenderManifest) {
  if (manifest.schemaVersion !== 3) {
    throw new Error(`unsupported graph render manifest version ${manifest.schemaVersion}`);
  }
  if (!/^\d+$/.test(manifest.generationId)) {
    throw new Error("graph render generation ID is not decimal");
  }
  if (!Number.isSafeInteger(manifest.totalNodeCount) || manifest.totalNodeCount < 0) {
    throw new Error("graph render manifest node count is invalid");
  }

  for (const node of manifest.hierarchy) {
    const territory = node.territory;
    if (node.kind !== "territory") {
      if (territory !== undefined) throw new Error("unexpected graph render territory");
      continue;
    }
    if (!territory || node.nodeCount <= 0 || !isGraphVec3(territory.center)
        || !isGraphVec3(territory.color) || territory.color.some(value => value < 0 || value > 1)
        || !Number.isFinite(territory.radius) || territory.radius <= 0
        || typeof territory.label !== "string" || !territory.label.trim() || [...territory.label].length > 96
        || (territory.kind === "community" ? !isMemoryId(territory.communityId)
          : territory.kind !== "unassigned" || territory.communityId !== null)) {
      throw new Error("invalid graph render territory");
    }
  }

  for (const chunk of manifest.nodeChunks) {
    if (chunk.labelCandidates.length > GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK) {
      throw new Error("graph render label candidate budget exceeded");
    }
    for (const candidate of chunk.labelCandidates) {
      if (
        !isU32(candidate.renderId)
        || !isU32(candidate.itemIndex)
        || !isU32(candidate.importance)
        || candidate.itemIndex >= chunk.nodeCount
      ) {
        throw new Error("graph render label candidate is invalid");
      }
      if ([...candidate.label].length > GRAPH_RENDER_LABEL_MAX_CHARS) {
        throw new Error("graph render label candidate exceeds text budget");
      }
    }
  }
}

export function validateViewport(viewport: GraphRenderViewport) {
  if (!Number.isFinite(viewport.radius) || viewport.radius <= 0) {
    throw new Error("graph render viewport radius must be positive");
  }
  if (!viewport.center.every(Number.isFinite)) {
    throw new Error("graph render viewport center must be finite");
  }
}

export function validateRenderId(renderId: number | null) {
  if (renderId === null) return null;
  if (!isU32(renderId)) throw new Error("graph render ID must be a u32");
  return renderId;
}

export function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

export function isGraphVec3(value: unknown): value is GraphRenderVec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

export function isMemoryId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
