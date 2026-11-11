import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import type { TrackballControls as TrackballControlsImpl } from "three-stdlib";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { BoundedPicker } from "./BoundedPicker";
import { boundsCenter, CameraViewport } from "./CameraViewport";
import { findFrameLabel } from "./labels";
import { RenderEdgeChunk } from "./RenderEdgeChunk";
import { RenderNodeChunk } from "./RenderNodeChunk";
import { RenderLabels } from "./RenderLabels";
import { RenderSelectionEdges } from "./RenderSelectionEdges";
import { RenderTerritories } from "./RenderTerritories";
import { useGraphRenderInteraction, type GraphRenderSceneProps as InteractionProps } from "./useGraphRenderInteraction";
import { GraphCameraBridge } from "./GraphCameraBridge";
import { GraphAnimationController } from "./GraphAnimationController";
import { CameraCenterPseudoNode } from "./CameraCenterPseudoNode";
import type { GraphPresentation } from "./presentation";
import type { GraphRenderManifest, GraphRenderNodeInspection, GraphRenderVec3 } from "./types";
import "./graph-render-scene.css";

const EMPTY_CHUNKS = [] as const;

export type GraphRenderSceneProps = InteractionProps & { presentation: GraphPresentation };

type SceneProps = ReturnType<typeof useGraphRenderInteraction> & {
  client: GraphRenderSceneProps["client"];
  center: GraphRenderVec3;
  extent: number;
  resetVersion: number;
  presentation: GraphPresentation;
  tooltipRef: RefObject<HTMLDivElement | null>;
};

// Warlock GraphScene.tsx at d9e38cb. Only node metadata and its size come from
// bounded authenticated inspection and picking instead of the original GraphNode.
function Tooltip({ node, tooltipRef }: {
  node: GraphRenderNodeInspection;
  tooltipRef: RefObject<HTMLDivElement | null>;
}) {
  const compact = node.memoryId.replace(/[^a-zA-Z0-9]/g, "");
  const subtitle = compact.length > 12 ? `…${compact.slice(-8)}` : node.memoryId;
  return (
    <div ref={tooltipRef} className="graph-tooltip graph-render-tooltip" role="status" aria-live="polite">
      <strong>{node.title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

// Hermes exposes its React instance but does not expose a DOM renderer. Use
// the original Html anchor and screen projection with a host-rendered tooltip.
function TooltipAnchor({ node, tooltipRef }: {
  node: GraphRenderNodeInspection & { size: number };
  tooltipRef: RefObject<HTMLDivElement | null>;
}) {
  const projected = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const [x, y, z] = node.position;
    projected.set(x, y + node.size * 1.2, z).project(camera);
    tooltip.style.visibility = projected.z >= -1 && projected.z <= 1 ? "visible" : "hidden";
    const left = (projected.x + 1) * size.width / 2;
    const top = (1 - projected.y) * size.height / 2;
    tooltip.style.transform = `translate(${left}px, ${top}px) translate(-50%, -50%)`;
  });
  return null;
}

function Scene({
  client, frame, center, extent, selectedRenderId, hoveredRenderId, hoverNode, selectedTitle,
  neighborhood, focusRequest, resetVersion, pick, publishHover, loadViewport, tooltipRef, presentation,
}: SceneProps) {
  const controlsRef = useRef<TrackballControlsImpl | null>(null);
  const animationActivity = useRef(false);
  const pointsByChunk = useRef(new Map<number, THREE.Points | THREE.InstancedMesh>());
  const { camera } = useThree();
  const registerChunk = useCallback((chunkId: number, pickable: THREE.Points | THREE.InstancedMesh | null) => {
    if (pickable) pointsByChunk.current.set(chunkId, pickable);
    else pointsByChunk.current.delete(chunkId);
  }, []);
  const lodById = useMemo(
    () => new Map(client.manifest.edgeChunks.map(({ chunkId, lod }) => [chunkId, lod])),
    [client],
  );
  const isolatedTerritory = useMemo(
    () => client.manifest.hierarchy.filter(({ kind }) => kind === "territory").length === 1,
    [client],
  );
  const nodeChunks = frame?.nodeChunks ?? EMPTY_CHUNKS;
  const selectedLabel = useMemo(
    () => selectedRenderId === null || selectedTitle === null
      ? undefined
      : findFrameLabel(nodeChunks, selectedRenderId, selectedTitle),
    [nodeChunks, selectedRenderId, selectedTitle],
  );
  const visibleSegmentCount = frame?.edgeChunks.reduce((count, chunk) => count + chunk.segmentCount, 0) ?? 0;

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[500, 500, 500]} intensity={0.6} />
      <pointLight position={[-300, -200, -300]} intensity={0.4} color="#6040ff" />
      {frame && <RenderTerritories hierarchy={frame.hierarchy} isolated={isolatedTerritory}
        territoryOpacity={presentation.display.territoryOpacity} communityShellLimit={presentation.display.communityShellLimit}
        selectedCommunityId={presentation.selectedCommunityId} />}
      {frame?.edgeChunks.map((chunk) => (
        <RenderEdgeChunk key={chunk.chunkId} chunk={chunk}
          lod={lodById.get(chunk.chunkId) ?? frame.lod} visibleSegmentCount={visibleSegmentCount}
          muted={selectedRenderId !== null} edgeBrightness={presentation.display.edgeBrightness} />
      ))}
      <RenderSelectionEdges neighborhood={neighborhood} />
      {nodeChunks.map((chunk) => (
        <RenderNodeChunk key={chunk.chunkId} chunk={chunk}
          totalNodeCount={client.manifest.totalNodeCount} nodeGlow={presentation.display.nodeGlow}
          selectedRenderId={selectedRenderId} hoveredRenderId={hoveredRenderId}
          register={registerChunk} />
      ))}
      {frame && <RenderLabels labels={frame.labels} selectedRenderId={selectedRenderId} selectedLabel={selectedLabel} />}
      {hoverNode && <TooltipAnchor node={hoverNode} tooltipRef={tooltipRef} />}
      <BoundedPicker client={client} chunks={nodeChunks} pointsByChunk={pointsByChunk.current}
        selectedRenderId={selectedRenderId} onHover={publishHover} onPick={pick} />
      <EffectComposer multisampling={0} enabled={presentation.display.bloom > 0}>
        <Bloom luminanceThreshold={0.3} luminanceSmoothing={0.7} intensity={1.45 * presentation.display.bloom} mipmapBlur radius={0.6} />
      </EffectComposer>
      <TrackballControls
        ref={controlsRef}
        rotateSpeed={2.4}
        zoomSpeed={1.8}
        panSpeed={1.05}
        staticMoving
        minDistance={10}
        maxDistance={Math.max(50000, extent * 20)}
      />
      <GraphCameraBridge controlsRef={controlsRef} center={center} extent={extent} focusRequest={focusRequest}
        resetVersion={resetVersion} preferences={presentation.camera} />
      <GraphAnimationController controlsRef={controlsRef} settings={presentation.animation}
        rerollToken={presentation.rerollToken} activityRef={animationActivity} />
      {presentation.display.cameraCenterIndicator && <CameraCenterPseudoNode controlsRef={controlsRef} />}
      <CameraViewport controlsRef={controlsRef} fallbackCenter={center} onViewport={loadViewport} />
    </>
  );
}

