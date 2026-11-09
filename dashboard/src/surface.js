(function (root) {
  "use strict";

  /** @type {import("../types").CreateReliquarySurface} */
  function createSurface({ authedFetch, pickOpenPath, pickSavePath, mutationBlockReason, surfaceLabel }) {
    const { React, hooks, components } = root.ReliquaryDashboardHost;
    const h = React.createElement;
    const { Button, Input } = components;
    const { useState, useEffect } = hooks;
    const { useRead, useCursor } = root.ReliquaryDashboardState;
    const { meta, readContent, select, pager, Status } = root.ReliquaryDashboardViews;
    const { OwnerContent } = root.ReliquaryDashboardOwner;
    const { createLiveMutation } = root.ReliquaryDashboardLive;

    /** @param {{client: import("../types").DashboardClient, configPath: string | null,
     *   blockReason?: string, onManageSetup(): void}} props */
    function DashboardTab({ client, configPath, blockReason, onManageSetup }) {
      const [write] = useState(() => blockReason ? undefined : createLiveMutation(authedFetch));
      const [sessionId, setSessionId] = useState(/** @type {string | null} */ (null));
      const [sessionInput, setSessionInput] = useState("");
      const [selectedOwnerId, setSelectedOwnerId] = useState(/** @type {string | null} */ (null));
      const [lastGood, setLastGood] = useState(/** @type {{sessionId:string|null,cursor:string|null,value:import("../types").ReadResults["ui.owner_sessions"]}|null} */ (null));
      const ownerCursor = useCursor();
      const discovery = useRead(client, "ui.owner_sessions", { owner: null, sessionId },
        { cursor: ownerCursor.current, limit: 128 });

      useEffect(() => {
        if (discovery.state.status === "ok") {
          setLastGood({ sessionId, cursor: ownerCursor.current, value: discovery.state.value });
        }
      }, [client, sessionId, ownerCursor.current, discovery.state]);
      useEffect(() => { setLastGood(null); }, [sessionId, ownerCursor.current]);
      const sameBindingPage = lastGood?.sessionId === sessionId && lastGood.cursor === ownerCursor.current;
      const refreshing = sameBindingPage && discovery.state.status === "loading";
      /** @type {import("../types").ReadHandle<import("../types").ReadResults["ui.owner_sessions"]>} */
      const visibleDiscovery = refreshing && lastGood
        ? { ...discovery, state: { status: "ok", value: lastGood.value } }
        : discovery;

      function refreshOwnerData() {
        client.invalidate();
        discovery.retry();
      }

      /** @param {{preventDefault():void}} event */
      function findSession(event) {
        event.preventDefault();
        const requested = sessionInput.trim() || null;
        if (requested === sessionId) { discovery.retry(); return; }
        client.invalidate();
        ownerCursor.reset();
        setSelectedOwnerId(null);
        setLastGood(null);
        setSessionId(requested);
      }

      return h("section", { className: "rly-dashboard", "aria-label": "Reliquary live dashboard" },
        h("header", { className: "rly-header" }, h("div", null,
          h("p", { className: "rly-eyebrow" }, surfaceLabel),
          h("h1", null, "Reliquary Memory"),
          h("p", { className: "rly-subtitle" }, "Configured owners in this Hermes profile")),
          h(Button, { type: "button", onClick: onManageSetup }, "Manage memory setup")),
        blockReason && h("p", { className: "rly-live-notice", role: "note" }, blockReason),
        refreshing && h("p", { className: "rly-refreshing", role: "status" },
          write ? "Refreshing owner binding. Writes are paused until it completes." : "Refreshing owner binding."),
        readContent("owner and session bindings", visibleDiscovery, (data) => {
          const owners = data.owners.items.filter((owner) => owner.capabilities.view &&
            (owner.owner_kind === "REL" || owner.owner_id === data.active_phy_id));
          const mappedRel = owners.find((owner) => owner.owner_kind === "REL" && owner.owner_id === data.session_owner_id) ?? null;
          const phy = owners.find((owner) => owner.owner_kind === "PHY" && owner.owner_id === data.active_phy_id) ?? null;
          const selected = owners.find((owner) => owner.owner_id === selectedOwnerId) ?? null;
          const defaultOwner = mappedRel ?? owners.find((owner) => owner.owner_kind === "REL") ?? phy;
          const owner = selected ?? defaultOwner;
          const sessionMatchesOwner = !!owner && owner.owner_kind === "REL" &&
            data.active_session_id !== null && data.session_owner_id === owner.owner_id &&
            (sessionId === null || data.active_session_id === sessionId);
          // Session scope is sent only when the server returned the exact mapping for this REL.
          const scope = { owner, sessionId: sessionMatchesOwner ? data.active_session_id : null };
          const scopeKey = JSON.stringify([owner?.owner_id ?? null, owner?.generation ?? null, scope.sessionId]);
          const ownerOptions = owners.map((item) => ({
            value: item.owner_id,
            label: item.owner_kind + " · " + item.display_label,
          }));

          return h("div", { className: "rly-layout" },
            h("aside", { className: "rly-sidebar", "aria-label": "Owner and scope" },
              h("h2", null, "Owner / scope"),
              h(Button, { type: "button", size: "sm", onClick: refreshOwnerData }, "Refresh owner data"),
              h("form", { onSubmit: findSession, className: "rly-session-lookup" },
                h("label", { className: "rly-field" }, h("span", null, "Hermes session ID"), h(Input, {
                  value: sessionInput, maxLength: 128, autoComplete: "off",
                  onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setSessionInput(event.currentTarget.value),
                })), h(Button, { type: "submit", size: "sm" }, "Look up session")),
              ownerOptions.length ? select("Browse authorized owner", owner?.owner_id ?? "", ownerOptions, (id) => {
                if (id !== selectedOwnerId) {
                  client.invalidate();
                  setSelectedOwnerId(id || null);
                }
              }) : h("p", { className: "rly-empty" }, "No viewable owner is available on this page."),
              h("dl", { className: "rly-owner-meta" },
                meta("Selected session", data.active_session_id ?? "None"),
                meta("Session REL", mappedRel?.display_label ?? (data.session_owner_id ? "Not on this page" : "None")),
                meta("Active PHY", phy?.owner_id ?? "None"),
                meta("Reliquary config", configPath ?? "No config detected"),
                owner && meta("Owner kind", owner.owner_kind),
                owner && meta("Generation", owner.generation),
                owner && meta("Cut", owner.cut),
                owner && owner.owner_kind === "REL" && data.active_session_id && !sessionMatchesOwner &&
                  meta("Session scope", "Owner-level view; selected session maps to another REL")),
              owner && h(Status, { key: scopeKey, client, scope, live: true }),
              pager("owner", ownerCursor, data.owners.next_cursor)),
            owner ? h(OwnerContent, { key: scopeKey, client, write, onRefresh: refreshOwnerData, refreshing,
              scope: /** @type {import("../types").ReadScope & {owner:import("../types").OwnerBinding}} */ (scope) })
              : h("p", { className: "rly-empty" }, "No authorized owner is available for this scope."));
        }, ownerCursor.reset));
    }


    const setup = root.ReliquarySetupClient.createSetupClient(authedFetch);
    const { Onboarding } = root.ReliquaryOnboarding;

    return function ReliquarySurface() {
      const [client] = useState(() => root.ReliquaryDashboardLive.createLiveClient(authedFetch));
      const [attempt, setAttempt] = useState(0);
      const [managing, setManaging] = useState(false);
      const [snapshot, setSnapshot] = useState(/** @type {{
        attempt:number, status?:import("../types").SetupStatus, error?:string
      } | null} */ (null));
      useEffect(() => {
        const controller = new AbortController();
        setup.status(controller.signal).then((status) => {
          if (!controller.signal.aborted) setSnapshot({ attempt, status });
        }, (error) => {
          if (!controller.signal.aborted) setSnapshot({ attempt, error: root.ReliquarySetupClient.message(error) });
        });
        return () => controller.abort();
      }, [attempt]);

      function refresh() {
        client.invalidate();
        setAttempt((current) => current + 1);
      }

      const current = snapshot?.attempt === attempt ? snapshot : null;
      const blockReason = current?.status && mutationBlockReason?.(current.status);
      if (current?.status?.configured && !managing) return h(DashboardTab, {
        client, configPath: current.status.config_path, blockReason, onManageSetup: () => setManaging(true),
      });
      return h("section", { className: "rly-dashboard", "aria-label": current?.status ? "Reliquary setup" : "Reliquary" },
        h("header", { className: "rly-header" }, h("div", null,
          h("p", { className: "rly-eyebrow" }, surfaceLabel),
          h("h1", null, current?.status?.configured ? "Manage memory setup"
            : current?.status ? "Set up Reliquary" : "Reliquary Memory"),
          current?.status && h("p", { className: "rly-subtitle" }, "Select or create Reliquary owners for this Hermes profile.")),
          current?.status?.configured && h(Button, { type: "button", onClick: () => setManaging(false) }, "Back to dashboard")),
        blockReason && h("p", { className: "rly-live-notice", role: "note" }, blockReason),
        current?.status ? h(Onboarding, { status: current.status, setup, pickOpenPath, pickSavePath,
          mutationsEnabled: !blockReason, onConnected: () => { setManaging(false); refresh(); } }) :
          current?.error ? h("div", { role: "alert" },
            h("p", null, current.error), h(Button, { type: "button", onClick: refresh }, "Retry setup status")) :
            h("p", { role: "status" }, "Checking Reliquary setup…"));
    };
  }

  root.ReliquaryDashboardSurface = createSurface;
})(globalThis);
