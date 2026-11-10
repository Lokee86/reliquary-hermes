/* Generated from dashboard/src and desktop/src. Rebuild with node desktop/scripts/build.cjs. */
const reliquaryStyles = ".rly-dashboard {\n  display: flex;\n  flex-direction: column;\n  gap: 1rem;\n  margin: 0 auto;\n  max-width: 1680px;\n  min-height: 75vh;\n  padding: 1.25rem;\n}\n.rly-header, .rly-view-switch, .rly-memory-button, .rly-fixture-pill {\n  align-items: center;\n  display: flex;\n}\n.rly-header, .rly-toolbar { justify-content: space-between; gap: 1rem; }\n.rly-header h1 { margin: 0; }\n.rly-eyebrow { margin: 0 0 .35rem; }\n.rly-subtitle { margin: .3rem 0 0; }\n.rly-fixture-pill, .rly-live-notice { padding: .45rem .75rem; }\n.rly-layout { display: grid; gap: 1rem; grid-template-columns: minmax(180px, 220px) minmax(0, 1fr); align-items: start; }\n.rly-sidebar, .rly-main, .rly-inspector { min-width: 0; padding: 1rem; }\n.rly-sidebar h2, .rly-inspector h2 { margin-top: 0; }\n.rly-field { display: grid; grid-template-columns: minmax(0, 1fr); gap: .35rem; margin-bottom: .75rem; }\n.rly-field :is(input, textarea, [role=\"combobox\"]) { min-width: 0; width: 100%; }\n.rly-owner-meta, .rly-detail-meta { display: grid; gap: .4rem; margin: 1rem 0; }\n.rly-meta-row { display: flex; gap: .75rem; justify-content: space-between; padding: .35rem 0; }\n.rly-meta-row dd { margin: 0; max-width: 65%; overflow-wrap: anywhere; text-align: right; }\n.rly-status-card { display: grid; gap: .3rem; margin-top: 1rem; padding: .75rem; }\n.rly-view-switch { gap: .35rem; margin-bottom: 1rem; }\n.rly-memory-list, .rly-provenance-list { display: grid; gap: .6rem; list-style: none; margin: 0; padding: 0; }\n.rly-memory-button { align-items: flex-start; flex-direction: column; }\n.rly-memory-button, .rly-community-button, .rly-community-members button {\n  line-height: normal;\n  overflow-wrap: anywhere;\n  text-align: left;\n  white-space: normal;\n  width: 100%;\n}\n.rly-empty { padding: 2rem; text-align: center; }\n.rly-owner-label { overflow-wrap: anywhere; }\n.rly-inspector h3 { margin-bottom: .4rem; }\n.rly-body { overflow-wrap: anywhere; white-space: pre-wrap; }\n.rly-provenance-list li { display: grid; gap: .3rem; overflow-wrap: anywhere; padding-left: .65rem; }\n.rly-provenance-list blockquote { margin: .2rem 0; padding-left: .6rem; white-space: pre-wrap; }\n\n.rly-owner-content { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: 1rem; align-items: start; min-width: 0; }\n.rly-pager { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }\n.rly-history { list-style: none; display: grid; gap: .4rem; padding: 0; }\n.rly-filters { margin-bottom: 1rem; }\n.rly-filter-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .5rem; padding-top: .5rem; }\n.rly-communities { margin-top: 1rem; padding-top: 1rem; }\n.rly-read-message { overflow-wrap: anywhere; }\n\n@media (max-width: 1180px) {\n  .rly-owner-content { grid-template-columns: minmax(0, 1fr); }\n}\n@media (max-width: 730px) {\n  .rly-layout { grid-template-columns: minmax(0, 1fr); }\n}\n\n.rly-graph-view, .rly-community-view { min-width: 0; }\n.rly-graph-canvas { overflow: auto; }\n.rly-graph-canvas svg { display: block; width: 100%; min-width: 34rem; height: auto; }\n.rly-graph-edge-line { stroke: currentColor; stroke-opacity: .4; stroke-width: 2; }\n.rly-graph-edge.is-selected .rly-graph-edge-line { stroke-opacity: 1; stroke-width: 4; }\n.rly-graph-edge-hit, .rly-graph-node { cursor: pointer; }\n.rly-graph-edge-hit:focus { stroke: currentColor; stroke-opacity: .35; }\n.rly-graph-node rect { fill: var(--ui-bg-primary, var(--background-base, transparent)); stroke: currentColor; stroke-width: 2; }\n.rly-graph-node text { fill: currentColor; font-size: 13px; pointer-events: none; }\n.rly-graph-node:hover rect,\n.rly-graph-node:focus rect,\n.rly-graph-node.is-selected rect { stroke-width: 3; }\n\n.rly-graph-inspector { margin-top: .8rem; padding: .85rem 1rem; }\n.rly-graph-inspector h3 { margin: 0 0 .6rem; }\n.rly-graph-inspector dl { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: .3rem .8rem; margin: 0; }\n.rly-graph-inspector dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }\n\n.rly-community-layout { display: grid; grid-template-columns: minmax(14rem, .8fr) minmax(16rem, 1.2fr); gap: 1rem; }\n.rly-community-list-pane, .rly-community-members-pane { min-width: 0; }\n.rly-community-list, .rly-community-members { display: grid; gap: .5rem; margin: 0; padding: 0; list-style: none; }\n.rly-community-button { display: grid; gap: .25rem; }\n\n@media (max-width: 700px) {\n  .rly-community-layout { grid-template-columns: 1fr; }\n}\n\n.rly-session-lookup { display: flex; align-items: end; gap: .75rem; flex-wrap: wrap; }\n.rly-session-lookup .rly-field { width: min(100%, 24rem); margin-bottom: 0; }\n.rly-sidebar .rly-session-lookup { margin: .75rem 0; }\n.rly-memory-write-form { margin-top: 1rem; padding-top: .75rem; }\n.rly-confirmation { display: flex; align-items: center; gap: .5rem; }\n.rly-write-success, .rly-write-error { overflow-wrap: anywhere; }\n\n.rly-setup-form { width: min(100%, 46rem); }\n.rly-setup-form fieldset { border: 0; margin: 0; min-width: 0; padding: 0; }\n.rly-setup-form h2 { margin: 1rem 0 .6rem; }\n.rly-setup-card, .rly-setup-picker { margin-block: 1rem; }\n.rly-setup-card .rly-setup-card { padding-inline-start: 1rem; }\n.rly-setup-check, .rly-setup-value { overflow-wrap: anywhere; }\n.rly-setup-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .65rem; }\n.rly-sources { display: grid; gap: 1rem; min-width: 0; }\n.rly-sources h2, .rly-sources h3, .rly-sources p { margin-block: .25rem; }\n.rly-import-list { display: grid; gap: .65rem; list-style: none; margin: 0; padding: 0; }\n.rly-import-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: .8rem; padding: .85rem; }\n.rly-import-row > div { min-width: 0; }\n.rly-import-row .rly-detail-meta { grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .2rem .75rem; }\n.rly-import-row .rly-detail-meta > div { display: flex; gap: .4rem; min-width: 0; }\n.rly-import-row dt { font-weight: 600; }\n.rly-import-row dd { margin: 0; overflow-wrap: anywhere; }\n.rly-import-review { padding: 1rem; }\n";
function createReliquarySurface(options) {
  const { React, hooks = React, components } = options;
  const runtime = { crypto: globalThis.crypto, ReliquaryDashboardHost: { React, hooks, components } };
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
          type: "button", className: "rly-memory-button", "aria-current": selected === memory.memory_id,
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


(function (root) {
  "use strict";

  const { Button } = root.ReliquaryDashboardHost.components;

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
          h(Button, { type: "button", onClick: () => props.onExpand(selectedNode.node_id) }, "Expand neighborhood")),
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
      h(Button, {
        type: "button", className: `rly-community-button${selected?.community_id === community.community_id ? " is-selected" : ""}`,
        "aria-pressed": selected?.community_id === community.community_id, onClick: () => onCommunity(community),
      }, h("strong", null, community.name ?? `Community ${community.community_id}`),
      h("span", null, `${community.member_count} members · ${community.name_origin}`))));
    const memberRows = members?.items.map((memoryId) => h("li", { key: memoryId },
      h(Button, { type: "button", onClick: () => onMemory(memoryId) }, memoryId))) ?? [];
    const nextCommunity = communities.next_cursor;
    const nextMember = members?.next_cursor;

    return h("section", { className: "rly-community-view", "aria-label": "Communities" },
      h("div", { className: "rly-community-layout" },
        h("div", { className: "rly-community-list-pane" },
          communityRows.length ? h("ul", { className: "rly-community-list" }, ...communityRows)
            : h("p", { className: "rly-muted" }, "No communities on this page."),
          nextCommunity && h(Button, { type: "button", onClick: () => onNextCommunities(nextCommunity) }, "Next community page")),
        h("div", { className: "rly-community-members-pane" },
          h("h3", null, "Members"),
          selected && h("p", { className: "rly-muted" }, `Community generation ${selected.generation}`),
          memberRows.length ? h("ul", { className: "rly-community-members" }, ...memberRows) : null,
          members && !memberRows.length && h("p", { className: "rly-muted" }, "No members on this page."),
          !selected && h("p", { className: "rly-muted" }, "Choose a community to inspect its members."),
          nextMember && h(Button, { type: "button", onClick: () => onNextMembers(nextMember) }, "Next member page"))));
  }

  root.ReliquaryDashboardGraph = { GraphView, CommunityView };
})(globalThis);


