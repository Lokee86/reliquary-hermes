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
export function parseStoredGraphView(value: unknown): StoredGraphView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredGraphView>;
  if (!validTuple(candidate.position) || !validTuple(candidate.target) || !validTuple(candidate.up)) return null;
  const direction = candidate.target.map((n, i) => n - candidate.position![i]);
  const directionLength = Math.hypot(...direction);
  const upLength = Math.hypot(...candidate.up);
  if (directionLength < DEGENERATE_EPSILON || upLength < DEGENERATE_EPSILON) return null;
  const cross = [
    direction[1] * candidate.up[2] - direction[2] * candidate.up[1],
    direction[2] * candidate.up[0] - direction[0] * candidate.up[2],
    direction[0] * candidate.up[1] - direction[1] * candidate.up[0],
  ];
  if (Math.hypot(...cross) / (directionLength * upLength) < DEGENERATE_EPSILON) return null;
  return {
    position: [...candidate.position],
    target: [...candidate.target],
    up: candidate.up.map((n) => n / upLength) as Vector3Tuple,
  };
}

export interface GraphCameraBounds { min: Vector3Tuple; max: Vector3Tuple; }
/** Reject a view far outside today's graph bounds; padding allows normal camera distance. */
export function isStoredGraphViewWithinBounds(view: StoredGraphView, bounds: GraphCameraBounds, paddingFactor = 2): boolean {
  if (!Number.isFinite(paddingFactor) || paddingFactor < 0 || !validTuple(bounds?.min) || !validTuple(bounds?.max)) return false;
  if (bounds.min.some((value, i) => value > bounds.max[i])) return false;
  const extent = bounds.max.map((value, i) => value - bounds.min[i]);
  const padding = Math.max(...extent, 1) * paddingFactor;
  const inside = (point: Vector3Tuple) => point.every((value, i) => value >= bounds.min[i] - padding && value <= bounds.max[i] + padding);
  return inside(view.position) && inside(view.target);
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





