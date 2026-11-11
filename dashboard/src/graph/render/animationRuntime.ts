import type { ResolvedAnimationSpeeds } from "../model/animationSettings";

export const MAX_ANIMATION_FRAME_DELTA = 0.05;

export interface AnimationReadiness {
  controlsAvailable: boolean;
  enabled: boolean;
  focused: boolean;
  visible: boolean;
  editing: boolean;
  dragging: boolean;
  elapsedMs: number;
  startDelaySeconds: number;
}

export function isAnimationReady(state: AnimationReadiness): boolean {
  return state.controlsAvailable
    && state.enabled
    && state.focused
    && state.visible
    && !state.editing
    && !state.dragging
    && Number.isFinite(state.elapsedMs)
    && state.elapsedMs >= Math.max(0, state.startDelaySeconds) * 1000;
}

export function clampAnimationDelta(deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds)) return 0;
  return Math.max(0, Math.min(MAX_ANIMATION_FRAME_DELTA, deltaSeconds));
}

export function hasAnimationMotion(speeds: ResolvedAnimationSpeeds): boolean {
  return Math.abs(speeds.x) > 1e-6
    || Math.abs(speeds.y) > 1e-6
    || Math.abs(speeds.z) > 1e-6;
}
