import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Community, MemorySummary, OwnerBinding, Page } from "../../types";
import type { HostControls, JsonTransport } from "../host";
import { graphSelectionEligible } from "../host";
import { createKnowledgeClient, type KnowledgeScope } from "./client";
import { KnowledgeGraph } from "./KnowledgeGraph";
import type { StorageLike } from "../graph/model/scopedStorage";
import { KnowledgeInspector } from "./KnowledgeInspector";
import { KnowledgeNavigation } from "./KnowledgeNavigation";
import { communityLabel } from "./knowledgeUi";
import type { GraphRenderFilterScope, GraphRenderTransport } from "../graph/render";
import "./knowledge.css";

interface Props {
  owner: OwnerBinding;
  sessionId: string | null;
  transport: JsonTransport;
  graphTransportFor: (owner: OwnerBinding, sessionId: string | null, signal?: AbortSignal) => GraphRenderTransport | undefined;
  controls: HostControls;
  preferenceProfileKey: string | null;
  preferenceSession?: StorageLike;
  scopeControls: ReactNode;
  mutationBlocked?: string;
  onOwnerRefresh: (memoryId?: string, includeArchived?: boolean, view?: ViewMode) => void;
  initialMemoryId?: string;
  initialView?: ViewMode;
  includeArchived?: boolean;
}

const PAGE_SIZE = 40;
const COMMUNITY_PAGE_SIZE = 100;
const EMPTY_FILTERS = { query: "", category: null, memory_type: null, lifecycle: null, community_id: null } as const;

export type ViewMode = "list" | "graph";
interface CommunityPageState {
  ownerKey: string;
  cursor: string | null;
  page: Page<Community>;
}