(function (root) {
  "use strict";

  const sdk = root.ReliquaryDashboardHost;
  const h = sdk.React.createElement;
  const { Button, Input, Textarea, Checkbox } = sdk.components;
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
      conflict && onRefresh && h(Button, { type: "button", onClick: onRefresh }, "Refresh owner data"),
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
      h("label", { className: "rly-field" }, h("span", null, "Replacement title"), h(Input, {
        value: draft.title, maxLength: 128,
        onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("title", event.currentTarget.value),
      })),
      h("label", { className: "rly-field" }, h("span", null, "Replacement body"), h(Textarea, {
        value: draft.body, maxLength: 32768, rows: 5,
        onChange: (/** @type {{currentTarget:HTMLTextAreaElement}} */ event) => edit("body", event.currentTarget.value),
      })),
      h(Button, { type: "submit", disabled: pending || refreshing || outcome?.status === "ok" || !detail || detail.memory.lifecycle !== "active" ||
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
        h("label", { className: "rly-field" }, h("span", null, "Title"), h(Input, {
          value: draft.title, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("title", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Body"), h(Textarea, {
          value: draft.body, maxLength: 32768, rows: 5,
          onChange: (/** @type {{currentTarget:HTMLTextAreaElement}} */ event) => edit("body", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Category"), h(Input, {
          value: draft.category, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("category", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Memory type"), h(Input, {
          value: draft.memory_type, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("memory_type", event.currentTarget.value),
        })),
        h(Button, { type: "submit", disabled: pending || refreshing || outcome?.status === "ok" || !draft.title.trim() || !draft.body.trim() || !draft.category.trim() || !draft.memory_type.trim() },
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
        h(Checkbox, { checked: confirmed, disabled: pending,
          onCheckedChange: (/** @type {boolean | "indeterminate"} */ checked) => setConfirmed(checked === true),
        }), " Confirm terminal retirement of this revision"),
      h(Button, { type: "submit", disabled: !confirmed || pending || refreshing || outcome?.status === "ok" },
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
  const { Button, Input } = sdk.components;
  const { useState, useEffect, useRef } = sdk.hooks;
  const { select } = root.ReliquaryDashboardViews;

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
        onRefresh && h(Button, { type: "button", onClick: onRefresh }, "Refresh owner data"));
    }
    const conflict = outcome.status === "conflict" || outcome.status === "stale_cursor";
    return h("div", { className: "rly-write-error", role: "status" },
      h("p", null, conflict ? "The owner changed after this draft was loaded."
        : "Could not save this draft (", safeCode(outcome.code), "). The draft and request key are preserved."),
      conflict && onRefresh && h(Button, { type: "button", onClick: onRefresh }, "Refresh owner data"),
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
    const memoryOptions = [{ value: "", label: "Choose a Memory" },
      ...nodes.map((node) => ({ value: node.node_id, label: node.label }))];
    return h("section", { className: "rly-graph-write-panel", "aria-label": "User association" },
      h("h3", null, "User association"),
      h("p", { className: "rly-muted" }, "Changes are checked against the current owner cut and Memory revisions."),
      h("form", { className: "rly-memory-write-form", onSubmit: submit },
        select("Action", mode, [
          { value: "link", label: "Link two Memories" },
          { value: "unlink", label: "Unlink an existing user association" },
        ], (value) => changed(() => setMode(/** @type {"link"|"unlink"} */ (value))), pending),
        mode === "link"
          ? h("div", null,
            select("From Memory", sourceId, memoryOptions, (value) => changed(() => setSourceId(value)), pending),
            select("To Memory", targetId, memoryOptions, (value) => changed(() => setTargetId(value)), pending),
            duplicate && h("p", { className: "rly-muted" }, "These Memories already have an active user association."),
          )
          : select("Active user association", edgeId, [{ value: "", label: "Choose an association" },
            ...edges.map((edge) => ({ value: edge.edge_id,
              label: `${byId.get(edge.source_id)?.label} → ${byId.get(edge.target_id)?.label}` }))],
          (value) => changed(() => setEdgeId(value)), pending),
        h(Button, { type: "submit", disabled: !canSubmit },
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
        h("label", { className: "rly-field" }, h("span", null, "Community name"), h(Input, {
          value: name, maxLength: 128, disabled: pending,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
            const value = event.currentTarget.value;
            setName(value); setDraftKey(requestKey()); setOutcome(null);
          },
        })),
        h(Button, { type: "submit", disabled: pending || refreshing || !community || !name.trim() },
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
  const { Button, Input } = root.ReliquaryDashboardHost.components;
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
      return h("label", { className: "rly-field" }, h("span", null, label), h(Input, {
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
        h(Button, { type: "button", onClick: () => onChange(initialFilters) }, "Clear filters"))));
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
          h(Button, { type: "button", "aria-pressed": mode === "graph", onClick: () => setMode("graph") }, "Graph page"),
          h(Button, { type: "button", "aria-pressed": mode === "list", onClick: () => setMode("list") }, "List page")),
        mode === "graph" ? h("section", { "aria-label": "Memory graph" },
          (seedId || graphCommunity) && h(Button, { type: "button", onClick: () => {
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
            communitiesCursor.current && h(Button, { type: "button", onClick: () => {
              changeCommunity(null); communitiesCursor.previous();
            } }, "Previous community page"),
            membersCursor.current && h(Button, { type: "button", onClick: membersCursor.previous }, "Previous member page"),
            community && members.state.status !== "ok" && readContent("community members", members, () => null, membersCursor.reset),
            community && grants.graph && h(Button, { type: "button", onClick: () => {
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


(function (root) {
  "use strict";

  const endpoint = "/api/plugins/reliquary-hermes/setup-v1";
  const messages = new Map([
    ["runtime_unavailable", "The Reliquary host is unavailable. Check the plugin installation."],
    ["preflight_unavailable", "The Reliquary host could not validate these files."],
    ["managed_setup", "This Hermes profile is managed and does not allow local setup changes."],
    ["service_restart_required", "Stop the running Reliquary service for this profile, then retry connecting to start it with the new settings."],
    ["setup_request_too_large", "The selected paths exceed the setup request limit."],
    ["invalid_setup_request", "Check the selected owner paths and refresh the Hermes projects list."],
    ["setup_denied", "Hermes did not authorize setup in this profile."],
    ["setup_unavailable", "Could not reach Reliquary setup. Try again."],
    ["source_capture_setup_required", "Check this profile's Reliquary capture enrollment file, then retry setup."],
    ["invalid_setup_response", "Reliquary returned an invalid setup response."],
    ["picker_failed", "Hermes Desktop could not open the file picker."],
    ["main_path", "Enter an absolute local path for the main REL."],
    ["phy_path", "Enter an absolute local path for the active PHY."],
    ["config_path", "Enter an absolute local path for the Reliquary config."],
    ["project_path", "Enter an absolute local path for each project REL."],
    ["project_id", "Refresh the Hermes projects list and try again."],
    ["project_discovery_unavailable", "Refresh the projects list to try again."],
    ["unknown_hermes_project", "The selected project is unavailable in this Hermes profile. Refresh the projects list."],
    ["same_origin_required", "Hermes did not authorize a setup write from this surface."],
    ["invalid_owner_path", "Choose a valid local destination for the new owner file."],
    ["owner_already_exists", "A file already exists at that location. Select it or choose another destination."],
    ["owner_creation_failed", "Reliquary could not create the owner file. Check the destination before retrying."],
    ["owner_creation_unavailable", "The Reliquary host could not start owner creation."],
    ["owner_created_unverified", "Reliquary created the file but could not verify it. Use Select to check the file before retrying."],
    ["owner_creation_unconfirmed", "Reliquary could not confirm creation. Use Select to check whether the file exists before retrying."],
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
   * @param {{id:string,path:string}[]} [projects]
   * @returns {import("../types").SetupCandidate}
   */
  function candidate(main, phy, config, projects) {
    const main_rel = main.trim();
    const active_phy = phy.trim();
    const config_path = config.trim() || null;
    if (!localPath(main_rel)) throw new Error("main_path");
    if (!localPath(active_phy)) throw new Error("phy_path");
    if (config_path && !localPath(config_path)) throw new Error("config_path");
    const selection = { main_rel, active_phy, config_path };
    if (!projects) return selection;
    const entries = new Map();
    for (const { id, path } of projects) {
      const key = id.trim();
      const value = path.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key) || entries.has(key)) throw new Error("project_id");
      if (!localPath(value)) throw new Error("project_path");
      entries.set(key, value);
    }
    return { ...selection, projects: Object.fromEntries(entries) };
  }

  /**
   * @param {import("../types").HermesDashboardSDK["authedFetch"]} authedFetch
   * @returns {import("../types").SetupClient}
   */
  function createSetupClient(authedFetch) {
    /**
     * @param {string} operation
     * @param {AbortSignal} signal
     * @param {import("../types").SetupCandidate | import("../types").SetupCreateRequest} [value]
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
      return data;
    }

    /** @param {unknown} data @param {boolean} applying */
    function checkReport(data, applying) {
      const report = /** @type {Partial<import("../types").SetupReport> & {configured?: boolean} | null} */ (data);
      if (applying && report?.configured === true && report.valid === true) return report;
      if (typeof report?.valid !== "boolean" || !report.main_rel || !report.active_phy || !report.projects ||
          !report.config || (applying && report.configured !== false)) throw new Error("invalid_setup_response");
      return report;
    }

    return {
      async status(signal) {
        const data = await request("status", signal);
        if (typeof data?.configured !== "boolean" || typeof data.runtime_detected !== "boolean" ||
            !data.defaults?.projects) throw new Error("invalid_setup_response");
        return { ...data, desktop_native_mutations: data.desktop_native_mutations === true };
      },
      async projects(signal) {
        const data = await request("projects", signal);
        const projects = data?.projects;
        if (!Array.isArray(projects) || typeof data.routing_available !== "boolean" ||
            projects.some((project) =>
          typeof project?.name !== "string" || typeof project.id !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(project.id)) ||
          new Set(projects.map((project) => project.id)).size !== projects.length) {
          throw new Error("invalid_setup_response");
        }
        return data;
      },
      async create(value, signal) {
        const data = await request("create", signal, value);
        if (data?.accepted !== true || data.opened !== true || typeof data.owner_id !== "string" ||
            typeof data.path !== "string" || data.kind !== (value.kind === "phy" ? "phy" : "rel")) {
          throw new Error("owner_creation_unconfirmed");
        }
        return data;
      },
      async validate(value, signal) {
        return /** @type {import("../types").SetupReport} */ (checkReport(await request("validate", signal, value), false));
      },
      async apply(value, signal) {
        const data = checkReport(await request("apply", signal, value), true);
        return /** @type {Awaited<ReturnType<import("../types").SetupClient["apply"]>>} */ (data);
      },
    };
  }

  const api = { createSetupClient, candidate, message };
  root.ReliquarySetupClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);


(function (root) {
  "use strict";

  const { React, hooks } = root.ReliquaryDashboardHost;
  const { Button, Input } = root.ReliquaryDashboardHost.components;
  const h = React.createElement;
  const { useEffect, useRef, useState } = hooks;
  const { candidate, message } = root.ReliquarySetupClient;

  /** @typedef {import("../types").SetupOwner} SetupOwner */
  /** @typedef {import("../types").SetupCheck} SetupCheck */
  /** @typedef {import("../types").SetupPicker} SetupPicker */
  /** @typedef {Parameters<SetupPicker>[0]} PathKind */
  /** @typedef {import("../types").SetupCreateKind} CreateKind */
  /** @typedef {{ kind: PathKind, update(path: string): void, createKind?: CreateKind, projectId?: string }} PickerTarget */

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
  function Onboarding({ status, setup, pickOpenPath, pickSavePath, mutationsEnabled, onConnected }) {
    const [main, setMain] = useState(status.defaults.main_rel ?? "");
    const [phy, setPhy] = useState(status.defaults.active_phy ?? "");
    const [config, setConfig] = useState(status.defaults.config_path ?? "");
    const [assignments, setAssignments] = useState(() => new Map(Object.entries(status.defaults.projects)));
    const [inventoryAttempt, setInventoryAttempt] = useState(0);
    const [inventory, setInventory] = useState(/** @type {{
      attempt: number, value?: import("../types").SetupProjectInventory, error?: string
    } | null} */ (null));
    const [showProjectHelp, setShowProjectHelp] = useState(false);
    const [manualPaths, setManualPaths] = useState(false);
    const pending = useRef(/** @type {AbortController | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [report, setReport] = useState(/** @type {import("../types").SetupReport | null} */ (null));
    const [destination, setDestination] = useState(/** @type {{target: PickerTarget, path: string} | null} */ (null));
    const [created, setCreated] = useState(/** @type {string[]} */ ([]));
    const [review, setReview] = useState(/** @type {{
      selected: import("../types").SetupCandidate, fallback: number
    } | null} */ (null));
    const canSubmit = mutationsEnabled && status.runtime_detected;
    const currentInventory = inventory?.attempt === inventoryAttempt ? inventory : null;
    const projects = currentInventory?.value?.projects ?? [];
    const routingAvailable = currentInventory?.value?.routing_available === true;
    const controlsLocked = !!(destination || review || busy);
    const projectsLoading = status.configured && !currentInventory;

    useEffect(() => () => pending.current?.abort(), []);
    useEffect(() => {
      if (!status.configured) return;
      const controller = new AbortController();
      setup.projects(controller.signal).then((value) => {
        if (!controller.signal.aborted) setInventory({ attempt: inventoryAttempt, value });
      }, (reason) => {
        if (!controller.signal.aborted) setInventory({
          attempt: inventoryAttempt, error: "Could not load Hermes projects. " + message(reason),
        });
      });
      return () => controller.abort();
    }, [setup, status.configured, inventoryAttempt]);

    function clearResult() {
      setReport(null);
      setError("");
    }

    /** @param {(signal: AbortSignal) => Promise<void>} operation */
    async function run(operation, clearError = true) {
      if (pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      if (clearError) setError("");
      setBusy(true);
      try {
        await operation(controller.signal);
      } catch (reason) {
        if (!controller.signal.aborted) setError(message(reason));
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }

    /** @param {boolean} reviewing */
    function validate(reviewing) {
      if (!canSubmit || controlsLocked || (reviewing && projectsLoading)) return;
      setReport(null);
      return run(async (signal) => {
        const selected = candidate(main, phy, config,
          routingAvailable ? Array.from(assignments, ([id, path]) => ({ id, path })) : undefined);
        const result = await setup.validate(selected, signal);
        if (signal.aborted) return;
        setReport(result);
        if (reviewing && result.valid) setReview({
          selected, fallback: routingAvailable ? projects.filter(({ id }) => !assignments.has(id)).length : 0,
        });
      });
    }

    function connect() {
      if (!canSubmit || !review) return;
      return run(async (signal) => {
        const result = await setup.apply(review.selected, signal);
        if (signal.aborted) return;
        if (result.configured) {
          onConnected();
          return;
        }
        setReport(result);
        setReview(null);
      });
    }

    /** @param {PickerTarget} target @param {boolean} creating @param {string} path */
    function acceptPath(target, creating, path) {
      clearResult();
      if (creating) {
        setDestination({ target, path });
      } else {
        target.update(path);
      }
    }

    /** @param {PickerTarget} target @param {boolean} [creating] */
    function choose(target, creating = false) {
      if (controlsLocked || (creating && !canSubmit)) return;
      const picker = creating ? pickSavePath : pickOpenPath;
      if (!picker) return;
      return run(async (signal) => {
        try {
          const path = await picker(target.kind);
          if (path && !signal.aborted) acceptPath(target, creating, path);
        } catch {
          if (!signal.aborted) setError("Could not open the native file dialog. Try again or enter the path manually.");
        }
      }, false);
    }

    function confirmCreate() {
      if (!canSubmit || !destination?.target.createKind) return;
      const { target, path } = destination;
      const kind = destination.target.createKind;
      return run(async (signal) => {
        const result = await setup.create({ kind, path, project_id: target.projectId }, signal);
        if (signal.aborted) return;
        setDestination(null);
        setCreated((paths) => [...paths, result.path]);
        acceptPath(target, false, result.path);
      });
    }

    /** @param {PickerTarget} target @param {string} value */
    function ownerButtons(target, value) {
      return h("div", { className: "rly-setup-actions" },
        h(Button, { type: "button", disabled: !pickOpenPath, onClick: () => choose(target) },
          "Select " + target.kind),
        h(Button, { type: "button", disabled: !canSubmit || !pickSavePath, onClick: () => choose(target, true) },
          "Create " + target.kind),
        manualPaths && h(Button, { type: "button", disabled: !canSubmit || !value.trim(),
          onClick: () => acceptPath(target, true, value.trim()) }, "Create " + target.kind + " at this path"),
        target.projectId && h(Button, { type: "button", disabled: !value || !mutationsEnabled,
          onClick: () => { clearResult(); target.update(""); } }, "Use General"));
    }

    /** @param {string} label @param {string} value @param {(next: string) => void} update */
    function pathInput(label, value, update) {
      return h("label", { className: "rly-field" }, h("span", null, label), h(Input, {
        type: "text", value, autoComplete: "off", maxLength: 4096,
        onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
          clearResult();
          update(event.currentTarget.value);
        },
      }));
    }

    /** @param {SetupOwner | SetupCheck | undefined} result */
    function check(result) {
      return result && h("p", { className: "rly-setup-check", role: "status" }, checkText(result));
    }

    const general = /** @type {PickerTarget} */ ({
      kind: "REL", update: setMain, createKind: "general_rel",
    });
    const identity = /** @type {PickerTarget} */ ({
      kind: "PHY", update: setPhy, createKind: "phy",
    });
    const configFile = /** @type {PickerTarget} */ ({
      kind: "config", update: setConfig,
    });

    const projectCards = projects.map(({ id, name }) => {
      const savedPath = Object.hasOwn(status.defaults.projects, id) ? status.defaults.projects[id] : "";
      const path = routingAvailable ? assignments.get(id) ?? "" : savedPath;
      const target = /** @type {PickerTarget} */ ({
        kind: "REL", createKind: "project_rel", projectId: id,
        update(next) {
          setAssignments((current) => {
            const updated = new Map(current);
            if (next) updated.set(id, next);
            else updated.delete(id);
            return updated;
          });
        },
      });
      const savedRoute = status.configured ? savedPath : path;
      return { id, name, path, target, savedRoute, draftChanged: status.configured && savedPath !== path };
    });

    const projectSection = status.configured && h("details", { className: "rly-setup-card" },
      h("summary", null, "Project memories"),
      h("section", { "aria-label": "Project memories" },
        routingAvailable && h("p", null, "Project memory selections apply after connecting."),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", "aria-expanded": showProjectHelp,
            onClick: () => setShowProjectHelp((show) => !show) }, "Create Hermes project"),
          h(Button, { type: "button", onClick: () => setInventoryAttempt((count) => count + 1) }, "Refresh projects")),
        showProjectHelp && h("p", { role: "note" },
          "Create a project in Hermes Desktop Chat or run ", h("code", null, "hermes project create <name>"),
          " for this Hermes profile, then refresh the project list."),
        !currentInventory && h("p", { role: "status" }, "Loading Hermes projects…"),
        currentInventory?.error && h("p", { role: "alert" }, currentInventory.error),
        currentInventory?.value?.projects.length === 0 && h("p", null, "This profile has no active Hermes projects."),
        currentInventory?.value && !routingAvailable && h("div", { role: "note" },
          h("p", null, "Unavailable on this Hermes build"),
          h("p", null, "Project conversations use General memory on this Hermes version.")),
        projectCards.map(({ id, name, path, target, savedRoute, draftChanged }) =>
          h("section", { key: id, className: "rly-setup-card", "aria-label": name },
            h("h3", null, name),
            routingAvailable && h("p", null, savedRoute ? "Dedicated REL" : "Using General memory"),
            path && !routingAvailable && h("p", null, "Saved project REL"),
            path && draftChanged && h("p", null, "Dedicated REL selected"),
            !path && draftChanged && h("p", null, "General memory selected"),
            manualPaths && routingAvailable ? pathInput(name + " REL path", path, target.update)
              : path && h("p", { className: "rly-setup-value" }, path),
            routingAvailable && ownerButtons(target, path),
            routingAvailable && check(report && Object.hasOwn(report.projects, id) ? report.projects[id] : undefined)))));

    return h("div", { className: "rly-main rly-setup-form" },
      h("dl", { className: "rly-owner-meta" },
        root.ReliquaryDashboardViews.meta("Reliquary runtime", status.runtime_detected ? "Detected" : "Unavailable")),
      h("form", { noValidate: true, onSubmit: (/** @type {{preventDefault():void}} */ event) => {
        event.preventDefault();
        void validate(true);
      } },
      h("fieldset", { disabled: controlsLocked },
        !pickOpenPath && !pickSavePath && h("p", { role: "note" },
          "Native file dialogs unavailable for this connection"),
        h(Button, { type: "button", "aria-expanded": manualPaths,
          onClick: () => setManualPaths((open) => !open) }, manualPaths ? "Hide manual paths" : "Enter path manually"),
        h("section", { "aria-label": "General memory", className: "rly-setup-card" },
          h("h2", null, "General memory"),
          manualPaths ? pathInput("Main REL path", main, setMain)
            : h("p", { className: "rly-setup-value" }, main || "A General REL is required."),
          ownerButtons(general, main), check(report?.main_rel)),
        h("section", { "aria-label": "Active identity", className: "rly-setup-card" },
          h("h2", null, "Active identity"),
          manualPaths ? pathInput("Active PHY path", phy, setPhy)
            : h("p", { className: "rly-setup-value" }, phy || "An active PHY is required."),
          ownerButtons(identity, phy), check(report?.active_phy)),
        h("section", { "aria-label": "Reliquary configuration", className: "rly-setup-card" },
          h("h2", null, "Reliquary configuration"),
          manualPaths ? pathInput("Reliquary config path (optional)", config, setConfig)
            : h("p", { className: "rly-setup-value" }, config || "No config detected"),
          h(Button, { type: "button", disabled: !pickOpenPath, onClick: () => choose(configFile) }, "Change configuration"),
          check(report?.config)),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: !canSubmit, onClick: () => validate(false) }, "Validate"),
          h(Button, { type: "submit", disabled: !canSubmit || projectsLoading }, "Review and connect")),
        projectSection)),

      destination && h("section", { className: "rly-setup-picker", "aria-label": "Confirm owner creation" },
        h("h2", null, "Confirm owner creation"),
        h("p", { className: "rly-setup-value" }, destination.path),
        h("p", null, "Reliquary will create a new file at this path."),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: busy || !canSubmit, onClick: confirmCreate }, "Create " + destination.target.kind),
          h(Button, { type: "button", disabled: busy, onClick: () => { setDestination(null); setError(""); } }, "Cancel"))),
      review && h("section", { className: "rly-setup-picker", "aria-label": "Review connection" },
        h("h2", null, "Review connection"),
        currentInventory?.error && h("p", { role: "note" }, "Hermes project memory routes could not be checked."),
        review.fallback > 0 && h("p", { role: "note" },
          review.fallback + (review.fallback === 1 ? " project will" : " projects will") +
          " use General memory for new sessions."),
        status.configured && h("p", null, "Existing Hermes sessions keep their accepted memory routes."),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: busy || !canSubmit, onClick: connect },
            review.fallback > 0 ? "Continue" : "Connect Reliquary"),
          h(Button, { type: "button", disabled: busy, onClick: () => { setReview(null); setError(""); } }, "Back to edit"))),
      created.length > 0 && h("div", { role: "status" }, h("p", null, "Created owner files remain on disk if connection fails."),
        h("ul", { className: "rly-setup-value" }, created.map((path) => h("li", { key: path }, path)))),
      busy && h("p", { role: "status" }, "Working…"),
      error && h("p", { role: "alert" }, error),
      report && h("p", { role: report.valid ? "status" : "alert" },
        report.valid ? "Validation passed." : report.topology_error === "owner_topology_changed"
          ? "Owner topology conflict. Keep the accepted General REL, PHY, and dedicated project owners when adding project RELs."
          : report.topology_error
            ? "Owner topology conflict (" + report.topology_error.replaceAll("_", " ") + ")."
          : "Validation failed. Check the rejected files."));
  }

  root.ReliquaryOnboarding = { Onboarding };
})(globalThis);


(function (root) {
  "use strict";

  /** @type {import("../types").CreateReliquarySurface} */
  function createSurface({ authedFetch, pickOpenPath, pickSavePath, mutationBlockReason, surfaceLabel }) {
    const { React, hooks, components } = root.ReliquaryDashboardHost;
    const h = React.createElement;
    const { Button, Input } = components;
    const { useState, useEffect } = hooks;
    const { useRead, useCursor } = root.ReliquaryDashboardState;
    const { meta, readContent, select, pager, Status } = root.ReliquaryDashboardViews;
    const { ImportSessions } = root.ReliquaryDashboardSources;
    const { OwnerContent } = root.ReliquaryDashboardOwner;
    const { createLiveMutation } = root.ReliquaryDashboardLive;

    /** @param {{client: import("../types").DashboardClient, configPath: string | null,
     *   blockReason?: string, onManageSetup(): void}} props */
    function DashboardTab({ client, configPath, blockReason, onManageSetup }) {
      const [write] = useState(() => blockReason ? undefined : createLiveMutation(authedFetch));
      const [sessionId, setSessionId] = useState(/** @type {string | null} */ (null));
      const [section, setSection] = useState("dashboard");
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
          h("p", { className: "rly-subtitle" }, "Configured owners in this Hermes profile")),
          h(Button, { type: "button", onClick: onManageSetup }, "Manage memory setup")),
        blockReason && h("p", { className: "rly-live-notice", role: "note" }, blockReason),
        h("nav", { className: "rly-view-switch", "aria-label": "Reliquary sections" },
          h(Button, { type: "button", "aria-pressed": section === "dashboard", onClick: () => setSection("dashboard") }, "Dashboard"),
          h(Button, { type: "button", "aria-pressed": section === "sources", onClick: () => setSection("sources") }, "Sources")),
        section === "sources" && h(ImportSessions, { authedFetch, mutationBlocked: blockReason }),
        section === "dashboard" && h("div", { className: "rly-dashboard-content" },
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
              h(Button, { type: "button", size: "sm", onClick: refreshOwnerData }, "Refresh owner data"),
              h("form", { onSubmit: findSession, className: "rly-session-lookup" },
                h("label", { className: "rly-field" }, h("span", null, "Hermes session ID"), h(Input, {
                  value: sessionInput, maxLength: 128, autoComplete: "off",
                  onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setSessionInput(event.currentTarget.value),
                })), h(Button, { type: "submit", size: "sm" }, "Look up session")),
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
        }, ownerCursor.reset)));
    }


    const setup = root.ReliquarySetupClient.createSetupClient(authedFetch);
    const { Onboarding } = root.ReliquaryOnboarding;

    return function ReliquarySurface() {
      const [client] = useState(() => root.ReliquaryDashboardLive.createLiveClient(authedFetch));
      const [attempt, setAttempt] = useState(0);
      const [managing, setManaging] = useState(false);
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
      if (current?.status?.configured && !managing) return h(DashboardTab, {
        client, configPath: current.status.config_path, blockReason, onManageSetup: () => setManaging(true),
      });
      return h("section", { className: "rly-dashboard", "aria-label": current?.status ? "Reliquary setup" : "Reliquary" },
        h("header", { className: "rly-header" }, h("div", null,
          h("p", { className: "rly-eyebrow" }, surfaceLabel),
          h("h1", null, current?.status?.configured ? "Manage memory setup"
            : current?.status ? "Set up Reliquary" : "Reliquary Memory"),
          current?.status && h("p", { className: "rly-subtitle" }, "Select or create Reliquary owners for this Hermes profile.")),
          current?.status?.configured && h(Button, { type: "button", onClick: () => setManaging(false) }, "Back to dashboard")),
        blockReason && h("p", { className: "rly-live-notice", role: "note" }, blockReason),
        current?.status ? h(Onboarding, { status: current.status, setup, pickOpenPath, pickSavePath,
          mutationsEnabled: !blockReason, onConnected: () => { setManaging(false); refresh(); } }) :
          current?.error ? h("div", { role: "alert" },
            h("p", null, current.error), h(Button, { type: "button", onClick: refresh }, "Retry setup status")) :
            h("p", { role: "status" }, "Checking Reliquary setup…"));
    };
  }

  root.ReliquaryDashboardSurface = createSurface;
})(globalThis);

})(runtime);
  return runtime.ReliquaryDashboardSurface(options);
}
import { createElement as h, useMemo } from "react";
import * as React from "react";
import {
  Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea,
  gatewayActivationEpoch, host, ROUTES_AREA, SIDEBAR_NAV_AREA, useGatewayActivationEpoch, useValue,
} from "@hermes/plugin-sdk";

