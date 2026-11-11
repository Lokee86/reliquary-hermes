import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GRAPH_RENDER_LABEL_BUDGET } from "./lod";
import type { GraphRenderHierarchyDescriptor, GraphRenderTerritory } from "./types";
import { selectCommunityShells, territoryShellOpacity } from "./displayHelpers";

// Warlock Territories.tsx at d9e38cb. The view maps only the active hierarchy.
interface GraphTerritory {
  id: number;
  label: string;
  nodeCount: number;
  kind: GraphRenderTerritory["kind"];
  communityId: string | null;
  radius: number;
  x: number;
  y: number;
  z: number;
  color: string;
}

interface LabelTexture { texture: THREE.CanvasTexture; width: number; height: number }

function labelTexture(text: string, color: string): LabelTexture | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const fontSize = 54;
  const paddingX = 26;
  context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  const width = Math.ceil(context.measureText(text).width) + paddingX * 2;
  const height = fontSize + 32;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 10;
  context.strokeStyle = "rgba(3,7,18,0.96)";
  context.fillStyle = color;
  context.strokeText(text, width / 2, height / 2);
  context.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, width, height };
}

function TerritoryLabel({ territory, isolated }: { territory: GraphTerritory; isolated: boolean }) {
  const text = `${territory.label.toUpperCase()} · ${territory.nodeCount.toLocaleString("en-US")}`;
  const label = useMemo(() => labelTexture(text, territory.color), [territory.color, text]);
  useEffect(() => () => label?.texture.dispose(), [label]);
  if (!label) return null;
  const unassigned = territory.kind === "unassigned";
  const originalHeight = Math.max(12, Math.min(28, territory.radius * 0.16));
  // Keep compact Rust layouts legible, and keep labels inside the initial frame
  // when a single sphere fills it. Multiple real communities retain Warlock placement.
  const worldHeight = Math.min(originalHeight, territory.radius * 0.16);
  const labelY = territory.radius * (unassigned ? 0.66 : 0.82) + worldHeight;
  const labelZ = territory.radius * (unassigned || isolated ? 0 : 0.62);
  return (
    <sprite
      position={[territory.x, territory.y + labelY, territory.z + labelZ]}
      scale={[worldHeight * (label.width / label.height), worldHeight, 1]}
      renderOrder={30}
      frustumCulled={false}
    >
      <spriteMaterial map={label.texture} transparent opacity={territory.kind === "unassigned" ? 0.65 : 0.94} depthWrite={false} depthTest={false} toneMapped={false} />
    </sprite>
  );
}

export function RenderTerritories({ hierarchy, isolated, territoryOpacity, communityShellLimit, selectedCommunityId = null }: {
  hierarchy: readonly GraphRenderHierarchyDescriptor[];
  isolated: boolean;
  territoryOpacity: number;
  communityShellLimit: number;
  selectedCommunityId?: string | null;
}) {
  const shellIds = useMemo(
    () => new Set(selectCommunityShells(hierarchy, communityShellLimit)),
    [communityShellLimit, hierarchy],
  );
  const territories = useMemo(() => hierarchy.flatMap(({ id, kind, nodeCount, territory }) => {
    if (kind !== "territory" || !territory) return [];
    const [x, y, z] = territory.center;
    return [{
      id, label: territory.label, nodeCount, kind: territory.kind, communityId: territory.communityId, radius: territory.radius,
      x, y, z, color: `#${new THREE.Color().setRGB(...territory.color, THREE.SRGBColorSpace).getHexString()}`,
    }];
  }), [hierarchy]);
  return (
    <group>
      {territories.map((territory, index) => (
        <group key={territory.id}>
          {territoryOpacity > 0 && shellIds.has(territory.id) && (
            <mesh position={[territory.x, territory.y, territory.z]} raycast={() => null}>
              <sphereGeometry args={[Math.max(0.1, territory.radius), 28, 18]} />
              <meshBasicMaterial
                color={territory.color}
                transparent
                opacity={territoryShellOpacity(
                  territory.kind,
                  territoryOpacity,
                  territory.kind === "community" && territory.communityId !== null
                    && territory.communityId === selectedCommunityId,
                )}
                wireframe
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          )}
          {index < GRAPH_RENDER_LABEL_BUDGET && <TerritoryLabel territory={territory} isolated={isolated} />}
        </group>
      ))}
    </group>
  );
}
