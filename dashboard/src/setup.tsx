import { useEffect, useRef, useState } from "react";
import type { SetupCandidate, SetupCreateKind, SetupDialogMode, SetupDialogResult, SetupPicker,
  SetupProjectInventory, SetupReport, SetupStatus } from "../types";
import type { HostBoundary, JsonTransport } from "./host";
import "./warlock-workflows.css";

const setupPath = "/setup-v1/";
const errorMessages: Record<string, string> = {
  runtime_unavailable: "The Reliquary host is unavailable. Check the plugin installation.",
  managed_setup: "This profile is managed and cannot change local setup.",
  service_restart_required: "Stop the running Reliquary service for this profile and try connecting again.",
  source_capture_setup_required: "Check this profile's Reliquary capture enrollment file and try again.",
  owner_already_exists: "A file already exists at this path. Select it or choose another destination.",
  owner_created_unverified: "Reliquary created the file but could not verify it. Use Select to check it.",
  unknown_hermes_project: "Refresh the Hermes projects list and try again.",
  invalid_path: "Enter an absolute local path for each selected owner and configuration.",
};

export function setupError(error: unknown): string {
  return error instanceof Error && Object.hasOwn(errorMessages, error.message)
    ? errorMessages[error.message] : "Could not complete Reliquary setup. Check the selected paths and try again.";
}

export async function loadSetupStatus(json: JsonTransport, signal: AbortSignal): Promise<SetupStatus> {
  const result = await json(setupPath + "status", { signal }) as SetupStatus;
  if (typeof result?.configured !== "boolean" || typeof result.runtime_detected !== "boolean" || !result.defaults?.projects) {
    throw new Error("invalid_setup_response");
  }
  return result;
}

export function desktopMutationNotice(surface: HostBoundary["surface"], status: SetupStatus) {
  return surface === "Desktop" && status.desktop_native_mutations !== true
    ? "This Hermes connection supports read-only access in Desktop. Open Reliquary in Hermes Web to change setup or manage Memories and imports."
    : undefined;
}

type PickerKind = Parameters<SetupPicker>[0];
interface Target { kind: PickerKind; label: string; value: string; change(value: string): void;
  createKind?: SetupCreateKind; projectId?: string }
type Confirmation = { mode: "create"; target: Target; path: string } | { mode: "apply"; candidate: SetupCandidate };

function validLocalPath(path: string) {
  return /^(?:[a-z]:[\\/]|\/(?!\/))/i.test(path) && !path.includes("\0") && new TextEncoder().encode(path).length <= 4096;
}

