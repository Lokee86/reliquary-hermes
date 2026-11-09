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

export interface ReadScope {
  owner: OwnerBinding | null;
  sessionId: string | null;
}

export type ReadErrorStatus = "denied" | "unavailable" | "stale_cursor" | "conflict" | "invalid" | "unsupported" | "error";
export interface ReadFailure {
  status: ReadErrorStatus;
  code: string;
  retryable: boolean;
}
export type ReadOutcome<T> = { status: "ok"; value: T } | ReadFailure;
export type ReadState<T> = { status: "idle" } | { status: "loading" } | ReadOutcome<T>;

export interface ReadHandle<T> {
  state: ReadState<T>;
  retry(): void;
}

export interface CursorState {
  current: string | null;
  next(cursor: string): void;
  previous(): void;
  reset(): void;
}

export interface DashboardRequest<K extends ReadOperation = ReadOperation> {
  protocol_version: 1;
  request_id: string;
  operation: K;
  profile_id: string;
  principal_id: string;
  session_id: string | null;
  owner_id: string | null;
  generation: string | null;
  cut: string | null;
  expected_revision: null;
  idempotency_key: null;
  arguments: ReadArgs[K];
}

export interface DashboardErrorResponse {
  protocol_version: 1;
  request_id: string;
  operation: ReadOperation;
  status: Exclude<ReadErrorStatus, "error">;
  binding: null;
  result: { code: string; retryable: boolean };
}

export type DashboardResponse = ScopedDashboardResponse | OwnerSessionsResponse | DashboardErrorResponse;
export type DashboardWireRequest = { [K in ReadOperation]: DashboardRequest<K> }[ReadOperation];
export type DashboardTransport = (request: DashboardWireRequest, signal: AbortSignal) => Promise<DashboardResponse>;

export interface SessionChoice {
  sessionId: string;
  relId: string;
}

export interface PhyChoice {
  phyId: string;
  label: string;
}

export interface DashboardClient {
  sessions(): SessionChoice[];
  phys(): PhyChoice[];
  invalidate(): void;
  read<K extends ReadOperation>(operation: K, scope: ReadScope, args: ReadArgs[K], signal: AbortSignal): Promise<ReadOutcome<ReadResults[K]>>;
}

export interface DashboardFixture {
  owner_sessions: Record<string, OwnerSessionsResponse[]>;
  memory_lists: Record<string, MemoryListResponse>;
  graph_pages: Record<string, GraphPageResponse>;
  memory_details: Record<string, MemoryDetailResponse[]>;
  memory_histories: Record<string, MemoryHistoryResponse[]>;
  provenance: Record<string, ProvenanceResponse[]>;
  operational_statuses: Record<string, OperationalStatusResponse>;
  community_lists: Record<string, CommunityListResponse>;
  community_members: Record<string, CommunityMembersResponse[]>;
}

export type GraphSelection = { kind: "node" | "edge"; id: string };

export interface GraphViewProps {
  graph: GraphPageResponse["result"];
  selected: GraphSelection | null;
  onSelect(selection: GraphSelection): void;
  onExpand(nodeId: string): void;
}

export interface CommunityViewProps {
  communities: Page<Community>;
  selected: Community | null;
  members: Page<string> | null;
  onCommunity(community: Community): void;
  onMemory(memoryId: string): void;
  onNextCommunities(cursor: string): void;
  onNextMembers(cursor: string): void;
}

export interface HostReact {
  createElement(type: string, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  createElement<P>(type: (props: P) => unknown, props: P & { key?: string }, ...children: unknown[]): unknown;
}

export interface HermesDashboardSDK {
  sdkVersion: string;
  React: HostReact;
  authedFetch(url: string, init?: RequestInit): Promise<Response>;
  hooks: {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void];
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
    useRef<T>(initial: T): { current: T };
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
  var ReliquaryDashboardClient: {
    createClient(transport: DashboardTransport, sessions?: SessionChoice[], phys?: PhyChoice[], resetTransport?: () => void): DashboardClient;
  };
  var ReliquaryDashboardFixtures: {
    createFixtureClient(fixture?: DashboardFixture, activePhyId?: string | null): DashboardClient;
  };
  var ReliquaryDashboardGraph: {
    GraphView(props: GraphViewProps): unknown;
    CommunityView(props: CommunityViewProps): unknown;
  };
  var ReliquaryDashboardState: {
    useRead<K extends ReadOperation>(client: DashboardClient, operation: K, scope: ReadScope, args: ReadArgs[K] | null): ReadHandle<ReadResults[K]>;
    useCursor(): CursorState;
  };
  var ReliquaryDashboardViews: {
    meta(label: string, value: string): unknown;
    readContent<T>(label: string, read: ReadHandle<T>, render: (value: T) => unknown, resync?: () => void): unknown;
    pager(label: string, cursor: CursorState, next: string | null): unknown;
    select(label: string, value: string, options: { value: string; label: string }[], onChange: (value: string) => void): unknown;
    MemoryList(props: { items: MemorySummary[]; selected: string | null; onSelect: (memoryId: string) => void }): unknown;
    Inspector(props: { client: DashboardClient; scope: ReadScope; memoryId: string }): unknown;
    Status(props: { client: DashboardClient; scope: ReadScope; live?: boolean }): unknown;
  };
  var ReliquaryDashboardLive: {
    createLiveClient(authedFetch: HermesDashboardSDK["authedFetch"]): DashboardClient;
    createLiveMutation(authedFetch: HermesDashboardSDK["authedFetch"]): import("./types-owner-content").DashboardMutationWriter;
  };
  var ReliquaryDashboardFixture: DashboardFixture;
}
