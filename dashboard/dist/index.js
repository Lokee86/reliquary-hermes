/* Generated from dashboard/src. Rebuild with node dashboard/scripts/build.cjs. */

(function () {
function createReliquarySurface(options) {
  const { React, hooks = React } = options;
  const runtime = { crypto: globalThis.crypto, ReliquaryDashboardHost: { React, hooks } };
  (function (globalThis, module) {
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

  function newRequestId() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

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

      let response;
      try {
        response = await authedFetch(endpoint, {
          method: "POST", cache: "no-store", signal,
          headers: { "Content-Type": "application/json" },
          // Host-authenticated identity and authority are resolved server-side.
          body: JSON.stringify({ ...request, profile_id: "dashboard", principal_id: "dashboard" }),
        });
      } catch {
        signal.throwIfAborted();
        return failure("unavailable", "dashboard_unavailable", true);
      }
      if (response.status === 401 || response.status === 403) return failure("denied", "dashboard_denied", false);
      if (response.status === 400) return failure("invalid", "invalid_request", false);
      if (response.status === 409) return failure("conflict", "dashboard_conflict", false);
      if (!response.ok) return failure("unavailable", "dashboard_unavailable", true);
      try {
        return await response.json();
      } catch {
        return failure("unavailable", "invalid_dashboard_response", false);
      }
    });
  }

  /**
   * @param {import("../types").HermesDashboardSDK["authedFetch"]} authedFetch
   * @returns {import("../types-owner-content").DashboardMutationWriter}
   */
  function createLiveMutation(authedFetch) {
    /**
     * @param {import("../types-owner-content").DashboardMutationOperation} operation
     * @param {import("../types").ReadScope & {owner:import("../types").OwnerBinding}} scope
     * @param {Record<string,string|null>} args
     * @param {string|null} expectedRevision
     * @param {string} idempotencyKey
     * @param {AbortSignal} signal
     * @returns {Promise<import("../types-owner-content").DashboardMutationOutcome>}
     */
    return async function write(operation, scope, args, expectedRevision, idempotencyKey, signal) {
      const owner = scope.owner;
      const capability = {
        "ui.memory_create": "memory_create", "ui.memory_edit": "memory_edit", "ui.memory_retire": "memory_retire",
        "ui.relation_change": "relation_edit", "ui.community_rename": "community_rename",
      }[operation];
      const capabilityKey = /** @type {keyof import("../types").CapabilityFlags} */ (capability);
      if (owner.owner_kind !== "REL" || !owner.capabilities.view || !owner.capabilities.manage || !owner.capabilities[capabilityKey]) {
        return { status: "denied", code: "capability_denied", retryable: false };
      }
      const request = {
        protocol_version: 1,
        request_id: newRequestId(),
        operation,
        profile_id: "dashboard",
        principal_id: "dashboard",
        session_id: scope.sessionId,
        owner_id: owner.owner_id,
        generation: owner.generation,
        cut: owner.cut,
        expected_revision: expectedRevision,
        idempotency_key: idempotencyKey,
        arguments: args,
      };
      let response;
      try {
        response = await authedFetch(endpoint, {
          method: "POST", cache: "no-store", signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
      } catch {
        signal.throwIfAborted();
        return { status: "error", code: "dashboard_unavailable", retryable: true };
      }
      if (response.status === 401 || response.status === 403) {
        return { status: "denied", code: "dashboard_denied", retryable: false };
      }
      if (response.status === 400) return { status: "invalid", code: "invalid_request", retryable: false };
      if (response.status === 409) return { status: "conflict", code: "dashboard_conflict", retryable: false };
      if (!response.ok) return { status: "unavailable", code: "dashboard_unavailable", retryable: true };

      let value;
      try { value = await response.json(); }
      catch { return { status: "unavailable", code: "invalid_dashboard_response", retryable: false }; }
      if (value.protocol_version !== 1 || value.request_id !== request.request_id || value.operation !== operation) {
        return { status: "conflict", code: "response_correlation_mismatch", retryable: false };
      }
      if (value.status !== "ok") {
        if (value.binding !== null) return { status: "conflict", code: "invalid_error_binding", retryable: false };
        return { status: value.status, code: value.result.code, retryable: value.result.retryable };
      }
      signal.throwIfAborted();
      const binding = value.binding;
      const result = value.result;
      const capsDoNotWiden = Object.entries(binding?.capabilities ?? {}).every(([key, granted]) =>
        !granted || owner.capabilities[/** @type {keyof import("../types").CapabilityFlags} */ (key)]);
      const validBinding = binding && binding.owner_id === owner.owner_id && binding.owner_kind === owner.owner_kind &&
        binding.display_label === owner.display_label && binding.generation === owner.generation &&
        capsDoNotWiden && binding.capabilities.view && binding.capabilities.manage &&
        binding.capabilities[capabilityKey] && (!result.changed || binding.cut !== owner.cut);
      const validReceipt = result.request_id === request.request_id && result.idempotency_key === idempotencyKey &&
        typeof result.receipt_id === "string" && typeof result.changed === "boolean";
      if (!validBinding || !validReceipt) {
        return { status: "conflict", code: "response_binding_mismatch", retryable: false };
      }
      return { status: "ok", value: { binding, result } };
    };
  }

  const api = { createLiveClient, createLiveMutation };
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
    const { useState, useEffect } = root.ReliquaryDashboardHost.hooks;
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
    const { useState } = root.ReliquaryDashboardHost.hooks;
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
    const sdk = root.ReliquaryDashboardHost;
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


(function (root) {
  "use strict";

  /** @typedef {import("../types").GraphViewProps} GraphViewProps */
  /** @typedef {import("../types").CommunityViewProps} CommunityViewProps */

  function getReact() {
    const sdk = root.ReliquaryDashboardHost;
    if (!sdk || !sdk.React) throw new Error("Hermes host React is unavailable");
    return sdk.React;
  }

  /** @param {GraphViewProps} props */
  function GraphView(props) {
    const React = getReact();
    const h = React.createElement;
    const { nodes, edges, truncated, next_cursor } = props.graph;
    const pageNote = next_cursor ? " · more pages" : truncated ? " · result limited" : "";
    const width = 760;
    const height = 420;
    const positioned = nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / Math.max(nodes.length, 1) - Math.PI / 2;
      const radiusX = Math.min(265, Math.max(72, 38 * nodes.length));
      const radiusY = Math.min(135, Math.max(52, 22 * nodes.length));
      return { node, x: width / 2 + Math.cos(angle) * radiusX, y: height / 2 + Math.sin(angle) * radiusY };
    });
    const coords = new Map(positioned.map((entry) => [entry.node.node_id, entry]));
    const selectedNode = props.selected?.kind === "node" ? nodes.find((node) => node.node_id === props.selected?.id) : null;
    const selectedEdge = props.selected?.kind === "edge" ? edges.find((edge) => edge.edge_id === props.selected?.id) : null;

    /** @param {{key:string,currentTarget:SVGElement,preventDefault():void}} event */
    function navigateNodes(event) {
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
      const current = event.currentTarget;
      const group = current.closest("svg");
      const controls = group ? Array.from(group.querySelectorAll("g.rly-graph-node"), (item) => /** @type {SVGElement} */ (item)) : [];
      const index = controls.indexOf(current);
      if (index < 0 || controls.length === 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      controls[(index + delta + controls.length) % controls.length].focus();
    }

    return h("section", { className: "rly-graph-view", "aria-label": "Bounded Memory graph" },
      h("p", { className: "rly-graph-summary" }, `${nodes.length} nodes · ${edges.length} edges${pageNote}`),
      nodes.length > 0
        ? h("div", { className: "rly-graph-canvas" },
          h("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": "Graph connections. Focus a node and use arrow keys to move between nodes." },
            h("g", { className: "rly-graph-edges", "aria-label": "Connections" }, ...edges.map((edge) => {
              const from = coords.get(edge.source_id);
              const to = coords.get(edge.target_id);
              if (!from || !to) return null;
              const active = props.selected?.kind === "edge" && props.selected.id === edge.edge_id;
              return h("g", { key: `edge:${edge.edge_id}`, className: `rly-graph-edge${active ? " is-selected" : ""}` },
                h("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, className: "rly-graph-edge-line", "aria-hidden": "true" }),
                h("line", {
                  x1: from.x, y1: from.y, x2: to.x, y2: to.y,
                  className: "rly-graph-edge-hit", stroke: "transparent", strokeWidth: 16,
                  role: "button", tabIndex: 0, "aria-pressed": active, "aria-label": `${edge.kind} connection from ${from.node.label} to ${to.node.label}${edge.active ? "" : " (inactive)"}`,
                  onClick: () => props.onSelect({ kind: "edge", id: edge.edge_id }),
                  onKeyDown: (/** @type {KeyboardEvent} */ event) => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onSelect({ kind: "edge", id: edge.edge_id }); }
                  },
                }));
            })),
            h("g", { className: "rly-graph-nodes" }, ...positioned.map(({ node, x, y }) => {
              const active = props.selected?.kind === "node" && props.selected.id === node.node_id;
              return h("g", {
                key: `node:${node.node_id}`, transform: `translate(${x} ${y})`,
                className: `rly-graph-node${active ? " is-selected" : ""}`,
                role: "button", tabIndex: 0, "aria-pressed": active,
                "aria-label": `${node.kind}: ${node.label}${node.memory_id ? ", open Memory" : ""}`,
                onClick: () => props.onSelect({ kind: "node", id: node.node_id }),
                onDoubleClick: () => props.onExpand(node.node_id),
                onKeyDown: (/** @type {{key:string,currentTarget:SVGElement,preventDefault():void}} */ event) => {
                  navigateNodes(event);
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onSelect({ kind: "node", id: node.node_id }); }
                  if (event.key === "e" || event.key === "E") { event.preventDefault(); props.onExpand(node.node_id); }
                },
              },
                h("rect", { x: -77, y: -23, width: 154, height: 46, rx: 10 }),
                h("text", { x: 0, y: 5, textAnchor: "middle" }, node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label));
            }))))
        : h("p", { className: "rly-graph-empty" }, "No graph nodes on this page."),
      (selectedNode || selectedEdge) && h("aside", { className: "rly-graph-inspector", "aria-live": "polite", "aria-label": "Selected graph item" },
        selectedNode && h("div", { className: "rly-graph-selection-details" },
          h("h3", null, selectedNode.label),
          h("dl", null,
            h("dt", null, "Type"), h("dd", null, selectedNode.kind),
            h("dt", null, "Origin"), h("dd", null, selectedNode.origin),
            h("dt", null, "Revision / cut"), h("dd", null, `${selectedNode.revision} · ${selectedNode.cut}`)),
          h("button", { type: "button", onClick: () => props.onExpand(selectedNode.node_id) }, "Expand neighborhood")),
        selectedEdge && h("div", { className: "rly-graph-selection-details" },
          h("h3", null, `${selectedEdge.kind} connection`),
          h("dl", null,
            h("dt", null, "Origin"), h("dd", null, selectedEdge.origin),
            h("dt", null, "Status"), h("dd", null, selectedEdge.active ? "Active" : "Inactive"),
            h("dt", null, "From / to"), h("dd", null, `${selectedEdge.source_id} → ${selectedEdge.target_id}`),
            h("dt", null, "Revision / cut"), h("dd", null, `${selectedEdge.revision} · ${selectedEdge.cut}`)))));
  }

  /** @param {CommunityViewProps} props */
  function CommunityView(props) {
    const React = getReact();
    const h = React.createElement;
    const { communities, members, selected, onCommunity, onMemory, onNextCommunities, onNextMembers } = props;
    const communityRows = communities.items.map((community) => h("li", { key: community.community_id },
      h("button", {
        type: "button", className: `rly-community-button${selected?.community_id === community.community_id ? " is-selected" : ""}`,
        "aria-pressed": selected?.community_id === community.community_id, onClick: () => onCommunity(community),
      }, h("strong", null, community.name ?? `Community ${community.community_id}`),
      h("span", null, `${community.member_count} members · ${community.name_origin}`))));
    const memberRows = members?.items.map((memoryId) => h("li", { key: memoryId },
      h("button", { type: "button", onClick: () => onMemory(memoryId) }, memoryId))) ?? [];
    const nextCommunity = communities.next_cursor;
    const nextMember = members?.next_cursor;

    return h("section", { className: "rly-community-view", "aria-label": "Communities" },
      h("div", { className: "rly-community-layout" },
        h("div", { className: "rly-community-list-pane" },
          communityRows.length ? h("ul", { className: "rly-community-list" }, ...communityRows)
            : h("p", { className: "rly-muted" }, "No communities on this page."),
          nextCommunity && h("button", { type: "button", onClick: () => onNextCommunities(nextCommunity) }, "Next community page")),
        h("div", { className: "rly-community-members-pane" },
          h("h3", null, "Members"),
          selected && h("p", { className: "rly-muted" }, `Community generation ${selected.generation}`),
          memberRows.length ? h("ul", { className: "rly-community-members" }, ...memberRows) : null,
          members && !memberRows.length && h("p", { className: "rly-muted" }, "No members on this page."),
          !selected && h("p", { className: "rly-muted" }, "Choose a community to inspect its members."),
          nextMember && h("button", { type: "button", onClick: () => onNextMembers(nextMember) }, "Next member page"))));
  }

  root.ReliquaryDashboardGraph = { GraphView, CommunityView };
})(globalThis);


