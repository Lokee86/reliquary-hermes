import { useEffect, useState } from "react";
import type { OwnerBinding } from "../../types";
import type { HostControls, JsonTransport } from "../host";

type ByteId = number[];
type Priority = "High" | "Normal" | "Low";
type Pin = { id: ByteId; revision: number; text: string; priority: Priority };
type Identity = { id: ByteId; revision: number; name: string; text: string };
type Selection = { id: ByteId | null; revision: number };
type Citation = { owner_id: ByteId; memory_id: ByteId; revision: number; field: string; start_byte: number; end_byte: number };
type Point = {
  id: ByteId; revision: number; statement: string | null; status: unknown; time_scope: unknown;
  current: boolean; eligible_for_context: boolean; citations: Citation[];
  tombstone: { suppressed: boolean } | null;
};
type Topic = { id: ByteId; revision: number; title: string | null; tombstone: { suppressed: boolean } | null };
type Summary = {
  revision: number; text?: { text: string; paragraphs: { citations: Citation[] }[] } | string;
  topics?: Topic[]; points?: Point[];
};
type Status = { enabled: boolean; phy: string; writable: boolean };
const hex = (id: ByteId | null | undefined) => (id ?? []).map(byte => byte.toString(16).padStart(2, "0")).join("");
const priorities = ["High", "Normal", "Low"].map(value => ({ value, label: value }));

interface Props {
  transport: JsonTransport;
  controls: HostControls;
  owner: OwnerBinding;
  blocked?: string;
  onOpenMemory(id: string, revision: string): void;
}

