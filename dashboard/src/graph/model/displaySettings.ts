import { GRAPH_RENDER_HIERARCHY_BUDGET } from "../render/lod";
import { readPreference, writePreference } from "./scopedStorage";
import type { ProfilePreferenceScope, StorageLike } from "./scopedStorage";

export interface DisplaySettings {
  edgeBrightness: number;
  nodeGlow: number;
  bloom: number;
  territoryOpacity: number;
  communityShellLimit: number;
  cameraCenterIndicator: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  edgeBrightness: 1,
  nodeGlow: 1,
  bloom: 1,
  territoryOpacity: 0.3,
  communityShellLimit: GRAPH_RENDER_HIERARCHY_BUDGET,
  cameraCenterIndicator: false,
};

export const DISPLAY_LIMITS = {
  edgeBrightness: { min: 0.1, max: 3 },
  nodeGlow: { min: 0, max: 2 },
  bloom: { min: 0, max: 2 },
  territoryOpacity: { min: 0, max: 1 },
  communityShellLimit: { min: 0, max: GRAPH_RENDER_HIERARCHY_BUDGET },
} as const;

type NumericDisplaySetting = Exclude<keyof DisplaySettings, "cameraCenterIndicator">;
const DISPLAY_STORAGE_NAME = "display";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function clampSetting(key: NumericDisplaySetting, value: unknown): number {
  const { min, max } = DISPLAY_LIMITS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DISPLAY_SETTINGS[key];
  return Math.min(max, Math.max(min, value));
}

export function clampDisplaySettings(raw: unknown): DisplaySettings {
  const value = record(raw);
  return {
    edgeBrightness: clampSetting("edgeBrightness", value.edgeBrightness),
    nodeGlow: clampSetting("nodeGlow", value.nodeGlow),
    bloom: clampSetting("bloom", value.bloom),
    territoryOpacity: clampSetting("territoryOpacity", value.territoryOpacity),
    communityShellLimit: Math.round(clampSetting("communityShellLimit", value.communityShellLimit)),
    cameraCenterIndicator: value.cameraCenterIndicator === true,
  };
}

export function loadDisplaySettings(scope: ProfilePreferenceScope, session?: StorageLike): DisplaySettings {
  try {
    const raw = readPreference(scope, DISPLAY_STORAGE_NAME, session);
    return raw === null ? { ...DEFAULT_DISPLAY_SETTINGS } : clampDisplaySettings(JSON.parse(raw));
  } catch { return { ...DEFAULT_DISPLAY_SETTINGS }; }
}

export function saveDisplaySettings(settings: unknown, scope: ProfilePreferenceScope, session?: StorageLike): void {
  try { writePreference(scope, DISPLAY_STORAGE_NAME, JSON.stringify(clampDisplaySettings(settings)), session); }
  catch { /* Nonfatal. */ }
}
