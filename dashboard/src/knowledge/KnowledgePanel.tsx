import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Community, MemorySummary, OwnerBinding, Page } from "../../types";
import type { HostControls, JsonTransport } from "../host";
import type { GraphRenderNodeResolution, GraphRenderTransport } from "../graph/render";
import { createKnowledgeClient, type KnowledgeScope } from "./client";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { KnowledgeInspector } from "./KnowledgeInspector";
import { KnowledgeNavigation } from "./KnowledgeNavigation";
import { communityLabel } from "./knowledgeUi";
import "./knowledge.css";

export type ViewMode = "list" | "graph";

interface Props {
  owner: OwnerBinding;
  sessionId: string | null;
  transport: JsonTransport;
  graphTransportFor: (owner: OwnerBinding, sessionId: string | null, signal?: AbortSignal) => GraphRenderTransport | undefined;
  controls: HostControls;
  scopeControls: ReactNode;
  mutationBlocked?: string;
  onOwnerRefresh: (memoryId?: string, includeArchived?: boolean, view?: ViewMode) => void;
  initialMemoryId?: string;
  initialView?: ViewMode;
  includeArchived?: boolean;
}

export function KnowledgePanel({ owner, sessionId, transport, graphTransportFor, controls, scopeControls,
  mutationBlocked, onOwnerRefresh, initialMemoryId, initialView, includeArchived = false }: Props) {
  const client = useMemo(() => createKnowledgeClient(transport), [transport]);
  const scope = useMemo<KnowledgeScope>(() => ({ owner, sessionId }), [owner, sessionId]);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(initialMemoryId ?? null);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(includeArchived);
  const [mode, setMode] = useState<ViewMode>(initialView ?? "list");
  const [memories, setMemories] = useState<Page<MemorySummary> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [communities, setCommunities] = useState<Page<Community> | null>(null);
  const [communityCursor, setCommunityCursor] = useState<string | null>(null);
  const [communitiesUnavailable, setCommunitiesUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconcileListSelection = useRef(false);

  const writable = !mutationBlocked && owner.owner_kind === "REL" && owner.capabilities.view && owner.capabilities.manage;

  useEffect(() => {
    if (mode !== "list") return;
    const controller = new AbortController();
    const filters = {
      query: query.trim(), category: null, memory_type: null,
      lifecycle: showArchived ? null : "active" as const, community_id: selectedCommunityId,
    };
    void client.read(scope, "ui.memory_list", { cursor, limit: 40, filters }, controller.signal).then(memoryPage => {
      if (controller.signal.aborted) return;
      setMemories(memoryPage);
      const checkPage = reconcileListSelection.current;
      reconcileListSelection.current = false;
      setSelectedMemoryId(current => current && (!checkPage || memoryPage.items.some(item => item.memory_id === current))
        ? current : memoryPage.items[0]?.memory_id ?? null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [client, scope, mode, cursor, query, showArchived, selectedCommunityId]);

  useEffect(() => {
    if (!owner.capabilities.community) return;
    const controller = new AbortController();
    void client.read(scope, "ui.community_list", { cursor: communityCursor, limit: 100 }, controller.signal).then(result => {
      if (!controller.signal.aborted) setCommunities(result.communities);
    }).catch(() => {
      if (!controller.signal.aborted) setCommunitiesUnavailable(true);
    });
    return () => controller.abort();
  }, [client, scope, communityCursor, owner.capabilities.community]);

  const filtered = memories?.items ?? [];
  const selectedCommunity = communities?.items.find(item => item.community_id === selectedCommunityId) ?? null;
  const listCount = memories && !cursor && !query.trim() && !selectedCommunityId && !memories.truncated
    ? filtered.length : undefined;

  const graphController = useMemo(() => new AbortController(), [owner.owner_id, owner.generation, owner.cut, sessionId]);
  useEffect(() => () => graphController.abort(), [graphController]);
  const graphTransport = useMemo(
    () => graphTransportFor(owner, sessionId, graphController.signal),
    [graphTransportFor, owner, sessionId, graphController],
  );
  const graphSelected = useCallback((resolution: GraphRenderNodeResolution) => {
    reconcileListSelection.current = false;
    setSelectedMemoryId(resolution.memoryId);
  }, []);
  const inspectorMemoryId = mode === "list" && !memories && reconcileListSelection.current ? null : selectedMemoryId;

  function refresh(memoryId?: string) {
    onOwnerRefresh(memoryId ?? selectedMemoryId ?? undefined, showArchived, mode);
  }

  function changePage(nextCursor: string | null) {
    reconcileListSelection.current = true;
    setCursor(nextCursor);
    setMemories(null);
    setError(null);
  }

  function changeCommunity(id: string | null) {
    if (selectedCommunityId === id && cursor === null) return;
    setSelectedCommunityId(id);
    changePage(null);
  }

  function changeCommunityPage(nextCursor: string | null) {
    setCommunityCursor(nextCursor);
    setCommunities(null);
    setCommunitiesUnavailable(false);
    changeCommunity(null);
  }

  async function renameCommunity(community: Community, name: string) {
    if (!writable || !owner.capabilities.community_rename) return;
    const outcome = await client.write(scope, "ui.community_rename", { community_id: community.community_id, name }, community.generation);
    if (outcome.status !== "ok") throw new Error(outcome.code);
    refresh();
  }

  return (
    <section className="knowledge-panel" data-view={mode} aria-label="Knowledge">
      <KnowledgeNavigation
        client={client} scope={scope} scopeControls={scopeControls}
        communities={communities} communitiesUnavailable={communitiesUnavailable}
        communityCursor={communityCursor} onCommunityPage={changeCommunityPage}
        selectedCommunity={selectedCommunity} selectedCommunityId={selectedCommunityId}
        query={query} showArchived={showArchived} listCount={listCount}
        blocked={mutationBlocked} canRename={writable && owner.capabilities.community_rename}
        onQuery={value => { setQuery(value); changePage(null); }}
        onShowArchived={value => { setShowArchived(value); changePage(null); }}
        onCommunity={changeCommunity} onRename={renameCommunity} onSaved={refresh} onRefresh={() => refresh()}
      />

      <section className="knowledge-memory-list" aria-label={mode === "graph" ? "Memory graph" : "Memory list"}>
        <header>
          <div>
            <strong>{selectedCommunity ? communityLabel(selectedCommunity) : "Memories"}</strong>
            {mode === "list" && memories && <span>{filtered.length}{memories.truncated ? "+" : ""}</span>}
          </div>
          <div className="knowledge-view-switch" role="group" aria-label="Knowledge view">
            <button type="button" className={mode === "list" ? "active" : ""} aria-pressed={mode === "list"}
              onClick={() => setMode("list")}>List</button>
            <button type="button" className={mode === "graph" ? "active" : ""} aria-pressed={mode === "graph"}
              onClick={() => setMode("graph")}>Graph</button>
          </div>
        </header>
        {mode === "graph" ? !owner.capabilities.graph ? (
          <div className="knowledge-state error" role="status">Graph viewing is not granted for this owner. List remains available.</div>
        ) : graphTransport ? (
          <Suspense fallback={<div className="knowledge-state" role="status">Loading graph renderer…</div>}>
            <KnowledgeGraph key={owner.owner_id + ":" + owner.generation + ":" + owner.cut} ownerId={owner.owner_id}
              transport={graphTransport} onSelect={graphSelected} />
          </Suspense>
        ) : (
          <div className="knowledge-state error" role="status">
            Graph rendering is unavailable because this Hermes host does not provide authorized binary chunk transport. List remains available.
          </div>
        ) : error ? (
          <div className="knowledge-state error" role="alert">{error}</div>
        ) : !memories ? (
          <div className="knowledge-state" role="status">Loading Knowledge…</div>
        ) : filtered.length === 0 && !cursor ? (
          <div className="knowledge-state">No matching memories.</div>
        ) : (
          <div className="knowledge-memory-rows">
            {filtered.map(memory => (
              <button key={memory.memory_id} type="button" aria-pressed={memory.memory_id === selectedMemoryId}
                className={"knowledge-memory-row " + (memory.memory_id === selectedMemoryId ? "selected" : "")}
                onClick={() => setSelectedMemoryId(memory.memory_id)}>
                <div>
                  <strong>{memory.title || (memory.lifecycle === "tombstoned" ? "Retired Memory" : "Untitled memory")}</strong>
                  <span>{memory.excerpt}</span>
                </div>
                <small>{memory.lifecycle}</small>
              </button>
            ))}
            {(cursor || memories.next_cursor) && <div className="knowledge-list-pager" role="group" aria-label="Memory pages">
              <button type="button" disabled={!cursor} onClick={() => changePage(null)}>First page</button>
              <button type="button" disabled={!memories.next_cursor} onClick={() => changePage(memories.next_cursor)}>Next page</button>
            </div>}
          </div>
        )}
      </section>

      <KnowledgeInspector key={inspectorMemoryId ?? "none"} client={client} scope={scope} memoryId={inspectorMemoryId}
        communities={communities?.items ?? []} controls={controls} blocked={mutationBlocked} writable={writable}
        onChanged={refresh} onOpenMemory={setSelectedMemoryId} />
    </section>
  );
}
