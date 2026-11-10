import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GraphRenderClient } from "./client";
import type { GraphRenderNodeChunk } from "./types";

interface Props {
  client: GraphRenderClient;
  chunks: readonly GraphRenderNodeChunk[];
  pointsByChunk: Map<number, THREE.Points>;
  onHover: (renderId: number | null) => void;
  onPick: (renderId: number) => void;
}

export function BoundedPicker({
  client,
  chunks,
  pointsByChunk,
  onHover,
  onPick,
}: Props) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => {
    const value = new THREE.Raycaster();
    value.params.Points = { threshold: 3 };
    return value;
  }, []);
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
        .filter((value): value is THREE.Points => Boolean(value));
      if (objects.length === 0) return null;

      const hit = raycaster.intersectObjects(objects, false)[0];
      const itemIndex = hit?.index;
      const chunkId = hit?.object.userData.graphRenderChunkId;
      if (
        itemIndex === undefined
        || typeof chunkId !== "number"
      ) return null;

      const chunk = chunkById.get(chunkId);
      if (!chunk || itemIndex >= chunk.renderIds.length) return null;
      return chunk.renderIds[itemIndex];
    };

    const publishHover = (event: PointerEvent) => {
      const renderId = pickAt(event);
      if (renderId === hovered.current) return;
      hovered.current = renderId;
      onHover(renderId);
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
      const renderId = pickAt(event);
      if (renderId !== null) onPick(renderId);
    };

    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      if (hovered.current !== null) onHover(null);
    };
  }, [camera, chunkById, client, gl, onHover, onPick, pointer, pointsByChunk, raycaster]);

  return null;
}
