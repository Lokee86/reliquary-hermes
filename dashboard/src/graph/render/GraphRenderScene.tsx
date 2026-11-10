import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { Points } from "three";
import type { TrackballControls as TrackballControlsImpl } from "three-stdlib";
import {
  boundsCenter,
  boundsExtent,
  CameraViewport,
  viewportForBounds,
} from "./CameraViewport";
import { BoundedPicker } from "./BoundedPicker";
import type { GraphRenderClient } from "./client";
import { RenderEdgeChunk } from "./RenderEdgeChunk";
import { RenderLabels } from "./RenderLabels";
import { RenderNodeChunk } from "./RenderNodeChunk";
import { RenderTerritories } from "./RenderTerritories";
import type { GraphRenderFrame, GraphRenderNodeResolution, GraphRenderViewport } from "./types";

interface Props {
  client: GraphRenderClient;
  onSelect: (selection: GraphRenderNodeResolution, renderId: number, generationId: string) => void;
  onFrameReady?: () => void;
}

export function GraphRenderScene({ client, onSelect, onFrameReady }: Props) {
  const [frame, setFrame] = useState<GraphRenderFrame | null>(null);
  const [selectedRenderId, setSelectedRenderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const selectionVersion = useRef(0);

  useEffect(() => () => { selectionVersion.current += 1; }, [client]);
  const initialViewport = useMemo(
    () => viewportForBounds(client.manifest.globalBounds),
    [client],
  );

  const loadViewport = useCallback(async (viewport: GraphRenderViewport) => {
    const version = ++requestVersion.current;
    try {
      const next = await client.loadViewport(viewport);
      if (version === requestVersion.current) {
        setFrame(next);
        setError(null);
        onFrameReady?.();
      }
    } catch (reason) {
      if (version === requestVersion.current) setError(String(reason));
    }
  }, [client, onFrameReady]);

  useEffect(() => {
    setFrame(null);
    setSelectedRenderId(null);
    client.setSelectedRenderId(null);
    void loadViewport(initialViewport);
  }, [client, initialViewport, loadViewport]);

  const pick = useCallback(async (renderId: number) => {
    const version = ++selectionVersion.current;
    client.setSelectedRenderId(renderId);
    setSelectedRenderId(renderId);
    try {
      const resolved = await client.resolveNode(renderId);
      if (selectionVersion.current !== version) return;
      onSelect(resolved, renderId, client.manifest.generationId);
      setError(null);
    } catch (reason) {
      if (selectionVersion.current === version) setError(String(reason));
    }
  }, [client, onSelect]);

  // Keep the camera target stable across viewport/chunk frame updates.
  // A fresh array on every render retriggers Scene's centering effect and snaps panning back.
  const center = useMemo(() => boundsCenter(client.manifest.globalBounds), [client]);
  const extent = boundsExtent(client.manifest.globalBounds);

  return (
    <>
      <Canvas
        camera={{
          position: [center[0], center[1], center[2] + extent * 2.4],
          fov: 50,
          near: 0.1,
          far: Math.max(100000, extent * 100),
        }}
        style={{ background: "#06090f" }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#06090f"]} />
        <Scene
          center={center}
          markerScale={Math.min(1, extent / 40)}
          client={client}
          frame={frame}
          selectedRenderId={selectedRenderId}
          onPick={pick}
          onViewport={loadViewport}
        />
      </Canvas>
      {error && <div className="knowledge-graph-status error" role="alert">{error}</div>}
    </>
  );
}

function Scene({
  center,
  markerScale,
  client,
  frame,
  selectedRenderId,
  onPick,
  onViewport,
}: {
  center: readonly [number, number, number];
  markerScale: number;
  client: GraphRenderClient;
  frame: GraphRenderFrame | null;
  selectedRenderId: number | null;
  onPick: (renderId: number) => void;
  onViewport: (viewport: GraphRenderViewport) => void;
}) {
  const controlsRef = useRef<TrackballControlsImpl | null>(null);
  const pointsByChunk = useRef(new Map<number, Points>());
  const registerChunk = useCallback((chunkId: number, points: Points | null) => {
    if (points) pointsByChunk.current.set(chunkId, points);
    else pointsByChunk.current.delete(chunkId);
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...center);
    controls.update();
  }, [center]);

  return (
    <>
      {frame && <RenderTerritories hierarchy={frame.hierarchy} />}
      {frame?.edgeChunks.map((chunk) => (
        <RenderEdgeChunk key={chunk.chunkId} chunk={chunk} />
      ))}
      {frame?.nodeChunks.map((chunk) => (
        <RenderNodeChunk
          key={chunk.chunkId}
          chunk={chunk}
          markerScale={markerScale}
          selectedRenderId={selectedRenderId}
          register={registerChunk}
        />
      ))}
      {frame && <RenderLabels labels={frame.labels} markerScale={markerScale} />}
      <BoundedPicker
        client={client}
        chunks={frame?.nodeChunks ?? []}
        markerScale={markerScale}
        pointsByChunk={pointsByChunk.current}
        onHover={(renderId) => client.setHoveredRenderId(renderId)}
        onPick={onPick}
      />
      <EffectComposer multisampling={0}>
        <Bloom luminanceThreshold={0.3} luminanceSmoothing={0.7} intensity={1.35} mipmapBlur radius={0.6} />
      </EffectComposer>
      <TrackballControls
        ref={controlsRef}
        rotateSpeed={2.4}
        zoomSpeed={1.8}
        panSpeed={1.05}
        staticMoving
        minDistance={2}
        maxDistance={Math.max(50000, boundsExtent(client.manifest.globalBounds) * 20)}
      />
      <CameraViewport controlsRef={controlsRef} fallbackCenter={center} onViewport={onViewport} />
    </>
  );
}
