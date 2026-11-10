import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GraphRenderLabel } from "./types";

interface LabelTexture {
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
}

export function RenderLabels({
  labels,
  markerScale,
}: {
  labels: readonly GraphRenderLabel[];
  markerScale: number;
}) {
  return (
    <group>
      {labels.map((label) => <Label key={label.renderId} value={label} markerScale={markerScale} />)}
    </group>
  );
}

function Label({ value, markerScale }: { value: GraphRenderLabel; markerScale: number }) {
  const texture = useMemo(() => createTexture(value.label), [value.label]);
  useEffect(() => () => texture?.texture.dispose(), [texture]);
  if (!texture) return null;

  const importance = Math.log2(value.importance + 2);
  const worldHeight = Math.min(5.2, 2.4 + importance * 0.35) * markerScale;
  return (
    <sprite
      position={[
        value.position[0],
        value.position[1] + worldHeight * 0.9,
        value.position[2],
      ]}
      scale={[
        worldHeight * (texture.width / texture.height),
        worldHeight,
        1,
      ]}
      renderOrder={20}
      raycast={() => null}
    >
      <spriteMaterial
        map={texture.texture}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function createTexture(text: string): LabelTexture | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  const fontSize = 50;
  const padding = 20;
  context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const width = Math.ceil(context.measureText(text).width) + padding * 2;
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
  context.fillStyle = "#d7c9ff";
  context.strokeText(text, width / 2, height / 2);
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, width, height };
}
