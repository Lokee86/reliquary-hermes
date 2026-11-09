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
