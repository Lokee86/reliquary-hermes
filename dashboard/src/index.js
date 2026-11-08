(function (browser) {
  "use strict";

  const SDK = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!SDK || !registry || typeof registry.register !== "function") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }
  if (SDK.sdkVersion !== "1.1.0") {
    throw new Error(`Reliquary dashboard SDK mismatch: expected 1.1.0, found ${SDK.sdkVersion || "unknown"}.`);
  }

  const React = SDK.React;
  const h = React.createElement.bind(React);
  const hooks = SDK.hooks;
  const State = ReliquaryDashboardState;
  const Mock = ReliquaryDashboardMock;

  /** @param {string} label @param {string} value */
  function MetaRow(label, value) {
    return h("div", { className: "rly-meta-row" },
      h("dt", null, label), h("dd", null, value));
  }

  /** @param {import("../types").ProvenanceSource[]} sources */
  function ProvenanceList(sources) {
    if (!sources || sources.length === 0) return h("p", { className: "rly-muted" }, "No source record in this fixture.");
    return h("ul", { className: "rly-provenance-list" }, ...sources.map((source, index) => {
      if (source.kind === "hermes_snapshot") {
        return h("li", { key: `source-${index}` },
          h("strong", null, source.label),
          h("span", null, `Session ${source.session_id} · message ${source.message_uid}`),
          h("blockquote", null, source.range.text));
      }
      if (source.kind === "source_unavailable") {
        return h("li", { key: `source-${index}` },
          h("strong", null, "Source unavailable"),
          h("span", null, `Source detail is unavailable (${source.reason}).`));
      }
      if (source.kind === "user_origin") {
        return h("li", { key: `source-${index}` },
          h("strong", null, "User-origin record"),
          h("span", null, `Principal ${source.principal_id} · ${source.created_at_ms}`));
      }
      return h("li", { key: `source-${index}`, className: "rly-muted" }, "Unsupported provenance record");
    }));
  }

  /** @returns {unknown} */
  function DashboardTab() {
    /** @type {[import("../types").DashboardState, (next: import("../types").DashboardState | ((current: import("../types").DashboardState) => import("../types").DashboardState)) => void]} */
    const [model, setModel] = hooks.useState(() => Mock.hydrate(State.createState(null), Mock.getDefaultOwner()));
    const owners = Mock.getOwners();
    const owner = model.owner;
    const activePhy = Mock.getActivePhy();
    const status = model.operationalStatus;
    const memories = model.listPage ? model.listPage.items : [];
    const nodes = model.graphPage ? model.graphPage.nodes : [];
    const detail = model.detail;
    const selected = detail ? detail.memory : null;
    const selectedId = model.selectedMemoryId;

    /** @param {{currentTarget: HTMLSelectElement}} event */
    function onOwnerChange(event) {
      const nextOwner = owners.find((candidate) => candidate.owner_id === event.currentTarget.value) || null;
      setModel((current) => Mock.hydrate(current, nextOwner));
    }

    /** @param {string} memoryId */
    function onMemorySelect(memoryId) {
      setModel((current) => Mock.select(current, memoryId));
    }

    /** @param {import("../types").MemorySummary} memory */
    function listItem(memory) {
      return h("li", { key: memory.memory_id },
        h("button", {
          type: "button",
          className: `rly-memory-button${selectedId === memory.memory_id ? " is-selected" : ""}`,
          "aria-current": selectedId === memory.memory_id ? "true" : undefined,
          onClick: () => onMemorySelect(memory.memory_id),
        },
          h("strong", null, memory.title ?? `Memory ${memory.memory_id}`),
          h("span", null, memory.excerpt),
          h("small", null, `${memory.category} · ${memory.lifecycle} · rev ${memory.revision}`)));
    }

    /** @param {import("../types").GraphNode} node */
    function graphItem(node) {
      const memoryId = node.memory_id;
      if (!memoryId) return h("li", { key: node.node_id }, h("span", null, node.label));
      return h("li", { key: node.node_id },
        h("button", {
          type: "button",
          className: `rly-graph-node${selectedId === memoryId ? " is-selected" : ""}`,
          "aria-current": selectedId === memoryId ? "true" : undefined,
          onClick: () => onMemorySelect(memoryId),
        }, node.label));
    }

    return h("section", { className: "rly-dashboard", "aria-label": "Reliquary dashboard fixture" },
      h("header", { className: "rly-header" },
        h("div", null,
          h("p", { className: "rly-eyebrow" }, "HERMES WEB DASHBOARD PLUGIN"),
          h("h1", null, "Reliquary Memory"),
          h("p", { className: "rly-subtitle" }, "REL and PHY fixture shell")),
        h("div", { className: "rly-fixture-pill", role: "status" }, "Synthetic fixture")),
      h("div", { className: "rly-live-notice", role: "note" },
        "Synthetic fixture only. All records and status shown below are sample data."),
      h("div", { className: "rly-layout" },
        h("aside", { className: "rly-sidebar", "aria-label": "Owner and scope" },
          h("h2", null, "Owner / scope"),
          h("label", { htmlFor: "rly-owner-select" }, "Browse fixture owner"),
          h("select", {
            id: "rly-owner-select",
            value: owner ? owner.owner_id : "",
            onChange: onOwnerChange,
            "aria-label": "Select REL or PHY to browse",
          }, ...owners.map((candidate) => h("option", { key: candidate.owner_id, value: candidate.owner_id },
            candidate.display_label))),
          owner && h("dl", { className: "rly-owner-meta" },
            MetaRow("Owner kind", owner.owner_kind),
            MetaRow("Generation", owner.generation),
            MetaRow("Cut", owner.cut),
            MetaRow("Bound session", status?.session_id ?? "None")),
          h("dl", { className: "rly-owner-meta" },
            MetaRow("Active PHY", activePhy?.display_label ?? "None"),
            activePhy && MetaRow("Reliquary user ID", activePhy.owner_id)),
          h("p", { className: "rly-muted" }, "Changing owner clears the selected Memory, current page and pending response bindings."),
          h("div", { className: "rly-status-card" },
            h("strong", null, "Fixture activity"),
            status ? h("dl", null,
              MetaRow("Copied source", status.source_state === "tombstoned" ? "Tombstoned source" : status.source_state),
              MetaRow("Worker", status.worker_state),
              MetaRow("Latest recall", status.latest_recall.state),
              MetaRow("Returned Memories", status.latest_recall.returned_ids.join(", ") || "None"))
              : h("span", null, "Status unavailable in this fixture."))),
        h("main", { className: "rly-main", "aria-label": "Memory graph or list" },
          h("div", { className: "rly-toolbar" },
            h("div", { className: "rly-view-switch", role: "group", "aria-label": "Memory view" },
              h("button", { type: "button", "aria-pressed": model.mode === "graph", onClick: () => setModel((current) => State.setMode(current, "graph")) }, "Graph page"),
              h("button", { type: "button", "aria-pressed": model.mode === "list", onClick: () => setModel((current) => State.setMode(current, "list")) }, "List page")),
            h("span", { className: "rly-page-label" }, model.mode === "graph" ? "Bounded mock graph page" : "Mock Memory page")),
          h("p", { className: "rly-page-limit" }, model.mode === "graph"
            ? `${nodes.length} nodes · ${model.graphPage ? model.graphPage.edges.length : 0} edges · read-only fixture`
            : `${memories.length} records on this page · read-only fixture`),
          model.mode === "graph"
            ? h("ul", { className: "rly-graph-list", "aria-label": "Graph nodes in fixture page" }, ...nodes.map(graphItem))
            : h("ul", { className: "rly-memory-list", "aria-label": "Memories in fixture page" }, ...memories.map(listItem)),
          (model.mode === "graph" ? nodes.length : memories.length) === 0 && h("p", { className: "rly-empty" }, "No records in this fixture page.")),
        h("aside", { className: "rly-inspector", "aria-label": "Selected Memory inspector" },
          h("p", { className: "rly-eyebrow" }, "INSPECTOR"),
          owner && h("p", { className: "rly-owner-label" }, `${owner.owner_kind} · ${owner.display_label}`),
          selected && detail ? h("div", null,
            h("h2", null, selected.title ?? `Memory ${selected.memory_id}`),
            h("dl", { className: "rly-detail-meta" },
              MetaRow("Memory ID", selected.memory_id),
              MetaRow("Revision", selected.revision),
              MetaRow("Lifecycle", selected.lifecycle),
              MetaRow("Canonical", selected.canonical_status)),
            h("h3", null, "Body"),
            h("p", { className: "rly-body" }, detail.body.content ?? `Body availability is ${detail.body.availability}.`),
            h("h3", null, "Provenance"),
            ProvenanceList(model.provenance ? model.provenance.sources : detail.provenance))
            : h("p", { className: "rly-muted" }, "Select a fixture Memory to inspect its exact mock detail and provenance."))),
      h("footer", { className: "rly-footer" },
        "HU01-R1 fixture shell"));
  }

  registry.register("reliquary-hermes", DashboardTab);
})(window);
