import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GraphRenderHierarchyDescriptor, GraphRenderTerritory } from "./types";
import { GRAPH_RENDER_LABEL_BUDGET } from "./lod";

export function RenderTerritories({
  hierarchy,
}: {
  hierarchy: readonly GraphRenderHierarchyDescriptor[];
}) {
  const territories = hierarchy.filter(
    (node): node is GraphRenderHierarchyDescriptor & { territory: GraphRenderTerritory } =>
      node.kind === "territory" && node.territory !== undefined,
  );
  const labeledTerritories = new Set(territories.slice(0, GRAPH_RENDER_LABEL_BUDGET).map((node) => node.id));

  return (
    <group>
      {territories.map((node) => (
        <Territory key={node.id} descriptor={node} showLabel={labeledTerritories.has(node.id)} />
      ))}
    </group>
  );
}

function Territory({ descriptor, showLabel }: {
  descriptor: GraphRenderHierarchyDescriptor & { territory: GraphRenderTerritory };
  showLabel: boolean;
}) {
  const { territory } = descriptor;
  const color = useMemo(
    () => new THREE.Color().setRGB(...territory.color, THREE.SRGBColorSpace),
    [territory.color],
  );
  const texture = useMemo(
    () => showLabel ? makeTerritoryLabel(territory.label, descriptor.nodeCount) : null,
    [descriptor.nodeCount, showLabel, territory.label],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  const radius = Math.max(0.1, territory.radius);
  const labelHeight = Math.max(1.5, Math.min(24, radius * 0.16));

  return (
    <group position={territory.center} raycast={() => null}>
      <mesh>
        <sphereGeometry args={[radius, 28, 20]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={territory.kind === "unassigned" ? 0.035 : 0.055}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius, 20, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={territory.kind === "unassigned" ? 0.16 : 0.23}
          wireframe
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {texture && (
        <sprite
          position={[0, radius * 0.82 + labelHeight, radius * 0.62]}
          scale={[labelHeight * (texture.width / texture.height), labelHeight, 1]}
          renderOrder={30}
          frustumCulled={false}
        >
          <spriteMaterial
            map={texture}
            transparent
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}

function makeTerritoryLabel(label: string, count: number) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = 460;
  const height = 112;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.fillStyle = "rgba(7, 10, 18, 0.74)";
  context.beginPath();
  context.roundRect(4, 7, width - 8, height - 14, 18);
  context.fill();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "600 34px Inter, system-ui, sans-serif";
  context.lineWidth = 5;
  context.strokeStyle = "rgba(0, 0, 0, 0.85)";
  context.fillStyle = "#f1ecff";
  const safeLabel = label.length > 38 ? `${label.slice(0, 37)}…` : label;
  context.strokeText(safeLabel, width / 2, 43, width - 28);
  context.fillText(safeLabel, width / 2, 43, width - 28);
  context.font = "500 23px Inter, system-ui, sans-serif";
  context.fillStyle = "#c3badc";
  context.fillText(`${count.toLocaleString()} ${count === 1 ? "memory" : "memories"}`, width / 2, 82);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
