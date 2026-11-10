import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GraphRenderNodeChunk } from "./types";
import { nodeRgb } from "./renderColors";

interface Props {
  chunk: GraphRenderNodeChunk;
  markerScale: number;
  selectedRenderId: number | null;
  register: (chunkId: number, points: THREE.Points | null) => void;
}

let pointSprite: THREE.CanvasTexture | null = null;

export function RenderNodeChunk({
  chunk,
  markerScale,
  selectedRenderId,
  register,
}: Props) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const colors = useMemo(
    () => nodeRgb(chunk.packedColors, chunk.renderIds, selectedRenderId),
    [chunk, selectedRenderId],
  );
  const setPoints = useCallback((points: THREE.Points | null) => {
    if (points) points.userData.graphRenderChunkId = chunk.chunkId;
    register(chunk.chunkId, points);
  }, [chunk.chunkId, register]);

  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(...chunk.bounds.min),
      new THREE.Vector3(...chunk.bounds.max),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  }, [chunk.bounds]);

  return (
    <points ref={setPoints} frustumCulled>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute attach="attributes-position" args={[chunk.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3, true]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={4 * markerScale}
        sizeAttenuation
        map={getPointSprite()}
        alphaTest={0.35}
        transparent
        toneMapped={false}
      />
    </points>
  );
}

function getPointSprite() {
  if (pointSprite) return pointSprite;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  pointSprite = new THREE.CanvasTexture(canvas);
  return pointSprite;
}
