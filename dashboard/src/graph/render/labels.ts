import { GRAPH_RENDER_LABEL_BUDGET } from "./lod";
import type {
  GraphRenderLabel,
  GraphRenderNodeChunk,
} from "./types";

function labelAt(
  chunk: GraphRenderNodeChunk,
  index: number,
  label: string,
): Omit<GraphRenderLabel, "importance"> {
  const offset = index * 3;
  return {
    renderId: chunk.renderIds[index],
    label,
    position: [
      chunk.positions[offset],
      chunk.positions[offset + 1],
      chunk.positions[offset + 2],
    ],
    size: chunk.sizes[index],
    packedColor: chunk.packedColors[index],
  };
}

export function findFrameLabel(
  chunks: readonly GraphRenderNodeChunk[],
  renderId: number,
  title: string,
) {
  for (const chunk of chunks) {
    const index = chunk.renderIds.indexOf(renderId);
    if (index !== -1) return labelAt(chunk, index, title);
  }
  return null;
}

export function selectFrameLabels(
  chunks: readonly GraphRenderNodeChunk[],
): GraphRenderLabel[] {
  const candidates: GraphRenderLabel[] = [];

  for (const chunk of chunks) {
    for (const candidate of chunk.labelCandidates) {
      candidates.push({
        ...labelAt(chunk, candidate.itemIndex, candidate.label),
        importance: candidate.importance,
      });
    }
  }

  candidates.sort((left, right) => (
    right.importance - left.importance
    || left.renderId - right.renderId
  ));
  return candidates.slice(0, GRAPH_RENDER_LABEL_BUDGET);
}
