import { graphViewPreferenceScopeKey, readPreference, writePreference, removePreference } from "./scopedStorage";
import type { GraphViewPreferenceScope, StorageLike } from "./scopedStorage";

export type Vector3Tuple = [number, number, number];
export interface StoredGraphView {
  position: Vector3Tuple;
  target: Vector3Tuple;
  up: Vector3Tuple;
}
const VIEW_STORAGE_NAME = "camera-view";
const DEGENERATE_EPSILON = 1e-6;

function validTuple(value: unknown): value is Vector3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

/** Scale first so finite but very large inputs cannot overflow a vector norm. */
function normalizeVector(value: Vector3Tuple): Vector3Tuple | null {
  const scale = Math.max(Math.abs(value[0]), Math.abs(value[1]), Math.abs(value[2]));
  if (!Number.isFinite(scale) || scale === 0) return null;
  const scaled: Vector3Tuple = [value[0] / scale, value[1] / scale, value[2] / scale];
  const length = Math.hypot(...scaled);
  if (!Number.isFinite(length) || length === 0 || scale < DEGENERATE_EPSILON / length) return null;
  const normalized = scaled.map((component) => component / length) as Vector3Tuple;
  return normalized.every(Number.isFinite) && normalized.some((component) => component !== 0)
    ? normalized : null;
}

/** Normalize target-position without ever subtracting two extreme raw coordinates. */
function normalizedDirection(position: Vector3Tuple, target: Vector3Tuple): Vector3Tuple | null {
  const scale = Math.max(...position.map(Math.abs), ...target.map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0) return null;
  const direction = target.map((component, index) => component / scale - position[index] / scale) as Vector3Tuple;
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length === 0 || scale < DEGENERATE_EPSILON / length) return null;
  const normalized = direction.map((component) => component / length) as Vector3Tuple;
  return normalized.every(Number.isFinite) && normalized.some((component) => component !== 0)
    ? normalized : null;
}

export function parseStoredGraphView(value: unknown): StoredGraphView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredGraphView>;
  if (!validTuple(candidate.position) || !validTuple(candidate.target) || !validTuple(candidate.up)) return null;
  const direction = normalizedDirection(candidate.position, candidate.target);
  const up = normalizeVector(candidate.up);
  if (!direction || !up) return null;
  // Both vectors are unit length here, so the cross product remains finite.
  const cross: Vector3Tuple = [
    direction[1] * up[2] - direction[2] * up[1],
    direction[2] * up[0] - direction[0] * up[2],
    direction[0] * up[1] - direction[1] * up[0],
  ];
  const crossLength = Math.hypot(...cross);
  if (!Number.isFinite(crossLength) || crossLength < DEGENERATE_EPSILON) return null;
  return {
    position: [...candidate.position],
    target: [...candidate.target],
    up,
  };
}

export interface GraphCameraBounds { min: Vector3Tuple; max: Vector3Tuple; }
/** Reject a view far outside today's graph bounds; padding allows normal camera distance. */
export function isStoredGraphViewWithinBounds(view: StoredGraphView, bounds: GraphCameraBounds, paddingFactor = 2): boolean {
  const validView = parseStoredGraphView(view);
  if (!validView || !Number.isFinite(paddingFactor) || paddingFactor < 0 || !validTuple(bounds?.min) || !validTuple(bounds?.max)) return false;
  if (bounds.min.some((value, i) => value > bounds.max[i])) return false;
  const extent = bounds.max.map((value, i) => value - bounds.min[i]);
  if (!extent.every((value) => Number.isFinite(value) && value >= 0)) return false;
  const padding = Math.max(...extent, 1) * paddingFactor;
  if (!Number.isFinite(padding)) return false;
  const paddedMin = bounds.min.map((value) => value - padding);
  const paddedMax = bounds.max.map((value) => value + padding);
  if (![...paddedMin, ...paddedMax].every(Number.isFinite)) return false;
  const inside = (point: Vector3Tuple) => point.every((value, i) => value >= paddedMin[i] && value <= paddedMax[i]);
  return inside(validView.position) && inside(validView.target);
}

function viewStorageScope(scope: GraphViewPreferenceScope) {
  return {
    profileKey: graphViewPreferenceScopeKey(scope),
    sessionKey: scope?.ownerKey ? `camera-owner:${scope.ownerKey}` : "camera-owner:anonymous",
  };
}
export function loadStoredGraphView(scope: GraphViewPreferenceScope, session?: StorageLike): StoredGraphView | null {
  try { return parseStoredGraphView(JSON.parse(readPreference(viewStorageScope(scope), VIEW_STORAGE_NAME, session) ?? "null")); }
  catch { return null; }
}
export function saveStoredGraphView(view: unknown, scope: GraphViewPreferenceScope, session?: StorageLike): void {
  const normalized = parseStoredGraphView(view);
  if (!normalized) return;
  try { writePreference(viewStorageScope(scope), VIEW_STORAGE_NAME, JSON.stringify(normalized), session); } catch { /* Nonfatal. */ }
}
export function clearStoredGraphView(scope: GraphViewPreferenceScope, session?: StorageLike): void {
  try { removePreference(viewStorageScope(scope), VIEW_STORAGE_NAME, session); } catch { /* Nonfatal. */ }
}