(function (root) {
  "use strict";

  const sdk = root.ReliquaryDashboardHost;
  const h = sdk.React.createElement;
  const { useState, useEffect, useRef } = sdk.hooks;
  const { useRead } = root.ReliquaryDashboardState;

  function requestKey() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** @param {import("../types-owner-content").DashboardMutationOutcome|null} outcome @param {(()=>void)|undefined} onRefresh */
  function resultMessage(outcome, onRefresh) {
    if (!outcome) return null;
    if (outcome.status === "ok") {
      return h("p", { className: "rly-write-success", role: "status" },
        `Saved. Receipt ${outcome.value.result.receipt_id}. Use Refresh owner data to inspect the committed Memory.`);
    }
    const conflict = outcome.status === "conflict" || outcome.status === "stale_cursor";
    return h("div", { className: "rly-write-error", role: "status" },
      h("p", null, conflict ? "The owner changed after this draft was loaded." :
        `Could not save this draft (${outcome.code}). The draft and request key are preserved.`),
      conflict && onRefresh && h("button", { type: "button", onClick: onRefresh }, "Refresh owner data"),
      !conflict && outcome.retryable && h("p", { className: "rly-muted" }, "Submit again to retry this same draft."));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},memoryId:string,detail:import("../types").MemoryDetail|null,detailState:import("../types").ReadState<import("../types").MemoryDetail>,write:import("../types-owner-content").DashboardMutationWriter,onRefresh?:()=>void,refreshing:boolean}} props */
  function CorrectionForm({ scope, memoryId, detail, detailState, write, onRefresh, refreshing }) {
    const [draft, setDraft] = useState(() => /** @type {{title:string,body:string,key:string,baseRevision:string|null,initialized:boolean}} */
      ({ title: "", body: "", key: requestKey(), baseRevision: null, initialized: false }));
    const [outcome, setOutcome] = useState(/** @type {import("../types-owner-content").DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));
    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [scope.owner.owner_id, scope.owner.generation, scope.owner.cut, scope.sessionId]);
    useEffect(() => {
      if (detail?.body.availability === "available" && !draft.initialized) {
        setDraft((old) => old.initialized ? old : {
          ...old, title: detail.memory.title ?? "", body: detail.body.content ?? "",
          baseRevision: detail.body.revision, initialized: true,
        });
      }
    }, [detail?.body.revision, detail?.body.availability]);

    /** @param {"title"|"body"} field @param {string} value */
    function edit(field, value) {
      setDraft((old) => ({ ...old, [field]: value, key: requestKey() }));
      setOutcome(null);
    }
    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (pending || refreshing || outcome?.status === "ok" || !detail || detail.memory.lifecycle !== "active" ||
          detail.body.availability !== "available" || !draft.initialized ||
          !draft.title.trim() || !draft.body.trim() || !detail.body.revision) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.memory_edit", scope, {
          memory_id: memoryId, title: draft.title, body: draft.body,
        }, detail.body.revision, draft.key, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }
    return h("form", { className: "rly-memory-write-form", onSubmit: submit },
      h("h3", null, "Correct selected Memory"),
      detailState.status !== "ok" && h("p", { className: "rly-muted", role: "status" },
        detailState.status === "loading" ? "Loading the exact current Memory revision…" :
          `Current Memory detail is unavailable (${detailState.status === "idle" ? "unavailable" : detailState.code}).`),
      draft.baseRevision && detail && draft.baseRevision !== detail.body.revision &&
        h("p", { className: "rly-write-conflict", role: "status" },
          `Draft started from revision ${draft.baseRevision}; latest revision is ${detail.body.revision}. Review before resubmitting.`),
      detail && detail.memory.revision !== detail.body.revision && h("p", { className: "rly-muted" }, "The exact body revision differs from the summary revision."),
      h("label", { className: "rly-field" }, h("span", null, "Replacement title"), h("input", {
        value: draft.title, maxLength: 128,
        onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("title", event.currentTarget.value),
      })),
      h("label", { className: "rly-field" }, h("span", null, "Replacement body"), h("textarea", {
        value: draft.body, maxLength: 32768, rows: 5,
        onChange: (/** @type {{currentTarget:HTMLTextAreaElement}} */ event) => edit("body", event.currentTarget.value),
      })),
      h("button", { type: "submit", disabled: pending || refreshing || outcome?.status === "ok" || !detail || detail.memory.lifecycle !== "active" ||
        detail.body.availability !== "available" ||
        !draft.initialized || !draft.title.trim() || !draft.body.trim() }, pending ? "Saving…" : "Save correction"),
      resultMessage(outcome, onRefresh));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},memoryId:string|null,write?:import("../types-owner-content").DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props */
  function MemoryMutationPanel({ client, scope, memoryId, write, onRefresh, refreshing = false }) {
    const [draft, setDraft] = useState(() => ({ title: "", body: "", category: "fact", memory_type: "general", key: requestKey() }));
    const [outcome, setOutcome] = useState(/** @type {import("../types-owner-content").DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));
    const capabilities = scope.owner.capabilities;
    const canCreate = !!write && scope.owner.owner_kind === "REL" && capabilities.manage && capabilities.memory_create;
    const canEdit = !!write && scope.owner.owner_kind === "REL" && capabilities.manage && capabilities.memory_edit;
    const canRetire = !!write && scope.owner.owner_kind === "REL" && capabilities.manage && capabilities.memory_retire;
    const detail = useRead(client, "ui.memory_detail", scope, memoryId && (canEdit || canRetire)
      ? { memory_id: memoryId, revision: null } : null);
    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [scope.owner.owner_id, scope.owner.generation, scope.owner.cut, scope.sessionId]);

    /** @param {"title"|"body"|"category"|"memory_type"} field @param {string} value */
    function edit(field, value) {
      setDraft((old) => ({ ...old, [field]: value, key: requestKey() }));
      setOutcome(null);
    }
    /** @param {{preventDefault():void}} event */
    async function submitCreate(event) {
      event.preventDefault();
      if (!write || pending || refreshing || outcome?.status === "ok" || !draft.title.trim() || !draft.body.trim()) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.memory_create", scope, {
          title: draft.title, body: draft.body, category: draft.category, memory_type: draft.memory_type,
        }, null, draft.key, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    if (scope.owner.owner_kind !== "REL" || !write || (!canCreate && !canEdit && !canRetire)) return null;
    return h("section", { className: "rly-memory-write-panel", "aria-label": "Memory management" },
      canCreate && h("form", { className: "rly-memory-write-form", onSubmit: submitCreate },
        h("h3", null, "Create user-origin Memory"),
        h("label", { className: "rly-field" }, h("span", null, "Title"), h("input", {
          value: draft.title, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("title", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Body"), h("textarea", {
          value: draft.body, maxLength: 32768, rows: 5,
          onChange: (/** @type {{currentTarget:HTMLTextAreaElement}} */ event) => edit("body", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Category"), h("input", {
          value: draft.category, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("category", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Memory type"), h("input", {
          value: draft.memory_type, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("memory_type", event.currentTarget.value),
        })),
        h("button", { type: "submit", disabled: pending || refreshing || outcome?.status === "ok" || !draft.title.trim() || !draft.body.trim() || !draft.category.trim() || !draft.memory_type.trim() },
          pending ? "Saving…" : "Create Memory"), resultMessage(outcome, onRefresh)),
      canEdit && memoryId && h(CorrectionForm, { key: memoryId, client, scope, memoryId,
        detail: detail.state.status === "ok" ? detail.state.value : null,
        detailState: detail.state, write, onRefresh, refreshing }),
      canRetire && detail.state.status === "ok" && detail.state.value.memory.lifecycle === "superseded" &&
        detail.state.value.superseded_by && h(RetirementForm, {
          key: detail.state.value.memory.memory_id, scope, write, onRefresh, refreshing,
          memory: detail.state.value.memory,
        }));
  }

  /** @param {{scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},
   * memory:import("../types").MemorySummary,write:import("../types-owner-content").DashboardMutationWriter,
   * onRefresh?:()=>void,refreshing:boolean}} props */
  function RetirementForm({ scope, memory, write, onRefresh, refreshing }) {
    const [key] = useState(requestKey);
    const [confirmed, setConfirmed] = useState(false);
    const [pending, setPending] = useState(false);
    const [outcome, setOutcome] = useState(/** @type {import("../types-owner-content").DashboardMutationOutcome|null} */ (null));
    const controller = useRef(/** @type {AbortController|null} */ (null));
    useEffect(() => {
      setPending(false);
      setConfirmed(false);
      return () => controller.current?.abort();
    }, [scope.owner.cut, memory.revision]);

    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (!confirmed || pending || refreshing || outcome?.status === "ok") return;
      const active = new AbortController();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.memory_retire", scope, { memory_id: memory.memory_id, effect: "retire" },
          memory.revision, key, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    return h("form", { className: "rly-memory-write-form", onSubmit: submit },
      h("h3", null, "Retire superseded Memory"),
      h("label", { className: "rly-confirmation" },
        h("input", { type: "checkbox", checked: confirmed, disabled: pending,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setConfirmed(event.currentTarget.checked),
        }), " Confirm terminal retirement of this revision"),
      h("button", { type: "submit", disabled: !confirmed || pending || refreshing || outcome?.status === "ok" },
        pending ? "Saving…" : "Retire Memory"),
      resultMessage(outcome, onRefresh));
  }

  root.ReliquaryDashboardMutations = /** @type {typeof root.ReliquaryDashboardMutations} */ ({ MemoryMutationPanel });
})(globalThis);


(function (root) {
  "use strict";

  /** @typedef {import("../types").GraphPageResponse["result"]} GraphPage */
  /** @typedef {import("../types").OwnerBinding} OwnerBinding */
  /** @typedef {import("../types").ReadScope & {owner: OwnerBinding}} MutationScope */
  /** @typedef {import("../types-owner-content").DashboardMutationWriter} DashboardMutationWriter */
  /** @typedef {import("../types-owner-content").DashboardMutationOutcome} DashboardMutationOutcome */

  const sdk = root.ReliquaryDashboardHost;
  const h = sdk.React.createElement;
  const { useState, useEffect, useRef } = sdk.hooks;

  function requestKey() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return hex;
  }

  /** @param {unknown} value */
  function safeCode(value) {
    return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)
      ? value : "unknown_error";
  }

  /** @param {{outcome:DashboardMutationOutcome|null,onRefresh?:()=>void}} props */
  function OutcomeMessage({ outcome, onRefresh }) {
    if (!outcome) return null;
    if (outcome.status === "ok") {
      return h("div", { className: "rly-write-success", role: "status" },
        h("p", null, "Saved. Receipt ", outcome.value.result.receipt_id,
          ". Refresh owner data to inspect the committed change."),
        onRefresh && h("button", { type: "button", onClick: onRefresh }, "Refresh owner data"));
    }
    const conflict = outcome.status === "conflict" || outcome.status === "stale_cursor";
    return h("div", { className: "rly-write-error", role: "status" },
      h("p", null, conflict ? "The owner changed after this draft was loaded."
        : "Could not save this draft (", safeCode(outcome.code), "). The draft and request key are preserved."),
      conflict && onRefresh && h("button", { type: "button", onClick: onRefresh }, "Refresh owner data"),
      !conflict && outcome.retryable && h("p", { className: "rly-muted" }, "Submit again to retry this same draft."));
  }

  /** @param {{scope:MutationScope,graph:GraphPage|null,write?:DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props */
  function RelationMutationPanel({ scope, graph, write, onRefresh, refreshing = false }) {
    const [mode, setMode] = useState(/** @type {"link"|"unlink"} */ ("link"));
    const [sourceId, setSourceId] = useState("");
    const [targetId, setTargetId] = useState("");
    const [edgeId, setEdgeId] = useState("");
    const [draftKey, setDraftKey] = useState(requestKey);
    const [outcome, setOutcome] = useState(/** @type {DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));

    const owner = scope.owner;
    const canEdit = !!write && owner.owner_kind === "REL"
      && owner.capabilities.view && owner.capabilities.manage && owner.capabilities.relation_edit;
    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [owner.owner_id, owner.generation, owner.cut, scope.sessionId]);

    const nodes = (graph?.nodes ?? []).filter((node) => node.kind === "memory" && node.memory_id
      && node.cut === owner.cut && node.node_id === node.memory_id);
    const byId = new Map(nodes.map((node) => [node.memory_id, node]));
    const edges = (graph?.edges ?? []).filter((edge) => edge.kind === "user_association"
      && edge.origin === "user" && edge.active && edge.cut === owner.cut
      && byId.has(edge.source_id) && byId.has(edge.target_id));
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    const selectedEdge = edges.find((edge) => edge.edge_id === edgeId);
    const duplicate = !!source && !!target && (graph?.edges ?? []).some((edge) => edge.active
      && edge.kind === "user_association" && edge.origin === "user"
      && ((edge.source_id === sourceId && edge.target_id === targetId)
        || (edge.source_id === targetId && edge.target_id === sourceId)));
    const canSubmit = canEdit && !!graph && !pending && !refreshing && (mode === "link"
      ? !!source && !!target && sourceId !== targetId && !duplicate
      : !!selectedEdge);

    /** @param {()=>void} edit */
    function changed(edit) {
      edit();
      setDraftKey(requestKey());
      setOutcome(null);
    }

    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (!canSubmit || !write || !graph) return;
      // The visible graph page, selected endpoints, and action all belong to the
      // exact owner cut sent by the shared mutation writer.
      if (graph.nodes.some((node) => node.cut !== owner.cut) || graph.edges.some((edge) => edge.cut !== owner.cut)) {
        setOutcome({ status: "conflict", code: "graph_cut_changed", retryable: false });
        return;
      }
      const endpoints = mode === "link" ? [source, target]
        : selectedEdge ? [byId.get(selectedEdge.source_id), byId.get(selectedEdge.target_id)] : [];
      const [from, to] = endpoints;
      if (!from?.memory_id || !to?.memory_id || (mode === "unlink" && !selectedEdge)) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      const args = mode === "link"
        ? {
            source_id: from.memory_id,
            target_id: to.memory_id,
            source_revision: from.revision,
            target_revision: to.revision,
            action: "link",
            relation_kind: "user_association",
            edge_id: null,
          }
        : {
            source_id: from.memory_id,
            target_id: to.memory_id,
            source_revision: from.revision,
            target_revision: to.revision,
            action: "unlink",
            relation_kind: "user_association",
            edge_id: selectedEdge?.edge_id ?? null,
          };
      const expectedRevision = mode === "link" ? null : selectedEdge?.revision ?? null;
      try {
        const result = await write("ui.relation_change", scope, args, expectedRevision, draftKey, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    if (!canEdit) return null;
    return h("section", { className: "rly-graph-write-panel", "aria-label": "User association" },
      h("h3", null, "User association"),
      h("p", { className: "rly-muted" }, "Changes are checked against the current owner cut and Memory revisions."),
      h("form", { className: "rly-memory-write-form", onSubmit: submit },
        h("label", { className: "rly-field" },
          h("span", null, "Action"),
          h("select", {
            value: mode, disabled: pending,
            onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) => changed(() => {
              setMode(/** @type {"link"|"unlink"} */ (event.currentTarget.value));
              setOutcome(null);
            }),
          }, h("option", { value: "link" }, "Link two Memories"),
          h("option", { value: "unlink" }, "Unlink an existing user association"))),
        mode === "link"
          ? h("div", null,
            h("label", { className: "rly-field" }, h("span", null, "From Memory"), h("select", {
              value: sourceId, disabled: pending,
              onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) =>
                changed(() => setSourceId(event.currentTarget.value)),
            }, h("option", { value: "" }, "Choose a Memory"),
            ...nodes.map((node) => h("option", { key: node.memory_id, value: node.memory_id }, node.label)))),
            h("label", { className: "rly-field" }, h("span", null, "To Memory"), h("select", {
              value: targetId, disabled: pending,
              onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) =>
                changed(() => setTargetId(event.currentTarget.value)),
            }, h("option", { value: "" }, "Choose a Memory"),
            ...nodes.map((node) => h("option", { key: node.memory_id, value: node.memory_id }, node.label)))),
            duplicate && h("p", { className: "rly-muted" }, "These Memories already have an active user association."),
          )
          : h("label", { className: "rly-field" }, h("span", null, "Active user association"), h("select", {
            value: edgeId, disabled: pending,
            onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) =>
              changed(() => setEdgeId(event.currentTarget.value)),
          }, h("option", { value: "" }, "Choose an association"),
          ...edges.map((edge) => h("option", { key: edge.edge_id, value: edge.edge_id },
            `${byId.get(edge.source_id)?.label} → ${byId.get(edge.target_id)?.label}`)))),
        h("button", { type: "submit", disabled: !canSubmit },
          pending ? "Saving…" : mode === "link" ? "Link Memories" : "Unlink association"),
        h(OutcomeMessage, { outcome, onRefresh })));
  }

  /** @param {{scope:MutationScope,community:import("../types").Community|null,write?:DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props */
  function CommunityRenamePanel({ scope, community, write, onRefresh, refreshing = false }) {
    const [name, setName] = useState(() => community?.name ?? "");
    const [draftKey, setDraftKey] = useState(requestKey);
    const [outcome, setOutcome] = useState(/** @type {DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));
    const owner = scope.owner;
    const canRename = !!write && owner.owner_kind === "REL"
      && owner.capabilities.view && owner.capabilities.manage && owner.capabilities.community_rename;

    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [owner.owner_id, owner.generation, owner.cut, scope.sessionId]);

    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (!canRename || pending || refreshing || !community || !write || !name.trim()) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.community_rename", scope, {
          community_id: community.community_id,
          name,
        }, community.generation, draftKey, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    if (!canRename) return null;
    return h("section", { className: "rly-community-rename", "aria-label": "Rename community" },
      h("form", { className: "rly-memory-write-form", onSubmit: submit },
        h("h3", null, "Rename selected community"),
        !community && h("p", { className: "rly-muted" }, "Current community metadata is unavailable."),
        h("label", { className: "rly-field" }, h("span", null, "Community name"), h("input", {
          value: name, maxLength: 128, disabled: pending,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
            const value = event.currentTarget.value;
            setName(value); setDraftKey(requestKey()); setOutcome(null);
          },
        })),
        h("button", { type: "submit", disabled: pending || refreshing || !community || !name.trim() },
          pending ? "Saving…" : "Save community name"),
        h(OutcomeMessage, { outcome, onRefresh })));
  }

  root.ReliquaryDashboardMutations = Object.assign(
    root.ReliquaryDashboardMutations || {},
    { RelationMutationPanel, CommunityRenamePanel },
  );
  if (typeof module !== "undefined" && module.exports) module.exports = { RelationMutationPanel, CommunityRenamePanel };
})(globalThis);


(function (root) {
  "use strict";

  /** @param {any} type @param {any} props @param {...any} children */
  const h = (type, props, ...children) => root.ReliquaryDashboardHost.React.createElement(type, props, ...children);
  const { useState, useEffect } = root.ReliquaryDashboardHost.hooks;
  const { useRead, useCursor } = root.ReliquaryDashboardState;
  const { meta, readContent, select, pager, MemoryList, Inspector } = root.ReliquaryDashboardViews;
  const { GraphView, CommunityView } = root.ReliquaryDashboardGraph;
  const { MemoryMutationPanel, RelationMutationPanel, CommunityRenamePanel } = root.ReliquaryDashboardMutations;
  const initialFilters = { query: "", category: null, memory_type: null, lifecycle: null, community_id: null };
  const lifecycleOptions = ["active", "retired", "tombstoned", "superseded", "unavailable"];

  /** @param {{filters:import("../types").MemoryFilters,communities:import("../types").Community[],onChange:(filters:import("../types").MemoryFilters)=>void}} props */
  function Filters({ filters, communities, onChange }) {
    /** @param {"query"|"category"|"memory_type"} key @param {string} label */
    function input(key, label) {
      return h("label", { className: "rly-field" }, h("span", null, label), h("input", {
        type: key === "query" ? "search" : "text", value: filters[key] ?? "",
        maxLength: key === "query" ? 1024 : 128,
        onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
          const value = event.currentTarget.value;
          onChange({ ...filters, [key]: key === "query" ? value : value || null });
        },
      }));
    }
    return h("div", { className: "rly-filters" }, input("query", "Search Memories"),
      h("details", null, h("summary", null, "Filters"), h("div", { className: "rly-filter-fields" },
        input("category", "Category"), input("memory_type", "Memory type"),
        select("Lifecycle", filters.lifecycle ?? "", [{ value: "", label: "Any" },
          ...lifecycleOptions.map((value) => ({ value, label: value }))],
        (value) => onChange({ ...filters, lifecycle: /** @type {import("../types").MemoryFilters["lifecycle"]} */
          (lifecycleOptions.find((option) => option === value) ?? null) })),
        select("Community", filters.community_id ?? "", [{ value: "", label: "Any" },
          ...communities.map((item) => ({ value: item.community_id, label: item.name ?? item.community_id }))],
        (value) => onChange({ ...filters, community_id: value || null })),
        h("button", { type: "button", onClick: () => onChange(initialFilters) }, "Clear filters"))));
  }

  /** Shared HU02 owner content. Scope is always bound to an admitted owner.
   * @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},write?:import("../types-owner-content").DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props
   */
  function OwnerContent({ client, scope, write, onRefresh, refreshing = false }) {
    const [mode, setMode] = useState(/** @type {import("../types").ViewMode} */ ("graph"));
    const [filters, setFilters] = useState(/** @type {import("../types").MemoryFilters} */ (initialFilters));
    const [memoryId, setMemoryId] = useState(/** @type {string|null} */ (null));
    const [selection, setSelection] = useState(/** @type {import("../types").GraphSelection|null} */ (null));
    const [seedId, setSeedId] = useState(/** @type {string|null} */ (null));
    const [graphCommunity, setGraphCommunity] = useState(/** @type {string|null} */ (null));
    const [community, setCommunity] = useState(/** @type {import("../types").Community|null} */ (null));
    const listCursor = useCursor();
    const graphCursor = useCursor();
    const communitiesCursor = useCursor();
    const membersCursor = useCursor();
    useEffect(() => {
      listCursor.reset(); graphCursor.reset(); communitiesCursor.reset(); membersCursor.reset();
      setSelection(null); setSeedId(null); setGraphCommunity(null);
    }, [scope.owner.owner_id, scope.owner.generation, scope.owner.cut, scope.sessionId]);
    const grants = scope.owner?.capabilities;
    const list = useRead(client, "ui.memory_list", scope, mode === "list" && grants?.view
      ? { cursor: listCursor.current, limit: 3, filters } : null);
    const graph = useRead(client, "ui.graph_page", scope, mode === "graph" && grants?.graph
      ? { cursor: graphCursor.current, seed_ids: seedId ? [seedId] : [], community_id: graphCommunity,
        depth: seedId ? 2 : 1, node_limit: seedId ? 6 : 4, edge_limit: 12 } : null);
    const communities = useRead(client, "ui.community_list", scope, grants?.community
      ? { cursor: communitiesCursor.current, limit: 3 } : null);
    const availableCommunities = communities.state.status === "ok" ? communities.state.value.communities.items : [];
    const currentCommunity = availableCommunities.find((item) => item.community_id === community?.community_id) ?? null;
    const members = useRead(client, "ui.community_members", scope, currentCommunity && grants?.community
      ? { cursor: membersCursor.current, limit: 3, community_id: currentCommunity.community_id,
        expected_generation: currentCommunity.generation } : null);

    /** @param {string} id */
    function selectMemory(id) { setMemoryId(id); setSelection(null); }
    /** @param {import("../types").MemoryFilters} next */
    function changeFilters(next) {
      setFilters(next); listCursor.reset(); setMemoryId(null); setSelection(null);
    }
    /** @param {import("../types").Community|null} next */
    function changeCommunity(next) { setCommunity(next); membersCursor.reset(); }
    /** @param {import("../types").GraphPageResponse["result"]} page */
    function graphContent(page) {
      const memoryNode = page.nodes.find((node) => node.memory_id && node.memory_id === memoryId);
      const selected = selection ?? (memoryNode ? { kind: "node", id: memoryNode.node_id } : null);
      return h("div", null, h(GraphView, {
        graph: page, selected,
        onSelect: (/** @type {import("../types").GraphSelection} */ next) => {
          setSelection(next);
          const node = next.kind === "node" ? page.nodes.find((item) => item.node_id === next.id) : null;
          setMemoryId(node?.memory_id ?? null);
          if (node?.community_id && node.kind === "community") {
            changeCommunity(availableCommunities.find((item) => item.community_id === node.community_id) ?? null);
          }
        },
        onExpand: (/** @type {string} */ nodeId) => { graphCursor.reset(); setSeedId(nodeId); },
      }), pager("graph", {
        ...graphCursor,
        next: (cursor) => { setSelection(null); graphCursor.next(cursor); },
        previous: () => { setSelection(null); graphCursor.previous(); },
      }, page.next_cursor));
    }

    return h("div", { className: "rly-owner-content" },
      h("main", { className: "rly-main", "aria-label": "Memory graph or list" },
        h("div", { className: "rly-view-switch", role: "group", "aria-label": "Memory view" },
          h("button", { type: "button", "aria-pressed": mode === "graph", onClick: () => setMode("graph") }, "Graph page"),
          h("button", { type: "button", "aria-pressed": mode === "list", onClick: () => setMode("list") }, "List page")),
        mode === "graph" ? h("section", { "aria-label": "Memory graph" },
          (seedId || graphCommunity) && h("button", { type: "button", onClick: () => {
            graphCursor.reset(); setSelection(null); setSeedId(null); setGraphCommunity(null);
          } }, "Reset graph"),
          readContent("graph", graph, graphContent, graphCursor.reset),
          write && h(RelationMutationPanel, { scope, write, onRefresh, refreshing,
            graph: graph.state.status === "ok" ? graph.state.value : null }))
          : h("section", { "aria-label": "Memory list" }, h(Filters, { filters, communities: availableCommunities, onChange: changeFilters }),
            readContent("Memory list", list, (page) => h("div", null,
              h(MemoryList, { items: page.items, selected: memoryId, onSelect: selectMemory }),
              pager("Memory", listCursor, page.next_cursor)), listCursor.reset)),
        grants?.community && h("section", { className: "rly-communities", "aria-label": "Communities" },
          h("h2", null, "Communities"), readContent("communities", communities, (value) => h("div", null,
            h(CommunityView, {
              communities: value.communities, selected: community,
              members: members.state.status === "ok" ? members.state.value.members : null,
              onCommunity: changeCommunity, onMemory: selectMemory,
              onNextCommunities: (/** @type {string} */ cursor) => { changeCommunity(null); communitiesCursor.next(cursor); },
              onNextMembers: membersCursor.next,
            }),
            communitiesCursor.current && h("button", { type: "button", onClick: () => {
              changeCommunity(null); communitiesCursor.previous();
            } }, "Previous community page"),
            membersCursor.current && h("button", { type: "button", onClick: membersCursor.previous }, "Previous member page"),
            community && members.state.status !== "ok" && readContent("community members", members, () => null, membersCursor.reset),
            community && grants.graph && h("button", { type: "button", onClick: () => {
              graphCursor.reset(); setSeedId(null); setSelection(null); setGraphCommunity(community.community_id); setMode("graph");
            } }, "Show community in graph")), communitiesCursor.reset),
          write && community && h(CommunityRenamePanel, { key: community.community_id, scope, write,
            onRefresh, refreshing, community: currentCommunity }))),
      h("aside", { className: "rly-inspector", "aria-label": "Selected Memory inspector" },
        h("p", { className: "rly-eyebrow" }, "INSPECTOR"),
        h("p", { className: "rly-owner-label" }, scope.owner.owner_kind + " · " + scope.owner.display_label),
        memoryId && scope.owner.capabilities.view
          ? h(Inspector, { key: memoryId, client, scope, memoryId })
          : h("p", { className: "rly-muted" }, scope.owner.capabilities.view
            ? "Select a Memory to inspect its detail, history, and provenance."
            : "Memory detail is unavailable for this owner."),
        h(MemoryMutationPanel, { client, scope, memoryId, write, onRefresh, refreshing })));
  }

  root.ReliquaryDashboardOwner = { OwnerContent };
})(globalThis);


