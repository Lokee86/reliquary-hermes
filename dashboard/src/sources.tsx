import { useEffect, useState } from "react";
import type { HostBoundary } from "./host";
import type { SetupStatus } from "../types";
import "./warlock-workflows.css";

const sourcesPath = "/sources-v1/";
const labels = {
  available: "Available", queued: "Queued", staged: "Staged", processing: "Processing",
  complete: "Complete", failed: "Failed", already_imported: "Already imported", unavailable: "Unavailable",
} as const;
type Status = keyof typeof labels;
interface SessionStatus { session_id: string; status: Status; reason: string | null; retryable: boolean }
interface Session extends SessionStatus {
  title: string; started_at: number; last_activity_at: number; message_count: number; project_name: string | null;
}
interface SessionPage {
  available: boolean; destinations: { owner_id: string; label: string }[]; sessions: Session[]; next_offset: number | null;
}

const pending = (status: Status) => status === "queued" || status === "staged" || status === "processing";
const canSelect = (row: SessionStatus) => row.status === "available" ||
  (row.retryable && (row.status === "failed" || row.status === "unavailable"));
const reasonLabels: Record<string, string> = {
  history_too_large: "This conversation exceeds the complete history import limit.",
  history_unsupported: "This conversation has history this host cannot export.",
  history_unavailable: "Hermes could not export the selected conversation.",
  source_capture_setup_required: "Reconnect Reliquary to enroll this Hermes profile for capture.",
  foreign_profile: "This conversation belongs to a different Hermes profile.",
  source_tombstoned: "This conversation was archived or deleted and cannot be imported.",
  already_imported: "A receipt already exists for this conversation.",
};
function describeReason(reason: string) {
  return Object.hasOwn(reasonLabels, reason) ? reasonLabels[reason] : "Reliquary could not complete this import.";
}
function isStatus(value: unknown): value is SessionStatus {
  const row = value as SessionStatus;
  return !!row && typeof row.session_id === "string" && !!row.session_id && Object.hasOwn(labels, row.status) &&
    (row.reason === null || typeof row.reason === "string") && typeof row.retryable === "boolean";
}
function readPage(value: unknown): SessionPage {
  const page = value as SessionPage;
  if (!page || typeof page.available !== "boolean" || !Array.isArray(page.sessions) || page.sessions.length > 16 ||
      !Array.isArray(page.destinations) ||
      (page.next_offset !== null && (!Number.isSafeInteger(page.next_offset) || page.next_offset < 0)) ||
      page.destinations.some(row => !row || typeof row.owner_id !== "string" || typeof row.label !== "string") ||
      page.sessions.some(row => !isStatus(row) || typeof row.title !== "string" ||
        !Number.isFinite(row.started_at) || !Number.isFinite(row.last_activity_at) ||
        !Number.isSafeInteger(row.message_count) || row.message_count < 0 ||
        !(row.project_name === null || typeof row.project_name === "string"))) throw new Error("invalid_source_page");
  return page;
}
function readStatuses(value: unknown, ids: readonly string[]) {
  const rows = (value as { sessions?: unknown[] } | null)?.sessions;
  if (!Array.isArray(rows) || rows.length !== ids.length ||
      !rows.every(isStatus) || new Set(rows.map(row => row.session_id)).size !== ids.length ||
      rows.some(row => !ids.includes(row.session_id))) throw new Error("invalid_source_status");
  return rows;
}

