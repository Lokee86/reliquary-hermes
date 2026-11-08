/* Generated from src/ with synthetic fixture data. Rebuild with node scripts/build.cjs. */

(function (root) {
  "use strict";

  /** @type {Record<import("../types").ScopedDashboardResponse["operation"], keyof import("../types").CapabilityFlags>} */
  const requiredCapability = {
    "ui.memory_list": "view",
    "ui.graph_page": "graph",
    "ui.memory_detail": "view",
    "ui.provenance": "provenance",
    "ui.operational_status": "status",
  };

  /** @param {import("../types").OwnerBinding | null} owner @returns {import("../types").DashboardState} */
  function createState(owner) {
    return {
      owner,
      mode: /** @type {import("../types").ViewMode} */ ("graph"),
      listPage: null,
      graphPage: null,
      selectedMemoryId: null,
      detail: null,
      provenance: null,
      operationalStatus: null,
      pendingRequests: {},
    };
  }

  /** @param {import("../types").DashboardState} state @param {import("../types").OwnerBinding | null} owner */
  function changeOwner(state, owner) {
    const current = state.owner;
    // Any binding change, including label or capabilities, is a private-scope remount.
    if (current && owner && JSON.stringify(current) === JSON.stringify(owner)) return state;
    if (!current && !owner) return state;
    return { ...createState(owner), mode: state.mode };
  }

  /** @param {import("../types").DashboardState} state @param {string} operation @param {string} requestId */
  function beginRequest(state, operation, requestId) {
    return { ...state, pendingRequests: { ...state.pendingRequests, [operation]: requestId } };
  }

  /** @param {import("../types").DashboardState} state @param {string | null} memoryId */
  function selectMemory(state, memoryId) {
    if (memoryId === state.selectedMemoryId) return state;
    const visibleInList = memoryId === null || Boolean(state.listPage && state.listPage.items.some((item) => item.memory_id === memoryId));
    const visibleInGraph = memoryId === null || Boolean(state.graphPage && state.graphPage.nodes.some((node) => node.memory_id === memoryId));
    if (memoryId !== null && !visibleInList && !visibleInGraph) return state;
    const pendingRequests = { ...state.pendingRequests };
    delete pendingRequests["ui.memory_detail"];
    delete pendingRequests["ui.provenance"];
    return { ...state, selectedMemoryId: memoryId, detail: null, provenance: null, pendingRequests };
  }

  /** @param {import("../types").DashboardState} state @param {import("../types").ViewMode} mode */
  function setMode(state, mode) {
    return state.mode === mode ? state : { ...state, mode };
  }

  /** @param {import("../types").DashboardState} state @param {import("../types").DashboardResponse} response */
  function acceptsResponse(state, response) {
    if (!state.owner || response.status !== "ok" || response.operation === "ui.owner_sessions" || !response.binding) return false;
    const owner = state.owner;
    const binding = response.binding;
    const capability = requiredCapability[response.operation];
    return state.pendingRequests[response.operation] === response.request_id &&
      binding.owner_id === owner.owner_id &&
      binding.owner_kind === owner.owner_kind &&
      binding.display_label === owner.display_label &&
      binding.generation === owner.generation &&
      binding.cut === owner.cut &&
      binding.capabilities.view && binding.capabilities[capability] &&
      Object.entries(owner.capabilities).every(([key, granted]) =>
        granted || !binding.capabilities[/** @type {keyof import("../types").CapabilityFlags} */ (key)]);
  }

  /** @param {import("../types").DashboardState} state @param {import("../types").DashboardResponse} response */
  function applyResponse(state, response) {
    if (!acceptsResponse(state, response)) return state;
    const pendingRequests = { ...state.pendingRequests };
    delete pendingRequests[response.operation];
    const next = { ...state, pendingRequests };
    if (response.operation === "ui.memory_list") return { ...next, listPage: response.result };
    if (response.operation === "ui.graph_page") return { ...next, graphPage: response.result };
    if (response.operation === "ui.operational_status") return { ...next, operationalStatus: response.result };
    if (response.operation === "ui.memory_detail") {
      return response.result.memory.memory_id === state.selectedMemoryId ? { ...next, detail: response.result } : state;
    }
    if (response.operation === "ui.provenance") {
      const { memory_id, revision } = response.result;
      return memory_id === state.selectedMemoryId && revision === state.detail?.body.revision
        ? { ...next, provenance: response.result }
        : state;
    }
    return next;
  }

  const api = { createState, changeOwner, beginRequest, selectMemory, setMode, applyResponse, acceptsResponse };
  root.ReliquaryDashboardState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);


(function (root) { root.ReliquaryDashboardFixture = {"owner_sessions":{"protocol_version":1,"request_id":"hu01-owner-sessions","operation":"ui.owner_sessions","status":"ok","binding":null,"result":{"owners":{"items":[{"owner_id":"fixture-rel","owner_kind":"REL","display_label":"General REL","generation":"1","cut":"fixture-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},{"owner_id":"fixture-project-rel","owner_kind":"REL","display_label":"Project REL","generation":"1","cut":"fixture-project-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},{"owner_id":"fixture-phy","owner_kind":"PHY","display_label":"Private PHY","generation":"1","cut":"fixture-phy-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}}],"next_cursor":null,"truncated":false},"active_session_id":"fixture-session","session_owner_id":"fixture-rel","active_phy_id":"fixture-phy"}},"memory_lists":{"fixture-rel":{"protocol_version":1,"request_id":"hu01-list-rel","operation":"ui.memory_list","status":"ok","binding":{"owner_id":"fixture-rel","owner_kind":"REL","display_label":"General REL","generation":"1","cut":"fixture-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"items":[{"memory_id":"fixture-rel-memory","revision":"1","body_id":"fixture-rel-body-1","title":"Synthetic session memory","excerpt":"A short synthetic example owned by the selected REL.","category":"fact","memory_type":"semantic","lifecycle":"active","canonical_status":"canonical","freshness":null,"community_id":null}],"next_cursor":null,"truncated":false}},"fixture-project-rel":{"protocol_version":1,"request_id":"hu01-list-rel-project","operation":"ui.memory_list","status":"ok","binding":{"owner_id":"fixture-project-rel","owner_kind":"REL","display_label":"Project REL","generation":"1","cut":"fixture-project-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"items":[{"memory_id":"fixture-project-rel-memory","revision":"1","body_id":"fixture-project-rel-body-1","title":"Synthetic project memory","excerpt":"A Memory whose copied Hermes source has been tombstoned.","category":"fact","memory_type":"semantic","lifecycle":"active","canonical_status":"canonical","freshness":null,"community_id":null}],"next_cursor":null,"truncated":false}},"fixture-phy":{"protocol_version":1,"request_id":"hu01-list-phy","operation":"ui.memory_list","status":"ok","binding":{"owner_id":"fixture-phy","owner_kind":"PHY","display_label":"Private PHY","generation":"1","cut":"fixture-phy-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"items":[{"memory_id":"fixture-phy-memory","revision":"1","body_id":"fixture-phy-body-1","title":"Synthetic private memory","excerpt":"A private-owner fixture that stays within the selected PHY.","category":"preference","memory_type":"semantic","lifecycle":"active","canonical_status":"canonical","freshness":null,"community_id":null}],"next_cursor":null,"truncated":false}}},"graph_pages":{"fixture-rel":{"protocol_version":1,"request_id":"hu01-graph-rel","operation":"ui.graph_page","status":"ok","binding":{"owner_id":"fixture-rel","owner_kind":"REL","display_label":"General REL","generation":"1","cut":"fixture-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"routing_state":"available","nodes":[{"node_id":"fixture-rel-node","kind":"memory","memory_id":"fixture-rel-memory","community_id":null,"label":"Synthetic session memory","origin":"source","revision":"1","cut":"fixture-rel-v1"}],"edges":[],"next_cursor":null,"truncated":false}},"fixture-project-rel":{"protocol_version":1,"request_id":"hu01-graph-rel-project","operation":"ui.graph_page","status":"ok","binding":{"owner_id":"fixture-project-rel","owner_kind":"REL","display_label":"Project REL","generation":"1","cut":"fixture-project-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"routing_state":"available","nodes":[{"node_id":"fixture-project-rel-node","kind":"memory","memory_id":"fixture-project-rel-memory","community_id":null,"label":"Synthetic project memory","origin":"source","revision":"1","cut":"fixture-project-rel-v1"}],"edges":[],"next_cursor":null,"truncated":false}},"fixture-phy":{"protocol_version":1,"request_id":"hu01-graph-phy","operation":"ui.graph_page","status":"ok","binding":{"owner_id":"fixture-phy","owner_kind":"PHY","display_label":"Private PHY","generation":"1","cut":"fixture-phy-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"routing_state":"available","nodes":[{"node_id":"fixture-phy-node","kind":"memory","memory_id":"fixture-phy-memory","community_id":null,"label":"Synthetic private memory","origin":"source","revision":"1","cut":"fixture-phy-v1"}],"edges":[],"next_cursor":null,"truncated":false}}},"memory_details":{"fixture-rel":{"protocol_version":1,"request_id":"hu01-detail-rel","operation":"ui.memory_detail","status":"ok","binding":{"owner_id":"fixture-rel","owner_kind":"REL","display_label":"General REL","generation":"1","cut":"fixture-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"memory":{"memory_id":"fixture-rel-memory","revision":"1","body_id":"fixture-rel-body-1","title":"Synthetic session memory","excerpt":"A short synthetic example owned by the selected REL.","category":"fact","memory_type":"semantic","lifecycle":"active","canonical_status":"canonical","freshness":null,"community_id":null},"body":{"revision":"1","body_id":"fixture-rel-body-1","availability":"available","content":"One synthetic session-memory line.\nAnother safe fixture line."},"retained_revisions":["1"],"superseded_by":null,"tombstone":false,"provenance":[{"kind":"hermes_snapshot","label":"Hermes source / copied snapshot","profile_namespace":"fixture-profile","session_id":"fixture-session","message_uid":"fixture-message","branch_id":null,"source_revision":null,"content_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","range":{"start_byte":"0","end_byte":"17","text":"safe demo excerpt"}},{"kind":"source_unavailable","reason":"stale"}]}},"fixture-project-rel":{"protocol_version":1,"request_id":"hu01-detail-rel-project","operation":"ui.memory_detail","status":"ok","binding":{"owner_id":"fixture-project-rel","owner_kind":"REL","display_label":"Project REL","generation":"1","cut":"fixture-project-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"memory":{"memory_id":"fixture-project-rel-memory","revision":"1","body_id":"fixture-project-rel-body-1","title":"Synthetic project memory","excerpt":"A Memory whose copied Hermes source has been tombstoned.","category":"fact","memory_type":"semantic","lifecycle":"active","canonical_status":"canonical","freshness":null,"community_id":null},"body":{"revision":"1","body_id":"fixture-project-rel-body-1","availability":"available","content":"This synthetic Memory remains available after its source conversation was removed. Example text: <img src=x onerror=alert(1)>."},"retained_revisions":["1"],"superseded_by":null,"tombstone":false,"provenance":[{"kind":"source_unavailable","reason":"deleted"}]}},"fixture-phy":{"protocol_version":1,"request_id":"hu01-detail-phy","operation":"ui.memory_detail","status":"ok","binding":{"owner_id":"fixture-phy","owner_kind":"PHY","display_label":"Private PHY","generation":"1","cut":"fixture-phy-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"memory":{"memory_id":"fixture-phy-memory","revision":"1","body_id":"fixture-phy-body-1","title":"Synthetic private memory","excerpt":"A private-owner fixture that stays within the selected PHY.","category":"preference","memory_type":"semantic","lifecycle":"active","canonical_status":"canonical","freshness":null,"community_id":null},"body":{"revision":"1","body_id":"fixture-phy-body-1","availability":"available","content":"This is a synthetic owner-scoped example."},"retained_revisions":["1"],"superseded_by":null,"tombstone":false,"provenance":[{"kind":"user_origin","principal_id":"fixture-principal","created_at_ms":"1794000000000"}]}}},"provenance":{"fixture-rel":{"protocol_version":1,"request_id":"hu01-provenance-rel","operation":"ui.provenance","status":"ok","binding":{"owner_id":"fixture-rel","owner_kind":"REL","display_label":"General REL","generation":"1","cut":"fixture-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"memory_id":"fixture-rel-memory","revision":"1","sources":[{"kind":"hermes_snapshot","label":"Hermes source / copied snapshot","profile_namespace":"fixture-profile","session_id":"fixture-session","message_uid":"fixture-message","branch_id":null,"source_revision":null,"content_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","range":{"start_byte":"0","end_byte":"17","text":"safe demo excerpt"}},{"kind":"source_unavailable","reason":"stale"}]}},"fixture-project-rel":{"protocol_version":1,"request_id":"hu01-provenance-rel-project","operation":"ui.provenance","status":"ok","binding":{"owner_id":"fixture-project-rel","owner_kind":"REL","display_label":"Project REL","generation":"1","cut":"fixture-project-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"memory_id":"fixture-project-rel-memory","revision":"1","sources":[{"kind":"source_unavailable","reason":"deleted"}]}},"fixture-phy":{"protocol_version":1,"request_id":"hu01-provenance-phy","operation":"ui.provenance","status":"ok","binding":{"owner_id":"fixture-phy","owner_kind":"PHY","display_label":"Private PHY","generation":"1","cut":"fixture-phy-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"memory_id":"fixture-phy-memory","revision":"1","sources":[{"kind":"user_origin","principal_id":"fixture-principal","created_at_ms":"1794000000000"}]}}},"operational_statuses":{"fixture-rel":{"protocol_version":1,"request_id":"hu01-status-rel","operation":"ui.operational_status","status":"ok","binding":{"owner_id":"fixture-rel","owner_kind":"REL","display_label":"General REL","generation":"1","cut":"fixture-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"session_id":"fixture-session","source_state":"active","accepted_source_cursor":"fixture-source-cursor-rel","last_completed_receipt":"fixture-receipt-rel","pending_count":"0","held_count":"0","error_count":"0","worker_state":"complete","latest_recall":{"state":"returned","search_id":"fixture-search-rel","delivery_id":"fixture-delivery-rel","candidate_ids":["fixture-rel-memory"],"selected_ids":["fixture-rel-memory"],"returned_ids":["fixture-rel-memory"]}}},"fixture-project-rel":{"protocol_version":1,"request_id":"hu01-status-project-rel","operation":"ui.operational_status","status":"ok","binding":{"owner_id":"fixture-project-rel","owner_kind":"REL","display_label":"Project REL","generation":"1","cut":"fixture-project-rel-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"session_id":"fixture-project-session","source_state":"tombstoned","accepted_source_cursor":"fixture-source-cursor-project-rel","last_completed_receipt":"fixture-receipt-project-rel","pending_count":"0","held_count":"0","error_count":"0","worker_state":"complete","latest_recall":{"state":"selected","search_id":"fixture-search-project-rel","delivery_id":null,"candidate_ids":["fixture-project-rel-memory"],"selected_ids":["fixture-project-rel-memory"],"returned_ids":[]}}},"fixture-phy":{"protocol_version":1,"request_id":"hu01-status-phy","operation":"ui.operational_status","status":"ok","binding":{"owner_id":"fixture-phy","owner_kind":"PHY","display_label":"Private PHY","generation":"1","cut":"fixture-phy-v1","capabilities":{"view":true,"manage":false,"history":true,"provenance":true,"graph":true,"community":false,"status":true,"memory_create":false,"memory_edit":false,"memory_retire":false,"relation_edit":false,"community_rename":false}},"result":{"session_id":null,"source_state":"none","accepted_source_cursor":null,"last_completed_receipt":null,"pending_count":"0","held_count":"0","error_count":"0","worker_state":"unavailable","latest_recall":{"state":"candidate","search_id":"fixture-search-phy","delivery_id":null,"candidate_ids":["fixture-phy-memory"],"selected_ids":[],"returned_ids":[]}}}}}; })(globalThis);

(function (root) {
  "use strict";
  let requestSequence = 0;
  const fixture = root.ReliquaryDashboardFixture;
  const state = root.ReliquaryDashboardState;

  /** @template T @param {T} value @returns {T} */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * @param {import("../types").DashboardState} current
   * @param {import("../types").ScopedDashboardResponse | undefined} base
   */
  function applyFixture(current, base) {
    if (!base) return current;
    const response = { ...clone(base), request_id: `hu01-mock-${++requestSequence}` };
    const pending = state.beginRequest(current, response.operation, response.request_id);
    const applied = state.applyResponse(pending, response);
    return applied === pending ? current : applied;
  }

  /** @returns {import("../types").OwnerBinding[]} */
  function getOwners() {
    return clone(fixture.owner_sessions.result.owners.items.filter((owner) => owner.capabilities.view));
  }

  /** @returns {import("../types").OwnerBinding | null} */
  function getDefaultOwner() {
    const ownerId = fixture.owner_sessions.result.session_owner_id;
    return getOwners().find((owner) => owner.owner_kind === "REL" && owner.owner_id === ownerId) || null;
  }

  /** @returns {import("../types").OwnerBinding | null} */
  function getActivePhy() {
    const phyId = fixture.owner_sessions.result.active_phy_id;
    return getOwners().find((owner) => owner.owner_kind === "PHY" && owner.owner_id === phyId) || null;
  }

  /** @param {import("../types").DashboardState} current @param {import("../types").OwnerBinding | null} owner */
  function hydrate(current, owner) {
    let next = state.changeOwner(current, owner);
    if (!owner) return next;
    const ownerId = owner.owner_id;
    const responses = [fixture.memory_lists[ownerId], fixture.graph_pages[ownerId], fixture.operational_statuses[ownerId]];
    for (const base of responses) next = applyFixture(next, base);
    return next;
  }

  /** @param {import("../types").DashboardState} current @param {string} memoryId */
  function select(current, memoryId) {
    let next = state.selectMemory(current, memoryId);
    if (next === current || !next.owner || next.selectedMemoryId !== memoryId) return next;
    const ownerId = next.owner.owner_id;
    next = applyFixture(next, fixture.memory_details[ownerId]);
    return applyFixture(next, fixture.provenance[ownerId]);
  }

  const api = { getOwners, getDefaultOwner, getActivePhy, hydrate, select };
  root.ReliquaryDashboardMock = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);


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