export function EgoInspector({ transport, controls, owner, blocked, onOpenMemory }: Props) {
  const [expanded, expand] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pinned, setPinned] = useState<Pin[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [revision, setRevision] = useState("");
  const [historical, setHistorical] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const [pinText, setPinText] = useState("");
  const [name, setName] = useState("");
  const [identityText, setIdentityText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { Button, Input, Textarea } = controls;
  const scope = { scope: owner.owner_kind === "REL" ? "rel" : "phy", owner_id: owner.owner_id };
  const call = <T,>(op: string, body: object, signal?: AbortSignal) =>
    transport("/ego-v1/" + op, { method: "POST", body, signal }) as Promise<T>;
  const summaryScope = (phy: string) => ({
    owner_id: phy,
    rel_id: owner.owner_kind === "REL" ? owner.owner_id : null,
  });
  const writable = Boolean(status?.enabled && status.writable && !blocked);

  async function load(signal?: AbortSignal) {
    const current = await call<Status>("status", {}, signal);
    signal?.throwIfAborted();
    setStatus(current);
    if (!current.enabled) return;
    const [pinList, identityList, summaryView] = await Promise.all([
      call<{ pins: Pin[] }>("pins", { ...scope, query: pinQuery }, signal),
      call<{ selection: Selection | null; identities: Identity[] }>("identities", { owner_id: current.phy }, signal),
      call<{ summary: Summary | null }>("summary", summaryScope(current.phy), signal),
    ]);
    signal?.throwIfAborted();
    setPinned(pinList.pins);
    setIdentities(identityList.identities);
    setSelection(identityList.selection);
    setSummary(summaryView.summary);
    setHistorical(false);
    setRevision("");
  }

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setStatus(null);
    setPinned([]);
    setIdentities([]);
    setSummary(null);
    setError("");
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("Ego is unavailable for this profile.");
    });
    return () => controller.abort();
  }, [expanded, owner.owner_id, transport]);

  async function write(op: string, body: object) {
    if (!writable || busy) return;
    setBusy(true);
    setError("");
    try {
      await call(op, body);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ego update could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function readRevision() {
    const value = revision ? Number(revision) : null;
    if (!status || (value !== null && (!Number.isSafeInteger(value) || value <= 0))) return;
    try {
      const result = await call<{ summary: Summary | null }>("summary", { ...summaryScope(status.phy), revision: value });
      setSummary(result.summary);
      setHistorical(value !== null);
      setError("");
    } catch {
      setError("Could not open this summary revision.");
    }
  }

  const citations = (items: Citation[]) => <ul className="knowledge-history-list">{items.map((citation, index) => {
    const id = hex(citation.memory_id);
    return <li key={id + ":" + index}>
      {hex(citation.owner_id) === owner.owner_id
        ? <Button type="button" onClick={() => onOpenMemory(id, String(citation.revision))}>Memory {id.slice(0, 8)}</Button>
        : <span>Memory {id.slice(0, 8)}</span>}
      <small> Revision {citation.revision}, {citation.field} bytes {citation.start_byte}–{citation.end_byte}</small>
    </li>;
  })}</ul>;

  return <details className="knowledge-inspector-section" onToggle={event => expand(event.currentTarget.open)}>
    <summary>Ego</summary>
    {error && <p role="alert">{error}</p>}
    {status && !status.enabled && <p>Ego is disabled for this profile.</p>}
    {status?.enabled && <>
      <section aria-label="Identities">
        <h3>Identity</h3>
        {identities.map(identity => <details key={hex(identity.id) + identity.revision}>
          <summary>{identity.name}{hex(selection?.id) === hex(identity.id) ? " · active" : ""}</summary>
          <form onSubmit={event => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            void write("identity_edit", { owner_id: status.phy, draft: {
              id: identity.id, revision: identity.revision, name: fields.get("name"), text: fields.get("text"),
            } });
          }}>
            <Input name="name" aria-label="Identity name" defaultValue={identity.name} disabled={!writable || busy} required />
            <Textarea name="text" aria-label="Identity text" defaultValue={identity.text} disabled={!writable || busy} required />
            {writable && <Button type="submit" disabled={busy || !Number.isSafeInteger(identity.revision)}>Save Identity</Button>}
          </form>
          {writable && hex(selection?.id) !== hex(identity.id) && <Button type="button" disabled={busy || !Number.isSafeInteger(identity.revision)}
            onClick={() => void write("identity_select", { owner_id: status.phy, id: identity.id,
              revision: identity.revision, selection_revision: selection?.revision ?? 0 })}>Use Identity</Button>}
        </details>)}
        {writable && <form onSubmit={event => {
          event.preventDefault();
          void write("identity_create", { owner_id: status.phy, name, text: identityText });
        }}>
          <Input aria-label="New Identity name" value={name} onChange={event => setName(event.currentTarget.value)} required />
          <Textarea aria-label="New Identity text" value={identityText} onChange={event => setIdentityText((event.currentTarget as HTMLTextAreaElement).value)} required />
          <Button type="submit" disabled={busy || !name.trim() || !identityText.trim()}>Create Identity</Button>
        </form>}
      </section>
      <section aria-label="Pinned context">
        <h3>Pins</h3>
        <form onSubmit={event => {
          event.preventDefault();
          void call<{ pins: Pin[] }>("pins", { ...scope, query: pinQuery }).then(result => setPinned(result.pins))
            .catch(() => setError("Could not search Pins."));
        }}>
          <Input aria-label="Search Pins" value={pinQuery} onChange={event => setPinQuery(event.currentTarget.value)} />
          <Button type="submit">Find Pins</Button>
        </form>
        {pinned.length === 0 && <p>No Pins for this owner.</p>}
        {pinned.map(pin => <PinEditor key={hex(pin.id) + pin.revision} pin={pin} controls={controls}
          writable={writable && Number.isSafeInteger(pin.revision)} busy={busy}
          save={(text, priority) => void write("pin_modify", { ...scope, id: pin.id, revision: pin.revision, text, priority })}
          remove={() => void write("pin_delete", { ...scope, id: pin.id, revision: pin.revision })} />)}
        {writable && <form onSubmit={event => { event.preventDefault(); void write("pin_create", { ...scope, text: pinText }); }}>
          <Textarea aria-label="New Pin" value={pinText} onChange={event => setPinText((event.currentTarget as HTMLTextAreaElement).value)} maxLength={2500} required />
          <Button type="submit" disabled={busy || !pinText.trim()}>Add Pin</Button>
        </form>}
      </section>
      <section aria-label="Ego summary">
        <h3>Summary</h3>
        <form onSubmit={event => { event.preventDefault(); void readRevision(); }}>
          <Input aria-label="Summary revision" placeholder="Current revision" inputMode="numeric" value={revision}
            onChange={event => setRevision(event.currentTarget.value)} />
          <Button type="submit">Open revision</Button>
        </form>
        {!summary && <p>No saved summary at this revision.</p>}
        {summary && <p>Revision {summary.revision}{historical ? " · retained" : ""}</p>}
        {typeof summary?.text === "string" && <p className="knowledge-memory-body">{summary.text}</p>}
        {summary?.text && typeof summary.text === "object" && <>
          <p className="knowledge-memory-body">{summary.text.text}</p>
          {citations(summary.text.paragraphs.flatMap(paragraph => paragraph.citations))}
        </>}
        {summary?.topics?.map(topic => <div key={hex(topic.id)}>
          <strong>{topic.title ?? "Retired topic"}</strong>
          {writable && !historical && topic.tombstone?.suppressed && Number.isSafeInteger(topic.revision)
            && summary && Number.isSafeInteger(summary.revision) && <Button type="button" disabled={busy}
              onClick={() => void write("summary_edit", { ...summaryScope(status.phy), revision: summary.revision,
                edit: { LiftSuppression: { item: { Topic: topic.id }, revision: topic.revision } } })}>
              Lift suppression
            </Button>}
        </div>)}
        {summary?.points?.map(point => <details key={hex(point.id) + point.revision}>
          <summary>{point.statement ?? "Retired point"}</summary>
          <p>{point.eligible_for_context ? "Eligible for context" : "Outside current context"}</p>
          {citations(point.citations)}
          {writable && !historical && summary && Number.isSafeInteger(summary.revision)
            && Number.isSafeInteger(point.revision) && <PointEditor key={hex(point.id) + point.revision}
              point={point} controls={controls} busy={busy}
              update={edit => void write("summary_edit", { ...summaryScope(status.phy), revision: summary.revision, edit })} />}
        </details>)}
      </section>
    </>}
  </details>;
}