const endpoint = "/api/plugins/reliquary-hermes";
const route = "/reliquary";
const nativeWriteNotice = "This Hermes build does not yet support secure Desktop writes for isolated plugins. " +
  "Use the Reliquary web dashboard for setup and write management.";
const methods = new Map([
  ["/setup-v1/status", "GET"],
  ["/setup-v1/projects", "GET"],
  ["/setup-v1/create", "POST"],
  ["/setup-v1/validate", "POST"],
  ["/setup-v1/apply", "POST"],
  ["/dashboard-v1", "POST"],
  ["/sources-v1/sessions", "GET"],
  ["/sources-v1/import", "POST"],
  ["/sources-v1/status", "POST"],
]);
const pickers = {
  REL: { title: "Choose a Reliquary REL", filters: [{ name: "Reliquary REL", extensions: ["rel"] }] },
  PHY: { title: "Choose a Reliquary PHY", filters: [{ name: "Reliquary PHY", extensions: ["phy"] }] },
  config: { title: "Choose a Reliquary configuration", filters: [{ name: "Reliquary configuration", extensions: ["cfg"] }] },
};
const saveNames = { REL: "general.rel", PHY: "active.phy" };

function scopedPicker(current, pick) {
  return async (kind) => {
    if (!current()) return null;

    // A switch can return to the same profile before the OS dialog resolves.
    let changed = false;
    const invalidate = () => { changed = true; };
    const stopProfile = host.state.profile.listen(invalidate);
    const stopConnection = host.state.connectionId.listen(invalidate);
    try {
      const path = await pick(kind);
      return !changed && current() ? path : null;
    } finally {
      stopConnection();
      stopProfile();
    }
  };
}