(function (root) {
  "use strict";

  const endpoint = "/api/plugins/reliquary-hermes/setup-v1";
  const messages = new Map([
    ["runtime_unavailable", "The Reliquary host is unavailable. Check the plugin installation."],
    ["preflight_unavailable", "The Reliquary host could not validate these files."],
    ["managed_setup", "This Hermes profile is managed and does not allow local setup changes."],
    ["service_restart_required", "Stop the running Reliquary service before changing these settings."],
    ["setup_request_too_large", "The selected paths exceed the setup request limit."],
    ["invalid_setup_request", "Check the paths and project IDs, then try again."],
    ["setup_denied", "Hermes did not authorize setup in this profile."],
    ["setup_unavailable", "Could not reach Reliquary setup. Try again."],
    ["invalid_setup_response", "Reliquary returned an invalid setup response."],
    ["picker_failed", "Hermes Desktop could not open the file picker."],
    ["main_path", "Enter an absolute local path for the main REL."],
    ["phy_path", "Enter an absolute local path for the active PHY."],
    ["config_path", "Enter an absolute local path for the Reliquary config."],
    ["project_path", "Enter an absolute local path for each project REL."],
    ["project_id", "Use a distinct ID for each project, starting with a letter or number."],
  ]);

  /** @param {unknown} error */
  function message(error) {
    return messages.get(error instanceof Error ? error.message : "") ?? "Could not complete Reliquary setup.";
  }

  /** @param {string} path */
  function localPath(path) {
    return /^(?:[a-z]:[\\/]|\/(?!\/))/i.test(path) && !path.includes("\0") &&
      new TextEncoder().encode(path).length <= 4096;
  }

  /**
   * @param {string} main
   * @param {string} phy
   * @param {string} config
   * @param {{id:string,path:string}[]} projects
   * @returns {import("../types").SetupCandidate}
   */
  function candidate(main, phy, config, projects) {
    const main_rel = main.trim();
    const active_phy = phy.trim();
    const config_path = config.trim() || null;
    if (!localPath(main_rel)) throw new Error("main_path");
    if (!localPath(active_phy)) throw new Error("phy_path");
    if (config_path && !localPath(config_path)) throw new Error("config_path");
    const entries = new Map();
    for (const { id, path } of projects) {
      const key = id.trim();
      const value = path.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key) || entries.has(key)) throw new Error("project_id");
      if (!localPath(value)) throw new Error("project_path");
      entries.set(key, value);
    }
    return { main_rel, active_phy, projects: Object.fromEntries(entries), config_path };
  }

  /**
   * @param {import("../types").HermesDashboardSDK["authedFetch"]} authedFetch
   * @returns {import("../types").SetupClient}
   */
  function createSetupClient(authedFetch) {
    /**
     * @param {"status"|"validate"|"apply"} operation
     * @param {AbortSignal} signal
     * @param {import("../types").SetupCandidate} [value]
     */
    async function request(operation, signal, value) {
      signal.throwIfAborted();
      let response;
      try {
        response = await authedFetch(endpoint + "/" + operation, value ? {
          method: "POST", signal, cache: "no-store", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        } : { method: "GET", signal, cache: "no-store" });
      } catch {
        signal.throwIfAborted();
        throw new Error("setup_unavailable");
      }
      const data = await response.json().catch(() => null);
      signal.throwIfAborted();
      if (!response.ok) {
        const known = messages.has(data?.detail) ? data.detail : null;
        throw new Error(known ?? (response.status === 401 || response.status === 403 ? "setup_denied" : "setup_unavailable"));
      }
      if (operation === "status") {
        if (typeof data?.configured !== "boolean" || typeof data.runtime_detected !== "boolean" ||
            !data.defaults || !data.defaults.projects) throw new Error("invalid_setup_response");
        return { ...data, desktop_native_mutations: data.desktop_native_mutations === true };
      }
      if (!(operation === "apply" && data?.valid === true && data.configured === true)) {
        if (typeof data?.valid !== "boolean" || !data.main_rel || !data.active_phy || !data.projects || !data.config ||
            (operation === "apply" && data.configured !== false)) throw new Error("invalid_setup_response");
      }
      return data;
    }

    return {
      status: (signal) => request("status", signal),
      validate: (value, signal) => request("validate", signal, value),
      apply: (value, signal) => request("apply", signal, value),
    };
  }

  const api = { createSetupClient, candidate, message };
  root.ReliquarySetupClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);


