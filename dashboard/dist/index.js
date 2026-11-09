/* Generated from dashboard/src. Rebuild with node dashboard/scripts/build.cjs. */

(function (root) {
  "use strict";

  /** @typedef {import("../types").DashboardWireRequest} WireRequest */
  /** @typedef {import("../types").ScopedDashboardResponse | import("../types").OwnerSessionsResponse} Success */

  /** @type {Record<import("../types").ReadOperation, keyof import("../types").CapabilityFlags | null>} */
  const requiredCapability = {
    "ui.owner_sessions": null,
    "ui.memory_list": "view",
    "ui.memory_detail": "view",
    "ui.memory_history": "history",
    "ui.provenance": "provenance",
    "ui.graph_page": "graph",
    "ui.community_list": "community",
    "ui.community_members": "community",
    "ui.operational_status": "status",
  };

  /** @param {import("../types").OwnerBinding} binding @param {import("../types").OwnerBinding} owner @param {keyof import("../types").CapabilityFlags} capability */
  function matchesOwner(binding, owner, capability) {
    return binding.owner_id === owner.owner_id && binding.owner_kind === owner.owner_kind &&
      binding.display_label === owner.display_label && binding.generation === owner.generation && binding.cut === owner.cut &&
      binding.capabilities.view && binding.capabilities[capability] &&
      Object.entries(binding.capabilities).every(([key, granted]) =>
        !granted || owner.capabilities[/** @type {keyof import("../types").CapabilityFlags} */ (key)]);
  }

  /** @param {{next_cursor:string|null,truncated:boolean}} page @param {string|null} cursor */
  function advances(page, cursor) {
    return page.next_cursor === null || (page.truncated && page.next_cursor !== cursor);
  }

  /** @template T @param {import("../types").Page<T>} page @param {import("../types").PageArgs} args @param {(item:T)=>string} id */
  function matchesPage(page, args, id) {
    return page.items.length <= args.limit && new Set(page.items.map(id)).size === page.items.length && advances(page, args.cursor);
  }

  /** @param {WireRequest} request @param {Success} response */
  function matchesTarget(request, response) {
    switch (request.operation) {
      case "ui.owner_sessions":
        return response.operation === request.operation && response.binding === null &&
          (request.session_id === null || response.result.active_session_id === request.session_id) &&
          matchesPage(response.result.owners, request.arguments, (owner) => owner.owner_id) &&
          response.result.owners.items.every((owner) => owner.capabilities.view &&
            (owner.owner_kind === "REL" || owner.owner_id === response.result.active_phy_id));
      case "ui.memory_list":
        return response.operation === request.operation &&
          matchesPage(response.result, request.arguments, (item) => item.memory_id) &&
          response.result.items.every((item) => item.freshness === null || item.freshness.as_of_cut === request.cut);
      case "ui.memory_detail":
        return response.operation === request.operation &&
          response.result.memory.memory_id === request.arguments.memory_id &&
          (request.arguments.revision === null || response.result.body.revision === request.arguments.revision);
      case "ui.memory_history":
        return response.operation === request.operation && response.result.memory_id === request.arguments.memory_id &&
          matchesPage(response.result.revisions, request.arguments, (item) => item.revision);
      case "ui.provenance":
        return response.operation === request.operation && response.result.memory_id === request.arguments.memory_id &&
          response.result.revision === request.arguments.revision;
      case "ui.graph_page": {
        if (response.operation !== request.operation) return false;
        const { nodes, edges } = response.result;
        const nodeIds = new Set(nodes.map((node) => node.node_id));
        return nodes.length <= request.arguments.node_limit && edges.length <= request.arguments.edge_limit &&
          nodeIds.size === nodes.length && new Set(edges.map((edge) => edge.edge_id)).size === edges.length &&
          nodes.every((node) => node.cut === request.cut) &&
          edges.every((edge) => edge.cut === request.cut && nodeIds.has(edge.source_id) && nodeIds.has(edge.target_id)) &&
          advances(response.result, request.arguments.cursor);
      }
      case "ui.community_list":
        return response.operation === request.operation &&
          matchesPage(response.result.communities, request.arguments, (item) => item.community_id);
      case "ui.community_members":
        return response.operation === request.operation && response.result.community_id === request.arguments.community_id &&
          response.result.generation === request.arguments.expected_generation &&
          matchesPage(response.result.members, request.arguments, (item) => item);
      case "ui.operational_status":
        return response.operation === request.operation && response.result.session_id === request.session_id;
    }
  }

  let sequence = 0;

  /**
   * @param {import("../types").DashboardTransport} transport
   * @param {import("../types").SessionChoice[]} [sessions]
   * @param {import("../types").PhyChoice[]} [phys]
   * @param {() => void} [resetTransport]
   * @returns {import("../types").DashboardClient}
   */
  function createClient(transport, sessions = [], phys = [], resetTransport) {
    let epoch = 0;
    return {
      sessions: () => sessions.slice(),
      phys: () => phys.slice(),
      invalidate() { epoch += 1; resetTransport?.(); },
      async read(operation, scope, args, signal) {
        signal.throwIfAborted();
        const owner = operation === "ui.owner_sessions" ? null : scope.owner;
        const capability = requiredCapability[operation];
        if (capability && (!owner?.capabilities.view || !owner.capabilities[capability])) {
          return { status: "denied", code: "capability_denied", retryable: false };
        }
        const request = /** @type {WireRequest} */ ({
          protocol_version: 1, request_id: "dashboard-" + ++sequence, operation,
          profile_id: "fixture-profile", principal_id: "fixture-principal", session_id: scope.sessionId,
          owner_id: owner?.owner_id ?? null, generation: owner?.generation ?? null, cut: owner?.cut ?? null,
          expected_revision: null, idempotency_key: null, arguments: args,
        });
        const started = epoch;
        try {
          const response = await transport(request, signal);
          signal.throwIfAborted();
          if (started !== epoch || response.protocol_version !== 1 || response.request_id !== request.request_id ||
            response.operation !== operation) return { status: "conflict", code: "response_scope_changed", retryable: false };
          if (response.status !== "ok") {
            if (response.binding !== null) return { status: "conflict", code: "invalid_error_binding", retryable: false };
            return { status: response.status, code: response.result.code, retryable: response.result.retryable };
          }
          if ((capability && (!response.binding || !owner || !matchesOwner(response.binding, owner, capability))) ||
            !matchesTarget(request, response)) {
            return { status: "conflict", code: "response_binding_mismatch", retryable: false };
          }
          return { status: "ok", value: /** @type {import("../types").ReadResults[typeof operation]} */ (response.result) };
        } catch {
          signal.throwIfAborted();
          return { status: "error", code: "request_failed", retryable: true };
        }
      },
    };
  }

  const api = { createClient };
  root.ReliquaryDashboardClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);


(function (root) {
  "use strict";

  const endpoint = "/api/plugins/reliquary-hermes/dashboard-v1";

  /** @param {import("../types").HermesDashboardSDK["authedFetch"]} authedFetch */
  function createLiveClient(authedFetch) {
    return root.ReliquaryDashboardClient.createClient(async (request, signal) => {
      /** @param {import("../types").DashboardErrorResponse["status"]} status @param {string} code @param {boolean} retryable */
      function failure(status, code, retryable) {
        return /** @type {import("../types").DashboardErrorResponse} */ ({
          protocol_version: 1, request_id: request.request_id, operation: request.operation,
          status, binding: null, result: { code, retryable },
        });
      }

      if (request.operation !== "ui.owner_sessions") {
        return failure("unsupported", "operation_unwired", false);
      }
      const response = await authedFetch(endpoint, {
        method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" },
        // The profile and principal fields are wire placeholders. Hermes and the service supply authority.
        body: JSON.stringify({ ...request, profile_id: "dashboard", principal_id: "dashboard" }),
      });
      if (response.status === 401 || response.status === 403) return failure("denied", "dashboard_denied", false);
      if (response.status === 400) return failure("invalid", "invalid_request", false);
      if (!response.ok) return failure("unavailable", "dashboard_unavailable", true);
      return response.json();
    });
  }

  const api = { createLiveClient };
  root.ReliquaryDashboardLive = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);


(function (root) {
  "use strict";

  /**
   * @template {import("../types").ReadOperation} K
   * @param {import("../types").DashboardClient} client
   * @param {K} operation
   * @param {import("../types").ReadScope} scope
   * @param {import("../types").ReadArgs[K] | null} args
   * @returns {import("../types").ReadHandle<import("../types").ReadResults[K]>}
   */
  function useRead(client, operation, scope, args) {
    const { useState, useEffect } = /** @type {import("../types").HermesDashboardSDK} */ (window.__HERMES_PLUGIN_SDK__).hooks;
    const [attempt, setAttempt] = useState(0);
    const [snapshot, setSnapshot] = useState(/** @type {{ client: import("../types").DashboardClient, key: string, state: import("../types").ReadOutcome<import("../types").ReadResults[K]> } | null} */ (null));
    const key = JSON.stringify([operation, scope, args, attempt]);

    useEffect(() => {
      if (args === null) return;
      const controller = new AbortController();
      client.read(operation, scope, args, controller.signal).then((state) => {
        if (!controller.signal.aborted) setSnapshot({ client, key, state });
      }, () => {
        if (!controller.signal.aborted) {
          setSnapshot({ client, key, state: { status: "error", code: "request_failed", retryable: true } });
        }
      });
      return () => controller.abort();
    }, [client, key]);

    return {
      state: args === null ? { status: "idle" } : snapshot?.client === client && snapshot.key === key ? snapshot.state : { status: "loading" },
      retry: () => setAttempt((value) => value + 1),
    };
  }

  /** @returns {import("../types").CursorState} */
  function useCursor() {
    const { useState } = /** @type {import("../types").HermesDashboardSDK} */ (window.__HERMES_PLUGIN_SDK__).hooks;
    const [trail, setTrail] = useState(/** @type {(string | null)[]} */ ([null]));
    return {
      current: trail[trail.length - 1],
      next: (cursor) => setTrail((previous) => [...previous, cursor]),
      previous: () => setTrail((previous) => previous.length > 1 ? previous.slice(0, -1) : previous),
      reset: () => setTrail([null]),
    };
  }

  root.ReliquaryDashboardState = { useRead, useCursor };
})(globalThis);


(function (root) {
  "use strict";

  /** @param {string} type @param {Record<string,unknown>|null} props @param {...unknown} children */
  function h(type, props, ...children) {
    const sdk = /** @type {import("../types").HermesDashboardSDK} */ (window.__HERMES_PLUGIN_SDK__);
    return sdk.React.createElement(type, props, ...children);
  }

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
        h("button", { type: "button", onClick: () => { resync(); retry(); } }, "Return to first " + label + " page"));
    }
    const reason = state.status === "unavailable" || state.status === "unsupported"
      ? label + " unavailable."
      : "Could not load " + label + " (" + state.code + ").";
    return h("div", { role: "status", className: "rly-read-message" },
      h("p", null, reason),
      state.retryable && h("button", { type: "button", onClick: retry }, "Retry " + label));
  }

  /** @param {string} label @param {import("../types").CursorState} cursor @param {string | null} next */
  function pager(label, cursor, next) {
    if (!cursor.current && !next) return null;
    return h("div", { className: "rly-pager" },
      h("button", { type: "button", disabled: cursor.current === null, onClick: cursor.previous }, "Previous " + label + " page"),
      h("button", { type: "button", disabled: next === null, onClick: () => { if (next) cursor.next(next); } }, "Next " + label + " page"));
  }

  /** @param {string} label @param {string} value @param {{value:string,label:string}[]} options @param {(value:string)=>void} onChange */
  function select(label, value, options, onChange) {
    return h("label", { className: "rly-field" }, h("span", null, label),
      h("select", {
        value,
        onChange: (/** @type {{currentTarget: HTMLSelectElement}} */ event) => onChange(event.currentTarget.value),
      }, ...options.map((option) => h("option", { key: option.value, value: option.value }, option.label))));
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
        h("button", {
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
          h("span", null, "UTF-8 bytes " + source.range.start_byte + "–" + source.range.end_byte),
          h("blockquote", null, source.range.text));
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
    const { useRead, useCursor } = ReliquaryDashboardState;
    const sdk = /** @type {import("../types").HermesDashboardSDK} */ (window.__HERMES_PLUGIN_SDK__);
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
      revision && h("button", { type: "button", onClick: () => setRevision(null) }, "Show current revision"),
      readContent("history", history, ({ revisions }) => h("div", null,
        revisions.items.length
          ? h("ul", { className: "rly-history" }, ...revisions.items.map((row) => h("li", { key: row.revision },
            h("button", { type: "button", "aria-pressed": row.revision === exactRevision,
              onClick: () => setRevision(row.revision) }, "Revision " + row.revision + " · " + row.availability))))
          : h("p", { className: "rly-muted" }, "No retained revisions on this page."),
        pager("history", cursor, revisions.next_cursor)), cursor.reset),
      h("h3", null, "Provenance"),
      exactRevision && readContent("provenance", provenance, (value) => provenanceList(value.sources)));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope}} props */
  function Status({ client, scope }) {
    const read = ReliquaryDashboardState.useRead(client, "ui.operational_status", scope, scope.owner?.capabilities.status ? {} : null);
    return h("div", { className: "rly-status-card" },
      h("strong", null, "Fixture activity"),
      readContent("operational status", read, (status) => h("dl", null,
        meta("Copied source", status.source_state === "tombstoned" ? "Tombstoned source" : status.source_state),
        meta("Worker", status.worker_state),
        meta("Pending / held / errors", [status.pending_count, status.held_count, status.error_count].join(" / ")),
        status.accepted_source_cursor && meta("Source cursor", status.accepted_source_cursor),
        status.last_completed_receipt && meta("Last completed receipt", status.last_completed_receipt),
        meta("Latest recall", status.latest_recall.state),
        meta("Candidate Memories", status.latest_recall.candidate_ids.join(", ") || "None"),
        meta("Selected Memories", status.latest_recall.selected_ids.join(", ") || "None"),
        meta("Returned Memories", status.latest_recall.returned_ids.join(", ") || "None"))));
  }

  root.ReliquaryDashboardViews = { meta, readContent, pager, select, MemoryList, Inspector, Status };
})(globalThis);


