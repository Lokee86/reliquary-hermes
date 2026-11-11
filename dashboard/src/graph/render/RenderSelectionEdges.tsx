import { useMemo } from "react";
import * as THREE from "three";
import { EdgeLines } from "./RenderEdgeChunk";
import { edgeIntensityScale, setPackedColor } from "./renderColors";
import type { GraphRenderIncidentEdge, GraphRenderNeighborhood } from "./types";

export function RenderSelectionEdges({ neighborhood }: { neighborhood: GraphRenderNeighborhood | null }) {
  const buffers = useMemo(() => {
    if (!neighborhood || neighborhood.edges.length === 0) return null;
    const count = neighborhood.edges.length;
    const endpoints = new Float32Array(count * 6);
    const packedColors = new Uint32Array(count);
    const weights = new Float32Array(count);
    neighborhood.edges.forEach((edge, index) => {
      endpoints.set(edge.sourcePosition, index * 6);
      endpoints.set(edge.targetPosition, index * 6 + 3);
      packedColors[index] = edge.style.packedColor;
      weights[index] = edge.weight;
    });
    return { endpoints, packedColors, weights };
  }, [neighborhood]);

  if (!buffers) return null;
  // As in Warlock, each incident segment has one selected endpoint.
  const intensity = 0.04 * edgeIntensityScale(buffers.weights.length);
  return (
    <group>
      <EdgeLines {...buffers} intensity={intensity} renderOrder={10} />
      {neighborhood?.edges.filter((edge) => edge.directed).map((edge, index) => (
        <DirectedMarker key={`${edge.sourceRenderId}:${edge.targetRenderId}:${index}`} edge={edge} />
      ))}
    </group>
  );
}

function DirectedMarker({ edge }: { edge: GraphRenderIncidentEdge }) {
  const from = new THREE.Vector3(...edge.sourcePosition);
  const to = new THREE.Vector3(...edge.targetPosition);
  const delta = to.clone().sub(from);
  const length = delta.length();
  if (length <= 0) return null;
  const size = Math.min(1.4, Math.max(0.12, length * 0.05));
  const color = setPackedColor(new THREE.Color(), edge.style.packedColor);
  const direction = delta.normalize();
  const position = from.addScaledVector(direction, length * 0.76);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  return (
    <mesh position={position} quaternion={quaternion} renderOrder={11}>
      <coneGeometry args={[size * 0.48, size, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
