import * as THREE from "three";

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

export interface AxisRotationRadians { x: number; y: number; z: number; }

/** Original Warlock v1 camera motion, around the live Trackball pivot. */
export function rotateCameraAroundPivotAxes(
  cameraPosition: THREE.Vector3,
  cameraUp: THREE.Vector3,
  pivot: THREE.Vector3,
  rotation: AxisRotationRadians,
): void {
  cameraPosition.sub(pivot);
  if (Number.isFinite(rotation.x) && rotation.x !== 0) {
    cameraPosition.applyAxisAngle(WORLD_X, rotation.x);
    cameraUp.applyAxisAngle(WORLD_X, rotation.x);
  }
  if (Number.isFinite(rotation.y) && rotation.y !== 0) {
    cameraPosition.applyAxisAngle(WORLD_Y, rotation.y);
    cameraUp.applyAxisAngle(WORLD_Y, rotation.y);
  }
  if (Number.isFinite(rotation.z) && rotation.z !== 0) {
    cameraPosition.applyAxisAngle(WORLD_Z, rotation.z);
    cameraUp.applyAxisAngle(WORLD_Z, rotation.z);
  }
  cameraPosition.add(pivot);
  cameraUp.normalize();
}
