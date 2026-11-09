export {};

export interface DashboardMutationSuccess {
  binding: import("./types").OwnerBinding;
  result: { receipt_id: string; request_id: string; idempotency_key: string; changed: boolean; committed: unknown };
}

export type DashboardMutationOutcome =
  | { status: "ok"; value: DashboardMutationSuccess }
  | { status: import("./types").ReadErrorStatus; code: string; retryable: boolean };

export type DashboardMutationOperation = "ui.memory_create" | "ui.memory_edit" | "ui.memory_retire" |
  "ui.relation_change" | "ui.community_rename";

export interface DashboardMutationWriter {
  (
    operation: DashboardMutationOperation,
    scope: import("./types").ReadScope & { owner: import("./types").OwnerBinding },
    args: Record<string, string | null>,
    expectedRevision: string | null,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<DashboardMutationOutcome>;
}

declare global {
  var ReliquaryDashboardOwner: {
    OwnerContent(props: {
      client: import("./types").DashboardClient;
      scope: import("./types").ReadScope & { owner: import("./types").OwnerBinding };
      write?: import("./types-owner-content").DashboardMutationWriter;
      onRefresh?: () => void;
      refreshing?: boolean;
    }): unknown;
  };
  var ReliquaryDashboardMutations: {
    RelationMutationPanel(props: {
      scope: import("./types").ReadScope & { owner: import("./types").OwnerBinding };
      graph: import("./types").GraphPageResponse["result"] | null;
      write?: DashboardMutationWriter;
      onRefresh?: () => void;
      refreshing?: boolean;
    }): unknown;
    CommunityRenamePanel(props: {
      scope: import("./types").ReadScope & { owner: import("./types").OwnerBinding };
      community: import("./types").Community | null;
      write?: DashboardMutationWriter;
      onRefresh?: () => void;
      refreshing?: boolean;
    }): unknown;
    MemoryMutationPanel(props: {
      client: import("./types").DashboardClient;
      scope: import("./types").ReadScope & { owner: import("./types").OwnerBinding };
      memoryId: string | null;
      write?: import("./types-owner-content").DashboardMutationWriter;
      onRefresh?: () => void;
      refreshing?: boolean;
    }): unknown;
  };
}
