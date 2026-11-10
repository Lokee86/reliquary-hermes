(function (root) {
  "use strict";

  const h = root.ReliquaryDashboardHost.React.createElement;
  const { useState, useEffect } = root.ReliquaryDashboardHost.hooks;
  const { Button, Input, Select, Checkbox } = root.ReliquaryDashboardHost.components;
  const endpoint = "/api/plugins/reliquary-hermes/sources-v1";
  const statuses = new Set(["available", "queued", "staged", "processing", "complete", "failed", "already_imported", "unavailable"]);
  const activeStatuses = new Set(["queued", "staged", "processing"]);
  /** @typedef {"available" | "queued" | "staged" | "processing" | "complete" | "failed" | "already_imported" | "unavailable"} ImportStatus */
  /** @typedef {{session_id:string,title:string,started_at:number,last_activity_at:number,message_count:number,project_name:string|null,status:ImportStatus,reason:string|null,retryable:boolean}} HistorySession */
  /** @typedef {{owner_id:string,label:string}} Destination */
  /** @typedef {{available:boolean,destinations:Destination[],sessions:HistorySession[],next_offset:number|null}} SessionPage */
  /** @typedef {{session_id:string,status:ImportStatus,reason:string|null,retryable:boolean}} ImportStatusRow */
  /** @typedef {import("../types").HermesDashboardSDK["authedFetch"]} AuthedFetch */
  const statusLabels = { available: "Available", queued: "Queued", staged: "Staged", processing: "Processing",
    complete: "Complete", failed: "Failed", already_imported: "Already imported", unavailable: "Unavailable" };
  /** @type {Record<string,string>} */
  const reasonLabels = {
    history_too_large: "This conversation exceeds the supported history size and cannot be imported completely.",
    history_unsupported: "This conversation’s history format is not supported for import.",
    history_identity_unavailable: "Hermes could not verify the original message identities needed for import.",
    history_session_unavailable: "This conversation is no longer available for import.",
    manual_import_conflict: "This conversation conflicts with an existing imported source and needs review.",
    source_owner_conflict: "This conversation is already associated with a different REL.",
  };

  /** @param {string} reason */
  function reasonText(reason) { return reasonLabels[reason] ?? "Import details are unavailable."; }

  /** @param {unknown} value @returns {HistorySession|null} */
  function safeSession(value) {
    if (!value || typeof value !== "object") return null;
    const row = /** @type {Record<string, unknown>} */ (value);
    if (typeof row.session_id !== "string" || !row.session_id || typeof row.title !== "string" ||
      !Number.isFinite(row.started_at) || !Number.isFinite(row.last_activity_at) || !Number.isInteger(row.message_count) ||
      (/** @type {number} */ (row.message_count)) < 0 || !(row.project_name === null || typeof row.project_name === "string") ||
      typeof row.status !== "string" || !statuses.has(row.status) ||
      !(row.reason === null || typeof row.reason === "string") || typeof row.retryable !== "boolean") return null;
    return /** @type {HistorySession} */ (row);
  }

  /** @param {unknown} value @returns {Destination|null} */
  function safeDestination(value) {
    if (!value || typeof value !== "object") return null;
    const row = /** @type {Record<string, unknown>} */ (value);
    return typeof row.owner_id === "string" && row.owner_id && typeof row.label === "string"
      ? /** @type {Destination} */ (row) : null;
  }

  /** @param {unknown} value @param {string[]} expectedIds @returns {ImportStatusRow[]|null} */
  function safeStatuses(value, expectedIds) {
    if (!value || typeof value !== "object") return null;
    const statusRows = /** @type {Record<string, unknown>} */ (value).sessions;
    if (!Array.isArray(statusRows)) return null;
    const seen = new Set();
    /** @type {ImportStatusRow[]} */
    const rows = [];
    for (const item of statusRows) {
      if (!item || typeof item !== "object") return null;
      const row = /** @type {Record<string, unknown>} */ (item);
      if (typeof row.session_id !== "string" || !expectedIds.includes(row.session_id) || seen.has(row.session_id) ||
        typeof row.status !== "string" || !statuses.has(row.status) || typeof row.retryable !== "boolean" ||
        !(row.reason === null || typeof row.reason === "string")) return null;
      seen.add(row.session_id); rows.push(/** @type {ImportStatusRow} */ (row));
    }
    return seen.size === expectedIds.length ? rows : null;
  }

  /** @param {AuthedFetch} authedFetch @param {string} path @param {"GET"|"POST"} method @param {Record<string, unknown>} [body] @returns {Promise<unknown>} */
  function request(authedFetch, path, method, body) {
    return authedFetch(endpoint + path, { method,
      headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((response) => {
      if (!response.ok) throw new Error("request_failed");
      return response.json();
    });
  }

  /** @param {{authedFetch:AuthedFetch,mutationBlocked?:string}} props */
  function ImportSessions({ authedFetch, mutationBlocked }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const [offset, setOffset] = useState(0);
    const [page, setPage] = useState(/** @type {SessionPage|null} */ (null));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState(/** @type {string[]} */ ([]));
    const [ownerId, setOwnerId] = useState("");
    const [review, setReview] = useState(false);
    const [busy, setBusy] = useState(false);
    const [statusById, setStatusById] = useState(/** @type {Record<string,ImportStatusRow>} */ ({}));
    const [polling, setPolling] = useState(0);

    async function loadPage(nextOffset = offset, q = submittedQuery) {
      setLoading(true); setError("");
      try {
        const value = await request(authedFetch, "/sessions?offset=" + nextOffset + "&q=" + encodeURIComponent(q), "GET");
        if (!value || typeof value !== "object") throw new Error("invalid_response");
        const candidate = /** @type {Record<string, unknown>} */ (value);
        const destinationRows = candidate.destinations;
        const sessionRows = candidate.sessions;
        const next = candidate.next_offset;
        if (typeof candidate.available !== "boolean" || !Array.isArray(destinationRows) || !Array.isArray(sessionRows) ||
          !(next === null || (typeof next === "number" && Number.isInteger(next) && next >= 0))) throw new Error("invalid_response");
        const destinationRowsSafe = destinationRows.map(safeDestination);
        const sessionRowsSafe = sessionRows.map(safeSession);
        if (destinationRowsSafe.some((item) => !item) || sessionRowsSafe.some((item) => !item)) throw new Error("invalid_response");
        const destinations = /** @type {Destination[]} */ (destinationRowsSafe);
        const sessions = /** @type {HistorySession[]} */ (sessionRowsSafe);
        setPage({ available: candidate.available, destinations, sessions,
          next_offset: /** @type {number|null} */ (next) });
        setStatusById((old) => ({ ...old, ...Object.fromEntries(sessions.map(({ session_id, status, reason, retryable }) =>
          [session_id, { session_id, status, reason, retryable }])) }));
        if (sessions.some((item) => activeStatuses.has(item.status))) setPolling(1);
        setSelected([]); setReview(false);
        if (!destinations.some((item) => item.owner_id === ownerId)) setOwnerId("");
      } catch { setPage(null); setError("Could not load session history. Retry to check availability."); }
      finally { setLoading(false); }
    }

    useEffect(() => { if (open) loadPage(0, submittedQuery); }, [open]);
    useEffect(() => {
      if (!polling) return undefined;
      const timer = setTimeout(async () => {
        try {
          const ids = Object.entries(statusById).filter(([, item]) => activeStatuses.has(item.status)).map(([id]) => id).slice(0, 8);
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

    /** @param {string[]} ids */
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
    /** @param {string} id */
    const checked = (id) => selected.includes(id);
    /** @param {string} id */
    function toggle(id) { setSelected((old) => old.includes(id) ? old.filter((item) => item !== id) : old.length < 8 ? [...old, id] : old); }
    const destination = page?.destinations.find((item) => item.owner_id === ownerId);
    /** @param {HistorySession} item */
    function sessionRow(item) {
      const status = statusById[item.session_id] ?? { status: item.status, reason: item.reason, retryable: item.retryable };
      const retry = status.retryable && ["failed", "unavailable"].includes(status.status) && !review
        ? h(Button, { type: "button", disabled: busy || mutationBlocked || !ownerId,
            onClick: () => { setSelected([item.session_id]); setReview(true); } }, "Retry import") : null;
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
          status.reason && h("p", { className: "rly-muted" }, reasonText(status.reason)), retry));
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
        h("form", { className: "rly-session-lookup", onSubmit: (/** @type {{preventDefault():void}} */ event) => {
          event.preventDefault(); setOffset(0); setSubmittedQuery(query.trim()); loadPage(0, query.trim());
        } },
          h("label", { className: "rly-field" }, h("span", null, "Search conversations"), h(Input, { value: query, maxLength: 128, disabled: review || busy,
            onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setQuery(event.currentTarget.value) })),
          h(Button, { type: "submit", disabled: review || busy }, "Search"), h(Button, { type: "button", disabled: review || busy, onClick: () => loadPage() }, "Refresh")),
        h("label", { className: "rly-field" }, h("span", null, "Import destination"),
          h(Select, { label: "Import destination", value: ownerId, disabled: review || busy,
            options: [{ value: "", label: "Choose an authorized REL" }, ...page.destinations.map((item) => ({ value: item.owner_id, label: item.label }))], onValueChange: setOwnerId })),
        current.length ? h("ul", { className: "rly-import-list" }, ...current.map(sessionRow))
          : h("p", { className: "rly-empty" }, "No conversations on this page."),
        h("div", { className: "rly-pager" },
          h(Button, { type: "button", disabled: offset === 0 || loading || review, onClick: () => { const next = Math.max(0, offset - 16); setOffset(next); loadPage(next); } }, "Previous page"),
          h(Button, { type: "button", disabled: page.next_offset === null || loading || review, onClick: () => {
            const next = page.next_offset; if (next !== null) { setOffset(next); loadPage(next); }
          } }, "Next page")),
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
