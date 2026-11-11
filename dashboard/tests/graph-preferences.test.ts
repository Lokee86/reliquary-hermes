import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISPLAY_SETTINGS, DISPLAY_LIMITS, clampDisplaySettings,
  loadDisplaySettings, saveDisplaySettings,
} from "../src/graph/model/displaySettings";
import {
  DEFAULT_ANIMATION_SETTINGS, clampAnimationSettings, loadAnimationSettings,
  saveAnimationSettings, resolveAnimationSpeeds, rpmToRadiansPerSecond,
} from "../src/graph/model/animationSettings";
import {
  clearStoredGraphView, isStoredGraphViewWithinBounds, loadStoredGraphView,
  parseStoredGraphView, saveStoredGraphView,
} from "../src/graph/model/viewDefaults";
import { rotateCameraAroundPivotAxes } from "../src/graph/model/graphRotation";
import * as THREE from "three";
import { createPreferenceSessionStore, type StorageLike } from "../src/graph/model/scopedStorage";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function useBrowserStorage(storage: StorageLike) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

test("display settings clamp bounds, reject nonfinite values, and use REL shell budget", () => {
  const settings = clampDisplaySettings({
    edgeBrightness: 99, nodeGlow: -1, bloom: Number.NaN, territoryOpacity: Infinity,
    communityShellLimit: 9999.2, cameraCenterIndicator: "true",
  });
  assert.deepEqual(settings, {
    ...DEFAULT_DISPLAY_SETTINGS,
    edgeBrightness: DISPLAY_LIMITS.edgeBrightness.max,
    nodeGlow: DISPLAY_LIMITS.nodeGlow.min,
    communityShellLimit: DISPLAY_LIMITS.communityShellLimit.max,
  });
  assert.equal(DEFAULT_DISPLAY_SETTINGS.communityShellLimit, 128);
  assert.deepEqual(clampDisplaySettings(null), DEFAULT_DISPLAY_SETTINGS);
  assert.deepEqual(clampDisplaySettings(42), DEFAULT_DISPLAY_SETTINGS);
});

test("animation defaults, strict bounds and injected random resolution", () => {
  assert.deepEqual(clampAnimationSettings(null), DEFAULT_ANIMATION_SETTINGS);
  assert.deepEqual(clampAnimationSettings("bad"), DEFAULT_ANIMATION_SETTINGS);
  const clamped = clampAnimationSettings({ enabled: false, startDelay: -3, y: { speed: Infinity, randomRange: 99, randomCounterspin: true } });
  assert.equal(clamped.enabled, false);
  assert.equal(clamped.startDelay, 0);
  assert.equal(clamped.y.speed, DEFAULT_ANIMATION_SETTINGS.y.speed);
  assert.equal(clamped.y.randomRange, 5);
  const resolved = resolveAnimationSpeeds({ ...DEFAULT_ANIMATION_SETTINGS,
    x: { speed: 1, randomRange: 2, randomCounterspin: false },
    y: { speed: 1, randomRange: 0, randomCounterspin: true },
  }, (() => { const values = [0.75, 0.5, 0.25, 0.5, 0.5, 0.5]; return () => values.shift() ?? 0.5; })());
  assert.deepEqual(resolved, { x: 2, y: -1, z: 0 });
  assert.equal(rpmToRadiansPerSecond(1), Math.PI / 30);
});

test("display and animation persistence is profile-scoped and ignores old keys", () => {
  const browser = new MemoryStorage();
  browser.setItem("cbm-display", JSON.stringify({ edgeBrightness: 3 }));
  browser.setItem("warlock-graph-animation-v1", JSON.stringify({ startDelay: 0 }));
  useBrowserStorage(browser);
  const scopeA = { profileKey: JSON.stringify(["Desktop", "connection-a", "owner-a"]) };
  const scopeB = { profileKey: JSON.stringify(["Desktop", "connection-b", "owner-a"]) };
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, edgeBrightness: 2 }, scopeA);
  saveAnimationSettings({ ...DEFAULT_ANIMATION_SETTINGS, startDelay: 42 }, scopeA);
  assert.equal(loadDisplaySettings(scopeA).edgeBrightness, 2);
  assert.equal(loadAnimationSettings(scopeA).startDelay, 42);
  assert.equal(loadDisplaySettings(scopeB).edgeBrightness, 1);
  assert.equal(loadAnimationSettings(scopeB).startDelay, 60);
});

test("missing profile stays in an explicit per-mount session store", () => {
  const browser = new MemoryStorage();
  useBrowserStorage(browser);
  const firstMount = createPreferenceSessionStore();
  const secondMount = createPreferenceSessionStore();
  const scope = { profileKey: null };
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, nodeGlow: 0.25 }, scope, firstMount);
  assert.equal(loadDisplaySettings(scope, firstMount).nodeGlow, 0.25);
  assert.equal(loadDisplaySettings(scope, secondMount).nodeGlow, 1);
  assert.equal(browser.values.size, 0);
});

test("storage failure falls back to session; malformed persistence safely defaults", () => {
  const throwing: StorageLike = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  useBrowserStorage(throwing);
  const session = createPreferenceSessionStore();
  const scope = { profileKey: "profile" };
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, bloom: 0.5 }, scope, session);
  assert.equal(loadDisplaySettings(scope, session).bloom, 0.5);
  session.setItem("reliquary.graph.preferences.v1:session:display", "not json");
  assert.equal(loadDisplaySettings({ profileKey: null }, session).bloom, 1);
});

