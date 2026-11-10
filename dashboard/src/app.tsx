import { useCallback, useEffect, useMemo, useState } from "react";
import type { OwnerBinding, ReadResults, SetupStatus } from "../types";
import { createGraphTransport } from "./host";
import type { HostBoundary } from "./host";
import { KnowledgePanel } from "./knowledge/KnowledgePanel";
import { createKnowledgeClient } from "./knowledge/client";
import { Setup, desktopMutationNotice, loadSetupStatus, setupError } from "./setup";
import { Sources } from "./sources";

type Section = "Knowledge" | "Sources" | "Setup";
const sections: Section[] = ["Knowledge", "Sources", "Setup"];

export function ReliquaryApp({ host }: { host: HostBoundary }) {
  const { Button } = host.controls;
  const [section, setSection] = useState<Section>("Knowledge");
  const [attempt, setAttempt] = useState(0);
  const [setup, setSetup] = useState<{ attempt: number; status?: SetupStatus; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadSetupStatus(host.json, controller.signal).then(status => {
      if (!controller.signal.aborted) setSetup({ attempt, status });
    }, error => {
      if (!controller.signal.aborted) setSetup({ attempt, error: setupError(error) });
    });
    return () => controller.abort();
  }, [host, attempt]);
  const current = setup?.attempt === attempt ? setup : null;
  const status = current?.status;
  const active = status && !status.configured ? "Setup" : section;
  const readOnly = status && desktopMutationNotice(host.surface, status);
  function connected() {
    setSection("Knowledge");
    setAttempt(value => value + 1);
  }
  return <section className="rly-app" aria-label="Reliquary">
    <header className="rly-app-header">
      <div className="rly-app-title"><span className="rly-overline">Hermes {host.surface}</span><h1>Reliquary</h1></div>
      <nav className="rly-actions" aria-label="Reliquary sections">{sections.map(item =>
        <Button key={item} type="button" aria-pressed={active === item} disabled={!status || (!status.configured && item !== "Setup")}
          onClick={() => setSection(item)}>{item}</Button>)}</nav>
    </header>
    {readOnly && <p className="rly-notice" role="note">{readOnly}</p>}
    {!current && <p className="rly-section" role="status">Checking this Hermes profile…</p>}
    {current?.error && <div className="rly-section" role="alert"><p>{current.error}</p>
      <Button onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
    {status && active === "Setup" && <Setup host={host} status={status} readOnly={readOnly} onConnected={connected} />}
    {status?.configured && active === "Sources" && <Sources host={host} readOnly={readOnly} captureStatus={status.capture_status} />}
    {status?.configured && active === "Knowledge" && <Knowledge host={host} mutationBlocked={readOnly} />}
  </section>;
}

function Knowledge({ host, mutationBlocked }: { host: HostBoundary; mutationBlocked?: string }) {
  const { Button, Input } = host.controls;
  const client = useMemo(() => createKnowledgeClient(host.json), [host.json]);
  const [draftSession, setDraftSession] = useState("");
  const [session, setSession] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const [attempt, setAttempt] = useState(0);
  const [preferred, setPreferred] = useState<{ ownerId?: string; memoryId?: string; includeArchived: boolean; view?: "list" | "graph" }>();
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
  function refresh(memoryId?: string, includeArchived = false, view?: "list" | "graph") {
    setPreferred({ ownerId: owner?.owner_id, memoryId, includeArchived, view });
    setAttempt(value => value + 1);
  }

  return <div className="rly-workspace">
    <aside className="rly-rail" aria-label="Owner scope">
      <span className="rly-overline">Scope</span>
      <h2>Owners</h2>
      {owners.map(item => <Button key={item.owner_id} aria-pressed={item.owner_id === owner?.owner_id}
        className="rly-owner-link" onClick={() => { setPreferred(undefined); setSelection(item.owner_id); }}>
        <span className="rly-owner-kind">{item.owner_kind}</span><span>{item.display_label}</span>
      </Button>)}
      {topology?.owners.next_cursor && <Button type="button" onClick={() => {
        setCursors(items => [...items, topology.owners.next_cursor]);
      }}>Next owners</Button>}
      {cursors.length > 1 && <Button type="button" onClick={() => setCursors(items => items.slice(0, -1))}>Previous owners</Button>}
      {owner && <dl className="rly-scope-details">
        <dt>Owner ID</dt><dd>{owner.owner_id}</dd>
        <dt>Access</dt><dd>{owner.capabilities.manage && !mutationBlocked ? "Manage" : "Read only"}</dd>
        {topology?.active_session_id && <><dt>Session</dt><dd>{topology.active_session_id}</dd></>}
      </dl>}
      <details className="rly-session-scope">
        <summary>Find a session owner</summary>
        <form onSubmit={event => {
          event.preventDefault();
          setSelection(null); setCursors([null]); setSession(draftSession.trim() || null); refresh();
        }}>
          <label className="rly-field">Hermes session ID
            <Input value={draftSession} maxLength={128} autoComplete="off"
              onChange={event => setDraftSession(event.currentTarget.value)} />
          </label>
          <Button type="submit" size="sm">Look up session</Button>
        </form>
      </details>
      <Button size="sm" onClick={() => refresh()}>Refresh owners</Button>
    </aside>
    <main className="rly-workspace-main" aria-label="Knowledge">
      {!current && <p className="rly-section" role="status">Loading owners…</p>}
      {current?.error && <p className="rly-section" role="alert">{current.error}</p>}
      {topology && !owner && <p className="rly-section">There are no authorized owners on this page.</p>}
      {owner && <KnowledgePanel key={JSON.stringify([owner.owner_id, owner.generation, owner.cut, sessionId])}
        owner={owner} sessionId={sessionId} transport={host.json} controls={host.controls}
        graphTransportFor={graphTransportFor} mutationBlocked={mutationBlocked} onOwnerRefresh={refresh}
        initialMemoryId={preferred?.ownerId === owner.owner_id ? preferred.memoryId : undefined}
        initialView={preferred?.ownerId === owner.owner_id ? preferred.view : undefined}
        includeArchived={preferred?.ownerId === owner.owner_id && preferred.includeArchived} />}
    </main>
  </div>;
}
