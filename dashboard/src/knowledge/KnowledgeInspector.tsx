import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { Community, MemoryDetail, MemorySummary, ReadResults } from "../../types";
import type { HostControls } from "../host";
import type { KnowledgeClient, KnowledgeScope } from "./client";
import { KnowledgeRelationsEditor } from "./KnowledgeRelationsEditor";
import { communityLabel, shortId } from "./knowledgeUi";

interface Props {
  client: KnowledgeClient;
  scope: KnowledgeScope;
  memory: MemorySummary | null;
  communities: Community[];
  controls: HostControls;
  blocked?: string;
  writable: boolean;
  onChanged: () => void;
  onError: (error: string | null) => void;
}

export function KnowledgeInspector({ client, scope, memory, communities, controls, blocked, writable, onChanged, onError }: Props) {
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyNext, setHistoryNext] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<ReadResults["ui.provenance"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { Button, Input, Textarea } = controls;

  useEffect(() => {
    setDetail(null); setHistory([]); setHistoryCursor(null); setHistoryNext(null); setRevision(null);
    setProvenance(null); setEditing(false); onError(null);
    if (!memory) return;
    const controller = new AbortController();
    void Promise.all([
      client.read(scope, "ui.memory_detail", { memory_id: memory.memory_id, revision: null }, controller.signal),
      scope.owner.capabilities.history
        ? client.read(scope, "ui.memory_history", { memory_id: memory.memory_id, cursor: null, limit: 20 }, controller.signal)
        : Promise.resolve(null),
      scope.owner.capabilities.provenance
        ? client.read(scope, "ui.provenance", { memory_id: memory.memory_id, revision: memory.revision }, controller.signal)
        : Promise.resolve(null),
    ]).then(([nextDetail, nextHistory, nextProvenance]) => {
      if (controller.signal.aborted) return;
      setDetail(nextDetail); setTitle(nextDetail.memory.title ?? "");
      setBody(nextDetail.body.content ?? "");
      setHistory(nextHistory?.revisions.items.map((item) => item.revision) ?? []);
      setHistoryNext(nextHistory?.revisions.next_cursor ?? null);
      setProvenance(nextProvenance);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) onError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [client, scope, memory?.memory_id, memory?.revision]);

  async function openRevision(nextRevision: string | null) {
    if (!memory) return;
    const controller = new AbortController();
    try {
      const value = await client.read(scope, "ui.memory_detail", { memory_id: memory.memory_id, revision: nextRevision }, controller.signal);
      setDetail(value); setRevision(nextRevision);
      setTitle(value.memory.title ?? ""); setBody(value.body.content ?? "");
    } catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function loadNextHistory() {
    if (!memory || !historyNext) return;
    try {
      const page = await client.read(scope, "ui.memory_history", { memory_id: memory.memory_id, cursor: historyNext, limit: 20 });
      setHistory((items) => [...items, ...page.revisions.items.map((item) => item.revision)]);
      setHistoryNext(page.revisions.next_cursor);
      setHistoryCursor(historyNext);
    } catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function save() {
    if (!memory || !detail || !writable || blocked || !scope.owner.capabilities.memory_edit || !title.trim() || !body.trim()) return;
    setBusy(true);
    const createdAt = String(Math.floor(Date.now() / 1000) * 1_000_000_000);
    const key = globalThis.crypto?.randomUUID?.() ?? `edit-${Date.now()}`;
    const result = await client.write(scope, "ui.memory_edit", {
      memory_id: memory.memory_id, title: title.trim(), body: body.trim(),
      expected_body_id: detail.body.body_id, created_at_ns: createdAt,
    }, detail.body.revision, key);
    setBusy(false);
    if (result.status !== "ok") { onError(result.code); return; }
    setEditing(false); onChanged();
  }

  if (!memory) return <aside className="knowledge-inspector"><div className="knowledge-state">Select a memory.</div></aside>;
  if (!detail) return <aside className="knowledge-inspector" aria-label="Memory inspector"><div className="knowledge-state">Loading detail, history, and provenance…</div></aside>;

  const community = communities.find((candidate) => candidate.community_id === memory.community_id) ?? null;
  const content = detail.body.content ?? "Memory body is unavailable at this revision.";
  const archived = memory.lifecycle !== "active";
  const canEdit = writable && !blocked && !archived && scope.owner.capabilities.memory_edit && detail.body.availability === "available";

  return (
    <aside className="knowledge-inspector" aria-label="Memory inspector">
      <div className="knowledge-inspector-title-row"><div><div className="eyebrow">MEMORY</div><h2>{memory.title || "Untitled memory"}</h2></div>
        {canEdit && <Button type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel" : "Edit"}</Button>}
      </div>
      {editing ? <div className="knowledge-edit-memory">
        <Input aria-label="Replacement title" value={title} maxLength={128} disabled={busy} onChange={(event) => setTitle(event.currentTarget.value)} />
        <Textarea aria-label="Replacement body" value={body} maxLength={32768} rows={7} disabled={busy}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBody(event.currentTarget.value)} />
        <Button type="button" disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save replacement"}</Button>
        <p className="knowledge-muted">This creates a revisioned replacement and preserves the original Memory and its provenance.</p>
      </div> : <p className="knowledge-memory-body">{content}</p>}

      <dl className="knowledge-details">
        <div><dt>Lifecycle</dt><dd>{memory.lifecycle}</dd></div>
        <div><dt>Type</dt><dd>{memory.category} · {memory.memory_type}</dd></div>
        <div><dt>Revision</dt><dd>{detail.body.revision}{revision ? " · historical" : " · current"}</dd></div>
        <div><dt>Community</dt><dd>{community ? communityLabel(community) : "—"}</dd></div>
        <div><dt>Memory ID</dt><dd>{memory.memory_id}</dd></div>
      </dl>

      <section className="knowledge-inspector-section" aria-label="Memory history">
        <h3>History</h3>
        {!scope.owner.capabilities.history ? <p className="knowledge-muted">History access is not granted for this owner.</p> : <>
        <Button type="button" disabled={!revision} onClick={() => void openRevision(null)}>Current revision</Button>
        <div className="knowledge-history-list">{history.map((item) => <Button key={item} type="button" aria-pressed={item === detail.body.revision}
          onClick={() => void openRevision(item)}>{item === memory.revision ? "Latest" : shortId(item)}{item === detail.body.revision ? " · selected" : ""}</Button>)}</div>
        {historyNext && <Button type="button" onClick={() => void loadNextHistory()}>Load older revisions</Button>}
        {historyCursor && <span className="knowledge-muted">History is paged; additional revisions are available above.</span>}
        </>}
      </section>

      {!archived && <KnowledgeRelationsEditor client={client} scope={scope} memory={memory} controls={controls} blocked={blocked} onChanged={onChanged} onError={onError} />}
      <section className="knowledge-inspector-section" aria-label="Memory provenance">
        <h3>Provenance</h3>
        {!scope.owner.capabilities.provenance ? <p className="knowledge-muted">Provenance access is not granted for this owner.</p>
          : !provenance ? <p className="knowledge-muted">Loading source evidence…</p> : provenance.sources.length === 0
          ? <p className="knowledge-muted">No source evidence is attached.</p>
          : provenance.sources.map((source, index) => <ProvenanceItem key={`${source.kind}:${index}`} source={source} />)}
      </section>
      {blocked && <p className="knowledge-muted" role="status">{blocked}</p>}
    </aside>
  );
}

function ProvenanceItem({ source }: { source: MemoryDetail["provenance"][number] }) {
  if (source.kind === "hermes_snapshot") return <div className="knowledge-source-turn">
    <strong>Hermes snapshot · {source.profile_namespace}</strong>
    <span>Session {shortId(source.session_id)} · Message {shortId(source.message_uid)}</span>
    <span>Revision {source.source_revision ?? "unavailable"} · Digest {shortId(source.content_digest)}</span>
    {source.range && <span>{source.range.text}</span>}
  </div>;
  if (source.kind === "user_origin") return <div className="knowledge-source-turn"><strong>Created by user</strong><span>Principal {shortId(source.principal_id)} · {source.created_at_ms}</span></div>;
  return <div className="knowledge-source-turn"><strong>Source unavailable</strong><span>{source.reason}</span></div>;
}