test("camera views normalize up, reject degeneracy, and validate against current bounds", () => {
  const valid = parseStoredGraphView({ position: [0, 0, 3], target: [0, 0, 0], up: [0, 3, 4] });
  assert.deepEqual(valid?.up, [0, 0.6, 0.8]);
  assert.equal(parseStoredGraphView({ position: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] }), null);
  assert.equal(parseStoredGraphView({ position: [0, 0, 10], target: [0, 0, 0], up: [0, 0, 2] }), null);
  assert.equal(parseStoredGraphView({ position: [0, Infinity, 1], target: [0, 0, 0], up: [0, 1, 0] }), null);
  assert.equal(isStoredGraphViewWithinBounds(valid!, { min: [-1, -1, -1], max: [1, 1, 1] }), true);
  const stale = parseStoredGraphView({ position: [1000, 0, 10], target: [1000, 0, 0], up: [0, 1, 0] })!;
  assert.equal(isStoredGraphViewWithinBounds(stale, { min: [-1, -1, -1], max: [1, 1, 1] }), false);
});

test("saved camera views require profile and owner and remain isolated", () => {
  const browser = new MemoryStorage();
  browser.setItem("warlock-graph-default-view:project", JSON.stringify({ position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0] }));
  useBrowserStorage(browser);
  const ownerA = { profileKey: "p1", ownerKey: "a" };
  const ownerB = { profileKey: "p1", ownerKey: "b" };
  const view = { position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 2, 0] as [number, number, number] };
  saveStoredGraphView(view, ownerA);
  assert.deepEqual(loadStoredGraphView(ownerA)?.up, [0, 1, 0]);
  assert.equal(loadStoredGraphView(ownerB), null);
  const session = createPreferenceSessionStore();
  saveStoredGraphView(view, { profileKey: null, ownerKey: "a" }, session);
  assert.ok(loadStoredGraphView({ profileKey: null, ownerKey: "a" }, session));
  assert.deepEqual(loadStoredGraphView(ownerA)?.up, [0, 1, 0]);
  clearStoredGraphView(ownerA);
  assert.equal(loadStoredGraphView(ownerA), null);
});

test("camera rotation is deterministic, keeps pivot fixed, and normalizes up", () => {
  const position = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 2, 0);
  const pivot = new THREE.Vector3(0, 0, 0);
  rotateCameraAroundPivotAxes(position, up, pivot, { x: 0, y: 0, z: Math.PI / 2 });
  assert.ok(Math.abs(position.x) < 1e-12);
  assert.ok(Math.abs(position.y - 1) < 1e-12);
  assert.ok(Math.abs(position.z) < 1e-12);
  assert.ok(Math.abs(up.x + 1) < 1e-12);
  assert.ok(Math.abs(up.y) < 1e-12);
  assert.ok(Math.abs(up.z) < 1e-12);
});



test("a session fallback write overrides an older browser value after quota failure", () => {
  const browser = new MemoryStorage();
  useBrowserStorage(browser);
  const session = createPreferenceSessionStore();
  const scope = { profileKey: "profile-quota" };
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, bloom: 0.25 }, scope);
  const failingWrite: StorageLike = {
    getItem: (key) => browser.getItem(key),
    setItem() { throw new Error("quota"); },
    removeItem: (key) => browser.removeItem(key),
  };
  useBrowserStorage(failingWrite);
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, bloom: 0.75 }, scope, session);
  assert.equal(loadDisplaySettings(scope, session).bloom, 0.75);
});


test("a recovered primary write clears the fallback overlay", () => {
  const browser = new MemoryStorage();
  useBrowserStorage(browser);
  const session = createPreferenceSessionStore();
  const scope = { profileKey: "profile-recovery" };
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, bloom: 0.25 }, scope);

  useBrowserStorage({
    getItem: (key) => browser.getItem(key),
    setItem() { throw new Error("quota"); },
    removeItem: (key) => browser.removeItem(key),
  });
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, bloom: 0.75 }, scope, session);
  assert.equal(loadDisplaySettings(scope, session).bloom, 0.75);

  useBrowserStorage(browser);
  saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, bloom: 1.5 }, scope, session);
  assert.equal(loadDisplaySettings(scope, session).bloom, 1.5);
});

test("failed camera view clear keeps a session tombstone until storage recovers", () => {
  const browser = new MemoryStorage();
  useBrowserStorage(browser);
  const session = createPreferenceSessionStore();
  const scope = { profileKey: "profile-clear", ownerKey: "owner-a" };
  const view = { position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number] };
  saveStoredGraphView(view, scope);
  const failingRemove: StorageLike = {
    getItem: (key) => browser.getItem(key),
    setItem: (key, value) => browser.setItem(key, value),
    removeItem() { throw new Error("storage unavailable"); },
  };
  useBrowserStorage(failingRemove);
  clearStoredGraphView(scope, session);
  assert.equal(loadStoredGraphView(scope, session), null);

  useBrowserStorage(browser);
  assert.equal(loadStoredGraphView(scope, session), null);
  clearStoredGraphView(scope, session);
  assert.equal(loadStoredGraphView(scope, session), null);
});

test("long Unicode profile and owner scopes remain distinct and persist", () => {
  const browser = new MemoryStorage();
  useBrowserStorage(browser);
  const profileKey = JSON.stringify(["Desktop", `connection-${"c".repeat(120)}`, `profile-${"é".repeat(100)}`]);
  const ownerA = { profileKey, ownerKey: `owner-${"🧭".repeat(30)}-a` };
  const ownerB = { profileKey, ownerKey: `owner-${"🧭".repeat(30)}-b` };
  const view = { position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number] };
  saveStoredGraphView(view, ownerA);
  assert.ok(browser.values.size > 0);
  assert.deepEqual(loadStoredGraphView(ownerA)?.position, [0, 0, 10]);
  assert.equal(loadStoredGraphView(ownerB), null);
});
