// Port of Warlock scene/NodeCloud.tsx at d9e38cb, fed by resident binary chunks.
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { nodeGlowBoost, setPackedColor } from "./renderColors";
import type { GraphRenderNodeChunk } from "./types";

interface Props {
  chunk: GraphRenderNodeChunk;
  totalNodeCount: number;
  selectedRenderId: number | null;
  hoveredRenderId: number | null;
  register: (chunkId: number, pickable: THREE.Points | THREE.InstancedMesh | null) => void;
}

const POINT_MODE_THRESHOLD = 75000;

function nodeColor(
  packed: number,
  highlighted: boolean,
  hovered: boolean,
  temp: THREE.Color,
): [number, number, number] {
  setPackedColor(temp, packed);
  if (!highlighted && !hovered) temp.multiplyScalar(0.15);
  else temp.multiplyScalar(nodeGlowBoost(temp.r, temp.g, temp.b));
  // Hermes has an explicit hover highlight alongside Warlock's selection emphasis.
  if (hovered) temp.multiplyScalar(1.2);
  return [temp.r, temp.g, temp.b];
}

function useNodeColors({ chunk, selectedRenderId, hoveredRenderId }: Props) {
  // Only a change to this chunk's hover target invalidates its color buffer.
  const hoveredIndex = hoveredRenderId === null ? -1 : chunk.renderIds.indexOf(hoveredRenderId);
  return useMemo(() => {
    const colors = new Float32Array(chunk.nodeCount * 3);
    const temp = new THREE.Color();
    for (let index = 0; index < chunk.nodeCount; index += 1) {
      const highlighted = selectedRenderId === null || chunk.renderIds[index] === selectedRenderId;
      const [r, g, b] = nodeColor(chunk.packedColors[index], highlighted, index === hoveredIndex, temp);
      colors[index * 3] = r;
      colors[index * 3 + 1] = g;
      colors[index * 3 + 2] = b;
    }
    return colors;
  }, [chunk, hoveredIndex, selectedRenderId]);
}

let pointSprite: THREE.CanvasTexture | null = null;
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

function NodePoints(props: Props) {
  const { chunk, register } = props;
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const colors = useNodeColors(props);
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

  // BoundedPicker owns raycasts and maps the hit index back to the chunk's render ID.
  return (
    <points key={chunk.nodeCount} ref={setPoints}>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute attach="attributes-position" args={[chunk.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={4} sizeAttenuation map={getPointSprite()} alphaTest={0.35} transparent toneMapped={false} />
    </points>
  );
}

function sphereDetail(count: number): [number, number, number] {
  if (count <= 8000) return [1, 32, 24];
  if (count <= 25000) return [1, 16, 12];
  return [1, 10, 7];
}

function NodeSpheres(props: Props) {
  const { chunk, totalNodeCount, selectedRenderId, register } = props;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const colors = useNodeColors(props);
  const setMesh = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (mesh) mesh.userData.graphRenderChunkId = chunk.chunkId;
    register(chunk.chunkId, mesh);
    meshRef.current = mesh;
  }, [chunk.chunkId, register]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let index = 0; index < chunk.nodeCount; index += 1) {
      tempObj.position.fromArray(chunk.positions, index * 3);
      const highlighted = selectedRenderId === null || chunk.renderIds[index] === selectedRenderId;
      tempObj.scale.setScalar(chunk.sizes[index] * (highlighted ? 0.5 : 0.2));
      tempObj.updateMatrix();
      mesh.setMatrixAt(index, tempObj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [chunk, selectedRenderId, tempObj]);

  return (
    <instancedMesh
      key={chunk.nodeCount}
      ref={setMesh}
      args={[undefined, undefined, chunk.nodeCount]}
    >
      <sphereGeometry args={sphereDetail(totalNodeCount)} />
      <meshBasicMaterial vertexColors toneMapped={false} />
      <instancedBufferAttribute attach="geometry-attributes-color" args={[colors, 3]} />
    </instancedMesh>
  );
}

export function RenderNodeChunk(props: Props) {
  return props.totalNodeCount > POINT_MODE_THRESHOLD ? <NodePoints {...props} /> : <NodeSpheres {...props} />;
}
