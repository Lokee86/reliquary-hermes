export const CAMERA_CENTER_NODE_DIAMETER_PX = 30;
export const CAMERA_CENTER_NODE_REFERENCE_DISTANCE = 800;
export const CAMERA_CENTER_NODE_BLOOM_SCALE = 0.7;

export function cameraCenterIndicatorZoomScale(distance: number): number {
  return Math.sqrt(CAMERA_CENTER_NODE_REFERENCE_DISTANCE / Math.max(1, distance));
}

export function cameraCenterIndicatorScale(
  distance: number,
  verticalFovDegrees: number,
  viewportHeight: number,
): number {
  const safeDistance = Math.max(0.001, distance);
  const safeHeight = Math.max(1, viewportHeight);
  const halfFovRadians = (verticalFovDegrees * Math.PI) / 360;
  return safeDistance
    * Math.tan(halfFovRadians)
    * (CAMERA_CENTER_NODE_DIAMETER_PX / safeHeight)
    * cameraCenterIndicatorZoomScale(safeDistance);
}

export function cameraCenterPulse(elapsedSeconds: number): { scale: number; opacity: number } {
  const pulse = (Math.sin(elapsedSeconds * 2.6) + 1) * 0.5;
  return {
    scale: 1.05 + pulse * 0.18,
    opacity: (0.2 + pulse * 0.16) * CAMERA_CENTER_NODE_BLOOM_SCALE,
  };
}
