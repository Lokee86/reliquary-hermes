import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { Community, MemorySummary, OwnerBinding, Page } from "../../types";
import type { HostControls, JsonTransport } from "../host";
import { graphSelectionEligible } from "../host";
import { createKnowledgeClient, type KnowledgeClient, type KnowledgeScope } from "./client";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { KnowledgeInspector } from "./KnowledgeInspector";
import { communityLabel } from "./knowledgeUi";
import type { GraphRenderFilterScope, GraphRenderTransport } from "../graph/render";
import "./knowledge.css";

interface Props {
  owner: OwnerBinding;
  sessionId: string | null;
  transport: JsonTransport;
  graphTransportFor: (owner: OwnerBinding, sessionId: string | null, signal?: AbortSignal) => GraphRenderTransport | undefined;
  controls: HostControls;
  mutationBlocked?: string;
  onOwnerRefresh?: (memoryId?: string, includeArchived?: boolean, view?: ViewMode) => void;
  initialMemoryId?: string;
  initialView?: ViewMode;
  includeArchived?: boolean;
}

const PAGE_SIZE = 40;
const COMMUNITY_PAGE_SIZE = 100;
const EMPTY_FILTERS = { query: "", category: null, memory_type: null, lifecycle: null, community_id: null } as const;

type ViewMode = "list" | "graph";
interface CommunityPageState {
  ownerKey: string;
  cursor: string | null;
  page: Page<Community>;
}