(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0" || typeof sdk.authedFetch !== "function") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }

  const h = sdk.React.createElement;
  const authedFetch = sdk.authedFetch;
  const { useState } = sdk.hooks;
  const { useRead, useCursor } = ReliquaryDashboardState;
  const { meta, readContent, pager } = ReliquaryDashboardViews;

  function DashboardTab() {
    const [client] = useState(() => ReliquaryDashboardLive.createLiveClient(authedFetch));
    const [sessionId, setSession] = useState(/** @type {string | null} */ (null));
    const [sessionInput, setSessionInput] = useState("");
    const cursor = useCursor();
    const read = useRead(client, "ui.owner_sessions", { owner: null, sessionId }, { cursor: cursor.current, limit: 128 });

    /** @param {{preventDefault():void}} event */
    function findSession(event) {
      event.preventDefault();
      const next = sessionInput.trim() || null;
      cursor.reset();
      client.invalidate();
      setSession(next);
      read.retry();
    }

    return h("section", { className: "rly-dashboard", "aria-label": "Reliquary dashboard" },
      h("header", { className: "rly-header" }, h("div", null,
        h("p", { className: "rly-eyebrow" }, "HERMES WEB DASHBOARD PLUGIN"),
        h("h1", null, "Reliquary Memory"),
        h("p", { className: "rly-subtitle" }, "Owners in this Hermes profile"))),
      h("div", { className: "rly-main" },
        h("form", { onSubmit: findSession, className: "rly-session-lookup" },
          h("label", { className: "rly-field" }, "Hermes session ID", h("input", {
            value: sessionInput, maxLength: 128, autoComplete: "off",
            onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setSessionInput(event.currentTarget.value),
          })),
          h("button", { type: "submit" }, "Look up session")),
        readContent("owner and session bindings", read, (data) => h("section", { "aria-label": "Owner and session bindings" },
          h("dl", { className: "rly-owner-meta" },
            meta("Selected session", data.active_session_id ?? "None"),
            meta("Session REL", data.session_owner_id ?? "None"),
            meta("Active PHY", data.active_phy_id ?? "None")),
          h("h2", null, "Configured owners"),
          data.owners.items.length
            ? h("ul", { className: "rly-live-owners" }, ...data.owners.items.map((owner) =>
              h("li", { key: owner.owner_id }, h("strong", null, owner.display_label),
                h("span", null, owner.owner_kind + " · " + owner.owner_id))))
            : h("p", { className: "rly-empty" }, "No owners on this page."),
          pager("owner", cursor, data.owners.next_cursor)), cursor.reset)),
      h("p", { className: "rly-live-notice", role: "note" },
        "Memory, graph, community, and activity reads are unavailable in this live slice."));
  }

  registry.register("reliquary-hermes", DashboardTab);
})(window);
