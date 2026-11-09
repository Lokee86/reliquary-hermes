(function (root) {
  "use strict";

  const endpoint = "/api/plugins/reliquary-hermes/setup-v1";
  const messages = new Map([
    ["runtime_unavailable", "The Reliquary host is unavailable. Check the plugin installation."],
    ["preflight_unavailable", "The Reliquary host could not validate these files."],
    ["managed_setup", "This Hermes profile is managed and does not allow local setup changes."],
    ["service_restart_required", "Stop the running Reliquary service before changing these settings."],
    ["setup_request_too_large", "The selected paths exceed the setup request limit."],
    ["invalid_setup_request", "Check the paths and project IDs, then try again."],
    ["setup_denied", "Hermes did not authorize setup in this profile."],
    ["setup_unavailable", "Could not reach Reliquary setup. Try again."],
    ["invalid_setup_response", "Reliquary returned an invalid setup response."],
    ["picker_failed", "Hermes Desktop could not open the file picker."],
    ["main_path", "Enter an absolute local path for the main REL."],
    ["phy_path", "Enter an absolute local path for the active PHY."],
    ["config_path", "Enter an absolute local path for the Reliquary config."],
    ["project_path", "Enter an absolute local path for each project REL."],
    ["project_id", "Use a distinct ID for each project, starting with a letter or number."],
  ]);

  /** @param {unknown} error */
  function message(error) {
    return messages.get(error instanceof Error ? error.message : "") ?? "Could not complete Reliquary setup.";
  }

  /** @param {string} path */
  function localPath(path) {
    return /^(?:[a-z]:[\\/]|\/(?!\/))/i.test(path) && !path.includes("\0") &&
      new TextEncoder().encode(path).length <= 4096;
  }

  /**
   * @param {string} main
   * @param {string} phy
   * @param {string} config
   * @param {{id:string,path:string}[]} projects
   * @returns {import("../types").SetupCandidate}
   */
  function candidate(main, phy, config, projects) {
    const main_rel = main.trim();
    const active_phy = phy.trim();
    const config_path = config.trim() || null;
    if (!localPath(main_rel)) throw new Error("main_path");
    if (!localPath(active_phy)) throw new Error("phy_path");
    if (config_path && !localPath(config_path)) throw new Error("config_path");
    const entries = new Map();
    for (const { id, path } of projects) {
      const key = id.trim();
      const value = path.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key) || entries.has(key)) throw new Error("project_id");
      if (!localPath(value)) throw new Error("project_path");
      entries.set(key, value);
    }
    return { main_rel, active_phy, projects: Object.fromEntries(entries), config_path };
  }

  /**
   * @param {import("../types").HermesDashboardSDK["authedFetch"]} authedFetch
   * @returns {import("../types").SetupClient}
   */
  function createSetupClient(authedFetch) {
    /**
     * @param {"status"|"validate"|"apply"} operation
     * @param {AbortSignal} signal
     * @param {import("../types").SetupCandidate} [value]
     */
    async function request(operation, signal, value) {
      signal.throwIfAborted();
      let response;
      try {
        response = await authedFetch(endpoint + "/" + operation, value ? {
          method: "POST", signal, cache: "no-store", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        } : { method: "GET", signal, cache: "no-store" });
      } catch {
        signal.throwIfAborted();
        throw new Error("setup_unavailable");
      }
      const data = await response.json().catch(() => null);
      signal.throwIfAborted();
      if (!response.ok) {
        const known = messages.has(data?.detail) ? data.detail : null;
        throw new Error(known ?? (response.status === 401 || response.status === 403 ? "setup_denied" : "setup_unavailable"));
      }
      if (operation === "status") {
        if (typeof data?.configured !== "boolean" || typeof data.runtime_detected !== "boolean" ||
            !data.defaults || !data.defaults.projects) throw new Error("invalid_setup_response");
        return { ...data, desktop_native_mutations: data.desktop_native_mutations === true };
      }
      if (!(operation === "apply" && data?.valid === true && data.configured === true)) {
        if (typeof data?.valid !== "boolean" || !data.main_rel || !data.active_phy || !data.projects || !data.config ||
            (operation === "apply" && data.configured !== false)) throw new Error("invalid_setup_response");
      }
      return data;
    }

    return {
      status: (signal) => request("status", signal),
      validate: (value, signal) => request("validate", signal, value),
      apply: (value, signal) => request("apply", signal, value),
    };
  }

  const api = { createSetupClient, candidate, message };
  root.ReliquarySetupClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