export function Setup({ host, status, readOnly, onConnected }: {
  host: HostBoundary; status: SetupStatus; readOnly?: string; onConnected(): void;
}) {
  const { Button, Input } = host.controls;
  const [main, setMain] = useState(status.defaults.main_rel ?? "");
  const [phy, setPhy] = useState(status.defaults.active_phy ?? "");
  const [config, setConfig] = useState(status.defaults.config_path ?? "");
  const [projects, setProjects] = useState(status.defaults.projects);
  const [inventory, setInventory] = useState<SetupProjectInventory | null>(null);
  const [inventoryError, setInventoryError] = useState(false);
  const [reloadProjects, setReloadProjects] = useState(0);
  const [manual, setManual] = useState(false);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const pending = useRef<AbortController | null>(null);
  const canWrite = status.runtime_detected && !readOnly;

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!status.configured) return;
    const controller = new AbortController();
    host.json(setupPath + "projects", { signal: controller.signal }).then(value => {
      const data = value as SetupProjectInventory;
      if (!Array.isArray(data?.projects) || typeof data.routing_available !== "boolean" ||
          data.projects.some(item => !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(item?.id) || typeof item.name !== "string") ||
          new Set(data.projects.map(item => item.id)).size !== data.projects.length) throw new Error("invalid_projects");
      if (!controller.signal.aborted) setInventory(data);
    }).catch(() => { if (!controller.signal.aborted) setInventoryError(true); });
    return () => controller.abort();
  }, [host, status.configured, reloadProjects]);

  function change(update: (value: string) => void, value: string) {
    setReport(null);
    setError("");
    update(value);
  }

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      await action(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setError(setupError(error));
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function post(operation: string, body: unknown, signal: AbortSignal) {
    return host.json(setupPath + operation, { method: "POST", body, signal });
  }

  const webDialogs = host.surface === "Web" && status.local_dialogs_available;
  function pick(target: Target, save: boolean) {
    const picker = save ? host.pickSavePath : host.pickOpenPath;
    return run(async signal => {
      let path: string | null = null;
      if (picker) {
        const result = await picker(target.kind, signal);
        path = typeof result === "string" ? result : result?.status === "selected" ? result.path : null;
      } else if (webDialogs) {
        const mode = ((save ? "save_" : "open_") + target.kind.toLowerCase()) as SetupDialogMode;
        const result = await post("dialog", { mode }, signal) as SetupDialogResult;
        if (result?.status === "unavailable") {
          setError("The file dialog is unavailable. Enter the path manually.");
          return;
        }
        if (result?.status === "selected") path = result.path;
      }
      signal.throwIfAborted();
      if (!path || !validLocalPath(path)) return;
      if (save) setConfirm({ mode: "create", target, path });
      else change(target.change, path);
    });
  }

  function validate(review: boolean) {
    return run(async signal => {
      const candidate: SetupCandidate = { main_rel: main.trim(), active_phy: phy.trim(), config_path: config.trim() || null };
      if (inventory?.routing_available) candidate.projects = Object.fromEntries(
        Object.entries(projects).filter(([, path]) => path.trim()).map(([id, path]) => [id, path.trim()]));
      const paths = [candidate.main_rel, candidate.active_phy,
        ...(candidate.config_path ? [candidate.config_path] : []), ...Object.values(candidate.projects ?? {})];
      if (paths.some(path => !validLocalPath(path))) throw new Error("invalid_path");
      const result = await post("validate", candidate, signal) as SetupReport;
      signal.throwIfAborted();
      if (typeof result?.valid !== "boolean" || !result.main_rel || !result.active_phy || !result.projects || !result.config) {
        throw new Error("invalid_setup_response");
      }
      setReport(result);
      if (review && result.valid) setConfirm({ mode: "apply", candidate });
    });
  }

  function commit() {
    if (!canWrite || !confirm) return;
    return run(async signal => {
      if (confirm.mode === "apply") {
        const result = await post("apply", confirm.candidate, signal) as SetupReport & { configured: boolean };
        signal.throwIfAborted();
        if (result?.configured === true && result.valid === true) {
          onConnected();
          return;
        }
        if (result?.configured !== false || typeof result.valid !== "boolean") throw new Error("invalid_setup_response");
        setReport(result);
      } else {
        const { target, path } = confirm;
        if (!target.createKind || !validLocalPath(path)) throw new Error("invalid_path");
        const result = await post("create", {
          kind: target.createKind, path, ...(target.projectId ? { project_id: target.projectId } : {}),
        }, signal) as { accepted: boolean; opened: boolean; path: string; kind: string; owner_id: string };
        signal.throwIfAborted();
        if (result?.accepted !== true || result.opened !== true || typeof result.owner_id !== "string" ||
            typeof result.path !== "string" || result.kind !== target.kind.toLowerCase()) throw new Error("invalid_setup_response");
        change(target.change, result.path);
        setCreated(values => [...values, result.path]);
      }
      setConfirm(null);
    });
  }

  function pathField(target: Target, check?: SetupReport["main_rel"] | SetupReport["config"]) {
    return <section className="knowledge-memory-row warlock-setup-row" aria-label={target.label}>
      <div>
        <strong>{target.label}</strong>
        {manual ? <label className="warlock-setup-path">{target.label} path
          <Input value={target.value} onChange={event => change(target.change, event.currentTarget.value)}
            autoComplete="off" maxLength={4096} />
        </label> : <p className="knowledge-provenance warlock-workflow-path">{target.value || "No file selected"}</p>}
        <div className="warlock-workflow-actions">
          <Button type="button" disabled={!webDialogs && !host.pickOpenPath} onClick={() => void pick(target, false)}>Select {target.kind}</Button>
          {target.createKind && canWrite && <>
            <Button type="button" disabled={!webDialogs && !host.pickSavePath} onClick={() => void pick(target, true)}>Create {target.kind}</Button>
            {manual && <Button type="button" disabled={!validLocalPath(target.value.trim())}
              onClick={() => setConfirm({ mode: "create", target, path: target.value.trim() })}>Create at this path</Button>}
          </>}
          {target.projectId && target.value && canWrite &&
            <Button type="button" onClick={() => change(target.change, "")}>Use General</Button>}
        </div>
        {check && <p role="status">{check.accepted && check.opened ? "Accepted" : check.accepted ? "No file selected" : "Rejected"}
          {"kind" in check && check.kind && " · " + check.kind.toUpperCase()}
          {check.error && " · " + check.error.replaceAll("_", " ")}</p>}
      </div>
    </section>;
  }

  return <section className="knowledge-panel" aria-label="Reliquary setup">
    <aside className="knowledge-nav" aria-label="Setup navigation">
      <div className="knowledge-heading"><span className="eyebrow">SETUP</span><strong>Connect owners</strong></div>
      {readOnly && <p role="note" className="knowledge-muted">{readOnly}</p>}
      <p className="knowledge-muted">{status.runtime_detected ? "Reliquary runtime detected" : "Reliquary runtime unavailable"}</p>
      {!webDialogs && !host.pickOpenPath && <p role="note" className="knowledge-muted">Native file dialogs are unavailable for this connection.</p>}
      <div className="knowledge-inspector-section">
        <h3>Owner paths</h3>
        <p className="knowledge-muted">Choose the General REL, active PHY, and configuration used by this Hermes profile.</p>
      </div>
      <Button type="button" aria-expanded={manual} disabled={busy || !!confirm}
        onClick={() => setManual(value => !value)}>{manual ? "Hide manual paths" : "Enter path manually"}</Button>
      {status.configured && <p className="knowledge-muted">Existing sessions keep their accepted memory routes.</p>}
    </aside>
    <main className="knowledge-memory-list warlock-workflow-center warlock-setup-center" aria-label="Owner files">
      <header><div><h2>Connect owners</h2><span>Review the files and routing used by this profile.</span></div></header>
      <form onSubmit={event => { event.preventDefault(); if (canWrite) void validate(true); }}>
        <fieldset disabled={busy || !!confirm}>
          <div className="knowledge-memory-rows">
            {pathField({ kind: "REL", label: "General memory", value: main, change: setMain, createKind: "general_rel" }, report?.main_rel)}
            {pathField({ kind: "PHY", label: "Active identity", value: phy, change: setPhy, createKind: "phy" }, report?.active_phy)}
            {pathField({ kind: "config", label: "Reliquary configuration", value: config, change: setConfig }, report?.config)}
            {status.configured && <details className="knowledge-create warlock-projects">
              <summary>Project memories</summary>
              <p>Create or manage projects in Hermes, then refresh this list.</p>
              <Button type="button" onClick={() => {
                setInventory(null); setInventoryError(false); setReloadProjects(value => value + 1);
              }}>Refresh projects</Button>
              {inventoryError && <p role="alert">Could not load Hermes projects.</p>}
              {!inventory && !inventoryError && <p role="status">Loading Hermes projects…</p>}
              {inventory && !inventory.routing_available && <p role="note">New project conversations use General memory on this Hermes build.</p>}
              {inventory?.projects.map(project => inventory.routing_available
                ? <div key={project.id}>{pathField({
                  kind: "REL", label: project.name, value: projects[project.id] ?? "", projectId: project.id, createKind: "project_rel",
                  change: value => setProjects(previous => ({ ...previous, [project.id]: value })),
                }, report?.projects[project.id])}</div>
                : <p key={project.id}>{project.name}{projects[project.id] && " · " + projects[project.id]}</p>)}
              {inventory?.projects.length === 0 && <p>This profile has no active Hermes projects.</p>}
            </details>}
          </div>
          {canWrite && <div className="warlock-workflow-actions">
            <Button type="button" onClick={() => void validate(false)}>Validate</Button>
            <Button type="submit" disabled={status.configured && !inventory && !inventoryError}>Review and connect</Button>
          </div>}
        </fieldset>
      </form>
    </main>
    <aside className="knowledge-inspector" aria-label="Setup review">
      <span className="eyebrow">STATUS</span>
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert" className="knowledge-inline-error">{error}</p>}
      {report && <section className="knowledge-inspector-section"><h3>Validation</h3>
        <p role={report.valid ? "status" : "alert"}>{report.valid ? "Validation passed."
          : report.topology_error === "owner_topology_changed"
            ? "Keep the accepted General REL, PHY, and dedicated owners when adding project RELs."
            : "Validation failed. Check the rejected files."}</p>
      </section>}
      {confirm && <section className="knowledge-inspector-section" aria-label={confirm.mode === "create" ? "Confirm owner creation" : "Review connection"}>
        <h3>{confirm.mode === "create" ? "Confirm owner creation" : "Review connection"}</h3>
        {confirm.mode === "create" ? <p className="knowledge-provenance warlock-workflow-path">Create a new owner at <span>{confirm.path}</span></p> : <>
          <p className="knowledge-provenance warlock-workflow-path">{confirm.candidate.main_rel}</p><p className="knowledge-provenance warlock-workflow-path">{confirm.candidate.active_phy}</p>
          {inventoryError && <p role="note">Hermes project routes could not be checked.</p>}
          {status.configured && <p>Existing sessions keep their accepted memory routes.</p>}
        </>}
        <div className="warlock-workflow-actions">
          <Button type="button" disabled={busy} onClick={() => void commit()}>
            {confirm.mode === "create" ? "Create " + confirm.target.kind : "Connect Reliquary"}
          </Button>
          <Button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      </section>}
      {created.length > 0 && <section className="knowledge-inspector-section" role="status">
        <h3>Created files</h3><p>Created owner files remain on disk if connection fails.</p>
        <ul className="knowledge-provenance warlock-workflow-paths">{created.map(path => <li key={path}>{path}</li>)}</ul>
      </section>}
      {!confirm && !report && !error && !created.length && <p className="knowledge-muted">Choose owner files, then validate or review the connection.</p>}
    </aside>
  </section>;
}
