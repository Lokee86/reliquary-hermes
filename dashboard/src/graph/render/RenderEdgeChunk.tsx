import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GraphRenderEdgeChunk, GraphRenderEdgeLod } from "./types";
import { edgeIntensityScale, setPackedColor } from "./renderColors";

type EdgeBuffers = Pick<GraphRenderEdgeChunk, "endpoints" | "packedColors" | "weights">;

interface Props extends EdgeBuffers {
  intensity: number;
  muted?: boolean;
  renderOrder?: number;
}

// Warlock EdgeLines.tsx at d9e38cb, fed by bounded renderer-native segments.
export function EdgeLines({ endpoints, packedColors, weights, intensity, muted, renderOrder }: Props) {
  const geometry = useMemo(() => {
    const colors = new Float32Array(endpoints.length);
    const color = new THREE.Color();

    for (let index = 0; index < weights.length; index += 1) {
      // The chunk weight is the available strength. Aggregate sums can exceed one.
      const strength = Math.min(1, intensity * weights[index]);
      setPackedColor(color, packedColors[index]);
      for (let vertex = 0; vertex < 2; vertex += 1) {
        const offset = index * 6 + vertex * 3;
        colors[offset] = color.r * strength;
        colors[offset + 1] = color.g * strength;
        colors[offset + 2] = color.b * strength;
      }
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(endpoints, 3));
    result.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return result;
  }, [endpoints, intensity, packedColors, weights]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} visible={!muted} renderOrder={renderOrder}>
      <lineBasicMaterial
        vertexColors
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

export function RenderEdgeChunk({
  chunk,
  lod,
  muted = false,
  visibleSegmentCount,
}: {
  chunk: GraphRenderEdgeChunk;
  lod: GraphRenderEdgeLod;
  muted?: boolean;
  visibleSegmentCount: number;
}) {
  // Detail segments stay within one leaf. Aggregate segments connect hierarchy centers.
  const intensity = (lod === "detail" ? 0.25 : 0.06) * edgeIntensityScale(visibleSegmentCount);
  return (
    <EdgeLines
      endpoints={chunk.endpoints}
      packedColors={chunk.packedColors}
      weights={chunk.weights}
      intensity={intensity}
      muted={muted}
    />
  );
}
