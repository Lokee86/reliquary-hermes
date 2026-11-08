(function (root) {
  "use strict";

  /** @typedef {import("../types").DashboardWireRequest} Request */
  /** @typedef {import("../types").DashboardErrorResponse} Failure */
  /** @typedef {import("../types").DashboardFixture} Fixture */
  /** @typedef {import("../types").ReadArgs} Args */

  /** @param {Request} request @param {Failure["status"]} status @param {string} code @returns {Failure} */
  function failure(request, status, code) {
    return { protocol_version: 1, request_id: request.request_id, operation: request.operation,
      status, binding: null, result: { code, retryable: false } };
  }

  /**
   * @template T
   * @template {{request_id:string,result:T}} R
   * @param {Request} request
   * @param {R} base
   * @param {T} result
   * @returns {R}
   */
  function issue(request, base, result) {
    return { ...base, request_id: request.request_id, result: structuredClone(result) };
  }

  /** @param {string} id */
  function validId(id) {
    return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) && !/[\r\n]/.test(id);
  }

  /** @param {string} value */
  function validDecimal(value) {
    return /^(0|[1-9][0-9]{0,38})$/.test(value) && !/[\r\n]/.test(value);
  }

  /** @param {number} value @param {number} max */
  function within(value, max) {
    return Number.isInteger(value) && value > 0 && value <= max;
  }

  /** @param {Request} request */
  function invalidArguments(request) {
    const args = request.arguments;
    if ("limit" in args && !within(args.limit, 128)) return "invalid_limit";
    if ("memory_id" in args && !validId(args.memory_id)) return "invalid_memory_id";
    if ("revision" in args && args.revision !== null && !validDecimal(args.revision)) return "invalid_revision";
    if (request.operation === "ui.community_members" &&
        (!validId(request.arguments.community_id) || !validDecimal(request.arguments.expected_generation))) return "invalid_community_scope";
    if (request.operation === "ui.memory_list") {
      const { query, category, memory_type, community_id } = request.arguments.filters;
      if ([category, memory_type, community_id].some((id) => id !== null && !validId(id))) return "invalid_filter_id";
      if (new TextEncoder().encode(query).length > 4096) return "query_too_large";
    }
    if (request.operation === "ui.graph_page") {
      const { depth, node_limit, edge_limit, seed_ids, community_id } = request.arguments;
      if (!within(depth, 3) || !within(node_limit, 500) || !within(edge_limit, 1000)) return "invalid_graph_bounds";
      if (seed_ids.length > 50 || seed_ids.some((id) => !validId(id)) || new Set(seed_ids).size !== seed_ids.length ||
          (community_id !== null && !validId(community_id))) return "invalid_graph_seed";
    }
    return null;
  }

  /** @param {import("../types").MemorySummary} memory @param {import("../types").MemoryFilters} filters */
  function matches(memory, filters) {
    const text = [memory.title, memory.excerpt].join(" ").toLowerCase();
    return text.includes(filters.query.trim().toLowerCase()) &&
      (!filters.category || memory.category === filters.category) &&
      (!filters.memory_type || memory.memory_type === filters.memory_type) &&
      (!filters.lifecycle || memory.lifecycle === filters.lifecycle) &&
      (!filters.community_id || memory.community_id === filters.community_id);
  }

  /**
   * @param {import("../types").GraphPageResponse["result"]} graph
   * @param {Args["ui.graph_page"]} args
   * @param {import("../types").MemorySummary[]} memories
   */
  function eligibleGraphNodes(graph, args, memories) {
    const memberIds = new Set(memories.filter((memory) => memory.community_id === args.community_id).map((memory) => memory.memory_id));
    const eligible = graph.nodes.filter((node) => !args.community_id || node.community_id === args.community_id ||
      (node.memory_id !== null && memberIds.has(node.memory_id)));
    if (!args.seed_ids.length) return eligible;
    const byId = new Map(eligible.map((node) => [node.node_id, node]));
    let frontier = new Set(args.seed_ids.filter((id) => byId.has(id)));
    const visited = new Set(frontier);
    for (let level = 0; level < args.depth && frontier.size; level += 1) {
      /** @type {Set<string>} */
      const next = new Set();
      for (const edge of graph.edges) {
        if (!edge.active) continue;
        const neighbor = frontier.has(edge.source_id) ? edge.target_id : frontier.has(edge.target_id) ? edge.source_id : null;
        if (neighbor && byId.has(neighbor) && !visited.has(neighbor)) {
          next.add(neighbor);
          visited.add(neighbor);
        }
      }
      frontier = next;
    }
    return Array.from(visited, (id) => /** @type {import("../types").GraphNode} */ (byId.get(id)));
  }

  let cursorSequence = 0;

  /**
   * @param {Fixture} [fixture]
   * @param {string|null} [activePhyId]
   * @returns {import("../types").DashboardClient}
   */
  function createFixtureClient(fixture = root.ReliquaryDashboardFixture, activePhyId) {
    const sessionRows = Object.entries(fixture.owner_sessions);
    const defaultSession = sessionRows[0]?.[0];
    const selectedPhy = activePhyId === undefined ? sessionRows[0]?.[1][0]?.result.active_phy_id ?? null : activePhyId;
    /** @type {import("../types").SessionChoice[]} */
    const sessions = [];
    /** @type {Map<string, import("../types").PhyChoice>} */
    const phys = new Map();
    for (const [sessionId, scenarios] of sessionRows) {
      const relId = scenarios[0]?.result.session_owner_id;
      if (relId) sessions.push({ sessionId, relId });
      for (const { result } of scenarios) {
        const phy = result.owners.items.find((item) => item.owner_id === result.active_phy_id && item.owner_kind === "PHY" && item.capabilities.view);
        if (phy) phys.set(phy.owner_id, { phyId: phy.owner_id, label: phy.display_label });
      }
    }
    /** @type {Map<string, {key:string,offset:number}>} */
    const cursors = new Map();

    /** @type {import("../types").DashboardTransport} */
    async function transport(request, signal) {
      signal.throwIfAborted();
      const invalid = invalidArguments(request);
      if (invalid) return failure(request, "invalid", invalid);

      const { request_id, arguments: args, ...scope } = request;
      const cursor = "cursor" in args ? args.cursor : null;
      const key = JSON.stringify([scope, { ...args, cursor: null }]);
      const entry = cursor ? cursors.get(cursor) : null;
      if (cursor && entry?.key !== key) return failure(request, "stale_cursor", "cursor_expired");
      const offset = entry?.offset ?? 0;

      /**
       * @template T
       * @param {T[]} items
       * @param {number} limit
       * @returns {import("../types").Page<T>}
       */
      function page(items, limit) {
        const end = offset + limit;
        const more = end < items.length;
        const next = more ? "fixture-cursor-" + ++cursorSequence : null;
        if (next) {
          if (cursors.size >= 256) {
            const oldest = cursors.keys().next().value;
            if (oldest) cursors.delete(oldest);
          }
          cursors.set(next, { key, offset: end });
        }
        return { items: items.slice(offset, end), next_cursor: next, truncated: more };
      }

      const session = request.session_id ?? defaultSession;
      const scenario = session && Object.hasOwn(fixture.owner_sessions, session)
        ? fixture.owner_sessions[session].find((item) => item.result.active_phy_id === selectedPhy) : null;
      if (!scenario) return failure(request, "unavailable", "scope_unavailable");
      if (request.operation === "ui.owner_sessions") {
        return issue(request, scenario, { ...scenario.result, owners: page(scenario.result.owners.items, request.arguments.limit) });
      }

      const ownerId = request.owner_id;
      const owner = scenario.result.owners.items.find((item) => item.owner_id === ownerId);
      if (!ownerId || !owner?.capabilities.view ||
          (owner.owner_kind === "REL" && request.session_id !== null && ownerId !== scenario.result.session_owner_id) ||
          (owner.owner_kind === "PHY" && request.session_id !== null)) return failure(request, "denied", "owner_unavailable");
      if (owner.generation !== request.generation || owner.cut !== request.cut) return failure(request, "conflict", "scope_changed");

      switch (request.operation) {
        case "ui.memory_list": {
          const base = fixture.memory_lists[ownerId];
          if (base) return issue(request, base, page(base.result.items.filter((item) => matches(item, request.arguments.filters)), request.arguments.limit));
          break;
        }
        case "ui.memory_detail": {
          const { memory_id, revision } = request.arguments;
          const current = fixture.memory_lists[ownerId]?.result.items.find((item) => item.memory_id === memory_id)?.revision;
          const base = fixture.memory_details[ownerId]?.find(({ result }) =>
            result.memory.memory_id === memory_id && result.body.revision === (revision ?? current));
          if (base) return issue(request, base, base.result);
          break;
        }
        case "ui.memory_history": {
          const { memory_id, limit } = request.arguments;
          const base = fixture.memory_histories[ownerId]?.find(({ result }) => result.memory_id === memory_id);
          if (base) return issue(request, base, { memory_id, revisions: page(base.result.revisions.items, limit) });
          break;
        }
        case "ui.provenance": {
          const { memory_id, revision } = request.arguments;
          const base = fixture.provenance[ownerId]?.find(({ result }) => result.memory_id === memory_id && result.revision === revision);
          if (base) return issue(request, base, base.result);
          break;
        }
        case "ui.graph_page": {
          const base = fixture.graph_pages[ownerId];
          if (!base) break;
          const args = request.arguments;
          const nodes = page(eligibleGraphNodes(base.result, args, fixture.memory_lists[ownerId]?.result.items ?? []), args.node_limit);
          const ids = new Set(nodes.items.map((node) => node.node_id));
          const edges = base.result.edges.filter((edge) => ids.has(edge.source_id) && ids.has(edge.target_id));
          return issue(request, base, { routing_state: "available", nodes: nodes.items, edges: edges.slice(0, args.edge_limit),
            next_cursor: nodes.next_cursor, truncated: nodes.truncated || edges.length > args.edge_limit });
        }
        case "ui.community_list": {
          const base = fixture.community_lists[ownerId];
          if (base) return issue(request, base, { metadata_state: "available",
            communities: page(base.result.communities.items, request.arguments.limit) });
          break;
        }
        case "ui.community_members": {
          const { community_id, expected_generation, limit } = request.arguments;
          const base = fixture.community_members[ownerId]?.find(({ result }) => result.community_id === community_id);
          if (!base) break;
          if (base.result.generation !== expected_generation) return failure(request, "conflict", "community_generation_changed");
          return issue(request, base, { community_id, generation: expected_generation, members: page(base.result.members.items, limit) });
        }
        case "ui.operational_status": {
          const base = fixture.operational_statuses[ownerId];
          if (base && base.result.session_id === request.session_id) return issue(request, base, base.result);
          break;
        }
      }
      return failure(request, "unavailable", "fixture_unavailable");
    }

    const createClient = root.ReliquaryDashboardClient.createClient;
    return createClient(transport, sessions, Array.from(phys.values()), () => cursors.clear());
  }

  const api = { createFixtureClient };
  root.ReliquaryDashboardFixtures = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
