import { GRAPH_RENDER_HIERARCHY_BUDGET } from "./lod";
import type { GraphRenderHierarchyDescriptor } from "./types";
import { edgeIntensityScale, nodeGlowBoost } from "./renderColors";

export const DEFAULT_COMMUNITY_SHELL_LIMIT = GRAPH_RENDER_HIERARCHY_BUDGET;

export function clampCommunityShellLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_COMMUNITY_SHELL_LIMIT;
  return Math.max(0, Math.min(GRAPH_RENDER_HIERARCHY_BUDGET, Math.round(limit)));
}

export function composeNodeGlowMultiplier(
  r: number,
  g: number,
  b: number,
  userGlow: number,
): number {
  const glow = Number.isFinite(userGlow) ? Math.max(0, Math.min(2, userGlow)) : 1;
  return 1 + (nodeGlowBoost(r, g, b) - 1) * glow;
}

export function composeEdgeIntensity(
  lod: "overview" | "intermediate" | "detail",
  visibleSegmentCount: number,
  edgeBrightness: number,
): number {
  const brightness = Number.isFinite(edgeBrightness)
    ? Math.max(0.1, Math.min(3, edgeBrightness))
    : 1;
  return (lod === "detail" ? 0.25 : 0.06)
    * edgeIntensityScale(visibleSegmentCount)
    * brightness;
}

export function territoryShellOpacity(
  kind: "community" | "unassigned",
  territoryOpacity: number,
  selected = false,
): number {
  const multiplier = Number.isFinite(territoryOpacity)
    ? Math.max(0, Math.min(1, territoryOpacity))
    : 0.3;
  const factor = kind === "unassigned" ? 0.045 : selected ? 0.24 : 0.085;
  return multiplier * factor;
}

export function selectCommunityShells(
  hierarchy: readonly GraphRenderHierarchyDescriptor[],
  requestedLimit: number,
): number[] {
  const limit = clampCommunityShellLimit(requestedLimit);
  if (limit === 0) return [];

  return hierarchy
    .filter((item) => item.kind === "territory" && item.territory !== undefined)
    .slice()
    .sort((a, b) => {
      const aIsCommunity = a.territory?.kind === "community";
      const bIsCommunity = b.territory?.kind === "community";
      if (aIsCommunity !== bIsCommunity) return aIsCommunity ? -1 : 1;
      if (a.nodeCount !== b.nodeCount) return b.nodeCount - a.nodeCount;
      return a.id - b.id;
    })
    .slice(0, limit)
    .map(({ id }) => id);
}
