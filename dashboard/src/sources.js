(function (root) {
  "use strict";

  const h = root.ReliquaryDashboardHost.React.createElement;
  const { useState, useEffect } = root.ReliquaryDashboardHost.hooks;
  const { Button, Input, Select, Checkbox } = root.ReliquaryDashboardHost.components;
  const endpoint = "/api/plugins/reliquary-hermes/sources-v1";
  const statuses = new Set(["available", "queued", "staged", "processing", "complete", "failed", "already_imported", "unavailable"]);
  const activeStatuses = new Set(["queued", "staged", "processing"]);
  const statusLabels = { available: "Available", queued: "Queued", staged: "Staged", processing: "Processing",
    complete: "Complete", failed: "Failed", already_imported: "Already imported", unavailable: "Unavailable" };

  function safeSession(value) {
    if (!value || typeof value !== "object" || typeof value.session_id !== "string" || !value.session_id ||
      typeof value.title !== "string" || !Number.isFinite(value.started_at) || !Number.isFinite(value.last_activity_at) ||
      !Number.isInteger(value.message_count) || value.message_count < 0 ||
      !(value.project_name === null || typeof value.project_name === "string") || typeof value.status !== "string" ||
      !statuses.has(value.status) || !(value.reason === null || typeof value.reason === "string") || typeof value.retryable !== "boolean") return null;
    return value;
  }

  function safeStatuses(value, expectedIds) {
    if (!value || !Array.isArray(value.sessions)) return null;
    const seen = new Set();
    const rows = [];
    for (const item of value.sessions) {
      if (!item || typeof item.session_id !== "string" || !expectedIds.includes(item.session_id) || seen.has(item.session_id) ||
        !statuses.has(item.status) || typeof item.retryable !== "boolean" || !(item.reason === null || typeof item.reason === "string")) return null;
      seen.add(item.session_id); rows.push(item);
    }
    return seen.size === expectedIds.length ? rows : null;
  }

  async function request(authedFetch, path, method, body) {
    const response = await authedFetch(endpoint + path, { method,
      headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error("request_failed");
    return response.json();
  }

  function ImportSessions({ authedFetch, mutationBlocked }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const [offset, setOffset] = useState(0);
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState([]);
    const [ownerId, setOwnerId] = useState("");
    const [review, setReview] = useState(false);
    const [busy, setBusy] = useState(false);
    const [statusById, setStatusById] = useState({});
    const [polling, setPolling] = useState(0);

    async function loadPage(nextOffset = offset, q = submittedQuery) {
      setLoading(true); setError("");
      try {
        const value = await request(authedFetch, "/sessions?offset=" + nextOffset + "&q=" + encodeURIComponent(q), "GET");
        if (!value || typeof value.available !== "boolean" || !Array.isArray(value.destinations) || !Array.isArray(value.sessions) ||
          !(value.next_offset === null || (Number.isInteger(value.next_offset) && value.next_offset >= 0))) throw new Error("invalid_response");
        const destinations = value.destinations.filter((item) => item && typeof item.owner_id === "string" && item.owner_id && typeof item.label === "string");
        const sessions = value.sessions.map(safeSession);
        if (destinations.length !== value.destinations.length || sessions.some((item) => !item)) throw new Error("invalid_response");
        setPage({ ...value, destinations, sessions });
        setSelected([]); setReview(false);
        if (!destinations.some((item) => item.owner_id === ownerId)) setOwnerId(destinations[0]?.owner_id ?? "");
      } catch { setPage(null); setError("Could not load session history. Retry to check availability."); }
      finally { setLoading(false); }
    }

    useEffect(() => { if (open) loadPage(0, submittedQuery); }, [open]);
    useEffect(() => {
      if (!polling) return undefined;
      const timer = setTimeout(async () => {
        try {
          const ids = Object.entries(statusById).filter(([, item]) => item && activeStatuses.has(item.status)).map(([id]) => id);
          if (!ids.length) { setPolling(0); return; }
          const value = await request(authedFetch, "/status", "POST", { session_ids: ids });
          const updates = safeStatuses(value, ids);
          if (!updates) throw new Error("invalid_response");
          setStatusById((old) => ({ ...old, ...Object.fromEntries(updates.map((item) => [item.session_id, item])) }));
          setPolling((count) => count < 29 ? count + 1 : 0);
        } catch { setPolling((count) => count < 29 ? count + 1 : 0); }
      }, 2000);
      return () => clearTimeout(timer);
    }, [polling, statusById]);

    async function importIds(ids) {
      if (mutationBlocked || !ownerId || !ids.length || ids.length > 8) return;
      setBusy(true); setError("");
      try {
        const value = await request(authedFetch, "/import", "POST", { session_ids: ids, owner_id: ownerId, confirm: true });
        const updates = safeStatuses(value, ids);
        if (!updates) throw new Error("invalid_response");
        setStatusById((old) => ({ ...old, ...Object.fromEntries(updates.map((item) => [item.session_id, item])) }));
        setSelected([]); setReview(false);
        if (updates.some((item) => activeStatuses.has(item.status))) setPolling(1);
      } catch { setError("Import could not be confirmed. Refresh status before retrying."); }
      finally { setBusy(false); }
    }

    if (!open) return h("section", { className: "rly-sources", "aria-label": "Sources" },
      h("h2", null, "Sources"),
      h("p", { className: "rly-muted" }, "Browse existing Hermes conversations and choose exactly which ones to import."),
      h(Button, { type: "button", onClick: () => setOpen(true) }, "Import Existing Sessions"));

    const current = page?.sessions ?? [];
    const checked = (id) => selected.includes(id);
    function toggle(id) { setSelected((old) => old.includes(id) ? old.filter((item) => item !== id) : old.length < 8 ? [...old, id] : old); }
    const destination = page?.destinations.find((item) => item.owner_id === ownerId);
    function sessionRow(item) {
      const status = statusById[item.session_id] ?? { status: item.status, reason: item.reason, retryable: item.retryable };
      const retry = status.retryable && ["failed", "unavailable"].includes(status.status) && !review
        ? h(Button, { type: "button", disabled: busy || mutationBlocked,
            onClick: () => importIds([item.session_id]) }, "Retry import") : null;
      return h("li", { key: item.session_id, className: "rly-import-row" },
        !review && h(Checkbox, { checked: checked(item.session_id), disabled: busy || status.status === "unavailable" ||
          status.status === "already_imported" || status.status === "complete", "aria-label": "Select " + item.title,
          onCheckedChange: () => toggle(item.session_id) }),
        h("div", null,
          h("strong", null, item.title),
          h("dl", { className: "rly-detail-meta" },
            h("div", null, h("dt", null, "Session ID"), h("dd", null, item.session_id)),
            h("div", null, h("dt", null, "Created"), h("dd", null, new Date(item.started_at * 1000).toLocaleString())),
            h("div", null, h("dt", null, "Last activity"), h("dd", null, new Date(item.last_activity_at * 1000).toLocaleString())),
            h("div", null, h("dt", null, "Messages"), h("dd", null, item.message_count)),
            item.project_name && h("div", null, h("dt", null, "Hermes project"), h("dd", null, item.project_name)),
            h("div", null, h("dt", null, "Import status"), h("dd", null, statusLabels[status.status]))),
          status.reason && h("p", { className: "rly-muted" }, status.reason), retry));
    }
    return h("section", { className: "rly-sources", "aria-label": "Import Existing Sessions" },
      h("div", { className: "rly-toolbar" }, h("div", null, h("h2", null, "Import Existing Sessions"),
        h("p", { className: "rly-muted" }, "No conversations are selected automatically. Select up to 8 conversations per import.")),
        h(Button, { type: "button", onClick: () => { setOpen(false); setSelected([]); setReview(false); } }, "Close")),
      mutationBlocked && h("p", { className: "rly-live-notice", role: "note" }, mutationBlocked),
      error && h("p", { role: "alert" }, error),
      loading && h("p", { role: "status" }, "Loading session history…"),
      page && !page.available && h("p", { role: "status", className: "rly-live-notice" }, "Session import is unavailable on this Hermes build."),
      page?.available && h("div", null,
        h("form", { className: "rly-session-lookup", onSubmit: (event) => {
          event.preventDefault(); setOffset(0); setSubmittedQuery(query.trim()); loadPage(0, query.trim());
        } },
          h("label", { className: "rly-field" }, h("span", null, "Search conversations"), h(Input, { value: query, maxLength: 200,
            onChange: (event) => setQuery(event.currentTarget.value) })),
          h(Button, { type: "submit" }, "Search"), h(Button, { type: "button", onClick: () => loadPage() }, "Refresh")),
        h("div", { className: "rly-field" }, h("label", { htmlFor: "rly-import-destination" }, "Import destination"),
          h(Select, { label: "Import destination", value: ownerId, disabled: review || busy,
            options: page.destinations.map((item) => ({ value: item.owner_id, label: item.label })), onValueChange: setOwnerId })),
        current.length ? h("ul", { className: "rly-import-list" }, ...current.map(sessionRow))
          : h("p", { className: "rly-empty" }, "No conversations on this page."),
        h("div", { className: "rly-pager" },
          h(Button, { type: "button", disabled: offset === 0 || loading || review, onClick: () => { const next = Math.max(0, offset - 16); setOffset(next); loadPage(next); } }, "Previous page"),
          h(Button, { type: "button", disabled: page.next_offset === null || loading || review, onClick: () => { setOffset(page.next_offset); loadPage(page.next_offset); } }, "Next page")),
        review && h("div", { className: "rly-import-review", role: "group", "aria-label": "Review import" },
          h("h3", null, "Review import"), h("p", null, "Import " + selected.length + " selected conversation" + (selected.length === 1 ? "" : "s") + " into " + (destination?.label ?? "the selected REL") + "?"),
          h("ul", null, ...current.filter((item) => selected.includes(item.session_id)).map((item) => h("li", { key: item.session_id }, item.title))),
          h(Button, { type: "button", disabled: busy, onClick: () => setReview(false) }, "Cancel"),
          h(Button, { type: "button", disabled: busy || mutationBlocked || !destination, onClick: () => importIds(selected) }, busy ? "Importing…" : "Import selected")),
        !review && h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: selected.length === 0 || !ownerId || mutationBlocked || busy, onClick: () => setReview(true) }, "Review selected (" + selected.length + ")"),
          polling > 0 && h("span", { role: "status" }, "Refreshing import status…"))));
  }

  root.ReliquaryDashboardSources = { ImportSessions };
})(globalThis);
