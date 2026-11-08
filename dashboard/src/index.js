(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }
  const h = sdk.React.createElement;
  const { useState } = sdk.hooks;
  const { useRead, useCursor } = ReliquaryDashboardState;
  const { meta, readContent, select, pager, MemoryList, Inspector, Status } = ReliquaryDashboardViews;
  const { GraphView, CommunityView } = ReliquaryDashboardGraph;

  /** @type {import("../types").MemoryFilters} */
  const initialFilters = { query: "", category: null, memory_type: null, lifecycle: null, community_id: null };
  /** @type {import("../types").MemorySummary["lifecycle"][]} */
  const lifecycleOptions = ["active", "retired", "tombstoned", "superseded", "unavailable"];

  /**
   * @param {{filters:import("../types").MemoryFilters, communities:import("../types").Community[],
   * onChange:(filters:import("../types").MemoryFilters)=>void}} props
   */
  function Filters({ filters, communities, onChange }) {
    /** @param {"query" | "category" | "memory_type"} key @param {string} label */
    function input(key, label) {
      return h("label", { className: "rly-field" }, h("span", null, label),
        h("input", {
          type: key === "query" ? "search" : "text", value: filters[key] ?? "",
          maxLength: key === "query" ? 1024 : 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
            const value = event.currentTarget.value;
            onChange({ ...filters, [key]: key === "query" ? value : value || null });
          },
        }));
    }

    const any = { value: "", label: "Any" };
    return h("div", { className: "rly-filters" },
      input("query", "Search Memories"),
      h("details", null, h("summary", null, "Filters"),
        h("div", { className: "rly-filter-fields" },
          input("category", "Category"),
          input("memory_type", "Memory type"),
          select("Lifecycle", filters.lifecycle ?? "", [any, ...lifecycleOptions.map((value) => ({ value, label: value }))],
            (value) => onChange({ ...filters, lifecycle: lifecycleOptions.find((option) => option === value) ?? null })),
          select("Community", filters.community_id ?? "", [any, ...communities.map((item) => ({
            value: item.community_id, label: item.name ?? item.community_id,
          }))], (value) => onChange({ ...filters, community_id: value || null })),
          h("button", { type: "button", onClick: () => onChange(initialFilters) }, "Clear filters"))));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope}} props */
  function OwnerContent({ client, scope }) {
    const [mode, setMode] = useState(/** @type {import("../types").ViewMode} */ ("graph"));
    const [filters, setFilters] = useState(initialFilters);
    const [memoryId, setMemoryId] = useState(/** @type {string|null} */ (null));
    const [selection, setSelection] = useState(/** @type {import("../types").GraphSelection|null} */ (null));
    const [seedId, setSeedId] = useState(/** @type {string|null} */ (null));
    const [graphCommunity, setGraphCommunity] = useState(/** @type {string|null} */ (null));
    const [community, setCommunity] = useState(/** @type {import("../types").Community|null} */ (null));
    const listCursor = useCursor();
    const graphCursor = useCursor();
    const communitiesCursor = useCursor();
    const membersCursor = useCursor();
    const grants = scope.owner?.capabilities;
    const list = useRead(client, "ui.memory_list", scope, mode === "list"
      ? { cursor: listCursor.current, limit: 3, filters } : null);
    const graph = useRead(client, "ui.graph_page", scope, mode === "graph" && grants?.graph
      ? {
        cursor: graphCursor.current, seed_ids: seedId ? [seedId] : [],
        community_id: graphCommunity, depth: seedId ? 2 : 1, node_limit: seedId ? 6 : 4, edge_limit: 12,
      } : null);
    const communities = useRead(client, "ui.community_list", scope, grants?.community
      ? { cursor: communitiesCursor.current, limit: 3 } : null);
    const members = useRead(client, "ui.community_members", scope, community
      ? { cursor: membersCursor.current, limit: 3, community_id: community.community_id, expected_generation: community.generation }
      : null);
    const availableCommunities = communities.state.status === "ok" ? communities.state.value.communities.items : [];

    /** @param {string} id */
    function selectMemory(id) {
      setMemoryId(id);
      setSelection(null);
    }

    /** @param {import("../types").MemoryFilters} next */
    function changeFilters(next) {
      setFilters(next);
      listCursor.reset();
      setMemoryId(null);
      setSelection(null);
    }

    /** @param {import("../types").Community | null} next */
    function changeCommunity(next) {
      setCommunity(next);
      membersCursor.reset();
    }

    /** @param {import("../types").GraphPageResponse["result"]} page */
    function graphContent(page) {
      const memoryNode = page.nodes.find((node) => node.memory_id && node.memory_id === memoryId);
      const selected = selection ?? (memoryNode ? { kind: /** @type {const} */ ("node"), id: memoryNode.node_id } : null);
      return h("div", null,
        h(GraphView, {
          graph: page,
          selected,
          onSelect: (next) => {
            setSelection(next);
            const node = next.kind === "node" ? page.nodes.find((item) => item.node_id === next.id) : null;
            setMemoryId(node?.memory_id ?? null);
            if (node?.community_id && node.kind === "community") {
              changeCommunity(availableCommunities.find((item) => item.community_id === node.community_id) ?? null);
            }
          },
          onExpand: (nodeId) => { graphCursor.reset(); setSeedId(nodeId); },
        }),
        pager("graph", { ...graphCursor,
          next: (cursor) => { setSelection(null); graphCursor.next(cursor); },
          previous: () => { setSelection(null); graphCursor.previous(); },
        }, page.next_cursor));
    }

    return h("div", { className: "rly-owner-content" },
      h("main", { className: "rly-main", "aria-label": "Memory graph or list" },
        h("div", { className: "rly-view-switch", role: "group", "aria-label": "Memory view" },
          h("button", { type: "button", "aria-pressed": mode === "graph", onClick: () => setMode("graph") }, "Graph page"),
          h("button", { type: "button", "aria-pressed": mode === "list", onClick: () => setMode("list") }, "List page")),
        mode === "graph"
          ? h("section", { "aria-label": "Memory graph" },
            (seedId || graphCommunity) && h("button", { type: "button", onClick: () => {
              graphCursor.reset(); setSelection(null); setSeedId(null); setGraphCommunity(null);
            } }, "Reset graph"),
            readContent("graph", graph, graphContent, graphCursor.reset))
          : h("section", { "aria-label": "Memory list" },
            h(Filters, { filters, communities: availableCommunities, onChange: changeFilters }),
            readContent("Memory list", list, (page) => h("div", null,
              h(MemoryList, { items: page.items, selected: memoryId, onSelect: selectMemory }),
              pager("Memory", listCursor, page.next_cursor)), listCursor.reset)),
        h("section", { className: "rly-communities", "aria-label": "Communities" },
          h("h2", null, "Communities"),
          readContent("communities", communities, (value) => h("div", null,
            h(CommunityView, {
              communities: value.communities,
              selected: community,
              members: members.state.status === "ok" ? members.state.value.members : null,
              onCommunity: changeCommunity,
              onMemory: selectMemory,
              onNextCommunities: (cursor) => { changeCommunity(null); communitiesCursor.next(cursor); },
              onNextMembers: membersCursor.next,
            }),
            communitiesCursor.current && h("button", { type: "button", onClick: () => {
              changeCommunity(null); communitiesCursor.previous();
            } }, "Previous community page"),
            membersCursor.current && h("button", { type: "button", onClick: membersCursor.previous }, "Previous member page"),
            community && members.state.status !== "ok" && readContent("community members", members, () => null, membersCursor.reset),
            community && grants?.graph && h("button", { type: "button", onClick: () => {
              graphCursor.reset(); setSeedId(null); setSelection(null); setGraphCommunity(community.community_id); setMode("graph");
            } }, "Show community in graph")), communitiesCursor.reset))),
      h("aside", { className: "rly-inspector", "aria-label": "Selected Memory inspector" },
        h("p", { className: "rly-eyebrow" }, "INSPECTOR"),
        scope.owner && h("p", { className: "rly-owner-label" }, scope.owner.owner_kind + " · " + scope.owner.display_label),
        memoryId ? h(Inspector, { key: memoryId, client, scope, memoryId })
          : h("p", { className: "rly-muted" }, "Select a Memory to inspect its detail, history, and provenance.")));
  }

  function DashboardTab() {
    const [client, setClient] = useState(() => ReliquaryDashboardFixtures.createFixtureClient());
    const sessions = client.sessions();
    const [sessionId, setSession] = useState(/** @type {string|null} */ (sessions[0]?.sessionId ?? null));
    const [kind, setKind] = useState(/** @type {import("../types").OwnerKind} */ ("REL"));
    const discovery = useRead(client, "ui.owner_sessions", { owner: null, sessionId }, { cursor: null, limit: 128 });

    /** @param {string | null} id */
    function changeSession(id) {
      if (id === sessionId) return;
      client.invalidate();
      setSession(id);
    }

    return h("section", { className: "rly-dashboard", "aria-label": "Reliquary dashboard fixture" },
      h("header", { className: "rly-header" },
        h("div", null, h("p", { className: "rly-eyebrow" }, "HERMES WEB DASHBOARD PLUGIN"),
          h("h1", null, "Reliquary Memory"), h("p", { className: "rly-subtitle" }, "Graph, list, and Memory inspection")),
        h("div", { className: "rly-fixture-pill" }, "Synthetic fixture")),
      h("div", { className: "rly-live-notice", role: "note" },
        "Synthetic fixture only. All records and status shown below are sample data."),
      readContent("owner and session bindings", discovery, (data) => {
        const owners = data.owners.items.filter((item) => item.capabilities.view);
        const rels = owners.filter((item) => item.owner_kind === "REL" && sessions.some((session) => session.relId === item.owner_id));
        const rel = rels.find((item) => item.owner_id === data.session_owner_id);
        const phy = owners.find((item) => item.owner_id === data.active_phy_id && item.owner_kind === "PHY");
        const owner = (kind === "PHY" ? phy : rel) ?? null;
        const scope = { owner, sessionId: owner?.owner_kind === "REL" ? data.active_session_id : null };
        const scopeKey = JSON.stringify([scope, data.active_phy_id]);

        return h("div", { className: "rly-layout" },
          h("aside", { className: "rly-sidebar", "aria-label": "Owner and scope" },
            h("h2", null, "Owner / scope"),
            select("REL", rel?.owner_id ?? "", rels.map((item) => ({ value: item.owner_id, label: item.display_label })),
              (id) => changeSession(sessions.find((session) => session.relId === id)?.sessionId ?? null)),
            select("Session", data.active_session_id ?? "", sessions.map((item) => ({ value: item.sessionId, label: item.sessionId })),
              (id) => changeSession(id || null)),
            select("Active PHY", phy?.owner_id ?? "", [{ value: "", label: "None" },
              ...client.phys().map((item) => ({ value: item.phyId, label: item.label }))],
            (id) => {
              if (!id) setKind("REL");
              client.invalidate();
              setClient(ReliquaryDashboardFixtures.createFixtureClient(undefined, id || null));
            }),
            select("Browse owner", kind, [{ value: "REL", label: "Selected REL" },
              ...(phy ? [{ value: "PHY", label: "Active PHY" }] : [])],
            (value) => {
              const next = value === "PHY" && phy ? "PHY" : "REL";
              if (next !== kind) client.invalidate();
              setKind(next);
            }),
            h("dl", { className: "rly-owner-meta" },
              meta("Selected session", data.active_session_id ?? "None"),
              meta("Mapped REL", rel?.display_label ?? "None"),
              meta("Reliquary user ID", phy?.owner_id ?? "None"),
              owner && meta("Owner kind", owner.owner_kind),
              owner && meta("Generation", owner.generation),
              owner && meta("Cut", owner.cut)),
            owner && h(Status, { key: scopeKey, client, scope })),
          owner ? h(OwnerContent, { key: scopeKey, client, scope })
            : h("p", { className: "rly-empty" }, "No authorized owner is available for this scope."));
      }));
  }

  registry.register("reliquary-hermes", DashboardTab);
})(window);
