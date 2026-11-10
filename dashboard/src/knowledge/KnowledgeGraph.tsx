import { useCallback, useEffect, useState } from "react";
import { GraphRenderClient, GraphRenderScene } from "../graph/render";
import type { GraphRenderFilterScope, GraphRenderNodeResolution, GraphRenderTransport } from "../graph/render";

interface Props {
  ownerId: string;
  transport: GraphRenderTransport;
  filters: GraphRenderFilterScope;
  selectedMemoryId: string | null;
  onSelectMemoryId: (memoryId: string | null) => void;
}

export function KnowledgeGraph({ ownerId, transport, filters, selectedMemoryId, onSelectMemoryId }: Props) {
  const [client, setClient] = useState<GraphRenderClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderReady, setRenderReady] = useState(false);
  const markReady = useCallback(() => setRenderReady(true), []);

  useEffect(() => {
    let cancelled = false;
    setClient(null);
    setError(null);
    setRenderReady(false);
    GraphRenderClient.prepare(ownerId, transport, filters)
      .then((next) => {
        if (cancelled) return;
        if (next.manifest.ownerId !== ownerId) {
          setError("Graph renderer returned a different owner. Refresh owner data and try again.");
          return;
        }
        setClient(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => { cancelled = true; };
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
        {renderReady ? `Graph canvas ready · ${client.manifest.totalNodeCount} nodes` : `Preparing canvas · ${client.manifest.totalNodeCount} nodes`}
      </div>
      <GraphRenderScene client={client} selectedMemoryId={selectedMemoryId} onSelect={handleSelect}
        onSelectionUnavailable={handleSelectionUnavailable} onFrameReady={markReady} />
      <div className="knowledge-graph-help">Drag to rotate · wheel to zoom · right-drag to pan</div>
    </div>
  );
}