export function Sources({ host, readOnly, captureStatus }: {
  host: HostBoundary; readOnly?: string; captureStatus: SetupStatus["capture_status"];
}) {
  const { Button, Input, Checkbox, Select } = host.controls;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ q: "", offset: 0 });
  const [page, setPage] = useState<SessionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [poll, setPoll] = useState(0);
  const [lifetime, setLifetime] = useState<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLifetime(controller);
    return () => controller.abort();
  }, [host]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected([]);
    setReview(false);
    setPage(null);
    host.json(sourcesPath + "sessions?" + new URLSearchParams({
      offset: String(search.offset), q: search.q,
    }), { signal: controller.signal }).then(value => {
      const result = readPage(value);
      if (controller.signal.aborted) return;
      setPage(result);
      setStatuses(Object.fromEntries(result.sessions.map(row => [row.session_id, row])));
      setPoll(result.sessions.some(row => pending(row.status)) ? 1 : 0);
      setDestinationId(current => result.destinations.some(row => row.owner_id === current) ? current : "");
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load Hermes conversations. Refresh and try again.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [host, open, search]);

  useEffect(() => {
    if (!open || !poll || busy) return;
    const controller = new AbortController();
    const ids = Object.values(statuses).filter(row => pending(row.status)).slice(0, 8).map(row => row.session_id);
    if (!ids.length) { setPoll(0); return; }
    const timer = setTimeout(async () => {
      try {
        const reply = await host.json(sourcesPath + "status", { method: "POST", body: { session_ids: ids }, signal: controller.signal });
        const rows = readStatuses(reply, ids);
        if (!controller.signal.aborted) setStatuses(current => ({
          ...current, ...Object.fromEntries(rows.map(row => [row.session_id, row])),
        }));
      } catch {
        // The bounded polling budget still applies to transient failures.
      } finally {
        if (!controller.signal.aborted) setPoll(current => current < 29 ? current + 1 : 0);
      }
    }, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [host, open, statuses, poll, busy]);

  const destination = page?.destinations.find(row => row.owner_id === destinationId);
  async function submit() {
    if (busy || readOnly || !destination || !selected.length || !lifetime || !review) return;
    setBusy(true);
    setError("");
    try {
      const result = await host.json(sourcesPath + "import", { method: "POST",
        body: { session_ids: selected, owner_id: destination.owner_id, confirm: true }, signal: lifetime.signal });
      const rows = readStatuses(result, selected);
      if (lifetime.signal.aborted) return;
      setStatuses(current => ({ ...current, ...Object.fromEntries(rows.map(row => [row.session_id, row])) }));
      setSelected([]);
      setReview(false);
      if (rows.some(row => pending(row.status))) setPoll(1);
    } catch {
      if (!lifetime.signal.aborted) setError("Import could not be confirmed. Refresh status before retrying.");
    } finally {
      if (!lifetime.signal.aborted) setBusy(false);
    }
  }

  return <section className="knowledge-panel" aria-label="Sources">
    <aside className="knowledge-nav" aria-label="Sources navigation">
      <div className="knowledge-heading"><span className="eyebrow">SOURCES</span><strong>Conversation imports</strong></div>
      {captureStatus && <section className="knowledge-inspector-section">
        <h3>Automatic capture</h3>
        <p className="knowledge-muted">{captureStatus === "enrolled" ? "Automatic capture is enrolled for this profile."
          : captureStatus === "setup_required" ? "Connect Reliquary in Setup to enroll this profile for automatic capture."
          : "Automatic capture is unavailable on this Hermes build."}</p>
      </section>}
      <p className="knowledge-muted">Choose existing Hermes conversations and explicitly import them into an authorized REL.</p>
      {!open ? <Button className="add-scope warlock-workflow-toggle" onClick={() => setOpen(true)}>Import Existing Sessions</Button>
        : <Button className="add-scope warlock-workflow-toggle" disabled={busy} onClick={() => { setOpen(false); setReview(false); }}>Close import</Button>}
      {readOnly && <p role="note" className="knowledge-muted">{readOnly}</p>}
    </aside>
    <main className="knowledge-memory-list warlock-workflow-center" aria-label="Hermes conversations">
      <header>
        <div><h2>Import Existing Sessions</h2><span>Browse and review conversations before import.</span></div>
        {open && <form className="warlock-source-search" onSubmit={event => {
          event.preventDefault(); if (!review && !busy) setSearch({ q: query.trim(), offset: 0 });
        }}>
          <label className="knowledge-search-label">Search conversations
            <Input value={query} maxLength={128} disabled={review || busy} onChange={event => setQuery(event.currentTarget.value)} />
          </label>
          <Button type="submit" disabled={review || busy}>Search</Button>
          <Button type="button" className="secondary" disabled={review || busy} onClick={() => setSearch({ ...search })}>Refresh</Button>
        </form>}
      </header>
      <div className="knowledge-memory-rows">
        {loading && <p className="knowledge-state" role="status">Loading Hermes conversations…</p>}
        {!open && <p className="knowledge-state">Open the import workflow to browse available conversations.</p>}
        {open && page && !page.available && <p role="note" className="knowledge-state">Session import is unavailable on this Hermes build.</p>}
        {open && page?.available && <>
          {!page.sessions.length && <p className="knowledge-state">No conversations on this page.</p>}
          <ul className="warlock-source-list">{page.sessions.map(row => {
            const status = statuses[row.session_id] ?? row;
            return <li key={row.session_id} className="knowledge-memory-row warlock-source-row">
              {!readOnly && !review && <Checkbox aria-label={"Select " + row.title}
                checked={selected.includes(row.session_id)} disabled={busy || !canSelect(status)}
                onCheckedChange={checked => setSelected(current => checked
                  ? current.length < 8 && !current.includes(row.session_id) ? [...current, row.session_id] : current
                  : current.filter(id => id !== row.session_id))} />}
              <div>
                <strong>{row.title}</strong>
                <span>{labels[status.status]} · {row.message_count} messages{row.project_name && " · " + row.project_name}</span>
                <small className="warlock-source-id">{row.session_id}</small>
                <span>Created {new Date(row.started_at * 1000).toLocaleString()} · Last activity {new Date(row.last_activity_at * 1000).toLocaleString()}</span>
                {status.reason && <span>{describeReason(status.reason)}</span>}
              </div>
            </li>;
          })}</ul>
          <div className="warlock-workflow-actions">
            <Button className="secondary" disabled={review || search.offset === 0} onClick={() => setSearch({ ...search, offset: Math.max(0, search.offset - 16) })}>Previous page</Button>
            <Button className="secondary" disabled={review || page.next_offset === null} onClick={() => {
              if (page.next_offset !== null) setSearch({ ...search, offset: page.next_offset });
            }}>Next page</Button>
            {!review && !readOnly && <Button disabled={!destination || !selected.length} onClick={() => setReview(true)}>Review selected ({selected.length})</Button>}
          </div>
          {poll > 0 && <p role="status" className="knowledge-muted">Refreshing import status…</p>}
        </>}
      </div>
    </main>
    <aside className="knowledge-inspector" aria-label="Import review">
      <span className="eyebrow">IMPORT</span>
      {open && page?.available && <>
        <label className="warlock-source-destination">Import destination
          <Select label="Import destination" value={destinationId} disabled={!!readOnly || review || busy}
            onValueChange={setDestinationId} options={[{ value: "", label: "Choose an authorized REL" },
              ...page.destinations.map(row => ({ value: row.owner_id, label: row.label }))]} />
        </label>
        <section className="knowledge-inspector-section">
          <h3>Selection</h3><p>{selected.length} of 8 conversations selected</p>
          {destination && <p className="knowledge-provenance">Destination: {destination.label}</p>}
        </section>
        {review && destination && <section className="knowledge-inspector-section" aria-label="Review import">
          <h3>Review import</h3>
          <p>Import {selected.length} selected {selected.length === 1 ? "conversation" : "conversations"} into {destination.label}?</p>
          <ul className="warlock-source-review-list">{page.sessions.filter(row => selected.includes(row.session_id)).map(row => <li key={row.session_id}>{row.title}</li>)}</ul>
          <div className="warlock-workflow-actions">
            <Button disabled={busy} onClick={() => void submit()}>{busy ? "Importing…" : "Import selected"}</Button>
            <Button className="secondary" disabled={busy} onClick={() => setReview(false)}>Cancel</Button>
          </div>
        </section>}
      </>}
      {error && <p role="alert" className="knowledge-inline-error">{error}</p>}
      {busy && <p role="status">Importing selected conversations…</p>}
      {!open && <p className="knowledge-muted">Select conversations to review an authorized import.</p>}
    </aside>
  </section>;
}
