import { useMemo } from "react";
import * as THREE from "three";
import type { GraphRenderIncidentEdge, GraphRenderNeighborhood } from "./types";

export function RenderSelectionEdges({ neighborhood }: { neighborhood: GraphRenderNeighborhood | null }) {
  const geometry = useMemo(() => {
    if (!neighborhood || neighborhood.edges.length === 0) return null;
    const positions = new Float32Array(neighborhood.edges.length * 6);
    const colors = new Float32Array(neighborhood.edges.length * 6);
    neighborhood.edges.forEach((edge, index) => {
      const offset = index * 6;
      positions.set(edge.sourcePosition, offset);
      positions.set(edge.targetPosition, offset + 3);
      const packed = edge.style.packedColor >>> 0;
      const strength = Math.min(1, Math.max(0.5, 0.68 + edge.weight * 0.3));
      colors[offset] = ((packed >>> 24) & 0xff) / 255 * strength;
      colors[offset + 1] = ((packed >>> 16) & 0xff) / 255 * strength;
      colors[offset + 2] = ((packed >>> 8) & 0xff) / 255 * strength;
      colors[offset + 3] = colors[offset];
      colors[offset + 4] = colors[offset + 1];
      colors[offset + 5] = colors[offset + 2];
    });
    const value = new THREE.BufferGeometry();
    value.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    value.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return value;
  }, [neighborhood]);

  if (!geometry) return null;
  return (
    <group>
      <lineSegments geometry={geometry} renderOrder={10}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
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
  const packed = edge.style.packedColor >>> 0;
  const color = new THREE.Color().setRGB(
    ((packed >>> 24) & 0xff) / 255,
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    THREE.SRGBColorSpace,
  );
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
