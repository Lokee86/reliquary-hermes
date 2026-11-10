import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { Points } from "three";
import * as THREE from "three";
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
import { RenderSelectionEdges } from "./RenderSelectionEdges";
import { RenderTerritories } from "./RenderTerritories";
import type {
  GraphRenderFrame,
  GraphRenderNeighborhood,
  GraphRenderNodeInspection,
  GraphRenderNodeResolution,
  GraphRenderVec3,
  GraphRenderViewport,
} from "./types";
import "./graph-render-scene.css";

interface Props {
  client: GraphRenderClient;
  selectedMemoryId: string | null;
  onSelect: (selection: GraphRenderNodeResolution, renderId: number, generationId: string) => void;
  onSelectionUnavailable?: (memoryId: string) => void;
  onFrameReady?: () => void;
}

export function GraphRenderScene({ client: clientValue, selectedMemoryId, onSelect, onSelectionUnavailable, onFrameReady }: Props) {
  const client = clientValue;
  const [frame, setFrame] = useState<GraphRenderFrame | null>(null);
  const [selectedRenderId, setSelectedRenderId] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ position: GraphRenderVec3; sequence: number } | null>(null);
  const [hoverRenderId, setHoverRenderId] = useState<number | null>(null);
  const [hoverDetail, setHoverDetail] = useState<GraphRenderNodeInspection | null>(null);
  const [neighborhood, setNeighborhood] = useState<{
    generationId: string;
    renderId: number;
    value: GraphRenderNeighborhood;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const requestVersion = useRef(0);
  const selectionVersion = useRef(0);
  const focusSequence = useRef(0);
  const previousControlledSelection = useRef<{ client: GraphRenderClient; id: string | null } | null>(null);
  const hoverPointer = useRef<{ x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

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
    setNeighborhood(null);
    setHoverRenderId(null);
    setHoverDetail(null);
    hoverPointer.current = null;
    client.setHoveredRenderId(null);
    client.setSelectedRenderId(null);
    void loadViewport(initialViewport);
  }, [client, initialViewport, loadViewport]);

  const pick = useCallback(async (renderId: number, position: GraphRenderVec3) => {
    const version = ++selectionVersion.current;
    const changed = renderId !== client.selectedRenderId;
    client.setSelectedRenderId(renderId);
    setSelectedRenderId(renderId);
    if (changed) setFocusRequest({ position, sequence: ++focusSequence.current });
    try {
      const resolved = await client.resolveNode(renderId);
      if (selectionVersion.current !== version) return;
      onSelect(resolved, renderId, client.manifest.generationId);
      setError(null);
    } catch (reason) {
      if (selectionVersion.current === version) setError(String(reason));
    }
  }, [client, onSelect]);

  useEffect(() => {
    if (previousControlledSelection.current?.client === client
      && previousControlledSelection.current.id === selectedMemoryId) return;
    previousControlledSelection.current = { client, id: selectedMemoryId };
    const version = ++selectionVersion.current;
    const controller = new AbortController();
    if (!selectedMemoryId) {
      client.setSelectedRenderId(null);
      setSelectedRenderId(null);
      setNeighborhood(null);
      return () => controller.abort();
    }
    void client.locateMemory(selectedMemoryId, controller.signal).then((located) => {
      if (controller.signal.aborted || selectionVersion.current !== version) return;
      if (!located) {
        onSelectionUnavailable?.(selectedMemoryId);
        return;
      }
      const changed = located.renderId !== client.selectedRenderId;
      client.setSelectedRenderId(located.renderId);
      setSelectedRenderId(located.renderId);
      setError(null);
      if (changed) {
        setFocusRequest({ position: located.position, sequence: ++focusSequence.current });
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && selectionVersion.current === version) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });
    return () => controller.abort();
  }, [client, onSelectionUnavailable, selectedMemoryId]);

  const publishHover = useCallback((renderId: number | null, pointer?: { x: number; y: number }) => {
    if (renderId === null) {
      client.setHoveredRenderId(null);
      setHoverRenderId(null);
      setHoverDetail(null);
    } else if (pointer) {
      if (client.hoveredRenderId !== renderId) setHoverDetail(null);
      client.setHoveredRenderId(renderId);
      hoverPointer.current = pointer;
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${Math.max(8, Math.min(pointer.x + 14, window.innerWidth - 268))}px`;
        tooltipRef.current.style.top = `${Math.max(8, Math.min(pointer.y + 14, window.innerHeight - 96))}px`;
      }
      setHoverRenderId((current) => current === renderId ? current : renderId);
    }
  }, [client]);

  useEffect(() => {
    if (hoverRenderId === null) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void client.inspectNode(hoverRenderId, controller.signal).then((detail) => {
        if (!controller.signal.aborted && client.hoveredRenderId === hoverRenderId) setHoverDetail(detail);
      }).catch(() => {
        if (!controller.signal.aborted) setHoverDetail(null);
      });
    }, 110);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      setHoverDetail(null);
    };
  }, [client, hoverRenderId]);

  useEffect(() => {
    if (selectedRenderId === null) return;
    const controller = new AbortController();
    void client.neighborhood(selectedRenderId, controller.signal).then((result) => {
      if (!controller.signal.aborted && client.selectedRenderId === selectedRenderId) {
        setNeighborhood({ generationId: client.manifest.generationId, renderId: selectedRenderId, value: result });
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [client, selectedRenderId]);

  const center = useMemo(() => boundsCenter(client.manifest.globalBounds), [client]);
  const graphExtent = boundsExtent(client.manifest.globalBounds);
  const extent = useMemo(
    () => framingExtent(client, center, graphExtent),
    [client, center, graphExtent],
  );
  const activeNeighborhood = neighborhood?.generationId === client.manifest.generationId
    && neighborhood.renderId === selectedRenderId
    ? neighborhood.value
    : null;
  const highlightedRelationshipCount = activeNeighborhood?.edges.length ?? 0;
  const omittedRelationships = activeNeighborhood
    ? Math.max(0, activeNeighborhood.totalCount - activeNeighborhood.edges.length)
    : 0;
  const relationKinds = activeNeighborhood
    ? Array.from(new Set(activeNeighborhood.edges.map((edge) => edge.style.relationKind))).filter(Boolean)
    : [];

  return (
    <div className="graph-render-scene" style={{ position: "relative", width: "100%", height: "100%", minHeight: 360 }}>
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
        onCreated={({ gl }) => {
          gl.domElement.tabIndex = 0;
          gl.domElement.setAttribute("aria-label", `Interactive memory graph with ${client.manifest.totalNodeCount} memories. Hover a node and press Enter to select it.`);
          gl.domElement.setAttribute("role", "application");
        }}
      >
        <color attach="background" args={["#06090f"]} />
        <Scene
          center={center}
          extent={extent}
          markerScale={Math.min(1, graphExtent / 40)}
          client={client}
          frame={frame}
          useSpheres={client.manifest.totalNodeCount <= 256}
          selectedRenderId={selectedRenderId}
          hoveredRenderId={hoverRenderId}
          neighborhood={activeNeighborhood}
          focusRequest={focusRequest}
          resetVersion={resetVersion}
          onPick={pick}
          onHover={publishHover}
          onViewport={loadViewport}
        />
      </Canvas>
      <button className="graph-render-reset" type="button" onClick={() => setResetVersion((value) => value + 1)}>
        Reset view
      </button>
      {hoverRenderId !== null && hoverDetail && hoverRenderId === client.hoveredRenderId && (
        <div ref={tooltipRef} className="graph-render-tooltip" role="status" aria-live="polite" style={{
          position: "fixed",
          left: Math.max(8, Math.min((hoverPointer.current?.x ?? 0) + 14, window.innerWidth - 268)),
          top: Math.max(8, Math.min((hoverPointer.current?.y ?? 0) + 14, window.innerHeight - 96)),
          zIndex: 100,
          pointerEvents: "none",
        }}>
          <strong>{hoverDetail.title || "Untitled memory"}</strong>
          <span>{shortIdentifier(hoverDetail.memoryId)}</span>
        </div>
      )}
      {selectedRenderId !== null && activeNeighborhood && (
        <div className="graph-render-relationships" role="status" aria-live="polite">
          {highlightedRelationshipCount.toLocaleString()} {highlightedRelationshipCount === 1 ? "relationship" : "relationships"} highlighted
          {relationKinds.length > 0 && <span>Types: {relationKinds.slice(0, 4).join(", ")}{relationKinds.length > 4 ? ` +${relationKinds.length - 4}` : ""}</span>}
          {omittedRelationships > 0 && <span>{omittedRelationships.toLocaleString()} more relationships</span>}
          {activeNeighborhood.truncated && omittedRelationships === 0 && <span>Additional relationships are not available in this selection window.</span>}
        </div>
      )}
      {error && <div className="knowledge-graph-status error" role="alert">{error}</div>}
    </div>
  );
}

function Scene({
  center,
  extent,
  markerScale,
  client,
  frame,
  useSpheres,
  selectedRenderId,
  hoveredRenderId,
  neighborhood,
  focusRequest,
  resetVersion,
  onPick,
  onHover,
  onViewport,
}: {
  center: GraphRenderVec3;
  extent: number;
  markerScale: number;
  client: GraphRenderClient;
  frame: GraphRenderFrame | null;
  useSpheres: boolean;
  selectedRenderId: number | null;
  hoveredRenderId: number | null;
  neighborhood: GraphRenderNeighborhood | null;
  focusRequest: { position: GraphRenderVec3; sequence: number } | null;
  resetVersion: number;
  onPick: (renderId: number, position: GraphRenderVec3) => void;
  onHover: (renderId: number | null, pointer?: { x: number; y: number }) => void;
  onViewport: (viewport: GraphRenderViewport) => void;
}) {
  const controlsRef = useRef<TrackballControlsImpl | null>(null);
  const pointsByChunk = useRef(new Map<number, Points | THREE.InstancedMesh>());
  const { camera } = useThree();
  const registerChunk = useCallback((chunkId: number, pickable: Points | THREE.InstancedMesh | null) => {
    if (pickable) pointsByChunk.current.set(chunkId, pickable);
    else pointsByChunk.current.delete(chunkId);
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...center);
    controls.update();
  }, [center]);

  useEffect(() => {
    if (!focusRequest || !controlsRef.current) return;
    const controls = controlsRef.current;
    const nextTarget = new THREE.Vector3(...focusRequest.position);
    const delta = nextTarget.clone().sub(controls.target);
    controls.target.copy(nextTarget);
    camera.position.add(delta);
    controls.update();
  }, [camera, focusRequest]);

  useEffect(() => {
    if (resetVersion === 0) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const target = new THREE.Vector3(...center);
    controls.target.copy(target);
    camera.position.set(center[0], center[1], center[2] + extent * 2.4);
    controls.update();
  }, [camera, center, extent, resetVersion]);

  return (
    <>
      {frame && <RenderTerritories hierarchy={frame.hierarchy} />}
      {frame?.edgeChunks.map((chunk) => (
        <RenderEdgeChunk key={chunk.chunkId} chunk={chunk} muted={selectedRenderId !== null} />
      ))}
      <RenderSelectionEdges neighborhood={neighborhood} />
      {frame?.nodeChunks.map((chunk) => (
        <RenderNodeChunk
          key={chunk.chunkId}
          chunk={chunk}
          markerScale={markerScale}
          useSpheres={useSpheres}
          selectedRenderId={selectedRenderId}
          hoveredRenderId={hoveredRenderId}
          register={registerChunk}
        />
      ))}
      {frame && <RenderLabels labels={frame.labels} markerScale={markerScale} />}
      <BoundedPicker
        client={client}
        chunks={frame?.nodeChunks ?? []}
        markerScale={markerScale}
        pointsByChunk={pointsByChunk.current}
        selectedRenderId={selectedRenderId}
        onHover={onHover}
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

function shortIdentifier(memoryId: string) {
  const compact = memoryId.replace(/[^a-zA-Z0-9]/g, "");
  return compact.length > 12 ? `…${compact.slice(-8)}` : memoryId;
}

function framingExtent(client: GraphRenderClient, graphCenter: GraphRenderVec3, baseExtent: number) {
  let extent = baseExtent;
  for (const node of client.manifest.hierarchy) {
    const territory = node.territory;
    if (node.kind !== "territory" || !territory) continue;
    const radius = Math.max(0.1, territory.radius);
    const labelHeight = Math.max(1.5, Math.min(24, radius * 0.16));
    const labelHalfWidth = labelHeight * (460 / 112) * 0.5;
    const labelRadius = Math.hypot(
      labelHalfWidth,
      labelHeight * 0.5,
      radius * 0.82 + labelHeight,
      radius * 0.62,
    );
    const territoryRadius = Math.max(radius, labelRadius);
    const centerDistance = Math.hypot(
      territory.center[0] - graphCenter[0],
      territory.center[1] - graphCenter[1],
      territory.center[2] - graphCenter[2],
    );
    extent = Math.max(extent, centerDistance + territoryRadius);
  }
  return extent;
}
