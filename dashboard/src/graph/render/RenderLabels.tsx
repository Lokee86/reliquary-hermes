// Port of Warlock scene/NodeLabels.tsx at d9e38cb, with bounded viewport labels.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GraphRenderLabel } from "./types";

interface LabelTexture { texture: THREE.CanvasTexture; width: number; height: number }

function createLabelTexture(text: string, color: string): LabelTexture | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const fontSize = 58;
  const padding = 22;
  context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const fitted = text.length > 48 ? `${text.slice(0, 45)}...` : text;
  const width = Math.ceil(context.measureText(fitted).width) + padding * 2;
  const height = fontSize + 28;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 8;
  context.strokeStyle = "rgba(0,0,0,0.9)";
  context.fillStyle = color;
  context.strokeText(fitted, width / 2, height / 2);
  context.fillText(fitted, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, width, height };
}

type VisualLabel = Omit<GraphRenderLabel, "importance">;

function Label({ node }: { node: VisualLabel }) {
  const color = `#${(node.packedColor >>> 8).toString(16).padStart(6, "0")}`;
  const label = useMemo(() => createLabelTexture(node.label, color), [color, node.label]);
  useEffect(() => () => label?.texture.dispose(), [label]);
  if (!label) return null;
  const worldHeight = Math.max(2.1, node.size * 0.7);
  const worldWidth = worldHeight * (label.width / label.height);
  return (
    <sprite
      position={[node.position[0], node.position[1] + node.size + worldHeight / 2, node.position[2]]}
      scale={[worldWidth, worldHeight, 1]}
      renderOrder={20}
      raycast={() => null}
    >
      <spriteMaterial map={label.texture} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </sprite>
  );
}

export function RenderLabels({
  labels,
  selectedRenderId,
  selectedLabel,
}: {
  labels: readonly GraphRenderLabel[];
  selectedRenderId: number | null;
  selectedLabel?: VisualLabel | null;
}) {
  // The client already ranks and caps viewport candidates. A selected node may
  // receive its own label from its resident chunk and bounded authenticated title.
  const selected = selectedLabel?.renderId === selectedRenderId
    ? selectedLabel
    : labels.find((label) => label.renderId === selectedRenderId);
  const labeled = selectedRenderId === null ? labels : selected ? [selected] : [];
  return <group>{labeled.map((node) => <Label key={node.renderId} node={node} />)}</group>;
}
