import type { OwnerBinding, ReadArgs, ReadErrorStatus, ReadOperation, ReadResults } from "../../types";
import type { JsonTransport } from "../host";

export interface KnowledgeScope { owner: OwnerBinding; sessionId: string | null }
export interface KnowledgeFailure { status: ReadErrorStatus; code: string; retryable: boolean }
export type KnowledgeOutcome<T> = { status: "ok"; value: T } | KnowledgeFailure;

export interface KnowledgeMutationReceipt {
  receipt_id: string;
  request_id: string;
  idempotency_key: string;
  changed: boolean;
  committed: unknown;
}

export interface KnowledgeClient {
  ownerSessions(sessionId: string | null, cursor: string | null, signal?: AbortSignal): Promise<ReadResults["ui.owner_sessions"]>;
  read<K extends Exclude<ReadOperation, "ui.owner_sessions">>(scope: KnowledgeScope, operation: K, args: ReadArgs[K], signal?: AbortSignal): Promise<ReadResults[K]>;
  write(scope: KnowledgeScope, operation: "ui.memory_create" | "ui.memory_edit" | "ui.memory_retire" | "ui.relation_change" | "ui.community_rename", args: Record<string, string | null>, expectedRevision: string | null, idempotencyKey: string, signal?: AbortSignal): Promise<KnowledgeOutcome<{ binding: OwnerBinding; result: KnowledgeMutationReceipt }>>;
}

const dashboardPath = "/dashboard-v1";
let sequence = 0;