function PinEditor({ pin, controls, writable, busy, save, remove }: {
  pin: Pin; controls: HostControls; writable: boolean; busy: boolean;
  save(text: string, priority: Priority): void; remove(): void;
}) {
  const [text, setText] = useState(pin.text);
  const [priority, setPriority] = useState(pin.priority);
  const { Button, Textarea, Select } = controls;
  return <div className="knowledge-edit-memory">
    <Textarea aria-label="Pin text" value={text} disabled={!writable || busy} maxLength={2500}
      onChange={event => setText((event.currentTarget as HTMLTextAreaElement).value)} />
    <Select label="Priority" value={priority} options={priorities} disabled={!writable || busy}
      onValueChange={value => setPriority(value as Priority)} />
    {writable && <>
      <Button type="button" disabled={busy || !text.trim() || (text === pin.text && priority === pin.priority)}
        onClick={() => save(text, priority)}>Save Pin</Button>
      <Button type="button" disabled={busy} onClick={remove}>Delete Pin</Button>
    </>}
  </div>;
}

function PointEditor({ point, controls, busy, update }: {
  point: Point; controls: HostControls; busy: boolean; update(edit: object): void;
}) {
  const [text, setText] = useState(point.statement ?? "");
  const [suppress, setSuppress] = useState(false);
  const { Button, Checkbox, Textarea } = controls;
  const target = { item: { Point: point.id }, revision: point.revision };
  if (point.tombstone?.suppressed) {
    return <Button type="button" disabled={busy} onClick={() => update({ LiftSuppression: target })}>Lift suppression</Button>;
  }
  if (!point.current || !point.statement) return null;
  return <div className="knowledge-edit-memory">
    <Textarea aria-label="Replacement point" value={text} onChange={event => setText((event.currentTarget as HTMLTextAreaElement).value)} />
    <Button type="button" disabled={busy || !text.trim() || text === point.statement}
      onClick={() => update({ ReplacePoint: {
        id: point.id, revision: point.revision, statement: text, status: point.status,
        time_scope: point.time_scope, citations: point.citations,
      } })}>Save replacement</Button>
    <label><Checkbox aria-label="Suppress duplicates" checked={suppress} onCheckedChange={setSuppress} /> Suppress duplicates</label>
    <Button type="button" disabled={busy} onClick={() => update({ Withdraw: { ...target, suppress } })}>Remove point</Button>
  </div>;
}
