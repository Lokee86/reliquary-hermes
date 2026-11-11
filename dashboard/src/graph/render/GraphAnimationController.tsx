import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { TrackballControls as TrackballControlsImpl } from "three-stdlib";
import {
  resolveAnimationSpeeds,
  rpmToRadiansPerSecond,
  type GraphAnimationSettings,
  type ResolvedAnimationSpeeds,
} from "../model/animationSettings";
import { rotateCameraAroundPivotAxes } from "../model/graphRotation";
import { clampAnimationDelta, hasAnimationMotion, isAnimationReady } from "./animationRuntime";

interface GraphAnimationControllerProps {
  controlsRef: React.RefObject<TrackballControlsImpl | null>;
  settings: GraphAnimationSettings;
  rerollToken: number;
  activityRef: React.MutableRefObject<boolean>;
}

const CAMERA_MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyQ"]);

export function GraphAnimationController({
  controlsRef,
  settings,
  rerollToken,
  activityRef,
}: GraphAnimationControllerProps) {
  const { camera, gl } = useThree();
  const lastInteraction = useRef(performance.now());
  const wasAnimating = useRef(false);
  const draggingPointers = useRef(new Set<number>());
  const pressedMovementKeys = useRef(new Set<string>());
  const speeds = useRef<ResolvedAnimationSpeeds>(resolveAnimationSpeeds(settings));

  useEffect(() => {
    speeds.current = resolveAnimationSpeeds(settings);
  }, [rerollToken, settings]);

  useEffect(() => {
    const canvas = gl.domElement;
    const surface = canvas.closest<HTMLElement>(".knowledge-surface");
    if (!surface) return;

    const markInteraction = () => {
      lastInteraction.current = performance.now();
      wasAnimating.current = false;
      activityRef.current = false;
    };
    const targetsCanvas = (event: Event) => event.target === canvas;
    const onPointerDown = (event: PointerEvent) => {
      if (!targetsCanvas(event)) return;
      draggingPointers.current.add(event.pointerId);
      markInteraction();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!targetsCanvas(event)) return;
      draggingPointers.current.delete(event.pointerId);
      markInteraction();
    };
    const onWheel = (event: WheelEvent) => {
      if (targetsCanvas(event)) markInteraction();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!targetsCanvas(event) || event.altKey || event.ctrlKey || event.metaKey
        || !CAMERA_MOVEMENT_KEYS.has(event.code)) return;
      pressedMovementKeys.current.add(event.code);
      markInteraction();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!targetsCanvas(event) || !CAMERA_MOVEMENT_KEYS.has(event.code)) return;
      pressedMovementKeys.current.delete(event.code);
      markInteraction();
    };
    const clearHeldInput = () => {
      draggingPointers.current.clear();
      pressedMovementKeys.current.clear();
      markInteraction();
    };

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointerup", onPointerEnd);
    surface.addEventListener("pointercancel", onPointerEnd);
    surface.addEventListener("wheel", onWheel);
    surface.addEventListener("keydown", onKeyDown);
    surface.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearHeldInput);
    window.addEventListener("focus", markInteraction);
    document.addEventListener("visibilitychange", markInteraction);
    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointerup", onPointerEnd);
      surface.removeEventListener("pointercancel", onPointerEnd);
      surface.removeEventListener("wheel", onWheel);
      surface.removeEventListener("keydown", onKeyDown);
      surface.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearHeldInput);
      window.removeEventListener("focus", markInteraction);
      document.removeEventListener("visibilitychange", markInteraction);
    };
  }, [activityRef, gl]);

  useEffect(() => () => {
    activityRef.current = false;
  }, [activityRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const focused = typeof document.hasFocus !== "function" || document.hasFocus();
    const ready = isAnimationReady({
      controlsAvailable: controls !== null,
      enabled: settings.enabled,
      focused,
      visible: !document.hidden,
      dragging: draggingPointers.current.size > 0 || pressedMovementKeys.current.size > 0,
      elapsedMs: performance.now() - lastInteraction.current,
      startDelaySeconds: settings.startDelay,
    });
    if (!controls || !ready) {
      wasAnimating.current = false;
      activityRef.current = false;
      return;
    }

    if (!wasAnimating.current) {
      speeds.current = resolveAnimationSpeeds(settings);
      wasAnimating.current = true;
    }
    const moving = hasAnimationMotion(speeds.current);
    activityRef.current = moving;
    if (!moving) return;

    const safeDelta = clampAnimationDelta(delta);
    if (safeDelta === 0) return;
    rotateCameraAroundPivotAxes(camera.position, camera.up, controls.target, {
      x: rpmToRadiansPerSecond(speeds.current.x) * safeDelta,
      y: rpmToRadiansPerSecond(speeds.current.y) * safeDelta,
      z: rpmToRadiansPerSecond(speeds.current.z) * safeDelta,
    });
    camera.lookAt(controls.target);
    controls.update();
  });

  return null;
}
