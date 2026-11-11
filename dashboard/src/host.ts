import type { ComponentType, ComponentPropsWithoutRef, ElementType } from "react";
import type { OwnerBinding } from "../types";
import type { GraphRenderTransport } from "./graph/render/transport";
import type {
  GraphRenderFilterScope, GraphRenderManifest, GraphRenderNeighborhood, GraphRenderNodeInspection,
  GraphRenderNodeLocation, GraphRenderNodeResolution,
} from "./graph/render/types";

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

const graphPath = "/graph-render-v1/";

function graphScope(owner: OwnerBinding, sessionId: string | null) {
  return { owner_id: owner.owner_id, generation: owner.generation, cut: owner.cut, session_id: sessionId };
}

function wireGraphFilters(filters: GraphRenderFilterScope) {
  return {
    query: filters.query,
    community_id: filters.communityId,
    include_archived: filters.includeArchived,
    category: filters.category,
    memory_type: filters.memoryType,
  };
}

export async function graphSelectionEligible(
  json: JsonTransport, owner: OwnerBinding, sessionId: string | null, memoryId: string,
  filters: GraphRenderFilterScope, signal?: AbortSignal,
): Promise<boolean> {
  const result = await json(graphPath + "eligible", {
    method: "POST",
    body: { ...graphScope(owner, sessionId), memory_id: memoryId, filters: wireGraphFilters(filters) },
    signal,
  });
  if (typeof result === "object" && result !== null && "eligible" in result
      && typeof result.eligible === "boolean") return result.eligible;
  throw new Error("Invalid Memory filter result");
}

export function createGraphTransport(
  host: HostBoundary, owner: OwnerBinding, sessionId: string | null, signal?: AbortSignal,
): GraphRenderTransport | undefined {
  const { json, bytes } = host;
  if (!bytes) return undefined;
  const scope = graphScope(owner, sessionId);
  const readNode = (operation: string, generationId: string, renderId: number, cancellation?: AbortSignal) =>
    json(graphPath + operation, {
      method: "POST",
      body: { ...scope, generation_id: generationId, render_id: renderId },
      signal: combineSignals(signal, cancellation),
    });
  return {
    async prepare(ownerId, filters) {
      if (ownerId !== scope.owner_id) {
        throw new Error("This graph source is outside the selected owner.");
      }
      return await json(graphPath + "prepare", {
        method: "POST", body: { ...scope, filters: wireGraphFilters(filters) }, signal,
      }) as GraphRenderManifest;
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
      return await readNode("resolve", generationId, renderId) as GraphRenderNodeResolution;
    },
    async inspectNode(generationId, renderId, cancellation) {
      return await readNode("inspect", generationId, renderId, cancellation) as GraphRenderNodeInspection;
    },
    async neighborhood(generationId, renderId, cancellation) {
      return await readNode("neighborhood", generationId, renderId, cancellation) as GraphRenderNeighborhood;
    },
    async locateMemory(generationId, memoryId, cancellation) {
      return await json(graphPath + "locate", {
        method: "POST",
        body: { ...scope, generation_id: generationId, memory_id: memoryId },
        signal: combineSignals(signal, cancellation),
      }) as GraphRenderNodeLocation | null;
    },
  };
}

function combineSignals(scope?: AbortSignal, request?: AbortSignal) {
  return scope && request ? AbortSignal.any([scope, request]) : scope ?? request;
}
