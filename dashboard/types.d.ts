export type OwnerKind = "REL" | "PHY";

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
  range: { start_byte: string; end_byte: string; text: string } | null;
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
export interface HistoryRevision {
  revision: string;
  body_id: string;
  availability: "available" | "missing" | "unauthorized" | "pruned" | "corrupt";
  created_at_ms: string;
  content_digest: string | null;
}

export interface Community {
  community_id: string;
  generation: string;
  member_count: string;
  name: string | null;
  name_origin: "user" | "derived" | "unnamed";
  cursor: string | null;
}

export type MemoryHistoryResponse = ScopedResponse<"ui.memory_history", { memory_id: string; revisions: Page<HistoryRevision> }>;
export type CommunityListResponse = ScopedResponse<"ui.community_list", { metadata_state: "available"; communities: Page<Community> }>;
export type CommunityMembersResponse = ScopedResponse<"ui.community_members", { community_id: string; generation: string; members: Page<string> }>;
export type ScopedDashboardResponse = MemoryListResponse | GraphPageResponse | MemoryDetailResponse | ProvenanceResponse
  | OperationalStatusResponse | MemoryHistoryResponse | CommunityListResponse | CommunityMembersResponse;

export interface PageArgs {
  cursor: string | null;
  limit: number;
}

export interface MemoryFilters {
  query: string;
  category: string | null;
  memory_type: string | null;
  lifecycle: MemorySummary["lifecycle"] | null;
  community_id: string | null;
}

export interface ReadArgs {
  "ui.owner_sessions": PageArgs;
  "ui.memory_list": PageArgs & { filters: MemoryFilters };
  "ui.memory_detail": { memory_id: string; revision: string | null };
  "ui.memory_history": PageArgs & { memory_id: string };
  "ui.provenance": { memory_id: string; revision: string };
  "ui.graph_page": { seed_ids: string[]; community_id: string | null; depth: number; node_limit: number; edge_limit: number; cursor: string | null };
  "ui.community_list": PageArgs;
  "ui.community_members": PageArgs & { community_id: string; expected_generation: string };
  "ui.operational_status": Record<string, never>;
}

export type ReadOperation = keyof ReadArgs;
export type ReadResults = {
  [Response in ScopedDashboardResponse | OwnerSessionsResponse as Response["operation"]]: Response["result"];
};

export type ReadErrorStatus = "denied" | "unavailable" | "stale_cursor" | "conflict" | "invalid" | "unsupported" | "error";

export interface SetupCandidate {
  main_rel: string;
  active_phy: string;
  projects?: Record<string, string>;
  config_path: string | null;
}

export interface SetupStatus {
  configured: boolean;
  runtime_detected: boolean;
  capture_status?: "unavailable" | "enrolled" | "setup_required";
  desktop_native_mutations: boolean;
  local_dialogs_available: boolean;
  config_path: string | null;
  defaults: {
    main_rel: string | null;
    active_phy: string | null;
    projects: Record<string, string>;
    config_path: string | null;
  };
}

export interface SetupCheck {
  accepted: boolean;
  opened: boolean;
  error: string | null;
}

export interface SetupOwner extends SetupCheck {
  kind: "rel" | "phy" | null;
  owner_id: string | null;
  scope: string | null;
}

export interface SetupReport {
  valid: boolean;
  main_rel: SetupOwner;
  active_phy: SetupOwner;
  projects: Record<string, SetupOwner>;
  config: SetupCheck;
  topology_error: string | null;
}

export interface SetupProject {
  id: string;
  name: string;
}

export interface SetupProjectInventory {
  projects: SetupProject[];
  routing_available: boolean;
}

export type SetupCreateKind = "general_rel" | "project_rel" | "phy";

export type SetupDialogMode = "open_rel" | "open_phy" | "open_config" | "save_rel" | "save_phy";
export type SetupDialogResult = { status: "selected"; path: string } | { status: "cancelled" } | { status: "unavailable" };

export type SetupPicker = (kind: "REL" | "PHY" | "config", signal?: AbortSignal) =>
  Promise<string | null | SetupDialogResult>;
