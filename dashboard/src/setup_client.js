(function (root) {
  "use strict";

  const endpoint = "/api/plugins/reliquary-hermes/setup-v1";
  const messages = new Map([
    ["runtime_unavailable", "The Reliquary host is unavailable. Check the plugin installation."],
    ["preflight_unavailable", "The Reliquary host could not validate these files."],
    ["managed_setup", "This Hermes profile is managed and does not allow local setup changes."],
    ["service_restart_required", "Stop the running Reliquary service for this profile, then retry connecting to start it with the new settings."],
    ["setup_request_too_large", "The selected paths exceed the setup request limit."],
    ["invalid_setup_request", "Check the selected owner paths and refresh the Hermes projects list."],
    ["setup_denied", "Hermes did not authorize setup in this profile."],
    ["setup_unavailable", "Could not reach Reliquary setup. Try again."],
    ["source_capture_setup_required", "Check this profile's Reliquary capture enrollment file, then retry setup."],
    ["invalid_setup_response", "Reliquary returned an invalid setup response."],
    ["picker_failed", "Hermes Desktop could not open the file picker."],
    ["main_path", "Enter an absolute local path for the main REL."],
    ["phy_path", "Enter an absolute local path for the active PHY."],
    ["config_path", "Enter an absolute local path for the Reliquary config."],
    ["project_path", "Enter an absolute local path for each project REL."],
    ["project_id", "Refresh the Hermes projects list and try again."],
    ["project_discovery_unavailable", "Refresh the projects list to try again."],
    ["unknown_hermes_project", "The selected project is unavailable in this Hermes profile. Refresh the projects list."],
    ["same_origin_required", "Hermes did not authorize a setup write from this surface."],
    ["invalid_browse_kind", "Hermes could not determine which files to list."],
    ["invalid_local_path", "Hermes rejected this host path."],
    ["browse_outside_roots", "This location is outside the folders permitted for browsing in this profile."],
    ["browse_reparse_point", "This location goes through a filesystem link. Choose a permitted local folder."],
    ["browse_not_directory", "This location is no longer a folder."],
    ["browse_not_found", "This folder is no longer available."],
    ["browse_unreadable", "Hermes could not list this folder. Choose another folder or use an Advanced path."],
    ["browse_timeout", "Hermes could not finish listing this folder. Try again or choose another folder."],
    ["invalid_owner_path", "Choose a valid local destination for the new owner file."],
    ["owner_already_exists", "A file already exists at that location. Select it or choose another destination."],
    ["owner_creation_failed", "Reliquary could not create the owner file. Check the destination before retrying."],
    ["owner_creation_unavailable", "The Reliquary host could not start owner creation."],
    ["owner_created_unverified", "Reliquary created the file but could not verify it. Use Select to check the file before retrying."],
    ["owner_creation_unconfirmed", "Reliquary could not confirm creation. Use Select to check whether the file exists before retrying."],
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
   * @param {{id:string,path:string}[]} [projects]
   * @returns {import("../types").SetupCandidate}
   */
  function candidate(main, phy, config, projects) {
    const main_rel = main.trim();
    const active_phy = phy.trim();
    const config_path = config.trim() || null;
    if (!localPath(main_rel)) throw new Error("main_path");
    if (!localPath(active_phy)) throw new Error("phy_path");
    if (config_path && !localPath(config_path)) throw new Error("config_path");
    const selection = { main_rel, active_phy, config_path };
    if (!projects) return selection;
    const entries = new Map();
    for (const { id, path } of projects) {
      const key = id.trim();
      const value = path.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key) || entries.has(key)) throw new Error("project_id");
      if (!localPath(value)) throw new Error("project_path");
      entries.set(key, value);
    }
    return { ...selection, projects: Object.fromEntries(entries) };
  }

  /**
   * @param {import("../types").HermesDashboardSDK["authedFetch"]} authedFetch
   * @returns {import("../types").SetupClient}
   */
  function createSetupClient(authedFetch) {
    /**
     * @param {string} operation
     * @param {AbortSignal} signal
     * @param {import("../types").SetupCandidate | import("../types").SetupCreateRequest} [value]
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
      return data;
    }

    /** @param {unknown} data @param {boolean} applying */
    function checkReport(data, applying) {
      const report = /** @type {Partial<import("../types").SetupReport> & {configured?: boolean} | null} */ (data);
      if (applying && report?.configured === true && report.valid === true) return report;
      if (typeof report?.valid !== "boolean" || !report.main_rel || !report.active_phy || !report.projects ||
          !report.config || (applying && report.configured !== false)) throw new Error("invalid_setup_response");
      return report;
    }

    return {
      async status(signal) {
        const data = await request("status", signal);
        if (typeof data?.configured !== "boolean" || typeof data.runtime_detected !== "boolean" ||
            !data.defaults?.projects) throw new Error("invalid_setup_response");
        return { ...data, desktop_native_mutations: data.desktop_native_mutations === true };
      },
      async projects(signal) {
        const data = await request("projects", signal);
        const projects = data?.projects;
        if (!Array.isArray(projects) || typeof data.routing_available !== "boolean" ||
            projects.some((project) =>
          typeof project?.name !== "string" || typeof project.id !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(project.id)) ||
          new Set(projects.map((project) => project.id)).size !== projects.length) {
          throw new Error("invalid_setup_response");
        }
        return data;
      },
      async browse(kind, path, signal) {
        const query = new URLSearchParams({ kind });
        if (path !== null) query.set("path", path);
        const data = await request("browse?" + query, signal);
        const entries = data?.entries;
        if (!Array.isArray(entries) || typeof data.truncated !== "boolean" ||
            (data.path !== null && typeof data.path !== "string") ||
            (data.parent !== null && typeof data.parent !== "string") ||
            entries.some((entry) => typeof entry?.name !== "string" || typeof entry.path !== "string" ||
              (entry.kind !== "directory" && entry.kind !== "file"))) throw new Error("invalid_setup_response");
        return data;
      },
      async create(value, signal) {
        const data = await request("create", signal, value);
        if (data?.accepted !== true || data.opened !== true || typeof data.owner_id !== "string" ||
            typeof data.path !== "string" || data.kind !== (value.kind === "phy" ? "phy" : "rel")) {
          throw new Error("owner_creation_unconfirmed");
        }
        return data;
      },
      async validate(value, signal) {
        return /** @type {import("../types").SetupReport} */ (checkReport(await request("validate", signal, value), false));
      },
      async apply(value, signal) {
        const data = checkReport(await request("apply", signal, value), true);
        return /** @type {Awaited<ReturnType<import("../types").SetupClient["apply"]>>} */ (data);
      },
    };
  }

  const api = { createSetupClient, candidate, message };
  root.ReliquarySetupClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
