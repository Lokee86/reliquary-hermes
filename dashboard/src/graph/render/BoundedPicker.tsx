import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GraphRenderClient } from "./client";
import type { GraphRenderNodeChunk } from "./types";

interface Props {
  client: GraphRenderClient;
  chunks: readonly GraphRenderNodeChunk[];
  markerScale: number;
  pointsByChunk: Map<number, THREE.Points | THREE.InstancedMesh>;
  onHover: (renderId: number | null, pointer?: { x: number; y: number }) => void;
  onPick: (renderId: number, position: readonly [number, number, number]) => void;
  selectedRenderId: number | null;
}

export function BoundedPicker({
  client,
  chunks,
  markerScale,
  pointsByChunk,
  onHover,
  onPick,
  selectedRenderId,
}: Props) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => {
    const value = new THREE.Raycaster();
    value.params.Points = { threshold: 3 * markerScale };
    return value;
  }, [markerScale]);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const chunkById = useMemo(
    () => new Map(chunks.map((chunk) => [chunk.chunkId, chunk])),
    [chunks],
  );
  const pointerDown = useRef<{ x: number; y: number; button: number } | null>(null);
  const hovered = useRef<number | null>(null);
  const pendingMove = useRef<PointerEvent | null>(null);
  const frameRequest = useRef<number | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;

    const pickAt = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const origin = raycaster.ray.origin;
      const direction = raycaster.ray.direction;
      const candidateIds = client.pickNodeChunkIds(
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
      );
      const objects = candidateIds
        .map((chunkId) => pointsByChunk.get(chunkId))
        .filter((value): value is THREE.Points | THREE.InstancedMesh => Boolean(value));
      if (objects.length === 0) return null;

      const hit = raycaster.intersectObjects(objects, false)[0];
      const itemIndex = hit?.object instanceof THREE.Points
        ? hit.index
        : (hit as THREE.Intersection<THREE.InstancedMesh> | undefined)?.instanceId;
      const chunkId = hit?.object.userData.graphRenderChunkId;
      if (
        itemIndex === undefined
        || typeof chunkId !== "number"
      ) return null;

      const chunk = chunkById.get(chunkId);
      if (!chunk || itemIndex >= chunk.renderIds.length) return null;
      const positionOffset = itemIndex * 3;
      return {
        renderId: chunk.renderIds[itemIndex],
        position: [
          chunk.positions[positionOffset],
          chunk.positions[positionOffset + 1],
          chunk.positions[positionOffset + 2],
        ] as const,
      };
    };

    const publishHover = (event: PointerEvent) => {
      const hit = pickAt(event);
      const renderId = hit?.renderId ?? null;
      if (renderId === hovered.current) {
        if (renderId !== null) onHover(renderId, { x: event.clientX, y: event.clientY });
        return;
      }
      hovered.current = renderId;
      onHover(renderId, renderId === null ? undefined : { x: event.clientX, y: event.clientY });
    };

    const move = (event: PointerEvent) => {
      pendingMove.current = event;
      if (frameRequest.current !== null) return;
      frameRequest.current = requestAnimationFrame(() => {
        frameRequest.current = null;
        const latest = pendingMove.current;
        pendingMove.current = null;
        if (latest) publishHover(latest);
      });
    };

    const leave = () => {
      pendingMove.current = null;
      if (hovered.current !== null) {
        hovered.current = null;
        onHover(null);
      }
    };

    const down = (event: PointerEvent) => {
      pointerDown.current = { x: event.clientX, y: event.clientY, button: event.button };
    };

    const up = (event: PointerEvent) => {
      const start = pointerDown.current;
      pointerDown.current = null;
      if (!start || start.button !== 0 || event.button !== 0) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) return;
      const hit = pickAt(event);
      if (hit) onPick(hit.renderId, hit.position);
    };

    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = hovered.current ?? selectedRenderId;
      if (target === null) return;
      const chunk = chunks.find((value) => value.renderIds.includes(target));
      if (!chunk) return;
      const itemIndex = chunk.renderIds.indexOf(target);
      const offset = itemIndex * 3;
      onPick(target, [chunk.positions[offset], chunk.positions[offset + 1], chunk.positions[offset + 2]]);
      event.preventDefault();
    };

    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("keydown", keydown);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("keydown", keydown);
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      if (hovered.current !== null) {
        hovered.current = null;
        onHover(null);
      }
    };
  }, [camera, chunkById, chunks, client, gl, onHover, onPick, pointer, pointsByChunk, raycaster, selectedRenderId]);

  return null;
}
