import test from "node:test";
import assert from "node:assert/strict";
import type { OwnerBinding } from "../types";
import type { JsonTransport } from "../src/host";
import { createKnowledgeClient } from "../src/knowledge/client";

const owner: OwnerBinding = {
  owner_id: "rel-example",
  owner_kind: "REL",
  display_label: "Example REL",
  generation: "generation-1",
  cut: "cut-1",
  capabilities: {
    view: true, manage: true, history: true, provenance: true, graph: true, community: true,
    status: true, memory_create: true, memory_edit: true, memory_retire: true,
    relation_edit: true, community_rename: true,
  },
};

 test("Knowledge client accepts the direct public dashboard browser DTO", async () => {
  let calledPath = "";
  let sentBody: Record<string, unknown> | null = null;
  const json: JsonTransport = async (path, options) => {
    calledPath = path;
    sentBody = options?.body as Record<string, unknown>;
    const request = sentBody;
    return {
      protocol_version: 1,
      request_id: request.request_id,
      operation: "ui.memory_list",
      status: "ok",
      binding: owner,
      result: {
        items: [{
          memory_id: "memory-1", revision: "3", body_id: "body-1", title: "Remember this",
          excerpt: "A bounded excerpt", category: "fact", memory_type: "general", lifecycle: "active",
          canonical_status: "canonical", freshness: null, community_id: null,
        }],
        next_cursor: null,
        truncated: false,
      },
      cursor: null,
    };
  };
  const client = createKnowledgeClient(json);
  const result = await client.read({ owner, sessionId: "session-1" }, "ui.memory_list", {
    cursor: null,
    limit: 40,
    filters: { query: "", category: null, memory_type: null, lifecycle: "active", community_id: null },
  });

  assert.equal(calledPath, "/dashboard-v1");
  assert.equal(sentBody?.session_id, "session-1");
  assert.equal((sentBody?.arguments as { limit: number }).limit, 40);
  assert.equal(result.items[0]?.memory_id, "memory-1");
});

test("owner discovery validates the selected session from the direct browser DTO", async () => {
  const json: JsonTransport = async (_path, options) => {
    const request = options?.body as Record<string, unknown>;
    return {
      protocol_version: 1,
      request_id: request.request_id,
      operation: "ui.owner_sessions",
      status: "ok",
      binding: null,
      result: {
        owners: { items: [owner], next_cursor: null, truncated: false },
        active_session_id: "session-1",
        session_owner_id: "rel-example",
        active_phy_id: null,
      },
      cursor: null,
    };
  };
  const result = await createKnowledgeClient(json).ownerSessions("session-1", null);
  assert.equal(result.session_owner_id, "rel-example");
  await assert.rejects(() => createKnowledgeClient(async (_path, options) => {
    const request = options?.body as Record<string, unknown>;
    return {
      protocol_version: 1, request_id: request.request_id, operation: "ui.owner_sessions", status: "ok", binding: null,
      result: { owners: { items: [owner], next_cursor: null, truncated: false }, active_session_id: "other-session", session_owner_id: "rel-example", active_phy_id: null },
    };
  }).ownerSessions("session-1", null));
});
