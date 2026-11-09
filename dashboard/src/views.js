(function (root) {
  "use strict";

  const { React, components } = root.ReliquaryDashboardHost;
  const h = React.createElement;
  const { Button, Select } = components;

  /** @param {string} label @param {string} value */
  function meta(label, value) {
    return h("div", { className: "rly-meta-row" }, h("dt", null, label), h("dd", null, value));
  }

  /**
   * @template T
   * @param {string} label
   * @param {import("../types").ReadHandle<T>} read
   * @param {(value: T) => unknown} render
   * @param {() => void} [resync]
   */
  function readContent(label, { state, retry }, render, resync) {
    if (state.status === "ok") return render(state.value);
    if (state.status === "loading") return h("p", { role: "status" }, "Loading " + label + "…");
    if (state.status === "idle") return h("p", { className: "rly-muted" }, label + " unavailable for this owner.");
    if (state.status === "stale_cursor" && resync) {
      return h("div", { role: "alert" },
        h("p", null, "This " + label + " page expired."),
        h(Button, { type: "button", onClick: () => { resync(); retry(); } }, "Return to first " + label + " page"));
    }
    const reason = state.status === "unavailable" || state.status === "unsupported"
      ? label + " unavailable."
      : "Could not load " + label + " (" + state.code + ").";
    return h("div", { role: "status", className: "rly-read-message" },
      h("p", null, reason),
      state.retryable && h(Button, { type: "button", onClick: retry }, "Retry " + label));
  }

  /** @param {string} label @param {import("../types").CursorState} cursor @param {string | null} next */
  function pager(label, cursor, next) {
    if (!cursor.current && !next) return null;
    return h("div", { className: "rly-pager" },
      h(Button, { type: "button", disabled: cursor.current === null, onClick: cursor.previous }, "Previous " + label + " page"),
      h(Button, { type: "button", disabled: next === null, onClick: () => { if (next) cursor.next(next); } }, "Next " + label + " page"));
  }

  /** @param {string} label @param {string} value @param {{value:string,label:string}[]} options @param {(value:string)=>void} onValueChange @param {boolean} [disabled] */
  function select(label, value, options, onValueChange, disabled) {
    return h("label", { className: "rly-field" }, h("span", null, label),
      h(Select, { label, value, options, onValueChange, disabled }));
  }

  /** @param {{key:string,currentTarget:HTMLButtonElement,preventDefault():void}} event */
  function navigateList(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.closest("ul")?.querySelectorAll("button") ?? []);
    const index = items.indexOf(event.currentTarget);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, next[/** @type {keyof typeof next} */ (event.key)]))]?.focus();
  }

  /** @param {{items: import("../types").MemorySummary[], selected: string | null, onSelect: (id:string)=>void}} props */
  function MemoryList({ items, selected, onSelect }) {
    if (!items.length) return h("p", { className: "rly-empty" }, "No Memories match this page.");
    return h("ul", { className: "rly-memory-list", "aria-label": "Memories in this page" },
      ...items.map((memory) => h("li", { key: memory.memory_id },
        h(Button, {
          type: "button", className: "rly-memory-button", "aria-current": selected === memory.memory_id ? "true" : undefined,
          onClick: () => onSelect(memory.memory_id), onKeyDown: navigateList,
        },
          h("strong", null, memory.title ?? "Memory " + memory.memory_id),
          h("span", null, memory.excerpt),
          h("small", null, [memory.category, memory.memory_type, memory.lifecycle, "rev " + memory.revision].join(" · "))))));
  }

  /** @param {import("../types").ProvenanceSource[]} sources */
  function provenanceList(sources) {
    if (!sources.length) return h("p", { className: "rly-muted" }, "No source records for this revision.");
    return h("ul", { className: "rly-provenance-list" }, ...sources.map((source, index) => {
      if (source.kind === "hermes_snapshot") {
        return h("li", { key: index },
          h("strong", null, source.label),
          h("span", null, source.profile_namespace + " · Session " + source.session_id + " · Message " + source.message_uid),
          source.range
            ? h("div", null,
                h("span", null, "UTF-8 bytes " + source.range.start_byte + "–" + source.range.end_byte),
                h("blockquote", null, source.range.text))
            : h("span", { className: "rly-muted" }, "Exact grounding quote span unavailable."));
      }
      if (source.kind === "user_origin") {
        return h("li", { key: index }, h("strong", null, "User-origin record"),
          h("span", null, "Principal " + source.principal_id + " · " + source.created_at_ms));
      }
      return h("li", { key: index }, h("strong", null, "Source unavailable"), h("span", null, source.reason));
    }));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope,memoryId:string}} props */
  function Inspector({ client, scope, memoryId }) {
    const { useRead, useCursor } = root.ReliquaryDashboardState;
    const sdk = root.ReliquaryDashboardHost;
    const [revision, setRevision] = sdk.hooks.useState(/** @type {string | null} */ (null));
    const cursor = useCursor();
    const detail = useRead(client, "ui.memory_detail", scope, { memory_id: memoryId, revision });
    const history = useRead(client, "ui.memory_history", scope, scope.owner?.capabilities.history
      ? { memory_id: memoryId, cursor: cursor.current, limit: 3 } : null);
    const exactRevision = detail.state.status === "ok" ? detail.state.value.body.revision : null;
    const provenance = useRead(client, "ui.provenance", scope, exactRevision && scope.owner?.capabilities.provenance
      ? { memory_id: memoryId, revision: exactRevision } : null);

    return h("div", null,
      readContent("Memory detail", detail, ({ memory, body, tombstone, superseded_by }) => h("div", null,
        h("h2", null, memory.title ?? "Memory " + memory.memory_id),
        h("dl", { className: "rly-detail-meta" },
          meta("Memory ID", memory.memory_id), meta("Revision", body.revision),
          meta("Lifecycle", memory.lifecycle), meta("Canonical", memory.canonical_status),
          body.body_id && meta("Body ID", body.body_id),
          memory.freshness && meta("Freshness", memory.freshness.native_value + " at " + memory.freshness.as_of_cut),
          superseded_by && meta("Superseded by", superseded_by)),
        tombstone && h("p", { role: "status" }, "Tombstoned Memory"),
        h("h3", null, "Body"),
        h("p", { className: "rly-body" }, body.content ?? "Body availability is " + body.availability + "."))),
      h("h3", null, "Revision history"),
      revision && h(Button, { type: "button", onClick: () => setRevision(null) }, "Show current revision"),
      readContent("history", history, ({ revisions }) => h("div", null,
        revisions.items.length
          ? h("ul", { className: "rly-history" }, ...revisions.items.map((row) => h("li", { key: row.revision },
            h(Button, { type: "button", "aria-pressed": row.revision === exactRevision,
              onClick: () => setRevision(row.revision) }, "Revision " + row.revision + " · " + row.availability))))
          : h("p", { className: "rly-muted" }, "No retained revisions on this page."),
        pager("history", cursor, revisions.next_cursor)), cursor.reset),
      h("h3", null, "Provenance"),
      exactRevision && readContent("provenance", provenance, (value) => provenanceList(value.sources)));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope,live?:boolean}} props */
  function Status({ client, scope, live = false }) {
    const read = root.ReliquaryDashboardState.useRead(client, "ui.operational_status", scope, scope.owner?.capabilities.status ? {} : null);
    return h("div", { className: "rly-status-card" },
      h("strong", null, "Operational activity"),
      readContent("operational status", read, (status) => h("dl", null,
        meta("Copied source", status.source_state === "tombstoned" ? "Tombstoned source" : status.source_state),
        meta("Worker", status.worker_state),
        meta("Pending / held / errors", [status.pending_count, status.held_count, status.error_count].join(" / ")),
        status.accepted_source_cursor && meta("Source cursor", status.accepted_source_cursor),
        status.last_completed_receipt && meta("Last completed receipt", status.last_completed_receipt),
        meta("Latest recall", status.latest_recall.state),
        meta("Candidate Memories", live ? "Unavailable" : status.latest_recall.candidate_ids.join(", ") || "None"),
        meta("Selected Memories", status.latest_recall.selected_ids.join(", ") || "None"),
        meta("Returned Memories", status.latest_recall.returned_ids.join(", ") || "None"))));
  }

  root.ReliquaryDashboardViews = { meta, readContent, pager, select, MemoryList, Inspector, Status };
})(globalThis);
