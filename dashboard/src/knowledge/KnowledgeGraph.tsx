import { useCallback, useEffect, useRef, useState } from "react";
import { GraphRenderClient, GraphRenderScene } from "../graph/render";
import type { GraphRenderFilterScope, GraphRenderNodeResolution, GraphRenderTransport } from "../graph/render";
import type { HostControls } from "../host";
import type { StorageLike } from "../graph/model/scopedStorage";
import { useGraphPreferences } from "../graph/useGraphPreferences";
import { DisplaySettingsMenu } from "../graph/controls/DisplaySettingsMenu";
import { AnimationControlsMenu } from "../graph/controls/AnimationControlsMenu";

interface Props {
  ownerId: string;
  controls: HostControls;
  preferenceProfileKey: string | null;
  preferenceSession?: StorageLike;
  transport: GraphRenderTransport;
  filters: GraphRenderFilterScope;
  selectedMemoryId: string | null;
  onSelectMemoryId: (memoryId: string | null) => void;
}

export function KnowledgeGraph({ ownerId, transport, filters, selectedMemoryId, onSelectMemoryId, controls, preferenceProfileKey, preferenceSession }: Props) {
  const preferences = useGraphPreferences(preferenceProfileKey, ownerId, preferenceSession);
  const [client, setClient] = useState<GraphRenderClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderReady, setRenderReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const clientRef = useRef<GraphRenderClient | null>(client);
  clientRef.current = client;
  const pendingPrepare = useRef<Promise<GraphRenderClient> | null>(null);
  const markReady = useCallback(() => setRenderReady(true), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPreparing(true);
    if (!clientRef.current) setRenderReady(false);
    const timer = setTimeout(() => {
      void (async () => {
        let request: Promise<GraphRenderClient> | null = null;
        try {
          while (pendingPrepare.current) await pendingPrepare.current.catch(() => undefined);
          if (cancelled) return;
          request = GraphRenderClient.prepare(ownerId, transport, filters);
          pendingPrepare.current = request;
          const next = await request;
          if (cancelled) return;
          if (next.manifest.ownerId !== ownerId) {
            setError("Graph renderer returned a different owner. Refresh owner data and try again.");
            return;
          }
          const current = clientRef.current;
          if (current?.manifest.generationId === next.manifest.generationId) {
            setClient(current);
          } else {
            clientRef.current = next;
            setClient(next);
            setRenderReady(false);
          }
        } catch (reason) {
          if (!cancelled) setError(String(reason));
        } finally {
          if (request && pendingPrepare.current === request) pendingPrepare.current = null;
          if (!cancelled) setPreparing(false);
        }
      })();
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ownerId, transport, filters]);

  const handleSelect = useCallback((selection: GraphRenderNodeResolution) => {
    onSelectMemoryId(selection.memoryId);
  }, [onSelectMemoryId]);
  const handleSelectionUnavailable = useCallback((memoryId: string) => {
    if (selectedMemoryId === memoryId) onSelectMemoryId(null);
  }, [onSelectMemoryId, selectedMemoryId]);

  if (error) return <div className="knowledge-state error" role="alert">{error}</div>;
  if (!client) return <div className="knowledge-state" role="status">Preparing graph…</div>;
  if (client.manifest.totalNodeCount === 0) {
    return <div className="knowledge-state" role="status" data-graph-node-count={0} data-graph-ready="true">
      Graph ready · 0 nodes. Create or import memories, then refresh.
    </div>;
  }

  return (
    <div className="knowledge-graph-wrap" data-graph-node-count={client.manifest.totalNodeCount}>
      <div className="knowledge-graph-status" role="status" aria-live="polite"
        data-graph-ready={renderReady ? "true" : "false"}>
        {preparing ? `Updating graph · ${client.manifest.totalNodeCount} nodes`
          : renderReady ? `Graph canvas ready · ${client.manifest.totalNodeCount} nodes` : `Preparing canvas · ${client.manifest.totalNodeCount} nodes`}
      </div>
      <GraphRenderScene client={client} selectedMemoryId={selectedMemoryId} onSelect={handleSelect}
        onSelectionUnavailable={handleSelectionUnavailable} onFrameReady={markReady}
        presentation={{ display: preferences.display, animation: preferences.animation, rerollToken: preferences.rerollToken,
          selectedCommunityId: filters.communityId ?? null,
          camera: { defaultView: preferences.defaultView, captureRequest: preferences.captureRequest,
            resetRequest: preferences.resetRequest, onCaptured: preferences.captureView, onReady: preferences.setCameraReady } }} />
      <div className="graph-display-controls">
        <DisplaySettingsMenu settings={preferences.display} onChange={preferences.updateDisplay} Button={controls.Button} />
      </div>
      <div className="graph-animation-controls">
        <AnimationControlsMenu settings={preferences.animation} onChange={preferences.updateAnimation}
          onReroll={preferences.reroll} hasCustomDefaultView={preferences.defaultView !== null}
          canSetCurrentView={preferences.cameraReady} onSetCurrentViewAsDefault={preferences.requestCapture}
          onRestoreFactoryView={preferences.restoreFactoryView} Button={controls.Button} />
        {!preferenceProfileKey && <small className="graph-preferences-session-note">Saved for this graph session</small>}
      </div>
      <div className="knowledge-graph-help">Drag to rotate · wheel to zoom · right-drag to pan</div>
    </div>
  );
}
