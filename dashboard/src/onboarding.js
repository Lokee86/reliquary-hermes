(function (root) {
  "use strict";

  const { React, hooks } = root.ReliquaryDashboardHost;
  const h = React.createElement;
  const { useEffect, useRef, useState } = hooks;
  const { candidate, message } = root.ReliquarySetupClient;

  /** @typedef {import("../types").SetupOwner} SetupOwner */
  /** @typedef {import("../types").SetupCheck} SetupCheck */
  /** @typedef {import("../types").SetupPicker} SetupPicker */
  /** @typedef {Parameters<SetupPicker>[0]} PathKind */
  /** @typedef {{ key: number, id: string, path: string }} Project */

  /** @param {SetupCheck | SetupOwner} result */
  function checkText(result) {
    const details = "kind" in result
      ? [result.kind?.toUpperCase(), result.owner_id, result.scope].filter(Boolean).join(" · ")
      : "";
    const state = !result.accepted ? "Rejected" : result.opened ? "Accepted" : "No file selected";
    const error = result.error ? result.error.replaceAll("_", " ") : "";
    return [state, details, error].filter(Boolean).join(" · ");
  }

  /** @type {typeof root.ReliquaryOnboarding.Onboarding} */
  function Onboarding({ status, setup, pickOpenPath, mutationsEnabled, onConnected }) {
    const [main, setMain] = useState(status.defaults.main_rel ?? "");
    const [phy, setPhy] = useState(status.defaults.active_phy ?? "");
    const [config, setConfig] = useState(status.defaults.config_path ?? "");
    const [projects, setProjects] = useState(/** @type {Project[]} */ (
      Object.entries(status.defaults.projects).map(([id, path], key) => ({ id, path, key }))
    ));
    const nextKey = useRef(projects.length);
    const pending = useRef(/** @type {AbortController | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [report, setReport] = useState(/** @type {import("../types").SetupReport | null} */ (null));
    const canSubmit = mutationsEnabled && status.runtime_detected;

    useEffect(() => () => pending.current?.abort(), []);

    function clearResult() {
      setReport(null);
      setError("");
    }

    /** @param {"validate"|"apply"} action */
    async function submit(action) {
      if (!canSubmit || pending.current) return;
      clearResult();
      let selected;
      try {
        selected = candidate(main, phy, config, projects);
      } catch (reason) {
        setError(message(reason));
        return;
      }
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const result = await setup[action](selected, controller.signal);
        if (controller.signal.aborted) return;
        if ("configured" in result && result.configured === true) {
          onConnected();
          return;
        }
        setReport(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(message(reason));
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }

    /** @param {PathKind} kind @param {(path: string) => void} update */
    async function browse(kind, update) {
      if (!pickOpenPath || pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const path = await pickOpenPath(kind);
        if (path && !controller.signal.aborted) {
          clearResult();
          update(path);
        }
      } catch {
        if (!controller.signal.aborted) setError(message(new Error("picker_failed")));
      } finally {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }

    /**
     * @param {string} label
     * @param {string} value
     * @param {(next: string) => void} update
     * @param {PathKind} kind
     * @param {SetupCheck | SetupOwner} [result]
     */
    function pathField(label, value, update, kind, result) {
      return h("div", { className: "rly-setup-path" },
        h("label", { className: "rly-field" }, h("span", null, label), h("input", {
          type: "text", value, autoComplete: "off", maxLength: 4096,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
            clearResult();
            update(event.currentTarget.value);
          },
        })),
        pickOpenPath && h("button", { type: "button", onClick: () => browse(kind, update), "aria-label": "Browse for " + label }, "Browse…"),
        result && h("p", { className: "rly-setup-check", role: "status" }, checkText(result)));
    }

    /** @param {number} key @param {Partial<Project>} update */
    function changeProject(key, update) {
      clearResult();
      setProjects((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
    }

    return h("div", { className: "rly-main rly-setup-form" },
      h("dl", { className: "rly-owner-meta" },
        root.ReliquaryDashboardViews.meta("Reliquary runtime", status.runtime_detected ? "Detected" : "Unavailable"),
        root.ReliquaryDashboardViews.meta("Reliquary config", status.config_path ?? "No config detected")),
      h("form", { noValidate: true, onSubmit: (/** @type {{preventDefault():void}} */ event) => {
        event.preventDefault();
        void submit("apply");
      } },
      h("fieldset", { disabled: busy },
        h("legend", null, "Local Reliquary files"),
        pathField("Main REL path", main, setMain, "REL", report?.main_rel),
        pathField("Active PHY path", phy, setPhy, "PHY", report?.active_phy),
        pathField("Reliquary config path (optional)", config, setConfig, "config", report?.config),
        h("h2", null, "Project RELs"),
        projects.map(({ key, id, path }, index) => h("div", { className: "rly-setup-project", key: String(key) },
          h("label", { className: "rly-field" }, h("span", null, `Project ${index + 1} ID`), h("input", {
            type: "text", value: id, autoComplete: "off", maxLength: 128,
            onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) =>
              changeProject(key, { id: event.currentTarget.value }),
          })),
          pathField(`Project ${index + 1} REL path`, path, (next) => changeProject(key, { path: next }),
            "REL", report?.projects[id.trim()]),
          h("button", { type: "button", "aria-label": `Remove project ${index + 1}`, onClick: () => {
            clearResult();
            setProjects((current) => current.filter((row) => row.key !== key));
          } }, "Remove"))),
        h("button", { type: "button", disabled: projects.length >= 128, onClick: () => {
          clearResult();
          const key = nextKey.current++;
          setProjects((current) => [...current, { key, id: "", path: "" }]);
        } }, "Add project REL"),
        h("div", { className: "rly-setup-actions" },
          h("button", { type: "button", disabled: !canSubmit, onClick: () => submit("validate") }, "Validate"),
          h("button", { type: "submit", disabled: !canSubmit }, "Connect Reliquary")))),
      busy && h("p", { role: "status" }, "Working…"),
      error && h("p", { role: "alert" }, error),
      report && h("p", { role: report.valid ? "status" : "alert" },
        report.valid ? "Validation passed." : report.topology_error
          ? "Owner topology conflict (" + report.topology_error.replaceAll("_", " ") + ")."
          : "Validation failed. Check the rejected files."));
  }

  root.ReliquaryOnboarding = { Onboarding };
})(globalThis);
