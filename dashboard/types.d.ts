export type OwnerKind = "REL" | "PHY";
export type ViewMode = "graph" | "list";

export interface CapabilityFlags {
  view: boolean;
  manage: boolean;
  history: boolean;
  provenance: boolean;
  graph: boolean;
  community: boolean;
  status: boolean;
  memory_create: boolean;
  memory_edit: boolean;
  memory_retire: boolean;
  relation_edit: boolean;
  community_rename: boolean;
}

export interface OwnerBinding {
  owner_id: string;
  owner_kind: OwnerKind;
  display_label: string;
  generation: string;
  cut: string;
  capabilities: CapabilityFlags;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  truncated: boolean;
}

export interface MemorySummary {
  memory_id: string;
  revision: string;
  body_id: string | null;
  title: string | null;
  excerpt: string;
  category: string;
  memory_type: string;
  lifecycle: "active" | "retired" | "tombstoned" | "superseded" | "unavailable";
  canonical_status: "canonical" | "duplicate" | "superseded" | "unknown";
  freshness: { native_value: string; as_of_cut: string } | null;
  community_id: string | null;
}

export interface GraphNode {
  node_id: string;
  kind: "memory" | "community";
  memory_id: string | null;
  community_id: string | null;
  label: string;
  origin: string;
  revision: string;
  cut: string;
}

export interface GraphEdge {
  edge_id: string;
  kind: string;
  origin: "user" | "dream" | "source";
  source_id: string;
  target_id: string;
  revision: string;
  cut: string;
  active: boolean;
}

export interface HermesSnapshotSource {
  kind: "hermes_snapshot";
  label: "Hermes source / copied snapshot";
  profile_namespace: string;
  session_id: string;
  message_uid: string;
  branch_id: string | null;
  source_revision: string | null;
  content_digest: string;
  range: { start_byte: string; end_byte: string; text: string };
}

export interface UserOriginSource {
  kind: "user_origin";
  principal_id: string;
  created_at_ms: string;
}

export interface SourceUnavailableProvenance {
  kind: "source_unavailable";
  reason: "unauthorized" | "deleted" | "stale" | "missing" | "pruned" | "corrupt";
}

export type ProvenanceSource = HermesSnapshotSource | UserOriginSource | SourceUnavailableProvenance;

export interface MemoryDetail {
  memory: MemorySummary;
  body: {
    revision: string;
    body_id: string | null;
    availability: "available" | "missing" | "unauthorized" | "pruned" | "corrupt" | "terminal";
    content: string | null;
  };
  retained_revisions: string[];
  superseded_by: string | null;
  tombstone: boolean;
  provenance: ProvenanceSource[];
}

export interface ScopedResponse<O extends string, R> {
  protocol_version: 1;
  request_id: string;
  operation: O;
  status: "ok";
  binding: OwnerBinding;
  result: R;
}

export interface OwnerSessionsResponse {
  protocol_version: 1;
  request_id: string;
  operation: "ui.owner_sessions";
  status: "ok";
  binding: null;
  result: {
    owners: Page<OwnerBinding>;
    active_session_id: string | null;
    session_owner_id: string | null;
    active_phy_id: string | null;
  };
}

export type MemoryListResponse = ScopedResponse<"ui.memory_list", Page<MemorySummary>>;
export type GraphPageResponse = ScopedResponse<"ui.graph_page", {
  routing_state: "available";
  nodes: GraphNode[];
  edges: GraphEdge[];
  next_cursor: string | null;
  truncated: boolean;
}>;
export type MemoryDetailResponse = ScopedResponse<"ui.memory_detail", MemoryDetail>;
export type ProvenanceResponse = ScopedResponse<"ui.provenance", {
  memory_id: string;
  revision: string;
  sources: ProvenanceSource[];
}>;
export interface OperationalStatus {
  session_id: string | null;
  source_state: "none" | "active" | "stale" | "tombstoned" | "unavailable";
  accepted_source_cursor: string | null;
  last_completed_receipt: string | null;
  pending_count: string;
  held_count: string;
  error_count: string;
  worker_state: "pending" | "running" | "held" | "failed" | "complete" | "unavailable";
  latest_recall: {
    state: "none" | "candidate" | "selected" | "returned";
    search_id: string | null;
    delivery_id: string | null;
    candidate_ids: string[];
    selected_ids: string[];
    returned_ids: string[];
  };
}

export type OperationalStatusResponse = ScopedResponse<"ui.operational_status", OperationalStatus>;
export type ScopedDashboardResponse = MemoryListResponse | GraphPageResponse | MemoryDetailResponse | ProvenanceResponse | OperationalStatusResponse;
export type DashboardResponse = OwnerSessionsResponse | ScopedDashboardResponse;

export interface DashboardState {
  owner: OwnerBinding | null;
  mode: ViewMode;
  listPage: Page<MemorySummary> | null;
  graphPage: GraphPageResponse["result"] | null;
  selectedMemoryId: string | null;
  detail: MemoryDetail | null;
  provenance: ProvenanceResponse["result"] | null;
  operationalStatus: OperationalStatus | null;
  pendingRequests: Record<string, string>;
}

export interface HostReact {
  createElement(type: string | ((props: Record<string, unknown>) => unknown), props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
}

export interface HermesDashboardSDK {
  sdkVersion: string;
  React: HostReact;
  hooks: {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void];
  };
}

export interface HermesPluginRegistry {
  register(name: string, component: () => unknown): void;
}

declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__?: HermesDashboardSDK;
    __HERMES_PLUGINS__?: HermesPluginRegistry;
  }
  var ReliquaryDashboardState: {
    createState(owner: OwnerBinding | null): DashboardState;
    changeOwner(state: DashboardState, owner: OwnerBinding | null): DashboardState;
    beginRequest(state: DashboardState, operation: string, requestId: string): DashboardState;
    selectMemory(state: DashboardState, memoryId: string | null): DashboardState;
    setMode(state: DashboardState, mode: ViewMode): DashboardState;
    applyResponse(state: DashboardState, response: DashboardResponse): DashboardState;
    acceptsResponse(state: DashboardState, response: DashboardResponse): boolean;
  };
  var ReliquaryDashboardMock: {
    getOwners(): OwnerBinding[];
    getDefaultOwner(): OwnerBinding | null;
    getActivePhy(): OwnerBinding | null;
    hydrate(state: DashboardState, owner: OwnerBinding | null): DashboardState;
    select(state: DashboardState, memoryId: string): DashboardState;
  };
  var ReliquaryDashboardFixture: {
    owner_sessions: OwnerSessionsResponse;
    memory_lists: Record<string, MemoryListResponse>;
    graph_pages: Record<string, GraphPageResponse>;
    memory_details: Record<string, MemoryDetailResponse>;
    provenance: Record<string, ProvenanceResponse>;
    operational_statuses: Record<string, OperationalStatusResponse>;
  };
}
