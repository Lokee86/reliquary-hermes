import { createElement } from "react";
import type { ComponentType } from "react";
import { ReliquaryApp } from "./app";
import { pluginPrefix, RequestError } from "./host";
import type { HostBoundary, HostControls, HostSelectProps, RequestOptions } from "./host";
import "./app.css";

interface WebSDK {
  sdkVersion: string;
  components: { Button: HostControls["Button"]; Input: HostControls["Input"]; Checkbox: HostControls["Checkbox"];
    Select: ComponentType<Omit<HostSelectProps, "options" | "label"> & { children: React.ReactNode; "aria-label": string }>;
    SelectOption: ComponentType<{ value: string; children: React.ReactNode }>;
  };
  authedFetch(url: string, init?: RequestInit): Promise<Response>;
}

const browser = window as Window & {
  __HERMES_PLUGIN_SDK__?: WebSDK;
  __HERMES_PLUGINS__?: { register(name: string, component: ComponentType): void };
};
const sdk = browser.__HERMES_PLUGIN_SDK__;
if (!sdk || !browser.__HERMES_PLUGINS__ || sdk.sdkVersion !== "1.1.0") {
  throw new Error("Reliquary requires Hermes Web SDK 1.1.0.");
}
const { Button, Input, Select, SelectOption, Checkbox } = sdk.components;

const controls: HostControls = {
  Button(props) {
    const quiet = props["aria-pressed"] === false || props["aria-current"] === false;
    return createElement(Button, { ...props, ...{ ghost: quiet } });
  },
  Input,
  Textarea: "textarea",
  Checkbox,
  Select({ label, value, options, onValueChange, disabled }) {
    return <Select aria-label={label} value={value} onValueChange={onValueChange} disabled={disabled}>
      {options.map(option => <SelectOption key={option.value} value={option.value}>{option.label}</SelectOption>)}
    </Select>;
  },
};

async function request(path: string, { method = "GET", body, signal }: RequestOptions = {}) {
  const reply = await sdk!.authedFetch(pluginPrefix + path, {
    method, signal, cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
  if (!reply.ok) {
    const error = await reply.json().catch(() => null);
    const code = typeof error?.detail === "string" && /^[a-z_]{1,64}$/.test(error.detail) ? error.detail : "request_failed";
    throw new RequestError(reply.status, code);
  }
  return reply;
}

const host: HostBoundary = {
  surface: "Web",
  controls,
  async json(path, options) {
    return (await request(path, options)).json();
  },
  async bytes(path, options) {
    const reply = await request(path, options);
    if (reply.headers.get("Content-Type") !== "application/octet-stream") throw new Error("Invalid graph chunk media type.");
    const value = new Uint8Array(await reply.arrayBuffer());
    if (value.byteLength > 1 << 20) throw new Error("Invalid graph chunk length.");
    return value;
  },
};

browser.__HERMES_PLUGINS__.register("reliquary-hermes", () => <ReliquaryApp host={host} />);
