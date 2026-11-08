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
