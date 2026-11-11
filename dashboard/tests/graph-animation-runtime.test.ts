import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraCenterIndicatorScale,
  cameraCenterIndicatorZoomScale,
  cameraCenterPulse,
  CAMERA_CENTER_NODE_DIAMETER_PX,
} from "../src/graph/render/cameraIndicator";
import {
  clampAnimationDelta,
  hasAnimationMotion,
  isAnimationReady,
  MAX_ANIMATION_FRAME_DELTA,
} from "../src/graph/render/animationRuntime";

const baseReadiness = {
  controlsAvailable: true,
  enabled: true,
  focused: true,
  visible: true,
  editing: false,
  dragging: false,
  elapsedMs: 60_000,
  startDelaySeconds: 60,
};

test("animation readiness honors delay, activity, focus, visibility and settings", () => {
  assert.equal(isAnimationReady(baseReadiness), true);
  assert.equal(isAnimationReady({ ...baseReadiness, elapsedMs: 59_999 }), false);
  for (const key of ["controlsAvailable", "enabled", "focused", "visible"] as const) {
    assert.equal(isAnimationReady({ ...baseReadiness, [key]: false }), false);
  }
  assert.equal(isAnimationReady({ ...baseReadiness, editing: true }), false);
  assert.equal(isAnimationReady({ ...baseReadiness, dragging: true }), false);
});

test("animation frame delta is finite, nonnegative, and capped", () => {
  assert.equal(clampAnimationDelta(0.016), 0.016);
  assert.equal(clampAnimationDelta(1), MAX_ANIMATION_FRAME_DELTA);
  assert.equal(clampAnimationDelta(-1), 0);
  assert.equal(clampAnimationDelta(Number.NaN), 0);
});

test("resolved rotation speeds determine whether motion is active", () => {
  assert.equal(hasAnimationMotion({ x: 0, y: 1e-7, z: 0 }), false);
  assert.equal(hasAnimationMotion({ x: -0.1, y: 0, z: 0 }), true);
  assert.equal(hasAnimationMotion({ x: 0, y: 0, z: 0.1 }), true);
});

test("camera marker keeps the v1 30-pixel zoom-responsive scale and pulse", () => {
  assert.equal(CAMERA_CENTER_NODE_DIAMETER_PX, 30);
  assert.equal(cameraCenterIndicatorZoomScale(800), 1);
  assert.equal(cameraCenterIndicatorZoomScale(3200), 0.5);
  const distance = 800;
  const expected = distance * Math.tan((50 * Math.PI) / 360) * (30 / 600);
  assert.equal(cameraCenterIndicatorScale(distance, 50, 600), expected);
  assert.equal(cameraCenterIndicatorScale(distance, 50, 0), distance * Math.tan((50 * Math.PI) / 360) * 30);

  const peak = cameraCenterPulse(Math.PI / (2 * 2.6));
  assert.equal(peak.scale, 1.23);
  assert.ok(Math.abs(peak.opacity - 0.252) < 1e-12);
});
