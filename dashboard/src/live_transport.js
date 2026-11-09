(function (root) {
  "use strict";

  const endpoint = "/api/plugins/reliquary-hermes/dashboard-v1";

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

      if (request.operation !== "ui.owner_sessions") {
        return failure("unsupported", "operation_unwired", false);
      }
      const response = await authedFetch(endpoint, {
        method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" },
        // The profile and principal fields are wire placeholders. Hermes and the service supply authority.
        body: JSON.stringify({ ...request, profile_id: "dashboard", principal_id: "dashboard" }),
      });
      if (response.status === 401 || response.status === 403) return failure("denied", "dashboard_denied", false);
      if (response.status === 400) return failure("invalid", "invalid_request", false);
      if (!response.ok) return failure("unavailable", "dashboard_unavailable", true);
      return response.json();
    });
  }

  const api = { createLiveClient };
  root.ReliquaryDashboardLive = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