export function KnowledgePanel({ owner, sessionId, transport, graphTransportFor, controls, mutationBlocked, onOwnerRefresh, initialMemoryId, initialView, includeArchived = false }: Props) {
  const client = useMemo(() => createKnowledgeClient(transport), [transport]);
  const scope = useMemo<KnowledgeScope>(() => ({ owner, sessionId }), [owner, sessionId]);
  const [mode, setMode] = useState<ViewMode>(initialMemoryId ? "list" : initialView ?? "graph");
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
  const [reload, setReload] = useState(0);

  const { Button, Input, Checkbox } = controls;
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
      setSelectedMemoryId((current) => current ?? memoryPage.items[0]?.memory_id ?? null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, scope, mode, cursor, graphFilters, reload, owner.capabilities.community]);

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
  }, [client, scope, reload, communityCursor, communityOwnerKey, owner.capabilities.community]);

  const filtered = memories?.items ?? [];
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

  const refresh = useCallback((memoryId?: string) => {
    setMemories(null);
    setCommunities(null);
    setReload((value) => value + 1);
    onOwnerRefresh?.(memoryId ?? (mode === "list" ? selectedMemoryId ?? undefined : undefined), showArchived, mode);
  }, [onOwnerRefresh, mode, selectedMemoryId, showArchived]);

  function changeQuery(value: string) {
    setSearch(value);
    setCursor(null);
  }

  function changeCategory(value: string) {
    setCategory(value);
    setCursor(null);
  }

  function changeMemoryType(value: string) {
    setMemoryType(value);
    setCursor(null);
  }

  function changeCommunityPage(nextCursor: string | null) {
    setCommunityCursor(nextCursor);
    setCommunities(null);
    setCommunityId(null);
    setCursor(null);
  }

  async function renameCommunity(community: Community, name: string) {
    if (!writable || mutationBlocked || !owner.capabilities.community_rename) return;
    const outcome = await client.write(scope, "ui.community_rename", { community_id: community.community_id, name }, community.generation);
    if (outcome.status !== "ok") throw new Error(outcome.code);
    refresh();
  }

  const graphSelected = useCallback((memoryId: string | null) => setSelectedMemoryId(memoryId), []);
  const inspectorMemoryId = validatedSelection?.key === selectionKey && validatedSelection.eligible
    ? selectedMemoryId : null;

  return (
    <section className="knowledge-panel" data-view={mode} aria-label="Knowledge">
      <aside className="knowledge-nav" aria-label="Knowledge navigation">
        <div className="knowledge-heading"><span className="eyebrow">KNOWLEDGE</span><strong>{owner.display_label}</strong><span>{owner.owner_kind}</span></div>
        <div className="knowledge-view-switch" role="group" aria-label="Knowledge view">
          <Button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</Button>
          <Button type="button" aria-pressed={mode === "graph"} onClick={() => setMode("graph")}>Graph</Button>
        </div>
        <>
            <label className="knowledge-search-label">Search memories
              <Input type="search" value={search} maxLength={1024} onChange={(event) => changeQuery(event.currentTarget.value)} />
            </label>
            <label className="knowledge-search-label">Category
              <Input value={category} maxLength={128} onChange={(event) => changeCategory(event.currentTarget.value)} />
            </label>
            <label className="knowledge-search-label">Memory type
              <Input value={memoryType} maxLength={128} onChange={(event) => changeMemoryType(event.currentTarget.value)} />
            </label>
            {mode === "list" && <CreateMemory client={client} scope={scope} controls={controls} blocked={mutationBlocked} onSaved={refresh} />}
            <label className="knowledge-lifecycle-filter knowledge-muted">
              <Checkbox checked={showArchived} aria-label="Show non-active memories"
                onCheckedChange={value => { setShowArchived(value); setCursor(null); }} />
              <span>Show non-active memories</span>
            </label>
            <Button type="button" aria-pressed={!communityId} onClick={() => { setCommunityId(null); setCursor(null); }}>
              All memories
            </Button>
            <div className="knowledge-nav-label">Communities</div>
            {(communityCursor !== null || Boolean(communityPage?.next_cursor)) && <div className="knowledge-list-pager" role="group" aria-label="Community pages">
              <Button type="button" aria-label="First community page" disabled={communityCursor === null}
                onClick={() => changeCommunityPage(null)}>First</Button>
              <Button type="button" aria-label="Next community page" disabled={!communityPage?.next_cursor}
                onClick={() => changeCommunityPage(communityPage?.next_cursor ?? null)}>Next</Button>
            </div>}
            {communitiesUnavailable && <p className="knowledge-muted" role="status">Community data is unavailable at this cut.</p>}
            {communityPage?.items.map((item) => (
              <Button key={item.community_id} type="button" aria-pressed={communityId === item.community_id}
                onClick={() => { setCommunityId(item.community_id); setCursor(null); }}>
                {communityLabel(item)} <small>{item.member_count}</small>
              </Button>
            ))}
            {mode === "list" && selectedCommunity && <RenameCommunity community={selectedCommunity} controls={controls} blocked={mutationBlocked}
              allowed={writable && owner.capabilities.community_rename} onRename={renameCommunity} />}
        </>
        <Button type="button" onClick={() => refresh()}>Refresh owner data</Button>
      </aside>

      <section className="knowledge-memory-list" aria-label={mode === "graph" ? "Memory graph" : "Memory list"}>
        <header>
          <div><strong>{mode === "graph" ? "Graph" : selectedCommunity ? communityLabel(selectedCommunity) : "Memories"}</strong>
            {mode === "list" && <span>{memories?.items.length ?? 0}</span>}</div>
          {mode === "list" && <div className="knowledge-list-pager">
            <Button type="button" disabled={!cursor} onClick={() => setCursor(null)}>First page</Button>
            <Button type="button" disabled={!memories?.next_cursor} onClick={() => setCursor(memories?.next_cursor ?? null)}>Next page</Button>
            {memories?.truncated && <span>More results are available.</span>}
          </div>}
        </header>
        {mode === "graph" ? !owner.capabilities.graph ? (
          <div className="knowledge-state error" role="status">Graph viewing is not granted for this owner. List remains available.</div>
        ) : graphTransport ? (
          <Suspense fallback={<div className="knowledge-state" role="status">Loading graph renderer…</div>}>
            <KnowledgeGraph key={`${owner.owner_id}:${owner.generation}:${owner.cut}`} ownerId={owner.owner_id}
              transport={graphTransport} filters={graphFilters} selectedMemoryId={selectedMemoryId}
              onSelectMemoryId={graphSelected} />
          </Suspense>
        ) : (
          <div className="knowledge-state error" role="status">
            Graph rendering is unavailable because this Hermes host does not provide authorized binary chunk transport. List remains available.
          </div>
        ) : error ? <div className="knowledge-state error" role="alert">{error}</div>
          : loading ? <div className="knowledge-state" role="status">Loading Knowledge…</div>
            : filtered.length === 0 ? <div className="knowledge-state">No matching memories.</div> : (
              <div className="knowledge-memory-rows">
                {filtered.map((memory) => <Button key={memory.memory_id} type="button"
                  aria-pressed={memory.memory_id === selectedMemoryId}
                  className="knowledge-memory-row"
                  onClick={() => setSelectedMemoryId(memory.memory_id)}>
                  <div><strong>{memory.title || (memory.lifecycle === "tombstoned" ? "Retired Memory" : "Untitled memory")}</strong><span>{memory.excerpt}</span></div>
                  <small>{memory.lifecycle}</small>
                </Button>)}
              </div>
            )}
      </section>

      <KnowledgeInspector key={`${owner.owner_id}:${owner.cut}:${selectedMemoryId ?? "none"}`}
        client={client} scope={scope} memoryId={inspectorMemoryId} communities={communityPage?.items ?? []} controls={controls}
        blocked={mutationBlocked} writable={writable}
        onChanged={refresh} onOpenMemory={setSelectedMemoryId} />
      {mutationBlocked && <div className="knowledge-capability-notice" role="status">{mutationBlocked}</div>}
    </section>
  );
}

