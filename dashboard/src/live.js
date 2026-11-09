(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0" || typeof sdk.authedFetch !== "function") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }

  const h = sdk.React.createElement;
  const authedFetch = sdk.authedFetch;
  const { useState } = sdk.hooks;
  const { useRead, useCursor } = ReliquaryDashboardState;
  const { meta, readContent, pager } = ReliquaryDashboardViews;

  function DashboardTab() {
    const [client] = useState(() => ReliquaryDashboardLive.createLiveClient(authedFetch));
    const [sessionId, setSession] = useState(/** @type {string | null} */ (null));
    const [sessionInput, setSessionInput] = useState("");
    const cursor = useCursor();
    const read = useRead(client, "ui.owner_sessions", { owner: null, sessionId }, { cursor: cursor.current, limit: 128 });

    /** @param {{preventDefault():void}} event */
    function findSession(event) {
      event.preventDefault();
      const next = sessionInput.trim() || null;
      cursor.reset();
      client.invalidate();
      setSession(next);
      read.retry();
    }

    return h("section", { className: "rly-dashboard", "aria-label": "Reliquary dashboard" },
      h("header", { className: "rly-header" }, h("div", null,
        h("p", { className: "rly-eyebrow" }, "HERMES WEB DASHBOARD PLUGIN"),
        h("h1", null, "Reliquary Memory"),
        h("p", { className: "rly-subtitle" }, "Owners in this Hermes profile"))),
      h("div", { className: "rly-main" },
        h("form", { onSubmit: findSession, className: "rly-session-lookup" },
          h("label", { className: "rly-field" }, "Hermes session ID", h("input", {
            value: sessionInput, maxLength: 128, autoComplete: "off",
            onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setSessionInput(event.currentTarget.value),
          })),
          h("button", { type: "submit" }, "Look up session")),
        readContent("owner and session bindings", read, (data) => h("section", { "aria-label": "Owner and session bindings" },
          h("dl", { className: "rly-owner-meta" },
            meta("Selected session", data.active_session_id ?? "None"),
            meta("Session REL", data.session_owner_id ?? "None"),
            meta("Active PHY", data.active_phy_id ?? "None")),
          h("h2", null, "Configured owners"),
          data.owners.items.length
            ? h("ul", { className: "rly-live-owners" }, ...data.owners.items.map((owner) =>
              h("li", { key: owner.owner_id }, h("strong", null, owner.display_label),
                h("span", null, owner.owner_kind + " · " + owner.owner_id))))
            : h("p", { className: "rly-empty" }, "No owners on this page."),
          pager("owner", cursor, data.owners.next_cursor)), cursor.reset)),
      h("p", { className: "rly-live-notice", role: "note" },
        "Memory, graph, community, and activity reads are unavailable in this live slice."));
  }

  registry.register("reliquary-hermes", DashboardTab);
})(window);
