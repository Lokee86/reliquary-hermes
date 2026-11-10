import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TrackballControls as TrackballControlsImpl } from "three-stdlib";
import type {
  GraphRenderBounds,
  GraphRenderViewport,
} from "./types";

export function CameraViewport({
  controlsRef,
  fallbackCenter,
  onViewport,
}: {
  controlsRef: React.RefObject<TrackballControlsImpl | null>;
  fallbackCenter: readonly [number, number, number];
  onViewport: (viewport: GraphRenderViewport) => void;
}) {
  const elapsed = useRef(0);
  const previous = useRef<GraphRenderViewport | null>(null);
  const scratch = useRef(new THREE.Vector3());

  useFrame(({ camera }, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 0.12) return;
    elapsed.current = 0;

    const target = controlsRef.current?.target;
    const center = target
      ? [target.x, target.y, target.z] as const
      : fallbackCenter;
    scratch.current.set(...center);
    const distance = camera.position.distanceTo(scratch.current);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
    const radius = Math.max(
      1,
      distance * Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) * 1.6,
    );
    const next = { center, radius };
    if (sameViewport(previous.current, next)) return;
    previous.current = next;
    onViewport(next);
  });

  return null;
}

export function viewportForBounds(bounds: GraphRenderBounds): GraphRenderViewport {
  return { center: boundsCenter(bounds), radius: boundsExtent(bounds) };
}

export function boundsCenter(bounds: GraphRenderBounds) {
  return [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ] as const;
}

export function boundsExtent(bounds: GraphRenderBounds) {
  return Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
    1,
  ) * 0.5;
}

function sameViewport(left: GraphRenderViewport | null, right: GraphRenderViewport) {
  if (!left) return false;
  const tolerance = Math.max(1, left.radius * 0.04);
  return Math.abs(left.radius - right.radius) < tolerance
    && Math.hypot(
      left.center[0] - right.center[0],
      left.center[1] - right.center[1],
      left.center[2] - right.center[2],
    ) < tolerance;
}
