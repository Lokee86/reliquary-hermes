import { createElement as h, useMemo } from "react";
import * as React from "react";
import {
  Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea,
  gatewayActivationEpoch, host, ROUTES_AREA, SIDEBAR_NAV_AREA, useGatewayActivationEpoch, useValue,
} from "@hermes/plugin-sdk";

const endpoint = "/api/plugins/reliquary-hermes";
const route = "/reliquary";
const nativeWriteNotice = "This Hermes build does not yet support secure Desktop writes for isolated plugins. " +
  "Use the Reliquary web dashboard for setup and write management.";
const methods = new Map([
  ["/setup-v1/status", "GET"],
  ["/setup-v1/projects", "GET"],
  ["/setup-v1/create", "POST"],
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

function setupFailure(error) {
  // Electron's REST bridge preserves the HTTP response text in the Error message.
  // Keep only a short typed detail for the shared client's message allowlist.
  const text = /(?:^|: )[45][0-9]{2}: (\{[^\n]{0,256}\})$/.exec(error?.message ?? "")?.[1];
  if (!text) return null;
  try {
    const { detail } = JSON.parse(text);
    return typeof detail === "string" && /^[a-z_]{1,64}$/.test(detail) ? { detail } : null;
  } catch {
    return null;
  }
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
      response = restResponse(httpStatus(error), suffix.startsWith("/setup-v1/") ? setupFailure(error) : null);
    }
    checkScope();
    return response;
  };
}

const components = {
  Button(props) {
    const quiet = props["aria-pressed"] === false || props["aria-current"] === false;
    return h(Button, { ...props, variant: quiet ? "ghost" : "default" });
  },
  Checkbox, Input, Textarea,
  Select({ label, value, options, onValueChange, disabled }) {
    // The Desktop select reserves the empty string for its placeholder.
    return h(Select, { value: ":" + value, onValueChange: (next) => onValueChange(next.slice(1)), disabled },
      h(SelectTrigger, { "aria-label": label }, h(SelectValue)),
      h(SelectContent, null, ...options.map(({ value, label }) => h(SelectItem, { key: value, value: ":" + value }, label))));
  },
};

const paneStyle = { width: "100%", height: "100%", overflow: "auto" };

function ReliquaryPane({ ctx }) {
  const epoch = useGatewayActivationEpoch();
  const profile = useValue(host.state.profile);
  const Surface = useMemo(() => {
    const current = () => gatewayActivationEpoch() === epoch && host.state.profile.get() === profile;
    return createReliquarySurface({
      React,
      components,
      authedFetch: dashboardTransport(ctx, current),
      async pickOpenPath(kind) {
        if (!current()) return null;
        const path = await ctx.os.pickOpenPath(pickers[kind]);
        return current() ? path : null;
      },
      async pickSavePath(kind) {
        if (!current()) return null;
        const options = { ...pickers[kind], title: "Create a Reliquary " + kind };
        const path = await ctx.os.pickSavePath(options);
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
