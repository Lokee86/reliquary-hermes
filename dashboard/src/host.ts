import type { ComponentType, ComponentPropsWithoutRef, ElementType } from "react";
import type { OwnerBinding } from "../types";
import type { GraphRenderTransport } from "./graph/render/transport";
import type { GraphRenderManifest, GraphRenderNodeResolution } from "./graph/render/types";

export const pluginPrefix = "/api/plugins/reliquary-hermes";

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}
export type JsonTransport = (path: string, options?: RequestOptions) => Promise<unknown>;
export type ByteTransport = (path: string, options: RequestOptions) => Promise<Uint8Array>;
export type HostSelectProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange(value: string): void;
  disabled?: boolean;
};
export type ButtonProps = ComponentPropsWithoutRef<"button"> & { size?: "sm" | "md" | "lg"; variant?: string };
export interface HostControls {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<ComponentPropsWithoutRef<"input">>;
  Textarea: ElementType<ComponentPropsWithoutRef<"textarea">>;
  Checkbox: ComponentType<{ checked: boolean; disabled?: boolean; "aria-label"?: string;
    onCheckedChange(value: boolean): void }>;
  Select: ComponentType<HostSelectProps>;
}
export interface HostBoundary {
  controls: HostControls;
  json: JsonTransport;
  bytes?: ByteTransport;
  surface: "Web" | "Desktop";
  pickOpenPath?: import("../types").SetupPicker;
  pickSavePath?: import("../types").SetupPicker;
}

export class RequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function createGraphTransport(
  host: HostBoundary, owner: OwnerBinding, sessionId: string | null, signal?: AbortSignal,
): GraphRenderTransport | undefined {
  const { json, bytes } = host;
  if (!bytes) return undefined;
  const scope = { owner_id: owner.owner_id, generation: owner.generation, cut: owner.cut, session_id: sessionId };
  const graphPath = "/graph-render-v1/";
  return {
    async prepare(ownerId, source) {
      if (ownerId !== scope.owner_id || (source && source.kind !== "reliquary")) {
        throw new Error("This graph source is outside the selected owner.");
      }
      return await json(graphPath + "prepare", { method: "POST", body: scope, signal }) as GraphRenderManifest;
    },
    nodeChunk(generationId, chunkId) {
      return bytes(graphPath + "node-chunk", {
        method: "POST", body: { ...scope, generation_id: generationId, chunk_id: chunkId }, signal,
      });
    },
    edgeChunk(generationId, chunkId) {
      return bytes(graphPath + "edge-chunk", {
        method: "POST", body: { ...scope, generation_id: generationId, chunk_id: chunkId }, signal,
      });
    },
    async resolveNode(generationId, renderId) {
      return await json(graphPath + "resolve", {
        method: "POST", body: { ...scope, generation_id: generationId, render_id: renderId }, signal,
      }) as GraphRenderNodeResolution;
    },
  };
}
