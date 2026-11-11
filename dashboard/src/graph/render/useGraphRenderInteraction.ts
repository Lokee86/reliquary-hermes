import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { viewportForBounds } from "./CameraViewport";
import type { GraphRenderClient } from "./client";
import type {
  GraphRenderFrame,
  GraphRenderNeighborhood,
  GraphRenderNodeInspection,
  GraphRenderNodeResolution,
  GraphRenderVec3,
  GraphRenderViewport,
} from "./types";

export interface GraphRenderSceneProps {
  client: GraphRenderClient;
  selectedMemoryId: string | null;
  onSelect: (selection: GraphRenderNodeResolution, renderId: number, generationId: string) => void;
  onSelectionUnavailable?: (memoryId: string) => void;
  onFrameReady?: () => void;
}

export function useGraphRenderInteraction({
  client,
  selectedMemoryId,
  onSelect,
  onSelectionUnavailable,
  onFrameReady,
}: GraphRenderSceneProps) {
  const [frame, setFrame] = useState<GraphRenderFrame | null>(null);
  const [selectedRenderId, setSelectedRenderId] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<GraphRenderVec3 | null>(null);
  const [hover, setHover] = useState<{ renderId: number; size: number } | null>(null);
  const [hoverDetail, setHoverDetail] = useState<{ renderId: number; node: GraphRenderNodeInspection } | null>(null);
  const [neighborhood, setNeighborhood] = useState<{ renderId: number; value: GraphRenderNeighborhood } | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<{ renderId: number; node: GraphRenderNodeInspection } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const selectionVersion = useRef(0);
  const onUnavailable = useRef(onSelectionUnavailable);
  const onReady = useRef(onFrameReady);

  useEffect(() => { onUnavailable.current = onSelectionUnavailable; }, [onSelectionUnavailable]);
  useEffect(() => { onReady.current = onFrameReady; }, [onFrameReady]);

  const initialViewport = useMemo(() => viewportForBounds(client.manifest.globalBounds), [client]);
  const loadViewport = useCallback(async (viewport: GraphRenderViewport) => {
    const version = ++requestVersion.current;
    try {
      const next = await client.loadViewport(viewport);
      if (version !== requestVersion.current) return;
      setFrame(next);
      setError(null);
      // Empty graphs have no drawable node object to signal readiness. For a
      // populated graph, the first node chunk reports readiness after render.
      if (client.manifest.totalNodeCount === 0) onReady.current?.();
    } catch (reason) {
      if (version === requestVersion.current) setError(String(reason));
    }
  }, [client]);

  useEffect(() => {
    client.setHoveredRenderId(null);
    client.setSelectedRenderId(null);
    void loadViewport(initialViewport);
    return () => {
      requestVersion.current += 1;
      selectionVersion.current += 1;
    };
  }, [client, initialViewport, loadViewport]);

  const select = useCallback((renderId: number, position: GraphRenderVec3) => {
    const changed = renderId !== client.selectedRenderId;
    client.setSelectedRenderId(renderId);
    setSelectedRenderId(renderId);
    setError(null);
    if (changed) setFocusRequest(position);
  }, [client]);

  const pick = useCallback(async (renderId: number, position: GraphRenderVec3) => {
    const version = ++selectionVersion.current;
    try {
      const resolved = await client.resolveNode(renderId);
      if (selectionVersion.current !== version) return;
      select(renderId, position);
      onSelect(resolved, renderId, client.manifest.generationId);
    } catch (reason) {
      if (selectionVersion.current === version) setError(String(reason));
    }
  }, [client, onSelect, select]);

  useEffect(() => {
    const version = ++selectionVersion.current;
    if (!selectedMemoryId) {
      client.setSelectedRenderId(null);
      setSelectedRenderId(null);
      return;
    }

    const controller = new AbortController();
    void client.locateMemory(selectedMemoryId, controller.signal).then((located) => {
      if (controller.signal.aborted || selectionVersion.current !== version) return;
      if (!located) {
        onUnavailable.current?.(selectedMemoryId);
        return;
      }
      select(located.renderId, located.position);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && selectionVersion.current === version) setError(String(reason));
    });
    return () => controller.abort();
  }, [client, select, selectedMemoryId]);

  const publishHover = useCallback((renderId: number | null, size = 0) => {
    client.setHoveredRenderId(renderId);
    setHover(renderId === null ? null : { renderId, size });
    setHoverDetail(null);
  }, [client]);

  const hoveredRenderId = hover?.renderId ?? null;
  useEffect(() => {
    if (hoveredRenderId === null) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void client.inspectNode(hoveredRenderId, controller.signal).then((node) => {
        if (!controller.signal.aborted && client.hoveredRenderId === hoveredRenderId) {
          setHoverDetail({ renderId: hoveredRenderId, node });
        }
      }).catch(() => undefined);
    }, 110);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [client, hoveredRenderId]);

  useEffect(() => {
    if (selectedRenderId === null) return;
    const controller = new AbortController();
    void client.neighborhood(selectedRenderId, controller.signal).then((value) => {
      if (!controller.signal.aborted && client.selectedRenderId === selectedRenderId) {
        setNeighborhood({ renderId: selectedRenderId, value });
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    void client.inspectNode(selectedRenderId, controller.signal).then((node) => {
      if (!controller.signal.aborted && client.selectedRenderId === selectedRenderId) {
        setSelectedDetail({ renderId: selectedRenderId, node });
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [client, selectedRenderId]);

  return {
    frame, error, selectedRenderId, hoveredRenderId, focusRequest,
    hoverNode: hover && hoverDetail?.renderId === hover.renderId
      ? { ...hoverDetail.node, size: hover.size }
      : null,
    neighborhood: neighborhood?.renderId === selectedRenderId ? neighborhood.value : null,
    selectedTitle: selectedDetail?.renderId === selectedRenderId ? selectedDetail.node.title : null,
    pick, publishHover, loadViewport,
  };
}
