import { readPreference, writePreference } from "./scopedStorage";
import type { ProfilePreferenceScope, StorageLike } from "./scopedStorage";

export interface AxisAnimationSettings {
  speed: number;
  randomRange: number;
  randomCounterspin: boolean;
}
export interface GraphAnimationSettings {
  enabled: boolean;
  startDelay: number;
  x: AxisAnimationSettings;
  y: AxisAnimationSettings;
  z: AxisAnimationSettings;
}
export interface ResolvedAnimationSpeeds { x: number; y: number; z: number; }

export const ANIMATION_LIMITS = {
  speed: { min: -5, max: 5 },
  randomRange: { min: 0, max: 5 },
  startDelay: { min: 0, max: 300 },
} as const;
export const DEFAULT_ANIMATION_SETTINGS: GraphAnimationSettings = {
  enabled: true,
  startDelay: 60,
  x: { speed: 0, randomRange: 0, randomCounterspin: false },
  y: { speed: 0.4, randomRange: 0, randomCounterspin: false },
  z: { speed: 0, randomRange: 0, randomCounterspin: false },
};
const ANIMATION_STORAGE_NAME = "animation";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function clampAxis(raw: unknown, fallback: AxisAnimationSettings): AxisAnimationSettings {
  const value = record(raw);
  return {
    speed: clamp(value.speed, ANIMATION_LIMITS.speed.min, ANIMATION_LIMITS.speed.max, fallback.speed),
    randomRange: clamp(value.randomRange, ANIMATION_LIMITS.randomRange.min, ANIMATION_LIMITS.randomRange.max, fallback.randomRange),
    randomCounterspin: typeof value.randomCounterspin === "boolean" ? value.randomCounterspin : fallback.randomCounterspin,
  };
}
export function clampAnimationSettings(raw: unknown): GraphAnimationSettings {
  const value = record(raw);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_ANIMATION_SETTINGS.enabled,
    startDelay: clamp(value.startDelay, ANIMATION_LIMITS.startDelay.min, ANIMATION_LIMITS.startDelay.max, DEFAULT_ANIMATION_SETTINGS.startDelay),
    x: clampAxis(value.x, DEFAULT_ANIMATION_SETTINGS.x),
    y: clampAxis(value.y, DEFAULT_ANIMATION_SETTINGS.y),
    z: clampAxis(value.z, DEFAULT_ANIMATION_SETTINGS.z),
  };
}
export function loadAnimationSettings(scope: ProfilePreferenceScope, session?: StorageLike): GraphAnimationSettings {
  try {
    const raw = readPreference(scope, ANIMATION_STORAGE_NAME, session);
    return raw === null ? structuredClone(DEFAULT_ANIMATION_SETTINGS) : clampAnimationSettings(JSON.parse(raw));
  } catch { return structuredClone(DEFAULT_ANIMATION_SETTINGS); }
}
export function saveAnimationSettings(settings: unknown, scope: ProfilePreferenceScope, session?: StorageLike): void {
  try { writePreference(scope, ANIMATION_STORAGE_NAME, JSON.stringify(clampAnimationSettings(settings)), session); }
  catch { /* Nonfatal. */ }
}

function resolveAxis(axis: AxisAnimationSettings, random: () => number): number {
  const randomized = axis.speed + (random() * 2 - 1) * axis.randomRange;
  if (!axis.randomCounterspin) return randomized;
  return random() < 0.5 ? -randomized : randomized;
}
export function resolveAnimationSpeeds(settings: GraphAnimationSettings, random: () => number = Math.random): ResolvedAnimationSpeeds {
  return { x: resolveAxis(settings.x, random), y: resolveAxis(settings.y, random), z: resolveAxis(settings.z, random) };
}
export function rpmToRadiansPerSecond(rpm: number): number {
  return (rpm * Math.PI * 2) / 60;
}