function requestId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `knowledge-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
}

function failureForStatus(status: number): KnowledgeFailure {
  if (status === 401 || status === 403) return { status: "denied", code: "dashboard_denied", retryable: false };
  if (status === 400) return { status: "invalid", code: "invalid_request", retryable: false };
  if (status === 409) return { status: "conflict", code: "owner_cut_changed", retryable: false };
  return { status: "unavailable", code: "dashboard_unavailable", retryable: true };
}

function unwrap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Dashboard returned an invalid response.");
  const root = value as Record<string, unknown>;
  if (root.protocol_version !== 1 || typeof root.operation !== "string" || typeof root.status !== "string") {
    throw new Error("Dashboard response does not match the public browser contract.");
  }
  return root;
}

function sameBinding(actual: unknown, owner: OwnerBinding, capability?: keyof OwnerBinding["capabilities"], requireSameCut = true) {
  if (!actual || typeof actual !== "object") return false;
  const binding = actual as OwnerBinding;
  return binding.owner_id === owner.owner_id && binding.owner_kind === owner.owner_kind
    && binding.display_label === owner.display_label && binding.generation === owner.generation
    && (!requireSameCut || binding.cut === owner.cut)
    && binding.capabilities?.view === true
    && (!capability || binding.capabilities[capability] === true)
    && Object.entries(binding.capabilities ?? {}).every(([key, granted]) =>
      !granted || owner.capabilities[key as keyof OwnerBinding["capabilities"]]);
}

function capabilityFor(operation: ReadOperation): keyof OwnerBinding["capabilities"] | null {
  switch (operation) {
    case "ui.memory_list":
    case "ui.memory_detail": return "view";
    case "ui.memory_history": return "history";
    case "ui.provenance": return "provenance";
    case "ui.graph_page": return "graph";
    case "ui.community_list":
    case "ui.community_members": return "community";
    case "ui.operational_status": return "status";
    case "ui.owner_sessions": return null;
  }
}

export function createKnowledgeClient(json: JsonTransport): KnowledgeClient {
  async function request(operation: ReadOperation, scope: KnowledgeScope | null, args: unknown, signal?: AbortSignal, overrideSessionId?: string | null) {
    const owner = scope?.owner ?? null;
    const reqId = requestId();
    const wire = {
      protocol_version: 1,
      request_id: reqId,
      operation,
      profile_id: "dashboard",
      principal_id: "dashboard",
      session_id: overrideSessionId === undefined ? scope?.sessionId ?? null : overrideSessionId,
      owner_id: owner?.owner_id ?? null,
      generation: owner?.generation ?? null,
      cut: owner?.cut ?? null,
      expected_revision: null,
      idempotency_key: null,
      arguments: args,
    };
    const value = await json(dashboardPath, { method: "POST", body: wire, signal });
    const response = unwrap(value);
    if (response.request_id !== reqId || response.operation !== operation) {
      throw new Error("Dashboard response did not match this request.");
    }
    if (response.status !== "ok") {
      const result = response.result as { code?: unknown; retryable?: unknown } | undefined;
      throw new Error(typeof result?.code === "string" ? result.code : "dashboard_request_failed");
    }
    const capability = capabilityFor(operation);
    if (owner && (capability && !owner.capabilities[capability] || !sameBinding(response.binding, owner, capability ?? undefined))) {
      throw new Error("Owner scope or capability changed. Refresh owner data before continuing.");
    }
    return response;
  }

  return {
    async ownerSessions(sessionId, cursor, signal) {
      const response = await request("ui.owner_sessions", null, { cursor, limit: 100 }, signal, sessionId);
      const result = response.result as ReadResults["ui.owner_sessions"];
      if (response.binding !== null) throw new Error("Owner session response included an unexpected owner binding.");
      if (sessionId !== null && result.active_session_id !== sessionId) {
        throw new Error("Owner session response does not match the selected session.");
      }
      const ids = result.owners.items.map((owner) => owner.owner_id);
      if (result.owners.items.length > 100 || new Set(ids).size !== ids.length
        || result.owners.items.some((owner) => !owner.capabilities.view
          || (owner.owner_kind !== "REL" && owner.owner_id !== result.active_phy_id))) {
        throw new Error("Owner session response failed validation.");
      }
      return result;
    },
    async read(scope, operation, args, signal) {
      const capability = capabilityFor(operation);
      if (!scope.owner.capabilities.view || (capability && !scope.owner.capabilities[capability])) {
        throw new Error("This owner does not grant the requested Knowledge capability.");
      }
      const response = await request(operation, scope, args, signal);
      return response.result as ReadResults[typeof operation];
    },
    async write(scope, operation, args, expectedRevision, idempotencyKey, signal) {
      const caps = scope.owner.capabilities;
      const capability = {
        "ui.memory_create": "memory_create", "ui.memory_edit": "memory_edit", "ui.memory_retire": "memory_retire",
        "ui.relation_change": "relation_edit", "ui.community_rename": "community_rename",
      }[operation] as keyof OwnerBinding["capabilities"];
      if (scope.owner.owner_kind !== "REL" || !caps.view || !caps.manage || !caps[capability]) {
        return { status: "denied", code: "capability_denied", retryable: false };
      }
      const reqId = requestId();
      const wire = {
        protocol_version: 1, request_id: reqId, operation,
        profile_id: "dashboard", principal_id: "dashboard", session_id: scope.sessionId,
        owner_id: scope.owner.owner_id, generation: scope.owner.generation, cut: scope.owner.cut,
        expected_revision: expectedRevision, idempotency_key: idempotencyKey, arguments: args,
      };
      try {
        const value = await json(dashboardPath, { method: "POST", body: wire, signal });
        const response = unwrap(value);
        if (response.request_id !== reqId || response.operation !== operation) {
          return { status: "conflict", code: "response_correlation_mismatch", retryable: false };
        }
        if (response.status !== "ok") {
          if (response.binding !== null) return { status: "conflict", code: "invalid_error_binding", retryable: false };
          const result = response.result as { code?: unknown; retryable?: unknown };
          return { status: response.status as ReadErrorStatus, code: typeof result?.code === "string" ? result.code : "dashboard_request_failed", retryable: result?.retryable === true };
        }
        const binding = response.binding as OwnerBinding;
        const result = response.result as KnowledgeMutationReceipt;
        const changedCut = !result.changed || binding.cut !== scope.owner.cut;
        if (!sameBinding(binding, scope.owner, capability, false) || !binding.capabilities.manage || !changedCut || result.request_id !== reqId
          || result.idempotency_key !== idempotencyKey || typeof result.receipt_id !== "string") {
          return { status: "conflict", code: "response_binding_mismatch", retryable: false };
        }
        return { status: "ok", value: { binding, result } };
      } catch (error) {
        if (signal?.aborted) throw error;
        const status = typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status: unknown }).status) : 0;
        return failureForStatus(status);
      }
    },
  };
}