export function KnowledgePanel({ owner, sessionId, transport, graphTransportFor, controls, scopeControls, preferenceProfileKey, preferenceSession,
  mutationBlocked, onOwnerRefresh, initialMemoryId, initialView, includeArchived = false }: Props) {
  const client = useMemo(() => createKnowledgeClient(transport), [transport]);
  const scope = useMemo<KnowledgeScope>(() => ({ owner, sessionId }), [owner, sessionId]);
  const [mode, setMode] = useState<ViewMode>(initialView ?? "graph");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [memoryType, setMemoryType] = useState("");
  const [showArchived, setShowArchived] = useState(includeArchived);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [memories, setMemories] = useState<Page<MemorySummary> | null>(null);
  const [communityCursor, setCommunityCursor] = useState<string | null>(null);
  const [communities, setCommunities] = useState<CommunityPageState | null>(null);
  const [communitiesUnavailable, setCommunitiesUnavailable] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(initialMemoryId ?? null);
  const [validatedSelection, setValidatedSelection] = useState<{ key: string; eligible: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconcileListSelection = useRef(false);

  const { Button } = controls;
  const writable = !mutationBlocked && owner.owner_kind === "REL" && owner.capabilities.view && owner.capabilities.manage;
  const communityOwnerKey = `${owner.owner_id}:${owner.generation}:${owner.cut}`;
  const normalizedQuery = search.trim();
  const normalizedCategory = category.trim();
  const normalizedMemoryType = memoryType.trim();
  const graphFilters = useMemo<GraphRenderFilterScope>(() => ({
    query: normalizedQuery,
    category: normalizedCategory || undefined,
    memoryType: normalizedMemoryType || undefined,
    communityId: communityId ?? undefined,
    includeArchived: showArchived,
  }), [normalizedQuery, normalizedCategory, normalizedMemoryType, communityId, showArchived]);

  useEffect(() => {
    if (mode !== "list") return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const filters = {
      ...EMPTY_FILTERS,
      query: graphFilters.query ?? "",
      category: graphFilters.category ?? null,
      memory_type: graphFilters.memoryType ?? null,
      lifecycle: graphFilters.includeArchived ? null : "active" as const,
      community_id: graphFilters.communityId ?? null,
    };
    void client.read(scope, "ui.memory_list", { cursor, limit: PAGE_SIZE, filters }, controller.signal).then(memoryPage => {
      if (controller.signal.aborted) return;
      setMemories(memoryPage);
      const checkCurrentPage = reconcileListSelection.current;
      reconcileListSelection.current = false;
      setSelectedMemoryId(current => current && (!checkCurrentPage || memoryPage.items.some(item => item.memory_id === current))
        ? current : memoryPage.items[0]?.memory_id ?? null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, scope, mode, cursor, graphFilters]);

  useEffect(() => {
    if (!owner.capabilities.community) return;
    const controller = new AbortController();
    setCommunitiesUnavailable(false);
    void client.read(scope, "ui.community_list", { cursor: communityCursor, limit: COMMUNITY_PAGE_SIZE }, controller.signal).then(result => {
      if (!controller.signal.aborted) setCommunities({ ownerKey: communityOwnerKey, cursor: communityCursor, page: result.communities });
    }).catch(() => {
      if (!controller.signal.aborted) setCommunitiesUnavailable(true);
    });
    return () => controller.abort();
  }, [client, scope, communityCursor, communityOwnerKey, owner.capabilities.community]);

  const filtered = memories?.items ?? [];
  const listCount = memories && !cursor && !normalizedQuery && !normalizedCategory && !normalizedMemoryType
    && !communityId && !showArchived && !memories.truncated ? filtered.length : undefined;
  const communityPage = communities?.ownerKey === communityOwnerKey && communities.cursor === communityCursor
    ? communities.page : null;
  const selectedCommunity = communityPage?.items.find((community) => community.community_id === communityId) ?? null;
  const graphController = useMemo(() => new AbortController(), [owner.owner_id, owner.generation, owner.cut, sessionId]);
  useEffect(() => () => graphController.abort(), [graphController]);
  const graphTransport = useMemo(
    () => graphTransportFor(owner, sessionId, graphController.signal),
    [graphTransportFor, owner, sessionId, graphController],
  );
  const selectionKey = JSON.stringify([
    owner.owner_id, owner.generation, owner.cut, sessionId, selectedMemoryId, graphFilters,
  ]);

  useEffect(() => {
    if (!selectedMemoryId) return;
    const controller = new AbortController();
    void graphSelectionEligible(transport, owner, sessionId, selectedMemoryId, graphFilters, controller.signal)
      .then((eligible) => {
        if (controller.signal.aborted) return;
        setValidatedSelection({ key: selectionKey, eligible });
        if (!eligible) setSelectedMemoryId((current) => current === selectedMemoryId ? null : current);
      })
      .catch(() => {
        if (!controller.signal.aborted) setValidatedSelection({ key: selectionKey, eligible: true });
      });
    return () => controller.abort();
  }, [transport, owner, sessionId, selectedMemoryId, graphFilters, selectionKey]);

  function refresh(memoryId?: string) {
    onOwnerRefresh(memoryId ?? selectedMemoryId ?? undefined, showArchived, mode);
  }

  function changeQuery(value: string) {
    setSearch(value);
    if (value.trim() !== normalizedQuery) changeListPage(null);
  }

  function changeCategory(value: string) {
    setCategory(value);
    if (value.trim() !== normalizedCategory) changeListPage(null);
  }

  function changeMemoryType(value: string) {
    setMemoryType(value);
    if (value.trim() !== normalizedMemoryType) changeListPage(null);
  }

  function changeArchived(value: boolean) {
    setShowArchived(value);
    changeListPage(null);
  }

  function changeCommunity(id: string | null) {
    if (communityId === id && cursor === null) return;
    setCommunityId(id);
    changeListPage(null);
  }

  function changeListPage(nextCursor: string | null) {
    reconcileListSelection.current = true;
    setCursor(nextCursor);
    setMemories(null);
    setError(null);
  }

  function changeCommunityPage(nextCursor: string | null) {
    setCommunityCursor(nextCursor);
    setCommunities(null);
    changeCommunity(null);
  }

  async function renameCommunity(community: Community, name: string) {
    if (!writable || mutationBlocked || !owner.capabilities.community_rename) return;
    const outcome = await client.write(scope, "ui.community_rename", { community_id: community.community_id, name }, community.generation);
    if (outcome.status !== "ok") throw new Error(outcome.code);
    refresh();
  }

  const graphSelected = useCallback((memoryId: string | null) => {
    reconcileListSelection.current = false;
    setSelectedMemoryId(memoryId);
  }, []);
  const inspectorMemoryId = validatedSelection?.key === selectionKey && validatedSelection.eligible
    ? selectedMemoryId : null;

  return (
    <section className="knowledge-panel" data-view={mode} aria-label="Knowledge">
      <KnowledgeNavigation
        client={client} scope={scope} scopeControls={scopeControls}
        communities={communityPage} communitiesUnavailable={communitiesUnavailable} listCount={listCount}
        communityCursor={communityCursor} onCommunityPage={changeCommunityPage}
        selectedCommunity={selectedCommunity} selectedCommunityId={communityId}
        query={search} category={category} memoryType={memoryType} showArchived={showArchived}
        blocked={mutationBlocked} canRename={writable && owner.capabilities.community_rename}
        onQuery={changeQuery} onCategory={changeCategory} onMemoryType={changeMemoryType}
        onShowArchived={changeArchived}
        onCommunity={changeCommunity}
        onRename={renameCommunity} onSaved={refresh} onRefresh={() => refresh()} />

      <section className="knowledge-memory-list" aria-label={mode === "graph" ? "Memory graph" : "Memory list"}>
        <header>
          <div><strong>{selectedCommunity ? communityLabel(selectedCommunity) : "Memories"}</strong>
            {mode === "list" && memories && <span>{filtered.length}{memories.truncated ? "+" : ""}</span>}</div>
          <div className="knowledge-view-switch" role="group" aria-label="Knowledge view">
            <button type="button" className={mode === "list" ? "active" : ""} aria-pressed={mode === "list"}
              onClick={() => setMode("list")}>List</button>
            <button type="button" className={mode === "graph" ? "active" : ""} aria-pressed={mode === "graph"}
              onClick={() => setMode("graph")}>Graph</button>
          </div>
          {mode === "list" && (cursor || memories?.next_cursor) && <div className="knowledge-list-pager" role="group" aria-label="Memory pages">
            <Button type="button" disabled={!cursor} onClick={() => changeListPage(null)}>First page</Button>
            <Button type="button" disabled={!memories?.next_cursor} onClick={() => changeListPage(memories?.next_cursor ?? null)}>Next page</Button>
            {memories?.truncated && <span>More results are available.</span>}
          </div>}
        </header>
        {mode === "graph" ? !owner.capabilities.graph ? (
          <div className="knowledge-state error" role="status">Graph viewing is not granted for this owner. List remains available.</div>
        ) : graphTransport ? (
          <Suspense fallback={<div className="knowledge-state" role="status">Loading graph renderer…</div>}>
            <KnowledgeGraph key={JSON.stringify([preferenceProfileKey, owner.owner_id, owner.generation, owner.cut])} ownerId={owner.owner_id}
              controls={controls} preferenceProfileKey={preferenceProfileKey} preferenceSession={preferenceSession}
              transport={graphTransport} filters={graphFilters} selectedMemoryId={selectedMemoryId}
              onSelectMemoryId={graphSelected} />
          </Suspense>
        ) : (
          <div className="knowledge-state error" role="status">
            Graph rendering is unavailable because this Hermes host does not provide authorized binary chunk transport. List remains available.
          </div>
        ) : error ? <div className="knowledge-state error" role="alert">{error}</div>
          : loading || !memories ? <div className="knowledge-state" role="status">Loading Knowledge…</div>
            : filtered.length === 0 && !cursor ? <div className="knowledge-state">No matching memories.</div> : (
              <div className="knowledge-memory-rows">
                {filtered.map((memory) => <button key={memory.memory_id} type="button"
                  aria-pressed={memory.memory_id === selectedMemoryId}
                  className={`knowledge-memory-row${memory.memory_id === selectedMemoryId ? " selected" : ""}`}
                  onClick={() => setSelectedMemoryId(memory.memory_id)}>
                  <div><strong>{memory.title || (memory.lifecycle === "tombstoned" ? "Retired Memory" : "Untitled memory")}</strong><span>{memory.excerpt}</span></div>
                  <small>{memory.lifecycle}</small>
                </button>)}
              </div>
            )}
      </section>

      <KnowledgeInspector key={`${owner.owner_id}:${owner.cut}:${selectedMemoryId ?? "none"}`}
        client={client} scope={scope} memoryId={inspectorMemoryId} communities={communityPage?.items ?? []} controls={controls}
        blocked={mutationBlocked} writable={writable}
        onChanged={refresh} onOpenMemory={setSelectedMemoryId} />
    </section>
  );
}
