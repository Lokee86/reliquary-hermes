import { useCallback, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TrackballControls as TrackballControlsImpl } from "three-stdlib";
import { cameraCenterIndicatorScale, cameraCenterPulse, CAMERA_CENTER_NODE_BLOOM_SCALE } from "./cameraIndicator";
import { useHermesMarkerColors } from "./useHermesMarkerColors";

export function CameraCenterPseudoNode({
  controlsRef,
}: {
  controlsRef: React.RefObject<TrackballControlsImpl | null>;
}) {
  const markerRef = useRef<THREE.Group>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const pulseMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera, size } = useThree();
  const colors = useHermesMarkerColors();
  const ignoreRaycast = useCallback(() => null, []);
  const primary = colors?.primary ?? [1, 1, 1] as const;
  const ring = colors?.ring ?? [1, 1, 1] as const;
  const coreColor = useMemo(
    () => new THREE.Color().setRGB(...primary, THREE.SRGBColorSpace)
      .multiplyScalar(2.4 * CAMERA_CENTER_NODE_BLOOM_SCALE),
    [primary],
  );
  const shellColor = useMemo(
    () => new THREE.Color().setRGB(...ring, THREE.SRGBColorSpace)
      .multiplyScalar(1.8 * CAMERA_CENTER_NODE_BLOOM_SCALE),
    [ring],
  );

  useFrame((state) => {
    const marker = markerRef.current;
    const controls = controlsRef.current;
    if (!marker || !controls) return;

    marker.position.copy(controls.target);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
    marker.scale.setScalar(cameraCenterIndicatorScale(
      camera.position.distanceTo(controls.target),
      fov,
      size.height,
    ));

    const pulse = cameraCenterPulse(state.clock.elapsedTime);
    if (pulseRef.current) {
      pulseRef.current.scale.setScalar(pulse.scale);
      pulseRef.current.rotation.x = state.clock.elapsedTime * 0.28;
      pulseRef.current.rotation.y = state.clock.elapsedTime * 0.42;
    }
    if (pulseMaterialRef.current) pulseMaterialRef.current.opacity = pulse.opacity;
  });

  return (
    <group ref={markerRef} renderOrder={1000}>
      <mesh raycast={ignoreRaycast} renderOrder={1002}>
        <sphereGeometry args={[0.48, 24, 18]} />
        <meshBasicMaterial color={coreColor} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh raycast={ignoreRaycast} renderOrder={1001}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshBasicMaterial
          color={shellColor}
          transparent
          opacity={0.74 * CAMERA_CENTER_NODE_BLOOM_SCALE}
          wireframe
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={pulseRef} raycast={ignoreRaycast} renderOrder={1000}>
        <icosahedronGeometry args={[0.92, 2]} />
        <meshBasicMaterial
          ref={pulseMaterialRef}
          color={coreColor}
          transparent
          opacity={0.28 * CAMERA_CENTER_NODE_BLOOM_SCALE}
          wireframe
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
