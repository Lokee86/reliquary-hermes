(function (root) {
  "use strict";

  const { React, hooks } = root.ReliquaryDashboardHost;
  const { Button, Input } = root.ReliquaryDashboardHost.components;
  const h = React.createElement;
  const { useEffect, useRef, useState } = hooks;
  const { candidate, message } = root.ReliquarySetupClient;

  /** @typedef {import("../types").SetupOwner} SetupOwner */
  /** @typedef {import("../types").SetupCheck} SetupCheck */
  /** @typedef {import("../types").SetupPicker} SetupPicker */
  /** @typedef {Parameters<SetupPicker>[0]} PathKind */
  /** @typedef {import("../types").SetupCreateKind} CreateKind */
  /** @typedef {{ label: string, kind: PathKind, update(path: string): void, createKind?: CreateKind, projectId?: string }} PickerTarget */

  /** @param {SetupCheck | SetupOwner} result */
  function checkText(result) {
    const details = "kind" in result
      ? [result.kind?.toUpperCase(), result.owner_id, result.scope].filter(Boolean).join(" · ")
      : "";
    const state = !result.accepted ? "Rejected" : result.opened ? "Accepted" : "No file selected";
    const error = result.error ? result.error.replaceAll("_", " ") : "";
    return [state, details, error].filter(Boolean).join(" · ");
  }

  /**
   * @param {{setup: import("../types").SetupClient, target: PickerTarget, creating: boolean,
   *   onPick(path: string): void, onCancel(): void}} props
   */
  function HostFilePicker({ setup, target, creating, onPick, onCancel }) {
    const [path, setPath] = useState(/** @type {string | null} */ (null));
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState(/** @type {{
      path: string | null, attempt: number, listing?: import("../types").SetupListing, error?: string
    } | null} */ (null));
    const extension = target.kind === "PHY" ? ".phy" : ".rel";
    const [name, setName] = useState("");
    const kind = /** @type {import("../types").SetupBrowseKind} */ (target.kind.toLowerCase());

    useEffect(() => {
      const controller = new AbortController();
      setup.browse(kind, path, controller.signal).then((listing) => {
        if (!controller.signal.aborted) setState({ path, attempt, listing });
      }, (reason) => {
        if (!controller.signal.aborted) setState({ path, attempt, error: message(reason) });
      });
      return () => controller.abort();
    }, [setup, kind, path, attempt]);

    const current = state?.path === path && state.attempt === attempt ? state : null;
    const listing = current?.listing;
    const filename = name.trim();
    const validName = filename.length > 0 && !/[<>:"/\\|?*\x00-\x1f]/.test(filename) &&
      !filename.endsWith(".") && filename !== "..";
    const basename = filename.toLowerCase().endsWith(extension) ? filename : filename + extension;
    const directory = listing?.path;
    const separator = directory?.includes("\\") ? "\\" : "/";
    const destination = directory && validName ? directory.replace(/[\\/]$/, "") + separator + basename : null;

    return h("section", { className: "rly-setup-picker", "aria-label": "Browse Hermes host files" },
      h("h2", null, (creating ? "Choose a destination for " : "Select a file for ") + target.label),
      h("p", null, "Browsing files on the machine hosting Hermes."),
      path !== null && h(Button, { type: "button", onClick: () => setPath(listing?.parent ?? null) },
        listing?.parent ? "Up one folder" : "Back to permitted folders"),
      current?.error && h("p", { role: "alert" }, current.error),
      current?.error && h(Button, { type: "button", onClick: () => setAttempt((count) => count + 1) }, "Retry folder"),
      !current && h("p", { role: "status" }, "Loading folders…"),
      listing && h("p", { className: "rly-setup-value" }, directory ?? "Permitted folders"),
      listing?.truncated && h("p", { role: "status" }, "This listing is capped. Use Advanced for a known path."),
      listing && h("ul", { className: "rly-setup-entries" },
        listing.entries.filter((entry) => !creating || entry.kind === "directory").map((entry) =>
          h("li", { key: entry.path }, h(Button, {
            type: "button", title: entry.path,
            onClick: () => entry.kind === "directory" ? setPath(entry.path) : onPick(entry.path),
          }, entry.name + (entry.kind === "directory" ? " /" : ""))))),
      creating && directory && h("label", { className: "rly-field" }, h("span", null, "New file name"),
        h(Input, { value: name, placeholder: "memory" + extension, maxLength: 200, autoComplete: "off",
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setName(event.currentTarget.value) })),
      h("div", { className: "rly-setup-actions" },
        creating && h(Button, { type: "button", disabled: !destination,
          onClick: () => { if (destination) onPick(destination); } }, "Use this destination"),
        h(Button, { type: "button", onClick: onCancel }, "Cancel")));
  }

  /** @type {typeof root.ReliquaryOnboarding.Onboarding} */
  function Onboarding({ status, setup, pickOpenPath, pickSavePath, mutationsEnabled, onConnected }) {
    const [main, setMain] = useState(status.defaults.main_rel ?? "");
    const [phy, setPhy] = useState(status.defaults.active_phy ?? "");
    const [config, setConfig] = useState(status.defaults.config_path ?? "");
    const [assignments, setAssignments] = useState(() => new Map(Object.entries(status.defaults.projects)));
    const [inventoryAttempt, setInventoryAttempt] = useState(0);
    const [inventory, setInventory] = useState(/** @type {{
      attempt: number, value?: import("../types").SetupProjectInventory, error?: string
    } | null} */ (null));
    const [showProjectHelp, setShowProjectHelp] = useState(false);
    const pending = useRef(/** @type {AbortController | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [report, setReport] = useState(/** @type {import("../types").SetupReport | null} */ (null));
    const [browser, setBrowser] = useState(/** @type {{ target: PickerTarget, creating: boolean } | null} */ (null));
    const [destination, setDestination] = useState(/** @type {{target: PickerTarget, path: string} | null} */ (null));
    const [created, setCreated] = useState(/** @type {string[]} */ ([]));
    const [review, setReview] = useState(/** @type {{
      selected: import("../types").SetupCandidate, fallback: number
    } | null} */ (null));
    const canSubmit = mutationsEnabled && status.runtime_detected;
    const currentInventory = inventory?.attempt === inventoryAttempt ? inventory : null;
    const projects = currentInventory?.value?.projects ?? [];
    const routingAvailable = currentInventory?.value?.routing_available === true;
    const controlsLocked = !!(browser || destination || review || busy);

    useEffect(() => () => pending.current?.abort(), []);
    useEffect(() => {
      const controller = new AbortController();
      setup.projects(controller.signal).then((value) => {
        if (!controller.signal.aborted) setInventory({ attempt: inventoryAttempt, value });
      }, (reason) => {
        if (!controller.signal.aborted) setInventory({
          attempt: inventoryAttempt, error: "Could not load Hermes projects. " + message(reason),
        });
      });
      return () => controller.abort();
    }, [setup, inventoryAttempt]);

    function clearResult() {
      setReport(null);
      setError("");
    }

    /** @param {(signal: AbortSignal) => Promise<void>} operation */
    async function run(operation) {
      if (pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setError("");
      setBusy(true);
      try {
        await operation(controller.signal);
      } catch (reason) {
        if (!controller.signal.aborted) setError(message(reason));
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }

    /** @param {boolean} reviewing */
    function validate(reviewing) {
      if (!canSubmit || controlsLocked || (reviewing && !currentInventory)) return;
      setReport(null);
      return run(async (signal) => {
        const selected = candidate(main, phy, config, Array.from(assignments, ([id, path]) => ({ id, path })));
        const result = await setup.validate(selected, signal);
        if (signal.aborted) return;
        setReport(result);
        if (reviewing && result.valid) setReview({
          selected, fallback: projects.filter(({ id }) => !routingAvailable || !assignments.has(id)).length,
        });
      });
    }

    function connect() {
      if (!canSubmit || !review) return;
      return run(async (signal) => {
        const result = await setup.apply(review.selected, signal);
        if (signal.aborted) return;
        if (result.configured) {
          onConnected();
          return;
        }
        setReport(result);
        setReview(null);
      });
    }

    /** @param {PickerTarget} target @param {boolean} creating @param {string} path */
    function acceptPath(target, creating, path) {
      setBrowser(null);
      if (creating) {
        setDestination({ target, path });
      } else {
        clearResult();
        target.update(path);
      }
    }

    /** @param {PickerTarget} target @param {boolean} [creating] */
    function choose(target, creating = false) {
      if (controlsLocked || (creating && !canSubmit)) return;
      const picker = creating ? pickSavePath : pickOpenPath;
      if (!picker) {
        setBrowser({ target, creating });
        return;
      }
      return run(async (signal) => {
        const path = await picker(target.kind).catch(() => { throw new Error("picker_failed"); });
        if (path && !signal.aborted) acceptPath(target, creating, path);
      });
    }

    function confirmCreate() {
      if (!canSubmit || !destination?.target.createKind) return;
      const { target, path } = destination;
      const kind = destination.target.createKind;
      return run(async (signal) => {
        const result = await setup.create({ kind, path, project_id: target.projectId }, signal);
        if (signal.aborted) return;
        setDestination(null);
        setCreated((paths) => [...paths, result.path]);
        acceptPath(target, false, result.path);
      });
    }

    /** @param {PickerTarget} target @param {string} value */
    function ownerButtons(target, value) {
      return h("div", { className: "rly-setup-actions" },
        h(Button, { type: "button", onClick: () => choose(target) }, "Select " + target.kind),
        h(Button, { type: "button", disabled: !canSubmit, onClick: () => choose(target, true) },
          "Create " + target.kind),
        target.projectId && h(Button, { type: "button", disabled: !value || !mutationsEnabled,
          onClick: () => { clearResult(); target.update(""); } }, "Use General"));
    }

    /** @param {string} label @param {string} value @param {(next: string) => void} update */
    function pathInput(label, value, update) {
      return h("label", { className: "rly-field" }, h("span", null, label), h(Input, {
        type: "text", value, autoComplete: "off", maxLength: 4096,
        onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
          clearResult();
          update(event.currentTarget.value);
        },
      }));
    }

    /** @param {SetupOwner | SetupCheck | undefined} result */
    function check(result) {
      return result && h("p", { className: "rly-setup-check", role: "status" }, checkText(result));
    }

    const general = /** @type {PickerTarget} */ ({
      label: "General memory", kind: "REL", update: setMain, createKind: "general_rel",
    });
    const identity = /** @type {PickerTarget} */ ({
      label: "Active identity", kind: "PHY", update: setPhy, createKind: "phy",
    });
    const configFile = /** @type {PickerTarget} */ ({
      label: "Reliquary configuration", kind: "config", update: setConfig,
    });

    const projectCards = projects.map(({ id, name }) => {
      const path = assignments.get(id) ?? "";
      const target = /** @type {PickerTarget} */ ({
        label: name, kind: "REL", createKind: "project_rel", projectId: id,
        update(next) {
          setAssignments((current) => {
            const updated = new Map(current);
            if (next) updated.set(id, next);
            else updated.delete(id);
            return updated;
          });
        },
      });
      const savedPath = Object.hasOwn(status.defaults.projects, id) ? status.defaults.projects[id] : "";
      const savedRoute = status.configured ? savedPath : path;
      return { id, name, path, target, savedRoute, draftChanged: status.configured && savedPath !== path };
    });

    return h("div", { className: "rly-main rly-setup-form" },
      h("dl", { className: "rly-owner-meta" },
        root.ReliquaryDashboardViews.meta("Reliquary runtime", status.runtime_detected ? "Detected" : "Unavailable"),
        root.ReliquaryDashboardViews.meta("Reliquary config", status.config_path ?? "No config detected")),
      h("form", { noValidate: true, onSubmit: (/** @type {{preventDefault():void}} */ event) => {
        event.preventDefault();
        void validate(true);
      } },
      h("fieldset", { disabled: controlsLocked },
        h("section", { "aria-label": "General memory", className: "rly-setup-card" },
          h("h2", null, "General memory"),
          h("p", { className: "rly-setup-value" }, main || "A General REL is required."),
          ownerButtons(general, main), check(report?.main_rel)),
        h("section", { "aria-label": "Active identity", className: "rly-setup-card" },
          h("h2", null, "Active identity"),
          h("p", { className: "rly-setup-value" }, phy || "An active PHY is required."),
          ownerButtons(identity, phy), check(report?.active_phy)),
        h("section", { "aria-label": "Project memories", className: "rly-setup-card" },
          h("h2", null, "Project memories"),
          h("p", null, "Project memory selections apply after connecting."),
          h("div", { className: "rly-setup-actions" },
            h(Button, { type: "button", "aria-expanded": showProjectHelp,
              onClick: () => setShowProjectHelp((show) => !show) }, "Create Hermes project"),
            h(Button, { type: "button", onClick: () => setInventoryAttempt((count) => count + 1) }, "Refresh projects")),
          showProjectHelp && (pickOpenPath
            ? h("p", { role: "note" }, "In Hermes Desktop Chat, choose New project in the Projects sidebar. Then return here and refresh the project list.")
            : h("p", { role: "note" }, "Run ", h("code", null, "hermes project create <name>"),
              " for this Hermes profile, then refresh the project list.")),
          !currentInventory && h("p", { role: "status" }, "Loading Hermes projects…"),
          currentInventory?.error && h("p", { role: "alert" }, currentInventory.error),
          currentInventory?.value?.projects.length === 0 && h("p", null, "This profile has no active Hermes projects."),
          currentInventory?.value && !routingAvailable && projects.length > 0 && h("p", { role: "note" },
            "This Hermes host does not supply trusted project membership for sessions. New sessions use General memory."),
          projectCards.map(({ id, name, path, target, savedRoute, draftChanged }) =>
            h("section", { key: id, className: "rly-setup-card", "aria-label": name },
              h("h3", null, name),
              h("p", null, savedRoute && routingAvailable ? "Dedicated REL" : "Using General memory"),
              path && (!routingAvailable || draftChanged) && h("p", null, "Dedicated REL selected"),
              !path && draftChanged && h("p", null, "General memory selected"),
              path && h("p", { className: "rly-setup-value" }, path),
              ownerButtons(target, path),
              check(report && Object.hasOwn(report.projects, id) ? report.projects[id] : undefined)))),
        h("details", null, h("summary", null, "Advanced"),
          pathInput("Main REL path", main, setMain),
          pathInput("Active PHY path", phy, setPhy),
          ...projectCards.map(({ id, name, path, target }) => h("div", { key: id },
            pathInput(name + " REL path", path, target.update))),
          pathInput("Reliquary config path (optional)", config, setConfig),
          h(Button, { type: "button", onClick: () => choose(configFile) }, "Select configuration"),
          check(report?.config)),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: !canSubmit, onClick: () => validate(false) }, "Validate"),
          h(Button, { type: "submit", disabled: !canSubmit || !currentInventory }, "Review and connect")))),
      browser && h(HostFilePicker, { setup, ...browser, onCancel: () => setBrowser(null),
        onPick: (/** @type {string} */ path) => acceptPath(browser.target, browser.creating, path) }),
      destination && h("section", { className: "rly-setup-picker", "aria-label": "Confirm owner creation" },
        h("h2", null, "Confirm owner creation"),
        h("p", { className: "rly-setup-value" }, destination.path),
        h("p", null, "Reliquary will create a new file at this path."),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: busy || !canSubmit, onClick: confirmCreate }, "Create owner file"),
          h(Button, { type: "button", disabled: busy, onClick: () => { setDestination(null); setError(""); } }, "Cancel"))),
      review && h("section", { className: "rly-setup-picker", "aria-label": "Review connection" },
        h("h2", null, "Review connection"),
        currentInventory?.error && h("p", { role: "note" }, "Hermes project memory routes could not be checked."),
        review.fallback > 0 && h("p", { role: "note" },
          review.fallback + (review.fallback === 1 ? " project will" : " projects will") +
          " use General memory for new sessions."),
        status.configured && h("p", null, "Existing Hermes sessions keep their accepted memory routes."),
        h("div", { className: "rly-setup-actions" },
          h(Button, { type: "button", disabled: busy || !canSubmit, onClick: connect },
            review.fallback > 0 ? "Continue" : "Connect Reliquary"),
          h(Button, { type: "button", disabled: busy, onClick: () => { setReview(null); setError(""); } }, "Back to edit"))),
      created.length > 0 && h("div", { role: "status" }, h("p", null, "Created owner files remain on disk if connection fails."),
        h("ul", { className: "rly-setup-value" }, created.map((path) => h("li", { key: path }, path)))),
      busy && h("p", { role: "status" }, "Working…"),
      error && h("p", { role: "alert" }, error),
      report && h("p", { role: report.valid ? "status" : "alert" },
        report.valid ? "Validation passed." : report.topology_error === "owner_topology_changed"
          ? "Owner topology conflict. Keep the accepted General REL, PHY, and dedicated project owners when adding project RELs."
          : report.topology_error
            ? "Owner topology conflict (" + report.topology_error.replaceAll("_", " ") + ")."
          : "Validation failed. Check the rejected files."));
  }

  root.ReliquaryOnboarding = { Onboarding };
})(globalThis);
