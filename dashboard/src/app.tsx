import { useEffect, useState } from "react";
import type { SetupStatus } from "../types";
import type { HostBoundary } from "./host";
import { KnowledgeScope } from "./knowledge/KnowledgeScope";
import { Setup, desktopMutationNotice, loadSetupStatus, setupError } from "./setup";
import { Sources } from "./sources";

const sections = ["Knowledge", "Sources", "Setup"] as const;
type Section = (typeof sections)[number];

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

  return <section className="knowledge-surface" aria-label="Reliquary">
    <nav className="knowledge-view-switch reliquary-sections" aria-label="Reliquary sections">
      {sections.map(item => <button key={item} type="button" className={active === item ? "active" : ""}
        aria-pressed={active === item} disabled={!status || (!status.configured && item !== "Setup")}
        onClick={() => setSection(item)}>{item}</button>)}
    </nav>
    {!current && <p className="knowledge-state" role="status">Checking this Hermes profile…</p>}
    {current?.error && <div className="knowledge-state error" role="alert"><p>{current.error}</p>
      <Button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
    {status && active === "Setup" && <Setup host={host} status={status} readOnly={readOnly} onConnected={connected} />}
    {status?.configured && active === "Sources" && <Sources host={host} readOnly={readOnly} captureStatus={status.capture_status} />}
    {status?.configured && active === "Knowledge" && <KnowledgeScope host={host} mutationBlocked={readOnly} />}
  </section>;
}