function CreateMemory({ client, scope, controls, blocked, onSaved }: {
  client: KnowledgeClient; scope: KnowledgeScope; controls: HostControls; blocked?: string; onSaved: (memoryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("fact");
  const [memoryType, setMemoryType] = useState("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { Button, Input, Textarea } = controls;
  const allowed = !blocked && scope.owner.owner_kind === "REL" && scope.owner.capabilities.manage
    && scope.owner.capabilities.memory_create;

  async function create() {
    if (!allowed || busy || !title.trim() || !body.trim() || !category.trim() || !memoryType.trim()) return;
    setBusy(true);
    setError(null);
    const result = await client.write(scope, "ui.memory_create", {
      title: title.trim(), body: body.trim(), category: category.trim(), memory_type: memoryType.trim(),
    }, null);
    setBusy(false);
    if (result.status !== "ok") { setError(result.code); return; }
    setTitle(""); setBody(""); setOpen(false); onSaved(result.value.result.committed.memory.memory_id);
  }

  return <details className="knowledge-create" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>New Memory</summary>
    {!allowed && <p className="knowledge-muted">{blocked ?? "Memory creation is not granted for this owner."}</p>}
    <Input aria-label="Memory title" placeholder="Title" value={title} disabled={!allowed || busy} onChange={(event) => setTitle(event.currentTarget.value)} />
    <Textarea aria-label="Memory body" placeholder="Memory" value={body} disabled={!allowed || busy}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBody(event.currentTarget.value)} />
    <Input aria-label="Memory category" placeholder="Category" value={category} disabled={!allowed || busy} onChange={(event) => setCategory(event.currentTarget.value)} />
    <Input aria-label="Memory type" placeholder="Type" value={memoryType} disabled={!allowed || busy} onChange={(event) => setMemoryType(event.currentTarget.value)} />
    <Button type="button" disabled={!allowed || busy || !title.trim() || !body.trim() || !category.trim() || !memoryType.trim()}
      onClick={() => void create().catch((reason: unknown) => { setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)); })}>{busy ? "Saving…" : "Create"}</Button>
    {error && <p className="knowledge-inline-error" role="alert">{error}</p>}
  </details>;
}

function RenameCommunity({ community, controls, blocked, allowed, onRename }: {
  community: Community; controls: HostControls; blocked?: string; allowed: boolean;
  onRename: (community: Community, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(community.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { Button, Input } = controls;
  useEffect(() => setName(community.name ?? ""), [community.community_id, community.name]);
  return <form className="knowledge-rename-community" onSubmit={(event) => {
    event.preventDefault(); if (!allowed || busy || !name.trim()) return;
    setBusy(true); setError(null);
    void onRename(community, name.trim()).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  }}>
    <Input aria-label="Community name" value={name} disabled={!allowed || busy} onChange={(event) => setName(event.currentTarget.value)} />
    <Button type="submit" disabled={!allowed || busy || !name.trim()}>Rename</Button>
    {!allowed && <span className="knowledge-muted">{blocked ?? "Community rename is not granted."}</span>}
    {error && <span className="knowledge-inline-error" role="alert">{error}</span>}
  </form>;
}