function httpStatus(error) {
  const status = error?.statusCode ?? Number(/(?:^|: )([45][0-9]{2}):/.exec(error?.message ?? "")?.[1]);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503;
}

function setupFailure(error) {
  // Electron's REST bridge preserves the HTTP response text in the Error message.
  // Keep only a short typed detail for the shared client's message allowlist.
  const text = /(?:^|: )[45][0-9]{2}: (\{[^\n]{0,256}\})$/.exec(error?.message ?? "")?.[1];
  if (!text) return null;
  try {
    const { detail } = JSON.parse(text);
    return typeof detail === "string" && /^[a-z_]{1,64}$/.test(detail) ? { detail } : null;
  } catch {
    return null;
  }
}

function restResponse(status, value = null) {
  return { status, ok: status === 200, json: async () => value };
}

function dashboardTransport(ctx, current) {
  return async function authedFetch(url, { method = "GET", body, signal } = {}) {
    function checkScope() {
      signal?.throwIfAborted();
      if (!current()) throw new DOMException("The active Hermes profile changed.", "AbortError");
    }

    checkScope();
    const suffix = url.slice(endpoint.length);
    const routePath = suffix.split("?", 1)[0];
    if (!url.startsWith(endpoint + "/") || methods.get(routePath) !== method ||
      (routePath === "/sources-v1/sessions" && !/^\?offset=\d+&q=/.test(suffix.slice(routePath.length)))) {
      throw new Error("Unsupported Reliquary API request.");
    }
    const options = { method, body: body === undefined ? undefined : JSON.parse(body) };
    let response;
    try {
      // The SDK resolves the active backend and profile before dispatch.
      response = restResponse(200, await ctx.rest(suffix, options));
    } catch (error) {
      response = restResponse(httpStatus(error), suffix.startsWith("/setup-v1/") ? setupFailure(error) : null);
    }
    checkScope();
    return response;
  };
}

