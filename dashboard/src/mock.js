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
