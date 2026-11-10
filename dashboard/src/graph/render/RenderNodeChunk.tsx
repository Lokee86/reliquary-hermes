import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GraphRenderNodeChunk } from "./types";
import { nodeRgb } from "./renderColors";

interface Props {
  chunk: GraphRenderNodeChunk;
  markerScale: number;
  useSpheres: boolean;
  selectedRenderId: number | null;
  hoveredRenderId: number | null;
  register: (chunkId: number, pickable: THREE.Points | THREE.InstancedMesh | null) => void;
}

let pointSprite: THREE.CanvasTexture | null = null;

export function RenderNodeChunk(props: Props) {
  return props.useSpheres
    ? <InstancedSphereChunk {...props} />
    : <PointChunk {...props} />;
}

function PointChunk({
  chunk,
  markerScale,
  selectedRenderId,
  hoveredRenderId,
  register,
}: Props) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const colors = useMemo(
    () => nodeRgb(chunk.packedColors, chunk.renderIds, selectedRenderId, hoveredRenderId),
    [chunk, hoveredRenderId, selectedRenderId],
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

function InstancedSphereChunk({
  chunk,
  selectedRenderId,
  hoveredRenderId,
  register,
}: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colors = useMemo(
    () => nodeRgb(chunk.packedColors, chunk.renderIds, selectedRenderId, hoveredRenderId),
    [chunk, hoveredRenderId, selectedRenderId],
  );
  const setMesh = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (mesh) mesh.userData.graphRenderChunkId = chunk.chunkId;
    register(chunk.chunkId, mesh);
    meshRef.current = mesh;
  }, [chunk.chunkId, register]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    for (let index = 0; index < chunk.nodeCount; index += 1) {
      const offset = index * 3;
      transform.position.set(chunk.positions[offset], chunk.positions[offset + 1], chunk.positions[offset + 2]);
      transform.scale.setScalar(Math.max(0.2, chunk.sizes[index] * 0.5));
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      color.setRGB(colors[offset] / 255, colors[offset + 1] / 255, colors[offset + 2] / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(index, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [chunk, colors]);

  return (
    <instancedMesh
      ref={setMesh}
      args={[undefined, undefined, chunk.nodeCount]}
      frustumCulled
    >
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
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