const components = {
  Button(props) {
    const quiet = props["aria-pressed"] === false || props["aria-current"] === false;
    return h(Button, { ...props, variant: quiet ? "ghost" : "default" });
  },
  Checkbox, Input, Textarea,
  Select({ label, value, options, onValueChange, disabled }) {
    // The Desktop select reserves the empty string for its placeholder.
    return h(Select, { value: ":" + value, onValueChange: (next) => onValueChange(next.slice(1)), disabled },
      h(SelectTrigger, { "aria-label": label }, h(SelectValue)),
      h(SelectContent, null, ...options.map(({ value, label }) => h(SelectItem, { key: value, value: ":" + value }, label))));
  },
};

const paneStyle = { width: "100%", height: "100%", overflow: "auto" };

function ReliquaryPane({ ctx }) {
  const epoch = useGatewayActivationEpoch();
  const profile = useValue(host.state.profile);
  const connection = useValue(host.state.connectionId);
  const Surface = useMemo(() => {
    const current = () => gatewayActivationEpoch() === epoch && host.state.profile.get() === profile &&
      host.state.connectionId.get() === connection;
    return createReliquarySurface({
      React,
      components,
      authedFetch: dashboardTransport(ctx, current),
      pickOpenPath: typeof ctx.os?.pickOpenPath === "function"
        ? scopedPicker(current, (kind) => ctx.os.pickOpenPath(pickers[kind])) : undefined,
      pickSavePath: typeof ctx.os?.pickSavePath === "function"
        ? scopedPicker(current, (kind) => ctx.os.pickSavePath({
          ...pickers[kind], title: "Create a Reliquary " + kind, defaultPath: saveNames[kind],
        })) : undefined,
      mutationBlockReason: (status) => status.desktop_native_mutations === true ? undefined : nativeWriteNotice,
      surfaceLabel: "HERMES DESKTOP PLUGIN",
    });
  }, [ctx, epoch, profile, connection]);

  return h("div", { className: "rly-desktop", style: paneStyle },
    h("style", null, reliquaryStyles),
    h(Surface));
}

export default {
  id: "reliquary-hermes",
  name: "Reliquary",
  description: "Connect Reliquary and manage Memories in the active Hermes profile",
  register(ctx) {
    ctx.registerMany([
      { id: "page", area: ROUTES_AREA, data: { path: route }, render: () => h(ReliquaryPane, { ctx }) },
      { id: "nav", area: SIDEBAR_NAV_AREA, data: { path: route, label: "Reliquary", codicon: "database" } },
    ]);
  },
};
