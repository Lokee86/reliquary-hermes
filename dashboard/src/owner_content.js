(function (root) {
  "use strict";

  /** @param {any} type @param {any} props @param {...any} children */
  const h = (type, props, ...children) => /** @type {import("../types").HermesDashboardSDK} */ (window.__HERMES_PLUGIN_SDK__).React.createElement(type, props, ...children);
  const { useState, useEffect } = /** @type {import("../types").HermesDashboardSDK} */ (window.__HERMES_PLUGIN_SDK__).hooks;
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
