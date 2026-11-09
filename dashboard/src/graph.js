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