(function (root) {
  "use strict";

  const { React, hooks } = root.ReliquaryDashboardHost;
  const h = React.createElement;
  const { useEffect, useRef, useState } = hooks;
  const { candidate, message } = root.ReliquarySetupClient;

  /** @typedef {import("../types").SetupOwner} SetupOwner */
  /** @typedef {import("../types").SetupCheck} SetupCheck */
  /** @typedef {import("../types").SetupPicker} SetupPicker */
  /** @typedef {Parameters<SetupPicker>[0]} PathKind */
  /** @typedef {{ key: number, id: string, path: string }} Project */

  /** @param {SetupCheck | SetupOwner} result */
  function checkText(result) {
    const details = "kind" in result
      ? [result.kind?.toUpperCase(), result.owner_id, result.scope].filter(Boolean).join(" · ")
      : "";
    const state = !result.accepted ? "Rejected" : result.opened ? "Accepted" : "No file selected";
    const error = result.error ? result.error.replaceAll("_", " ") : "";
    return [state, details, error].filter(Boolean).join(" · ");
  }

  /** @type {typeof root.ReliquaryOnboarding.Onboarding} */
  function Onboarding({ status, setup, pickOpenPath, mutationsEnabled, onConnected }) {
    const [main, setMain] = useState(status.defaults.main_rel ?? "");
    const [phy, setPhy] = useState(status.defaults.active_phy ?? "");
    const [config, setConfig] = useState(status.defaults.config_path ?? "");
    const [projects, setProjects] = useState(/** @type {Project[]} */ (
      Object.entries(status.defaults.projects).map(([id, path], key) => ({ id, path, key }))
    ));
    const nextKey = useRef(projects.length);
    const pending = useRef(/** @type {AbortController | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [report, setReport] = useState(/** @type {import("../types").SetupReport | null} */ (null));
    const canSubmit = mutationsEnabled && status.runtime_detected;

    useEffect(() => () => pending.current?.abort(), []);

    function clearResult() {
      setReport(null);
      setError("");
    }

    /** @param {"validate"|"apply"} action */
    async function submit(action) {
      if (!canSubmit || pending.current) return;
      clearResult();
      let selected;
      try {
        selected = candidate(main, phy, config, projects);
      } catch (reason) {
        setError(message(reason));
        return;
      }
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const result = await setup[action](selected, controller.signal);
        if (controller.signal.aborted) return;
        if ("configured" in result && result.configured === true) {
          onConnected();
          return;
        }
        setReport(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(message(reason));
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }

    /** @param {PathKind} kind @param {(path: string) => void} update */
    async function browse(kind, update) {
      if (!pickOpenPath || pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const path = await pickOpenPath(kind);
        if (path && !controller.signal.aborted) {
          clearResult();
          update(path);
        }
      } catch {
        if (!controller.signal.aborted) setError(message(new Error("picker_failed")));
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }

    /**
     * @param {string} label
     * @param {string} value
     * @param {(next: string) => void} update
     * @param {PathKind} kind
     * @param {SetupCheck | SetupOwner} [result]
     */
    function pathField(label, value, update, kind, result) {
      return h("div", { className: "rly-setup-path" },
        h("label", { className: "rly-field" }, h("span", null, label), h("input", {
          type: "text", value, autoComplete: "off", maxLength: 4096,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
            clearResult();
            update(event.currentTarget.value);
          },
        })),
        pickOpenPath && h("button", { type: "button", onClick: () => browse(kind, update), "aria-label": "Browse for " + label }, "Browse…"),
        result && h("p", { className: "rly-setup-check", role: "status" }, checkText(result)));
    }

    /** @param {number} key @param {Partial<Project>} update */
    function changeProject(key, update) {
      clearResult();
      setProjects((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
    }

    return h("div", { className: "rly-main rly-setup-form" },
      h("dl", { className: "rly-owner-meta" },
        root.ReliquaryDashboardViews.meta("Reliquary runtime", status.runtime_detected ? "Detected" : "Unavailable"),
        root.ReliquaryDashboardViews.meta("Reliquary config", status.config_path ?? "No config detected")),
      h("form", { noValidate: true, onSubmit: (/** @type {{preventDefault():void}} */ event) => {
        event.preventDefault();
        void submit("apply");
      } },
      h("fieldset", { disabled: busy },
        h("legend", null, "Local Reliquary files"),
        pathField("Main REL path", main, setMain, "REL", report?.main_rel),
        pathField("Active PHY path", phy, setPhy, "PHY", report?.active_phy),
        pathField("Reliquary config path (optional)", config, setConfig, "config", report?.config),
        h("h2", null, "Project RELs"),
        projects.map(({ key, id, path }, index) => h("div", { className: "rly-setup-project", key: String(key) },
          h("label", { className: "rly-field" }, h("span", null, `Project ${index + 1} ID`), h("input", {
            type: "text", value: id, autoComplete: "off", maxLength: 128,
            onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) =>
              changeProject(key, { id: event.currentTarget.value }),
          })),
          pathField(`Project ${index + 1} REL path`, path, (next) => changeProject(key, { path: next }),
            "REL", report?.projects[id.trim()]),
          h("button", { type: "button", "aria-label": `Remove project ${index + 1}`, onClick: () => {
            clearResult();
            setProjects((current) => current.filter((row) => row.key !== key));
          } }, "Remove"))),
        h("button", { type: "button", disabled: projects.length >= 128, onClick: () => {
          clearResult();
          const key = nextKey.current++;
          setProjects((current) => [...current, { key, id: "", path: "" }]);
        } }, "Add project REL"),
        h("div", { className: "rly-setup-actions" },
          h("button", { type: "button", disabled: !canSubmit, onClick: () => submit("validate") }, "Validate"),
          h("button", { type: "submit", disabled: !canSubmit }, "Connect Reliquary")))),
      busy && h("p", { role: "status" }, "Working…"),
      error && h("p", { role: "alert" }, error),
      report && h("p", { role: report.valid ? "status" : "alert" },
        report.valid ? "Validation passed." : report.topology_error
          ? "Owner topology conflict (" + report.topology_error.replaceAll("_", " ") + ")."
          : "Validation failed. Check the rejected files."));
  }

  root.ReliquaryOnboarding = { Onboarding };
})(globalThis);


(function (root) {
  "use strict";

  /** @type {import("../types").CreateReliquarySurface} */
  function createSurface({ authedFetch, pickOpenPath, mutationBlockReason, surfaceLabel }) {
    const { React, hooks } = root.ReliquaryDashboardHost;
    const h = React.createElement;
    const { useState, useEffect } = hooks;
    const { useRead, useCursor } = root.ReliquaryDashboardState;
    const { meta, readContent, select, pager, Status } = root.ReliquaryDashboardViews;
    const { OwnerContent } = root.ReliquaryDashboardOwner;
    const { createLiveMutation } = root.ReliquaryDashboardLive;

    /** @param {{client: import("../types").DashboardClient, configPath: string | null, blockReason?: string}} props */
    function DashboardTab({ client, configPath, blockReason }) {
      const [write] = useState(() => blockReason ? undefined : createLiveMutation(authedFetch));
      const [sessionId, setSessionId] = useState(/** @type {string | null} */ (null));
      const [sessionInput, setSessionInput] = useState("");
      const [selectedOwnerId, setSelectedOwnerId] = useState(/** @type {string | null} */ (null));
      const [lastGood, setLastGood] = useState(/** @type {{sessionId:string|null,cursor:string|null,value:import("../types").ReadResults["ui.owner_sessions"]}|null} */ (null));
      const ownerCursor = useCursor();
      const discovery = useRead(client, "ui.owner_sessions", { owner: null, sessionId },
        { cursor: ownerCursor.current, limit: 128 });

      useEffect(() => {
        if (discovery.state.status === "ok") {
          setLastGood({ sessionId, cursor: ownerCursor.current, value: discovery.state.value });
        }
      }, [client, sessionId, ownerCursor.current, discovery.state]);
      useEffect(() => { setLastGood(null); }, [sessionId, ownerCursor.current]);
      const sameBindingPage = lastGood?.sessionId === sessionId && lastGood.cursor === ownerCursor.current;
      const refreshing = sameBindingPage && discovery.state.status === "loading";
      /** @type {import("../types").ReadHandle<import("../types").ReadResults["ui.owner_sessions"]>} */
      const visibleDiscovery = refreshing && lastGood
        ? { ...discovery, state: { status: "ok", value: lastGood.value } }
        : discovery;

      function refreshOwnerData() {
        client.invalidate();
        discovery.retry();
      }

      /** @param {{preventDefault():void}} event */
      function findSession(event) {
        event.preventDefault();
        const requested = sessionInput.trim() || null;
        if (requested === sessionId) { discovery.retry(); return; }
        client.invalidate();
        ownerCursor.reset();
        setSelectedOwnerId(null);
        setLastGood(null);
        setSessionId(requested);
      }

      return h("section", { className: "rly-dashboard", "aria-label": "Reliquary live dashboard" },
        h("header", { className: "rly-header" }, h("div", null,
          h("p", { className: "rly-eyebrow" }, surfaceLabel),
          h("h1", null, "Reliquary Memory"),
          h("p", { className: "rly-subtitle" }, "Configured owners in this Hermes profile"))),
        blockReason && h("p", { className: "rly-live-notice", role: "note" }, blockReason),
        refreshing && h("p", { className: "rly-refreshing", role: "status" },
          write ? "Refreshing owner binding. Writes are paused until it completes." : "Refreshing owner binding."),
        readContent("owner and session bindings", visibleDiscovery, (data) => {
          const owners = data.owners.items.filter((owner) => owner.capabilities.view &&
            (owner.owner_kind === "REL" || owner.owner_id === data.active_phy_id));
          const mappedRel = owners.find((owner) => owner.owner_kind === "REL" && owner.owner_id === data.session_owner_id) ?? null;
          const phy = owners.find((owner) => owner.owner_kind === "PHY" && owner.owner_id === data.active_phy_id) ?? null;
          const selected = owners.find((owner) => owner.owner_id === selectedOwnerId) ?? null;
          const defaultOwner = mappedRel ?? owners.find((owner) => owner.owner_kind === "REL") ?? phy;
          const owner = selected ?? defaultOwner;
          const sessionMatchesOwner = !!owner && owner.owner_kind === "REL" &&
            data.active_session_id !== null && data.session_owner_id === owner.owner_id &&
            (sessionId === null || data.active_session_id === sessionId);
          // Session scope is sent only when the server returned the exact mapping for this REL.
          const scope = { owner, sessionId: sessionMatchesOwner ? data.active_session_id : null };
          const scopeKey = JSON.stringify([owner?.owner_id ?? null, owner?.generation ?? null, scope.sessionId]);
          const ownerOptions = owners.map((item) => ({
            value: item.owner_id,
            label: item.owner_kind + " · " + item.display_label,
          }));

          return h("div", { className: "rly-layout" },
            h("aside", { className: "rly-sidebar", "aria-label": "Owner and scope" },
              h("h2", null, "Owner / scope"),
              h("button", { type: "button", onClick: refreshOwnerData }, "Refresh owner data"),
              h("form", { onSubmit: findSession, className: "rly-session-lookup" },
                h("label", { className: "rly-field" }, h("span", null, "Hermes session ID"), h("input", {
                  value: sessionInput, maxLength: 128, autoComplete: "off",
                  onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setSessionInput(event.currentTarget.value),
                })), h("button", { type: "submit" }, "Look up session")),
              ownerOptions.length ? select("Browse authorized owner", owner?.owner_id ?? "", ownerOptions, (id) => {
                if (id !== selectedOwnerId) {
                  client.invalidate();
                  setSelectedOwnerId(id || null);
                }
              }) : h("p", { className: "rly-empty" }, "No viewable owner is available on this page."),
              h("dl", { className: "rly-owner-meta" },
                meta("Selected session", data.active_session_id ?? "None"),
                meta("Session REL", mappedRel?.display_label ?? (data.session_owner_id ? "Not on this page" : "None")),
                meta("Active PHY", phy?.owner_id ?? "None"),
                meta("Reliquary config", configPath ?? "No config detected"),
                owner && meta("Owner kind", owner.owner_kind),
                owner && meta("Generation", owner.generation),
                owner && meta("Cut", owner.cut),
                owner && owner.owner_kind === "REL" && data.active_session_id && !sessionMatchesOwner &&
                  meta("Session scope", "Owner-level view; selected session maps to another REL")),
              owner && h(Status, { key: scopeKey, client, scope, live: true }),
              pager("owner", ownerCursor, data.owners.next_cursor)),
            owner ? h(OwnerContent, { key: scopeKey, client, write, onRefresh: refreshOwnerData, refreshing,
              scope: /** @type {import("../types").ReadScope & {owner:import("../types").OwnerBinding}} */ (scope) })
              : h("p", { className: "rly-empty" }, "No authorized owner is available for this scope."));
        }, ownerCursor.reset));
    }


    const setup = root.ReliquarySetupClient.createSetupClient(authedFetch);
    const { Onboarding } = root.ReliquaryOnboarding;

    return function ReliquarySurface() {
      const [client] = useState(() => root.ReliquaryDashboardLive.createLiveClient(authedFetch));
      const [attempt, setAttempt] = useState(0);
      const [snapshot, setSnapshot] = useState(/** @type {{
        attempt:number, status?:import("../types").SetupStatus, error?:string
      } | null} */ (null));
      useEffect(() => {
        const controller = new AbortController();
        setup.status(controller.signal).then((status) => {
          if (!controller.signal.aborted) setSnapshot({ attempt, status });
        }, (error) => {
          if (!controller.signal.aborted) setSnapshot({ attempt, error: root.ReliquarySetupClient.message(error) });
        });
        return () => controller.abort();
      }, [attempt]);

      function refresh() {
        client.invalidate();
        setAttempt((current) => current + 1);
      }

      const current = snapshot?.attempt === attempt ? snapshot : null;
      const blockReason = current?.status && mutationBlockReason?.(current.status);
      if (current?.status?.configured) return h(DashboardTab, { client, configPath: current.status.config_path, blockReason });
      return h("section", { className: "rly-dashboard", "aria-label": current?.status ? "Reliquary setup" : "Reliquary" },
        h("header", { className: "rly-header" }, h("div", null,
          h("p", { className: "rly-eyebrow" }, surfaceLabel),
          h("h1", null, current?.status ? "Set up Reliquary" : "Reliquary Memory"),
          current?.status && h("p", { className: "rly-subtitle" }, "Connect existing Reliquary owners to this Hermes profile."))),
        blockReason && h("p", { className: "rly-live-notice", role: "note" }, blockReason),
        current?.status ? h(Onboarding, { status: current.status, setup, pickOpenPath,
          mutationsEnabled: !blockReason, onConnected: refresh }) :
          current?.error ? h("div", { role: "alert" },
            h("p", null, current.error), h("button", { type: "button", onClick: refresh }, "Retry setup status")) :
            h("p", { role: "status" }, "Checking Reliquary setup…"));
    };
  }

  root.ReliquaryDashboardSurface = createSurface;
})(globalThis);

})(runtime);
  return runtime.ReliquaryDashboardSurface(options);
}
(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0" || typeof sdk.authedFetch !== "function") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }
  registry.register("reliquary-hermes", createReliquarySurface({
    React: sdk.React, hooks: sdk.hooks, authedFetch: sdk.authedFetch, surfaceLabel: "HERMES WEB DASHBOARD PLUGIN",
  }));
})(window);

})();