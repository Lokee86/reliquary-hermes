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
