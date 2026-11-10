import type {
  GraphRenderBounds,
  GraphRenderEdgeLod,
  GraphRenderViewport,
} from "./types";

export const GRAPH_RENDER_DETAIL_CHUNK_BUDGET = 32;
export const GRAPH_RENDER_INTERMEDIATE_EDGE_BUDGET = 16;
export const GRAPH_RENDER_OVERVIEW_EDGE_BUDGET = 4;
export const GRAPH_RENDER_HIERARCHY_BUDGET = 128;
export const GRAPH_RENDER_PICK_CHUNK_BUDGET = 8;
export const GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK = 4;
export const GRAPH_RENDER_LABEL_BUDGET = 48;
export const GRAPH_RENDER_LABEL_MAX_CHARS = 64;

export function selectGraphRenderLod(
  viewport: GraphRenderViewport,
  globalBounds: GraphRenderBounds,
): GraphRenderEdgeLod {
  const globalRadius = Math.max(
    globalBounds.max[0] - globalBounds.min[0],
    globalBounds.max[1] - globalBounds.min[1],
    globalBounds.max[2] - globalBounds.min[2],
    1,
  ) * 0.5;
  const ratio = viewport.radius / globalRadius;
  if (ratio >= 0.35) return "overview";
  if (ratio >= 0.08) return "intermediate";
  return "detail";
}

export function edgeBudget(lod: GraphRenderEdgeLod) {
  switch (lod) {
    case "overview":
      return GRAPH_RENDER_OVERVIEW_EDGE_BUDGET;
    case "intermediate":
      return GRAPH_RENDER_INTERMEDIATE_EDGE_BUDGET;
    case "detail":
      return GRAPH_RENDER_DETAIL_CHUNK_BUDGET;
  }
}
