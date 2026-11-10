declare module "reliquary:styles" {
  const styles: string;
  export default styles;
}
declare module "@hermes/plugin-sdk" {
  type Component<P> = import("react").ComponentType<P>;
  type Props<T extends keyof React.JSX.IntrinsicElements> = React.ComponentPropsWithoutRef<T>;
  type Control = import("../../dashboard/src/host").HostControls;
  export const Button: Control["Button"];
  export const Checkbox: Control["Checkbox"];
  export const Input: Control["Input"];
  export const Textarea: Component<Props<"textarea">>;
  export const Select: Component<{ value: string; onValueChange(value: string): void; disabled?: boolean; children: React.ReactNode }>;
  export const SelectContent: Component<{ children: React.ReactNode }>;
  export const SelectItem: Component<{ value: string; children: React.ReactNode }>;
  export const SelectTrigger: Component<Props<"button">>;
  export const SelectValue: Component;
  export const ROUTES_AREA: string;
  export const SIDEBAR_NAV_AREA: string;
  export function gatewayActivationEpoch(): number;
  export function useGatewayActivationEpoch(): number;
  interface Value<T> { get(): T }
  export const host: { state: { profile: Value<string | null>; connectionId: Value<string | null> } };
  export function useValue<T>(value: Value<T>): T;
  interface FileOptions { title: string; defaultPath?: string; filters: { name: string; extensions: string[] }[] }
  interface RestOptions { method: string; body?: unknown; timeoutMs?: number }
  export interface PluginContext {
    rest<T>(path: string, options: RestOptions): Promise<T>;
    restBytes?(path: string, options: RestOptions): Promise<ArrayBuffer>;
    os: { pickOpenPath?(options: FileOptions): Promise<string | null>; pickSavePath?(options: FileOptions): Promise<string | null> };
    registerMany(entries: { id: string; area: string; data: Record<string, string>; render?: () => React.ReactNode }[]): void;
  }
}
