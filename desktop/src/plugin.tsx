import { useMemo } from "react";
import {
  Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea,
  gatewayActivationEpoch, host, ROUTES_AREA, SIDEBAR_NAV_AREA, useGatewayActivationEpoch, useValue,
} from "@hermes/plugin-sdk";
import type { PluginContext } from "@hermes/plugin-sdk";
import { ReliquaryApp } from "../../dashboard/src/app";
import { RequestError } from "../../dashboard/src/host";
import type { HostBoundary, HostControls, RequestOptions } from "../../dashboard/src/host";
import styles from "reliquary:styles";

const route = "/reliquary";
const pickers = {
  REL: { title: "Choose a Reliquary REL", filters: [{ name: "Reliquary REL", extensions: ["rel"] }] },
  PHY: { title: "Choose a Reliquary PHY", filters: [{ name: "Reliquary PHY", extensions: ["phy"] }] },
  config: { title: "Choose processing routes", filters: [{ name: "Processing routes", extensions: ["json"] }] },
};

const controls: HostControls = {
  Button(props) {
    const quiet = props["aria-pressed"] === false || props["aria-current"] === false;
    return <Button {...props} variant={props.variant ?? (quiet ? "ghost" : "default")} />;
  },
  Checkbox, Input, Textarea,
  Select({ label, value, options, onValueChange, disabled }) {
    return <Select value={":" + value} onValueChange={next => onValueChange(next.slice(1))} disabled={disabled}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.value} value={":" + option.value}>
        {option.label}
      </SelectItem>)}</SelectContent>
    </Select>;
  },
};

function nativeError(error: unknown): RequestError {
  const message = error instanceof Error ? error.message : "";
  const match = /(?:^|: )([45][0-9]{2}):(?: (\{[^\n]{0,256}\}))?/.exec(message);
  let detail = "request_failed";
  try {
    const parsed = match?.[2] && JSON.parse(match[2]);
    if (typeof parsed?.detail === "string" && /^[a-z_]{1,64}$/.test(parsed.detail)) detail = parsed.detail;
  } catch {
    // Bridge errors do not expose raw response bodies to the shared UI.
  }
  return new RequestError(match ? Number(match[1]) : 503, detail);
}

function desktopBoundary(ctx: PluginContext, current: () => boolean, preferenceProfileKey?: string): HostBoundary {
  function assertCurrent(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!current()) throw new DOMException("The active Hermes connection changed.", "AbortError");
  }
  async function request<T>(send: () => Promise<T>, signal?: AbortSignal) {
    assertCurrent(signal);
    try {
      const result = await send();
      assertCurrent(signal);
      return result;
    } catch (error) {
      assertCurrent(signal);
      throw nativeError(error);
    }
  }
  function checkedPicker(pick: () => Promise<string | null>, signal?: AbortSignal) {
    return request(pick, signal);
  }
  return {
    surface: "Desktop", controls, preferenceProfileKey,
    json(path, { method = "GET", body, signal }: RequestOptions = {}) {
      const timeoutMs = path.endsWith("/prepare") ? 45000 : path === "/setup-v1/apply" || path === "/dashboard-v1" ? 25000 : undefined;
      return request(() => ctx.rest(path, { method, body, timeoutMs }), signal);
    },
    bytes: typeof ctx.restBytes === "function" ? async (path, { method = "GET", body, signal }) => {
      const result = await request(() => ctx.restBytes!(path, { method, body }), signal);
      if (!(result instanceof ArrayBuffer) || result.byteLength > 1 << 20) throw new Error("Invalid Desktop graph chunk.");
      return new Uint8Array(result);
    } : undefined,
    pickOpenPath: typeof ctx.os?.pickOpenPath === "function"
      ? (kind, signal) => checkedPicker(() => ctx.os.pickOpenPath!(pickers[kind]), signal) : undefined,
    pickSavePath: typeof ctx.os?.pickSavePath === "function"
      ? (kind, signal) => checkedPicker(() => ctx.os.pickSavePath!({
        ...pickers[kind], title: "Create a Reliquary " + kind,
        defaultPath: kind === "REL" ? "general.rel" : "active.phy",
      }), signal) : undefined,
  };
}

function ReliquaryPane({ ctx }: { ctx: PluginContext }) {
  const epoch = useGatewayActivationEpoch();
  const profile = useValue(host.state.profile);
  const connection = useValue(host.state.connectionId);
  const boundary = useMemo(() => desktopBoundary(ctx, () =>
    gatewayActivationEpoch() === epoch && host.state.profile.get() === profile &&
    host.state.connectionId.get() === connection,
    typeof profile === "string" && profile.length > 0 && typeof connection === "string" && connection.length > 0
      ? JSON.stringify(["Desktop", connection, profile]) : undefined), [ctx, epoch, profile, connection]);
  return <>
    <style>{styles}</style>
    <ReliquaryApp key={JSON.stringify([epoch, profile, connection])} host={boundary} />
  </>;
}

export default {
  id: "reliquary",
  name: "Reliquary",
  description: "Browse and manage Reliquary Memories in the active Hermes profile",
  register(ctx: PluginContext) {
    ctx.registerMany([
      { id: "page", area: ROUTES_AREA, data: { path: route }, render: () => <ReliquaryPane ctx={ctx} /> },
      { id: "nav", area: SIDEBAR_NAV_AREA, data: { path: route, label: "Reliquary", codicon: "database" } },
    ]);
  },
};
