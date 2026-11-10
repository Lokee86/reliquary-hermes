import type { GraphRenderHierarchyDescriptor } from "./types";

export function RenderTerritories({
  hierarchy,
}: {
  hierarchy: readonly GraphRenderHierarchyDescriptor[];
}) {
  return (
    <group>
      {hierarchy
        .filter((node) => node.kind === "territory")
        .map((node) => {
          const center = [
            (node.bounds.min[0] + node.bounds.max[0]) * 0.5,
            (node.bounds.min[1] + node.bounds.max[1]) * 0.5,
            (node.bounds.min[2] + node.bounds.max[2]) * 0.5,
          ] as const;
          const scale = [
            Math.max(0.1, node.bounds.max[0] - node.bounds.min[0]),
            Math.max(0.1, node.bounds.max[1] - node.bounds.min[1]),
            Math.max(0.1, node.bounds.max[2] - node.bounds.min[2]),
          ] as const;
          return (
            <mesh key={node.id} position={center} scale={scale} raycast={() => null}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial
                color="#8f7caf"
                transparent
                opacity={0.09}
                wireframe
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          );
        })}
    </group>
  );
}
