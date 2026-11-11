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
const CAMERA_ACTIVITY_KEYS = new Set(["Enter", "Space", "Escape"]);

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches("input, select, textarea, [contenteditable='true'], [role='textbox']"));
}

function isGraphControlTarget(target: EventTarget | null, canvas: HTMLCanvasElement): boolean {
  return target === canvas
    || (target instanceof Element && target.closest(".graph-render-reset, .graph-preferences-trigger") !== null);
}

export function GraphAnimationController({
  controlsRef,
  settings,
  rerollToken,
  activityRef,
}: GraphAnimationControllerProps) {
  const { camera, gl } = useThree();
  const lastInteraction = useRef(performance.now());
  const wasAnimating = useRef(false);
  const viewportVisible = useRef(false);
  const surfaceAvailable = useRef(false);
  const editingControl = useRef(false);
  const draggingPointers = useRef(new Set<number>());
  const pressedMovementKeys = useRef(new Set<string>());
  const speeds = useRef<ResolvedAnimationSpeeds | null>(null);
  if (speeds.current === null) speeds.current = resolveAnimationSpeeds(settings);

  useEffect(() => {
    speeds.current = resolveAnimationSpeeds(settings);
  }, [rerollToken, settings]);

  useEffect(() => {
    const canvas = gl.domElement;
    const surface = canvas.closest<HTMLElement>(".knowledge-surface");
    if (!surface) return;
    surfaceAvailable.current = true;

    const markInteraction = () => {
      lastInteraction.current = performance.now();
      wasAnimating.current = false;
      activityRef.current = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isGraphControlTarget(event.target, canvas)) return;
      if (event.target === canvas) draggingPointers.current.add(event.pointerId);
      markInteraction();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!draggingPointers.current.has(event.pointerId)) return;
      draggingPointers.current.delete(event.pointerId);
      markInteraction();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.target === canvas) markInteraction();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== canvas || event.altKey || event.ctrlKey || event.metaKey) return;
      if (CAMERA_MOVEMENT_KEYS.has(event.code)) pressedMovementKeys.current.add(event.code);
      else if (!CAMERA_ACTIVITY_KEYS.has(event.code)) return;
      markInteraction();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!pressedMovementKeys.current.has(event.code)) return;
      pressedMovementKeys.current.delete(event.code);
      markInteraction();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isEditableTarget(event.target)) {
        editingControl.current = true;
        markInteraction();
      } else if (isGraphControlTarget(event.target, canvas)) {
        editingControl.current = false;
        markInteraction();
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isEditableTarget(event.target)) return;
      editingControl.current = isEditableTarget(event.relatedTarget);
      markInteraction();
    };
    const clearHeldInput = () => {
      draggingPointers.current.clear();
      pressedMovementKeys.current.clear();
      markInteraction();
    };

    surface.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    surface.addEventListener("wheel", onWheel);
    surface.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp, true);
    surface.addEventListener("focusin", onFocusIn, true);
    surface.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("blur", clearHeldInput);
    window.addEventListener("focus", markInteraction);
    document.addEventListener("visibilitychange", clearHeldInput);

    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
        const visible = Boolean(entry?.isIntersecting
          && entry.intersectionRect.width > 0
          && entry.intersectionRect.height > 0);
        if (visible === viewportVisible.current) return;
        viewportVisible.current = visible;
        if (visible) markInteraction();
        else clearHeldInput();
      });
    if (observer) {
      viewportVisible.current = false;
      observer.observe(canvas);
    } else {
      viewportVisible.current = true;
    }

    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      surface.removeEventListener("wheel", onWheel);
      surface.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp, true);
      surface.removeEventListener("focusin", onFocusIn, true);
      surface.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("blur", clearHeldInput);
      window.removeEventListener("focus", markInteraction);
      document.removeEventListener("visibilitychange", clearHeldInput);
      observer?.disconnect();
      surfaceAvailable.current = false;
    };
  }, [activityRef, gl]);

  useEffect(() => () => {
    activityRef.current = false;
  }, [activityRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const focused = typeof document.hasFocus !== "function" || document.hasFocus();
    const ready = isAnimationReady({
      controlsAvailable: controls !== null && surfaceAvailable.current,
      enabled: settings.enabled,
      focused,
      visible: !document.hidden && viewportVisible.current,
      editing: editingControl.current || isEditableTarget(document.activeElement),
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
    const currentSpeeds = speeds.current;
    if (!currentSpeeds) {
      activityRef.current = false;
      return;
    }
    const moving = hasAnimationMotion(currentSpeeds);
    activityRef.current = moving;
    if (!moving) return;

    const safeDelta = clampAnimationDelta(delta);
    if (safeDelta === 0) return;
    rotateCameraAroundPivotAxes(camera.position, camera.up, controls.target, {
      x: rpmToRadiansPerSecond(currentSpeeds.x) * safeDelta,
      y: rpmToRadiansPerSecond(currentSpeeds.y) * safeDelta,
      z: rpmToRadiansPerSecond(currentSpeeds.z) * safeDelta,
    });
    camera.lookAt(controls.target);
    controls.update();
  });

  return null;
}
