import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Community, Page } from "../../types";
import type { KnowledgeClient, KnowledgeScope } from "./client";
import { communityLabel } from "./knowledgeUi";

interface Props {
  client: KnowledgeClient;
  scope: KnowledgeScope;
  scopeControls: ReactNode;
  communities: Page<Community> | null;
  communitiesUnavailable: boolean;
  communityCursor: string | null;
  onCommunityPage: (cursor: string | null) => void;
  selectedCommunity: Community | null;
  selectedCommunityId: string | null;
  query: string;
  showArchived: boolean;
  listCount?: number;
  blocked?: string;
  canRename: boolean;
  onQuery: (value: string) => void;
  onShowArchived: (value: boolean) => void;
  onCommunity: (value: string | null) => void;
  onRename: (community: Community, name: string) => Promise<void>;
  onSaved: (memoryId: string) => void;
  onRefresh: () => void;
}

export function KnowledgeNavigation({ client, scope, scopeControls, communities, communitiesUnavailable,
  communityCursor, onCommunityPage, selectedCommunity, selectedCommunityId, query, showArchived, listCount, blocked,
  canRename, onQuery, onShowArchived, onCommunity, onRename, onSaved, onRefresh }: Props) {
  const { owner } = scope;
  return (
    <aside className="knowledge-nav" aria-label="Knowledge navigation">
      <div className="knowledge-heading">
        <span className="eyebrow">KNOWLEDGE</span><strong title={owner.display_label}>{owner.display_label}</strong>
        <span className="knowledge-muted">{owner.owner_kind} · {owner.capabilities.manage && !blocked ? "Manage" : "Read only"}</span>
      </div>
      {scopeControls}
      {blocked && <p className="knowledge-muted" role="note">{blocked}</p>}
      <input className="knowledge-search" type="search" aria-label="Search memories" value={query} maxLength={1024}
        placeholder="Search memories" onChange={event => onQuery(event.currentTarget.value)} />
      <CreateMemory client={client} scope={scope} blocked={blocked} onSaved={onSaved} />
      <label className="knowledge-check">
        <input type="checkbox" checked={showArchived} aria-label="Show non-active memories"
          onChange={event => onShowArchived(event.currentTarget.checked)} />Show archived
      </label>
      <button type="button" className={!selectedCommunityId ? "active" : ""} aria-pressed={!selectedCommunityId}
        onClick={() => onCommunity(null)}>
        <span>All memories</span>{listCount !== undefined && <small>{listCount}</small>}
      </button>
      <div className="knowledge-nav-label">Communities</div>
      {communitiesUnavailable && <p className="knowledge-muted" role="status">Community data is unavailable at this cut.</p>}
      {communities?.items.map(community => (
        <button key={community.community_id} type="button" aria-pressed={selectedCommunityId === community.community_id}
          className={selectedCommunityId === community.community_id ? "active" : ""}
          onClick={() => onCommunity(community.community_id)}>
          <span>{communityLabel(community)}</span><small>{community.member_count}</small>
        </button>
      ))}
      {(communityCursor !== null || Boolean(communities?.next_cursor)) && <div className="knowledge-list-pager" role="group" aria-label="Community pages">
        <button type="button" aria-label="First community page" disabled={communityCursor === null}
          onClick={() => onCommunityPage(null)}>First</button>
        <button type="button" aria-label="Next community page" disabled={!communities?.next_cursor}
          onClick={() => onCommunityPage(communities?.next_cursor ?? null)}>Next</button>
      </div>}
      {selectedCommunity && <RenameCommunity community={selectedCommunity} blocked={blocked} allowed={canRename} onRename={onRename} />}
      <button type="button" onClick={onRefresh}>Refresh owner data</button>
    </aside>
  );
}

function CreateMemory({ client, scope, blocked, onSaved }: {
  client: KnowledgeClient; scope: KnowledgeScope; blocked?: string; onSaved: (memoryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("fact");
  const [memoryType, setMemoryType] = useState("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = !blocked && scope.owner.owner_kind === "REL" && scope.owner.capabilities.view
    && scope.owner.capabilities.manage && scope.owner.capabilities.memory_create;
  const canCreate = allowed && !busy && title.trim() && content.trim() && category.trim() && memoryType.trim();

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.write(scope, "ui.memory_create", {
        title: title.trim(), body: content.trim(), category: category.trim(), memory_type: memoryType.trim(),
      }, null);
      if (result.status !== "ok") { setError(result.code); return; }
      setTitle("");
      setContent("");
      setOpen(false);
      onSaved(result.value.result.committed.memory.memory_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="knowledge-create" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>New Memory</summary>
      {!allowed && <p className="knowledge-muted">{blocked ?? "Memory creation is not granted for this owner."}</p>}
      <input aria-label="Memory title" placeholder="Title" value={title} disabled={!allowed || busy}
        onChange={event => setTitle(event.currentTarget.value)} />
      <textarea aria-label="Memory body" placeholder="Memory" value={content} disabled={!allowed || busy}
        onChange={event => setContent(event.currentTarget.value)} />
      <div>
        <input aria-label="Memory category" placeholder="Category" value={category} disabled={!allowed || busy}
          onChange={event => setCategory(event.currentTarget.value)} />
        <input aria-label="Memory type" placeholder="Type" value={memoryType} disabled={!allowed || busy}
          onChange={event => setMemoryType(event.currentTarget.value)} />
      </div>
      <button type="button" disabled={!canCreate} onClick={() => void create()}>{busy ? "Saving…" : "Create"}</button>
      {error && <p className="knowledge-inline-error" role="alert">{error}</p>}
    </details>
  );
}

function RenameCommunity({ community, blocked, allowed, onRename }: {
  community: Community; blocked?: string; allowed: boolean;
  onRename: (community: Community, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(community.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(community.name ?? ""), [community.community_id, community.name]);

  return (
    <form className="knowledge-rename-community" onSubmit={event => {
      event.preventDefault();
      if (!allowed || busy || !name.trim()) return;
      setBusy(true);
      setError(null);
      void onRename(community, name.trim()).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => setBusy(false));
    }}>
      <input aria-label="Community name" placeholder="Community name" value={name} disabled={!allowed || busy}
        onChange={event => setName(event.currentTarget.value)} />
      <button type="submit" disabled={!allowed || busy || !name.trim()}>Rename</button>
      {!allowed && <span className="knowledge-muted">{blocked ?? "Community rename is not granted."}</span>}
      {error && <span className="knowledge-inline-error" role="alert">{error}</span>}
    </form>
  );
}
