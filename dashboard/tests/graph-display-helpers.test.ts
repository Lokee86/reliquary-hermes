import assert from "node:assert/strict";
import test from "node:test";
import type { GraphRenderHierarchyDescriptor } from "../src/graph/render/types";
import {
  clampCommunityShellLimit,
  composeEdgeIntensity,
  composeNodeGlowMultiplier,
  selectCommunityShells,
  territoryShellOpacity,
} from "../src/graph/render/displayHelpers";

function territory(
  id: number,
  nodeCount: number,
  kind: "community" | "unassigned",
): GraphRenderHierarchyDescriptor {
  return {
    id,
    parentId: null,
    kind: "territory",
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    nodeCount,
    chunkId: null,
    territory: {
      kind,
      communityId: kind === "community" ? `community-${id}` : null,
      label: `Territory ${id}`,
      color: [1, 1, 1],
      center: [0, 0, 0],
      radius: 1,
    },
  };
}

test("node glow scales only the boost above the base color", () => {
  const fullBoost = composeNodeGlowMultiplier(0.1, 0.1, 0.9, 1);
  assert.equal(composeNodeGlowMultiplier(0.1, 0.1, 0.9, 0), 1);
  assert.equal(composeNodeGlowMultiplier(0.1, 0.1, 0.9, 1), fullBoost);
  assert.equal(composeNodeGlowMultiplier(0.1, 0.1, 0.9, 2), 1 + (fullBoost - 1) * 2);
  assert.equal(composeNodeGlowMultiplier(0.1, 0.1, 0.9, Number.NaN), fullBoost);
});

test("edge brightness composes after density compensation for every LOD", () => {
  for (const lod of ["overview", "intermediate", "detail"] as const) {
    assert.equal(composeEdgeIntensity(lod, 100, 1), lod === "detail" ? 0.25 : 0.06);
    assert.equal(composeEdgeIntensity(lod, 100, 2), (lod === "detail" ? 0.25 : 0.06) * 2);
    assert.ok(composeEdgeIntensity(lod, 100_000, 3) < composeEdgeIntensity(lod, 100, 3));
    assert.ok(Number.isFinite(composeEdgeIntensity(lod, 100, Number.POSITIVE_INFINITY)));
  }
});

test("territory opacity uses v1 shell factors and keeps unassigned distinct", () => {
  assert.equal(territoryShellOpacity("community", 0.3), 0.085 * 0.3);
  assert.equal(territoryShellOpacity("unassigned", 0.3), 0.045 * 0.3);
  assert.equal(territoryShellOpacity("community", 0.3, true), 0.24 * 0.3);
  assert.equal(territoryShellOpacity("community", 0), 0);
  assert.equal(territoryShellOpacity("community", 2), 0.085);
});

test("community shell limits clamp to the frame budget and select deterministically", () => {
  const hierarchy = [
    territory(8, 500, "unassigned"),
    territory(6, 20, "community"),
    territory(4, 20, "community"),
    territory(2, 100, "community"),
  ];
  assert.equal(clampCommunityShellLimit(-1), 0);
  assert.equal(clampCommunityShellLimit(1000), 128);
  assert.deepEqual(selectCommunityShells(hierarchy, 3), [2, 4, 6]);
  assert.deepEqual(selectCommunityShells(hierarchy, 4), [2, 4, 6, 8]);
  assert.deepEqual(selectCommunityShells(hierarchy, 0), []);
});
