import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TrackballControls as TrackballControlsImpl } from "three-stdlib";
import { isStoredGraphViewWithinBounds, parseStoredGraphView } from "../model/viewDefaults";
import type { StoredGraphView, GraphCameraBounds } from "../model/viewDefaults";
import type { GraphRenderVec3 } from "./types";

export interface GraphCameraPreferences {
  defaultView: StoredGraphView | null;
  captureRequest: number;
  resetRequest: number;
  onCaptured(view: StoredGraphView): void;
  onReady(ready: boolean): void;
}

/** The v1 capture/reset bridge, applied to the existing Trackball camera only. */
export function GraphCameraBridge({ controlsRef, center, extent, focusRequest, resetVersion, preferences }: {
  controlsRef: React.RefObject<TrackballControlsImpl | null>;
  center: GraphRenderVec3;
  extent: number;
  focusRequest: GraphRenderVec3 | null;
  resetVersion: number;
  preferences: GraphCameraPreferences;
}) {
  const { camera } = useThree();
  const reset = useRef<string | null>(null);
  const lastFocus = useRef<GraphRenderVec3 | null>(null);
  const lastCapture = useRef(preferences.captureRequest);
  const ready = useRef(false);
  const onReady = useRef(preferences.onReady);
  onReady.current = preferences.onReady;
  useEffect(() => () => onReady.current(false), []);

  const bounds = useMemo<GraphCameraBounds>(() => ({
      min: [center[0] - extent, center[1] - extent, center[2] - extent],
      max: [center[0] + extent, center[1] + extent, center[2] + extent],
  }), [center, extent]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const resetKey = `${resetVersion}:${preferences.resetRequest}`;
    if (reset.current !== resetKey) {
      const parsed = parseStoredGraphView(preferences.defaultView);
      const saved = parsed && isStoredGraphViewWithinBounds(parsed, bounds) ? parsed : null;
      const fieldOfView = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
      const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
      const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(fieldOfView * 0.5)) * Math.min(1, aspect));
      const fitDistance = extent / Math.max(Math.sin(halfAngle), 0.1) * 1.08;
      camera.position.fromArray(saved?.position ?? [center[0], center[1], center[2] + fitDistance]);
      camera.up.fromArray(saved?.up ?? [0, 1, 0]);
      controls.target.fromArray(saved?.target ?? center);
      camera.lookAt(controls.target);
      controls.update();
      reset.current = resetKey;
    }
    if (lastFocus.current !== focusRequest) {
      if (focusRequest) {
        const dx = focusRequest[0] - controls.target.x;
        const dy = focusRequest[1] - controls.target.y;
        const dz = focusRequest[2] - controls.target.z;
        camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
        controls.target.fromArray(focusRequest);
        camera.lookAt(controls.target);
        controls.update();
      }
      lastFocus.current = focusRequest;
    }
    const view = parseStoredGraphView({ position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray() });
    const canCapture = view !== null && isStoredGraphViewWithinBounds(view, bounds);
    if (lastCapture.current !== preferences.captureRequest) {
      if (view && canCapture) preferences.onCaptured(view);
      lastCapture.current = preferences.captureRequest;
    }
    if (ready.current !== canCapture) { ready.current = canCapture; onReady.current(canCapture); }
  }, -1);
  return null;
}
