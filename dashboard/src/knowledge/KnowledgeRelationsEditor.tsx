import { useEffect, useMemo, useState } from "react";
import type { GraphEdge, GraphNode, MemorySummary } from "../../types";
import type { HostControls } from "../host";
import type { KnowledgeClient, KnowledgeScope } from "./client";
import { shortId } from "./knowledgeUi";

interface Props {
  client: KnowledgeClient;
  scope: KnowledgeScope;
  memory: MemorySummary;
  controls: HostControls;
  blocked?: string;
  onChanged: () => void;
  onError: (error: string | null) => void;
}

export function KnowledgeRelationsEditor({ client, scope, memory, controls, blocked, onChanged, onError }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [targetId, setTargetId] = useState("");
  const [direction, setDirection] = useState<"outgoing" | "incoming">("outgoing");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const { Button, Select } = controls;
  const canEdit = !blocked && scope.owner.owner_kind === "REL" && scope.owner.capabilities.view
    && scope.owner.capabilities.manage && scope.owner.capabilities.relation_edit;

  useEffect(() => {
    const controller = new AbortController();
    if (!scope.owner.capabilities.graph) {
      setLoading(false);
      setNodes([]);
      setEdges([]);
      return () => controller.abort();
    }
    setLoading(true);
    void Promise.all([
      client.read(scope, "ui.graph_page", { seed_ids: [memory.memory_id], community_id: null, depth: 1, node_limit: 500, edge_limit: 1000, cursor: null }, controller.signal),
      client.read(scope, "ui.memory_list", { cursor: null, limit: 100, filters: {
        query: "", category: null, memory_type: null, lifecycle: "active", community_id: null,
      } }, controller.signal),
    ]).then(([graph, page]) => {
      if (controller.signal.aborted) return;
      const byId = new Map(graph.nodes.map((node) => [node.memory_id, node]));
      for (const item of page.items) {
        if (!byId.has(item.memory_id)) byId.set(item.memory_id, {
          node_id: item.memory_id, kind: "memory", memory_id: item.memory_id, community_id: item.community_id,
          label: item.title || item.excerpt.slice(0, 128) || "Untitled memory", origin: "memory", revision: item.revision,
          cut: scope.owner.cut,
        });
      }
      setNodes([...byId.values()]); setEdges(graph.edges); setTruncated(graph.truncated);
      setTargetId((old) => [...byId.values()].some((node) => node.memory_id === old && old !== memory.memory_id)
        ? old : [...byId.values()].find((node) => node.memory_id && node.memory_id !== memory.memory_id)?.memory_id ?? "");
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) onError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, scope, memory.memory_id, onError]);

  const byId = useMemo(() => new Map(nodes.filter((node) => node.memory_id).map((node) => [node.memory_id!, node])), [nodes]);
  const related = edges.filter((edge) => edge.source_id === memory.memory_id || edge.target_id === memory.memory_id);
  const options = nodes.filter((node) => node.memory_id && node.memory_id !== memory.memory_id)
    .map((node) => ({ value: node.memory_id!, label: node.label || shortId(node.memory_id!) }));

  async function change(edge: GraphEdge | null, target: GraphNode) {
    if (!canEdit || busy || !target.memory_id) return;
    const sourceNode = byId.get(memory.memory_id);
    const targetNode = byId.get(target.memory_id);
    const linking = edge === null;
    const fromNode = edge ? byId.get(edge.source_id) : direction === "outgoing" ? sourceNode : targetNode;
    const toNode = edge ? byId.get(edge.target_id) : direction === "outgoing" ? targetNode : sourceNode;
    if (!sourceNode || !targetNode || !fromNode || !toNode
      || sourceNode.cut !== scope.owner.cut || targetNode.cut !== scope.owner.cut
      || fromNode.cut !== scope.owner.cut || toNode.cut !== scope.owner.cut) {
      onError("The graph cut changed. Refresh owner data before editing relationships."); return;
    }
    setBusy(true);
    const result = await client.write(scope, "ui.relation_change", {
      source_id: linking ? fromNode.memory_id! : edge.source_id,
      target_id: linking ? toNode.memory_id! : edge.target_id,
      source_revision: fromNode.revision,
      target_revision: toNode.revision,
      action: linking ? "link" : "unlink",
      relation_kind: "user_association",
      edge_id: edge?.edge_id ?? null,
    }, edge?.revision ?? null);
    setBusy(false);
    if (result.status !== "ok") { onError(result.code); return; }
    onChanged();
  }

  return (
    <section className="knowledge-inspector-section" aria-label="Memory relationships">
      <h3>Relationships</h3>
      {loading ? <p className="knowledge-muted">Loading the bounded relationship neighborhood…</p> : related.length === 0
        ? <p className="knowledge-muted">No relationships in this Memory's bounded neighborhood.</p>
        : related.map((edge) => {
          const outgoing = edge.source_id === memory.memory_id;
          const otherId = outgoing ? edge.target_id : edge.source_id;
          const other = byId.get(otherId);
          const editable = canEdit && edge.kind === "user_association" && edge.origin === "user";
          return <div className="knowledge-relation-editor" key={edge.edge_id}>
            <div>
              <strong>{outgoing ? "→" : "←"} {other?.label || shortId(otherId)}</strong>
              <span>{edge.origin} · {edge.kind.replaceAll("_", " ")} · {edge.active ? "active" : "inactive"}</span>
            </div>
            <Select label="Relationship type" value={edge.kind} options={[
              { value: edge.kind, label: edge.kind.replaceAll("_", " ") },
            ]} disabled onValueChange={() => undefined} />
            {editable && edge.active && <Button type="button" disabled={busy} onClick={() => void change(edge, other ?? {
              node_id: otherId, kind: "memory", memory_id: otherId, community_id: null, label: otherId,
              origin: "memory", revision: memory.revision, cut: scope.owner.cut,
            })}>Remove user association</Button>}
          </div>;
        })}
      {canEdit && <div className="knowledge-add-relation">
        <Select label="Relationship direction" value={direction} options={[
          { value: "outgoing", label: "This memory → target" },
          { value: "incoming", label: "Target → this memory" },
        ]} disabled={busy} onValueChange={(value) => setDirection(value as "outgoing" | "incoming")} />
        <Select label="Link to Memory" value={targetId} options={options} disabled={busy || options.length === 0}
          onValueChange={setTargetId} />
        <Button type="button" disabled={busy || !targetId} onClick={() => {
          const target = byId.get(targetId);
          if (!target) return;
          void change(null, target);
        }}>Link Memories</Button>
      </div>}
      {!scope.owner.capabilities.graph && <p className="knowledge-muted">The authorized graph capability is required to inspect relationship endpoints.</p>}
      {truncated && <p className="knowledge-muted" role="status">This relationship neighborhood is truncated at the API limit. Results above are incomplete; refine by selecting a specific Memory or refresh after the owner changes.</p>}
      {!canEdit && <p className="knowledge-muted">{blocked ?? "Relationship editing is not granted for this owner."}</p>}
      <p className="knowledge-muted">Hermes currently authorizes user associations only. Other relation kinds are shown read-only.</p>
    </section>
  );
}
