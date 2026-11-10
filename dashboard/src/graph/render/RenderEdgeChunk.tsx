import { useMemo } from "react";
import * as THREE from "three";
import type { GraphRenderEdgeChunk } from "./types";
import { edgeRgb } from "./renderColors";

export function RenderEdgeChunk({ chunk }: { chunk: GraphRenderEdgeChunk }) {
  const colors = useMemo(
    () => edgeRgb(chunk.packedColors, chunk.weights),
    [chunk],
  );

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[chunk.endpoints, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3, true]} />
      </bufferGeometry>
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
