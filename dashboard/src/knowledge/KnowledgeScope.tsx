import { useCallback, useEffect, useMemo, useState } from "react";
import type { OwnerBinding, ReadResults } from "../../types";
import { createGraphTransport } from "../host";
import type { HostBoundary } from "../host";
import { KnowledgePanel, type ViewMode } from "./KnowledgePanel";
import { createKnowledgeClient } from "./client";

export function KnowledgeScope({ host, mutationBlocked }: { host: HostBoundary; mutationBlocked?: string }) {
  const { Button, Input } = host.controls;
  const client = useMemo(() => createKnowledgeClient(host.json), [host.json]);
  const [draftSession, setDraftSession] = useState("");
  const [session, setSession] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const [attempt, setAttempt] = useState(0);
  const [preferred, setPreferred] = useState<{ ownerId?: string; memoryId?: string; includeArchived: boolean; view?: ViewMode }>();
  const [snapshot, setSnapshot] = useState<{
    key: string; value?: ReadResults["ui.owner_sessions"]; error?: string;
  } | null>(null);
  const key = JSON.stringify([session, cursor, attempt]);
  const graphTransportFor = useCallback((owner: OwnerBinding, sessionId: string | null, signal?: AbortSignal) =>
    createGraphTransport(host, owner, sessionId, signal), [host]);

  useEffect(() => {
    const controller = new AbortController();
    client.ownerSessions(session, cursor, controller.signal).then(value => {
      if (!controller.signal.aborted) setSnapshot({ key, value });
    }, () => {
      if (!controller.signal.aborted) setSnapshot({ key, error: "Could not load the authorized owner bindings." });
    });
    return () => controller.abort();
  }, [client, session, cursor, key]);

  const current = snapshot?.key === key ? snapshot : null;
  const topology = current?.value;
  const owners = topology?.owners.items.filter(owner => owner.capabilities.view &&
    (owner.owner_kind === "REL" || owner.owner_id === topology.active_phy_id)) ?? [];
  const mapped = owners.find(owner => owner.owner_id === topology?.session_owner_id && owner.owner_kind === "REL");
  const owner = owners.find(item => item.owner_id === selection) ?? mapped ??
    owners.find(item => item.owner_kind === "REL") ?? owners[0];
  const sessionId = owner && mapped?.owner_id === owner.owner_id ? topology?.active_session_id ?? null : null;

  function refresh(memoryId?: string, includeArchived = false, view?: ViewMode) {
    setPreferred({ ownerId: owner?.owner_id, memoryId, includeArchived, view });
    setAttempt(value => value + 1);
  }

  const scopeControls = <details className="scope-options">
    <summary className="add-scope">Scope Options</summary>
    <div className="open-scopes" role="group" aria-label="Owner scope">
      {owners.map(item => <button key={item.owner_id} type="button" aria-pressed={item.owner_id === owner?.owner_id}
        className={item.owner_id === owner?.owner_id ? "scope-chip selected" : "scope-chip"}
        onClick={() => { setPreferred(undefined); setSelection(item.owner_id); }}>
        <strong>{item.display_label}</strong><span>{item.owner_kind}</span>
      </button>)}
      {(topology?.owners.next_cursor || cursors.length > 1) && <div className="scope-control-actions">
        {cursors.length > 1 && <Button type="button" onClick={() => setCursors(items => items.slice(0, -1))}>Previous owners</Button>}
        {topology?.owners.next_cursor && <Button type="button" onClick={() =>
          setCursors(items => [...items, topology.owners.next_cursor])}>Next owners</Button>}
      </div>}
      {owner && <dl className="knowledge-details">
        <div><dt>Owner ID</dt><dd>{owner.owner_id}</dd></div>
        <div><dt>Access</dt><dd>{owner.capabilities.manage && !mutationBlocked ? "Manage" : "Read only"}</dd></div>
        {topology?.active_session_id && <div><dt>Session</dt><dd>{topology.active_session_id}</dd></div>}
      </dl>}
      <details className="scope-session">
        <summary>Find a session owner</summary>
        <form className="scope-controls" onSubmit={event => {
          event.preventDefault();
          setPreferred(undefined);
          setSelection(null);
          setCursors([null]);
          setSession(draftSession.trim() || null);
          setAttempt(value => value + 1);
        }}>
          <label>Hermes session ID
            <Input value={draftSession} maxLength={128} autoComplete="off"
              onChange={event => setDraftSession(event.currentTarget.value)} />
          </label>
          <div className="scope-control-actions"><Button type="submit">Look up session</Button></div>
        </form>
      </details>
    </div>
  </details>;

  if (owner) return <KnowledgePanel key={JSON.stringify([owner.owner_id, owner.generation, owner.cut, sessionId, attempt])}
    owner={owner} sessionId={sessionId} transport={host.json} controls={host.controls} scopeControls={scopeControls}
    graphTransportFor={graphTransportFor} mutationBlocked={mutationBlocked} onOwnerRefresh={refresh}
    initialMemoryId={preferred?.ownerId === owner.owner_id ? preferred.memoryId : undefined}
    initialView={preferred?.ownerId === owner.owner_id ? preferred.view : undefined}
    includeArchived={preferred?.ownerId === owner.owner_id && preferred.includeArchived} />;

  return <section className="knowledge-panel" aria-label="Knowledge">
    <aside className="knowledge-nav" aria-label="Knowledge navigation">
      <div className="knowledge-heading"><span className="eyebrow">KNOWLEDGE</span></div>
      {current && scopeControls}
      <button type="button" onClick={() => refresh()}>Refresh owner data</button>
    </aside>
    <section className="knowledge-memory-list" aria-label="Memory list">
      <header><strong>Memories</strong></header>
      {!current && <p className="knowledge-state" role="status">Loading owners…</p>}
      {current?.error && <p className="knowledge-state error" role="alert">{current.error}</p>}
      {topology && <p className="knowledge-state">There are no authorized owners on this page.</p>}
    </section>
    <aside className="knowledge-inspector" aria-label="Memory inspector">
      <div className="eyebrow">MEMORY</div>
    </aside>
  </section>;
}
