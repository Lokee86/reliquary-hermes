import { createElement as h, useMemo } from "react";
import * as React from "react";
import {
  gatewayActivationEpoch, host, ROUTES_AREA, SIDEBAR_NAV_AREA, useGatewayActivationEpoch, useValue,
} from "@hermes/plugin-sdk";

const endpoint = "/api/plugins/reliquary-hermes";
const route = "/reliquary";
const nativeWriteNotice = "This Hermes build does not yet support secure Desktop writes for isolated plugins. " +
  "Use the Reliquary web dashboard for setup and write management.";
const methods = new Map([
  ["/setup-v1/status", "GET"],
  ["/setup-v1/validate", "POST"],
  ["/setup-v1/apply", "POST"],
  ["/dashboard-v1", "POST"],
]);
const pickers = {
  REL: { title: "Choose a Reliquary REL", filters: [{ name: "Reliquary REL", extensions: ["rel"] }] },
  PHY: { title: "Choose a Reliquary PHY", filters: [{ name: "Reliquary PHY", extensions: ["phy"] }] },
  config: { title: "Choose a Reliquary configuration" },
};

function httpStatus(error) {
  const status = error?.statusCode ?? Number(/(?:^|: )([45][0-9]{2}):/.exec(error?.message ?? "")?.[1]);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503;
}

function restResponse(status, value = null) {
  return { status, ok: status === 200, json: async () => value };
}

function dashboardTransport(ctx, current) {
  return async function authedFetch(url, { method = "GET", body, signal } = {}) {
    function checkScope() {
      signal?.throwIfAborted();
      if (!current()) throw new DOMException("The active Hermes profile changed.", "AbortError");
    }

    checkScope();
    const suffix = url.slice(endpoint.length);
    if (!url.startsWith(endpoint + "/") || methods.get(suffix) !== method) {
      throw new Error("Unsupported Reliquary API request.");
    }
    const options = { method, body: body === undefined ? undefined : JSON.parse(body) };
    let response;
    try {
      // The SDK resolves the active backend and profile before dispatch.
      response = restResponse(200, await ctx.rest(suffix, options));
    } catch (error) {
      response = restResponse(httpStatus(error));
    }
    checkScope();
    return response;
  };
}

const paneStyle = {
  width: "100%", height: "100%", overflow: "auto",
  "--color-foreground": "var(--ui-text-primary)",
  "--color-muted-foreground": "var(--ui-text-secondary)",
  "--color-background": "var(--ui-bg-primary)",
  "--color-card": "var(--ui-bg-card)",
  "--color-muted": "var(--ui-bg-secondary)",
  "--color-border": "var(--ui-stroke-secondary)",
  "--color-primary": "var(--ui-accent)",
};

function ReliquaryPane({ ctx }) {
  const epoch = useGatewayActivationEpoch();
  const profile = useValue(host.state.profile);
  const Surface = useMemo(() => {
    const current = () => gatewayActivationEpoch() === epoch && host.state.profile.get() === profile;
    return createReliquarySurface({
      React,
      authedFetch: dashboardTransport(ctx, current),
      async pickOpenPath(kind) {
        if (!current()) return null;
        const path = await ctx.os.pickOpenPath(pickers[kind]);
        return current() ? path : null;
      },
      mutationBlockReason: (status) => status.desktop_native_mutations === true ? undefined : nativeWriteNotice,
      surfaceLabel: "HERMES DESKTOP PLUGIN",
    });
  }, [ctx, epoch, profile]);

  return h("div", { className: "rly-desktop", style: paneStyle },
    h("style", null, reliquaryStyles),
    h(Surface));
}

export default {
  id: "reliquary-hermes",
  name: "Reliquary",
  description: "Connect Reliquary and manage Memories in the active Hermes profile",
  register(ctx) {
    ctx.registerMany([
      { id: "page", area: ROUTES_AREA, data: { path: route }, render: () => h(ReliquaryPane, { ctx }) },
      { id: "nav", area: SIDEBAR_NAV_AREA, data: { path: route, label: "Reliquary", codicon: "database" } },
    ]);
  },
};
