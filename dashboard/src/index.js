(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }
  const h = sdk.React.createElement;
  const { useState } = sdk.hooks;
  const { useRead } = globalThis.ReliquaryDashboardState;
  const { meta, readContent, select, Status } = globalThis.ReliquaryDashboardViews;
  const { OwnerContent } = globalThis.ReliquaryDashboardOwner;

  function DashboardTab() {
    const [client, setClient] = useState(() => globalThis.ReliquaryDashboardFixtures.createFixtureClient());
    const sessions = client.sessions();
    const [sessionId, setSession] = useState(/** @type {string|null} */ (sessions[0]?.sessionId ?? null));
    const [kind, setKind] = useState(/** @type {import("../types").OwnerKind} */ ("REL"));
    const discovery = useRead(client, "ui.owner_sessions", { owner: null, sessionId }, { cursor: null, limit: 128 });

    /** @param {string | null} id */
    function changeSession(id) {
      if (id === sessionId) return;
      client.invalidate();
      setSession(id);
    }

    return h("section", { className: "rly-dashboard", "aria-label": "Reliquary dashboard fixture" },
      h("header", { className: "rly-header" },
        h("div", null, h("p", { className: "rly-eyebrow" }, "HERMES WEB DASHBOARD PLUGIN"),
          h("h1", null, "Reliquary Memory"), h("p", { className: "rly-subtitle" }, "Graph, list, and Memory inspection")),
        h("div", { className: "rly-fixture-pill" }, "Synthetic fixture")),
      h("div", { className: "rly-live-notice", role: "note" },
        "Synthetic fixture only. All records and status shown below are sample data."),
      readContent("owner and session bindings", discovery, (data) => {
        const owners = data.owners.items.filter((item) => item.capabilities.view);
        const rels = owners.filter((item) => item.owner_kind === "REL" && sessions.some((session) => session.relId === item.owner_id));
        const rel = rels.find((item) => item.owner_id === data.session_owner_id);
        const phy = owners.find((item) => item.owner_id === data.active_phy_id && item.owner_kind === "PHY");
        const owner = (kind === "PHY" ? phy : rel) ?? null;
        const scope = { owner, sessionId: owner?.owner_kind === "REL" ? data.active_session_id : null };
        const scopeKey = JSON.stringify([scope, data.active_phy_id]);

        return h("div", { className: "rly-layout" },
          h("aside", { className: "rly-sidebar", "aria-label": "Owner and scope" },
            h("h2", null, "Owner / scope"),
            select("REL", rel?.owner_id ?? "", rels.map((item) => ({ value: item.owner_id, label: item.display_label })),
              (id) => changeSession(sessions.find((session) => session.relId === id)?.sessionId ?? null)),
            select("Session", data.active_session_id ?? "", sessions.map((item) => ({ value: item.sessionId, label: item.sessionId })),
              (id) => changeSession(id || null)),
            select("Active PHY", phy?.owner_id ?? "", [{ value: "", label: "None" },
              ...client.phys().map((item) => ({ value: item.phyId, label: item.label }))],
            (id) => {
              if (!id) setKind("REL");
              client.invalidate();
              setClient(globalThis.ReliquaryDashboardFixtures.createFixtureClient(undefined, id || null));
            }),
            select("Browse owner", kind, [{ value: "REL", label: "Selected REL" },
              ...(phy ? [{ value: "PHY", label: "Active PHY" }] : [])],
            (value) => {
              const next = value === "PHY" && phy ? "PHY" : "REL";
              if (next !== kind) client.invalidate();
              setKind(next);
            }),
            h("dl", { className: "rly-owner-meta" },
              meta("Selected session", data.active_session_id ?? "None"),
              meta("Mapped REL", rel?.display_label ?? "None"),
              meta("Reliquary user ID", phy?.owner_id ?? "None"),
              owner && meta("Owner kind", owner.owner_kind),
              owner && meta("Generation", owner.generation),
              owner && meta("Cut", owner.cut)),
            owner && h(Status, { key: scopeKey, client, scope })),
          owner ? h(OwnerContent, { key: scopeKey, client, scope: { ...scope, owner } })
            : h("p", { className: "rly-empty" }, "No authorized owner is available for this scope."));
      }));
  }

  registry.register("reliquary-hermes", DashboardTab);
})(window);
