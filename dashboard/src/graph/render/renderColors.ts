import type { Color } from "three";

export function setPackedColor(color: Color, packed: number): Color {
  return color.setHex(packed >>> 8);
}

// Warlock model/visuals.ts at d9e38cb.
export function nodeGlowBoost(r: number, g: number, b: number): number {
  const blue = Math.max(0, b - Math.max(r, g));
  const red = Math.max(0, r - Math.max(g, b));
  return 1.35 + blue * 2.4 + red * 0.9;
}

export function edgeIntensityScale(count: number): number {
  return count <= 2500 ? 1 : Math.max(0.05, Math.sqrt(2500 / count));
}
