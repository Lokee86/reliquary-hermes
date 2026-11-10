import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Community, MemoryDetail, MemorySummary, ReadResults } from "../../types";
import type { HostControls } from "../host";
import type { KnowledgeClient, KnowledgeScope } from "./client";
import { KnowledgeRelationsEditor } from "./KnowledgeRelationsEditor";
import { communityLabel, shortId } from "./knowledgeUi";

interface Props {
  client: KnowledgeClient;
  scope: KnowledgeScope;
  memoryId: string | null;
  communities: Community[];
  controls: HostControls;
  blocked?: string;
  writable: boolean;
  onChanged: (memoryId?: string) => void;
  onOpenMemory: (memoryId: string) => void;
  onError: (error: string | null) => void;
}

export function KnowledgeInspector({ client, scope, memoryId, communities, controls, blocked, writable, onChanged, onOpenMemory, onError }: Props) {
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [currentRevision, setCurrentRevision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const revisionRequest = useRef<AbortController | null>(null);
  const memory = detail?.memory;
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

  async function loadDetail(id: string, target: string | null, signal: AbortSignal) {
    const next = await client.read(scope, "ui.memory_detail", { memory_id: id, revision: target }, signal);
    const evidence = scope.owner.capabilities.provenance
      ? await client.read(scope, "ui.provenance", { memory_id: id, revision: next.body.revision }, signal)
      : null;
    signal.throwIfAborted();
    setDetail(next);
    setProvenance(evidence);
    setTitle(next.memory.title ?? "");
    setBody(next.body.content ?? "");
    if (target === null) setCurrentRevision(next.body.revision);
    setRevision(target);
    setEditing(false);
    return next;
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setError(null);
    if (memoryId) void Promise.all([
      loadDetail(memoryId, null, controller.signal),
      scope.owner.capabilities.history
        ? client.read(scope, "ui.memory_history", { memory_id: memoryId, cursor: null, limit: 20 }, controller.signal)
        : Promise.resolve(null),
    ]).then(([, page]) => {
      if (controller.signal.aborted) return;
      setHistory(page?.revisions.items.map(item => item.revision) ?? []);
      setHistoryNext(page?.revisions.next_cursor ?? null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open this Memory.");
    });
    return () => { controller.abort(); revisionRequest.current?.abort(); };
  }, [client, scope, memoryId]);

  async function openRevision(nextRevision: string | null) {
    if (!memoryId) return;
    revisionRequest.current?.abort();
    const controller = new AbortController();
    revisionRequest.current = controller;
    setError(null);
    try {
      await loadDetail(memoryId, nextRevision, controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open this revision.");
    }
  }

  async function loadNextHistory() {
    if (!memory || !historyNext) return;
    try {
      const page = await client.read(scope, "ui.memory_history", { memory_id: memory.memory_id, cursor: historyNext, limit: 20 }, lifetime.current?.signal);
      setHistory((items) => [...items, ...page.revisions.items.map((item) => item.revision)]);
      setHistoryNext(page.revisions.next_cursor);
      setHistoryCursor(historyNext);
    } catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function save() {
    if (!memory || !detail || !writable || blocked || !scope.owner.capabilities.memory_edit || !title.trim() || !body.trim()) return;
    const signal = lifetime.current?.signal;
    setBusy(true);
    setError(null);
    try {
      const result = await client.write(scope, "ui.memory_edit", {
        memory_id: memory.memory_id, title: title.trim(), body: body.trim(),
      }, detail.body.revision, signal);
      signal?.throwIfAborted();
      if (result.status !== "ok") { setError(result.code); return; }
      setEditing(false);
      onChanged(result.value.result.committed.replacement.memory.memory_id);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not save this replacement.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  if (!memoryId) return <aside className="knowledge-inspector"><div className="knowledge-state">Select a memory.</div></aside>;
  if (!detail || !memory) return <aside className="knowledge-inspector" aria-label="Memory inspector">
    {error ? <p className="knowledge-inline-error" role="alert">{error}</p>
      : <div className="knowledge-state">Loading detail, history, and provenance…</div>}
  </aside>;

  const community = communities.find((candidate) => candidate.community_id === memory.community_id) ?? null;
  const content = detail.body.content ?? "Memory body is unavailable at this revision.";
  const archived = memory.lifecycle !== "active";
  const canEdit = writable && !blocked && !archived && revision === null && scope.owner.capabilities.memory_edit
    && detail.body.availability === "available" && detail.body.body_id !== null;

  return (
    <aside className="knowledge-inspector" aria-label="Memory inspector">
      <div className="knowledge-inspector-title-row"><div><div className="eyebrow">MEMORY</div><h2>{memory.title || "Untitled memory"}</h2>
        {error && <p className="knowledge-inline-error" role="alert">{error}</p>}</div>
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
          onClick={() => void openRevision(item)}>{item === currentRevision ? "Latest" : shortId(item)}{item === detail.body.revision ? " · selected" : ""}</Button>)}</div>
        {historyNext && <Button type="button" onClick={() => void loadNextHistory()}>Load older revisions</Button>}
        {historyCursor && <span className="knowledge-muted">History is paged; additional revisions are available above.</span>}
        </>}
      </section>

      {detail.superseded_by && <Button type="button" onClick={() => onOpenMemory(detail.superseded_by!)}>
        Open replacement
      </Button>}
      {detail.superseded_by && <RetirementForm client={client} scope={scope} memory={memory}
        canRetire={revision === null && writable && !blocked && scope.owner.capabilities.memory_retire && detail.body.availability === "available"}
        blocked={blocked} controls={controls} onChanged={onChanged} onError={onError} />}
      {!archived && revision === null && <KnowledgeRelationsEditor client={client} scope={scope} memory={memory} controls={controls} blocked={blocked} onChanged={onChanged} onError={onError} />}
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

function RetirementForm({ client, scope, memory, canRetire, blocked, controls, onChanged, onError }: {
  client: KnowledgeClient;
  scope: KnowledgeScope;
  memory: MemorySummary;
  canRetire: boolean;
  blocked?: string;
  controls: HostControls;
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { Button, Checkbox } = controls;
  if (memory.lifecycle !== "superseded") return null;
  async function retire() {
    if (!canRetire || !confirmed || busy) return;
    setBusy(true);
    const result = await client.write(scope, "ui.memory_retire", {
      memory_id: memory.memory_id,
      effect: "retire",
    }, memory.revision);
    setBusy(false);
    if (result.status !== "ok") { onError(result.code); return; }
    onChanged();
  }

  return <section className="knowledge-inspector-section" aria-label="Memory retirement">
    <h3>Retirement</h3>
    <p className="knowledge-muted">This superseded Memory can be retired after Hermes verifies its replacement from the current owner cut.</p>
    {!canRetire && <p className="knowledge-muted" role="status">{blocked ?? "Memory retirement is not granted for this owner."}</p>}
    <label className="knowledge-check"><Checkbox checked={confirmed} disabled={!canRetire || busy}
      aria-label="Confirm terminal retirement" onCheckedChange={setConfirmed} />Confirm terminal retirement of this revision</label>
    <Button type="button" disabled={!canRetire || !confirmed || busy} onClick={() => void retire()}>
      {busy ? "Retiring…" : "Retire superseded Memory"}
    </Button>
  </section>;
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