function framingExtent(manifest: GraphRenderManifest) {
  // Rust's compact layouts need a tighter frame than Warlock's 180-unit floor.
  // Territory shells may be synthetic and must not inflate the node-world frame.
  const halfWidths = manifest.globalBounds.max.map((max, axis) =>
    (max - manifest.globalBounds.min[axis]) * 0.5,
  );
  return Math.max(8, Math.hypot(...halfWidths));
}

function GraphScene(props: GraphRenderSceneProps) {
  const { client } = props;
  const interaction = useGraphRenderInteraction(props);
  const frame = interaction.frame;
  const loadedNodeCount = frame?.nodeChunks.reduce((total, chunk) => total + chunk.nodeCount, 0) ?? 0;
  const [resetVersion, setResetVersion] = useState(0);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const center = useMemo(() => boundsCenter(client.manifest.globalBounds), [client]);
  const extent = useMemo(() => framingExtent(client.manifest), [client]);
  const camera = useMemo(() => ({
    position: [center[0], center[1], center[2] + extent * 2.4] as [number, number, number],
    fov: 50,
    near: 0.1,
    far: Math.max(100000, extent * 100),
  }), [center, extent]);
  const { neighborhood, error } = interaction;
  const highlightedRelationshipCount = neighborhood?.edges.length ?? 0;
  const omittedRelationships = neighborhood ? neighborhood.totalCount - highlightedRelationshipCount : 0;
  const relationKinds = neighborhood
    ? Array.from(new Set(neighborhood.edges.map((edge) => edge.style.relationKind))).filter(Boolean)
    : [];

  return (
    <div className="graph-render-scene" style={{ position: "relative", width: "100%", height: "100%", minHeight: 360 }}>
      <Canvas
        camera={camera}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.domElement.tabIndex = 0;
          gl.domElement.setAttribute("aria-label", `Interactive memory graph with ${client.manifest.totalNodeCount} memories. Hover a node and press Enter to select it.`);
          gl.domElement.setAttribute("role", "application");
        }}
      >
        <Scene {...interaction} client={client} center={center} extent={extent}
          resetVersion={resetVersion} tooltipRef={tooltipRef} presentation={props.presentation} />
      </Canvas>
      {interaction.hoverNode && <Tooltip node={interaction.hoverNode} tooltipRef={tooltipRef} />}
      <button className="graph-render-reset" type="button" onClick={() => setResetVersion((value) => value + 1)}>
        Reset view
      </button>
      {neighborhood && (
        <div className="graph-render-relationships" role="status" aria-live="polite">
          {highlightedRelationshipCount.toLocaleString()} {highlightedRelationshipCount === 1 ? "relationship" : "relationships"} highlighted
          {relationKinds.length > 0 && <span>Types: {relationKinds.slice(0, 4).join(", ")}{relationKinds.length > 4 ? ` +${relationKinds.length - 4}` : ""}</span>}
          {omittedRelationships > 0 && <span>{omittedRelationships.toLocaleString()} more relationships</span>}
        </div>
      )}
      {error && <div className="knowledge-graph-status error" role="alert">{error}</div>}
      <div className="graph-render-telemetry" role="status" aria-live="polite">
        {loadedNodeCount.toLocaleString()} / {client.manifest.totalNodeCount.toLocaleString()} Memories drawn
        <span>{frame?.nodeChunks.length ?? 0} / {client.manifest.nodeChunks.length} node chunks loaded</span>
        {!client.nodeOverviewFits && <span>Overview downsampling active · max 32 chunks / 16 MiB</span>}
        {frame && <span>Edges: {frame.lod}</span>}
      </div>
    </div>
  );
}

export function GraphRenderScene(props: GraphRenderSceneProps) {
  const { ownerId, generationId } = props.client.manifest;
  return <GraphScene key={`${ownerId}:${generationId}`} {...props} />;
}
