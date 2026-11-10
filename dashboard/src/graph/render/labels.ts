import { GRAPH_RENDER_LABEL_BUDGET } from "./lod";
import type {
  GraphRenderLabel,
  GraphRenderNodeChunk,
} from "./types";

export function selectFrameLabels(
  chunks: readonly GraphRenderNodeChunk[],
): GraphRenderLabel[] {
  const candidates: GraphRenderLabel[] = [];

  for (const chunk of chunks) {
    for (const candidate of chunk.labelCandidates) {
      const offset = candidate.itemIndex * 3;
      candidates.push({
        renderId: candidate.renderId,
        label: candidate.label,
        importance: candidate.importance,
        position: [
          chunk.positions[offset],
          chunk.positions[offset + 1],
          chunk.positions[offset + 2],
        ],
      });
    }
  }

  candidates.sort((left, right) => (
    right.importance - left.importance
    || left.renderId - right.renderId
  ));
  return candidates.slice(0, GRAPH_RENDER_LABEL_BUDGET);
}
