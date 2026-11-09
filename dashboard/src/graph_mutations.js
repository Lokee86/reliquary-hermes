(function (root) {
  "use strict";

  /** @typedef {import("../types").GraphPageResponse["result"]} GraphPage */
  /** @typedef {import("../types").OwnerBinding} OwnerBinding */
  /** @typedef {import("../types").ReadScope & {owner: OwnerBinding}} MutationScope */
  /** @typedef {import("../types-owner-content").DashboardMutationWriter} DashboardMutationWriter */
  /** @typedef {import("../types-owner-content").DashboardMutationOutcome} DashboardMutationOutcome */

  const sdk = root.ReliquaryDashboardHost;
  const h = sdk.React.createElement;
  const { useState, useEffect, useRef } = sdk.hooks;

  function requestKey() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return hex;
  }

  /** @param {unknown} value */
  function safeCode(value) {
    return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)
      ? value : "unknown_error";
  }

  /** @param {{outcome:DashboardMutationOutcome|null,onRefresh?:()=>void}} props */
  function OutcomeMessage({ outcome, onRefresh }) {
    if (!outcome) return null;
    if (outcome.status === "ok") {
      return h("div", { className: "rly-write-success", role: "status" },
        h("p", null, "Saved. Receipt ", outcome.value.result.receipt_id,
          ". Refresh owner data to inspect the committed change."),
        onRefresh && h("button", { type: "button", onClick: onRefresh }, "Refresh owner data"));
    }
    const conflict = outcome.status === "conflict" || outcome.status === "stale_cursor";
    return h("div", { className: "rly-write-error", role: "status" },
      h("p", null, conflict ? "The owner changed after this draft was loaded."
        : "Could not save this draft (", safeCode(outcome.code), "). The draft and request key are preserved."),
      conflict && onRefresh && h("button", { type: "button", onClick: onRefresh }, "Refresh owner data"),
      !conflict && outcome.retryable && h("p", { className: "rly-muted" }, "Submit again to retry this same draft."));
  }

  /** @param {{scope:MutationScope,graph:GraphPage|null,write?:DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props */
  function RelationMutationPanel({ scope, graph, write, onRefresh, refreshing = false }) {
    const [mode, setMode] = useState(/** @type {"link"|"unlink"} */ ("link"));
    const [sourceId, setSourceId] = useState("");
    const [targetId, setTargetId] = useState("");
    const [edgeId, setEdgeId] = useState("");
    const [draftKey, setDraftKey] = useState(requestKey);
    const [outcome, setOutcome] = useState(/** @type {DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));

    const owner = scope.owner;
    const canEdit = !!write && owner.owner_kind === "REL"
      && owner.capabilities.view && owner.capabilities.manage && owner.capabilities.relation_edit;
    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [owner.owner_id, owner.generation, owner.cut, scope.sessionId]);

    const nodes = (graph?.nodes ?? []).filter((node) => node.kind === "memory" && node.memory_id
      && node.cut === owner.cut && node.node_id === node.memory_id);
    const byId = new Map(nodes.map((node) => [node.memory_id, node]));
    const edges = (graph?.edges ?? []).filter((edge) => edge.kind === "user_association"
      && edge.origin === "user" && edge.active && edge.cut === owner.cut
      && byId.has(edge.source_id) && byId.has(edge.target_id));
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    const selectedEdge = edges.find((edge) => edge.edge_id === edgeId);
    const duplicate = !!source && !!target && (graph?.edges ?? []).some((edge) => edge.active
      && edge.kind === "user_association" && edge.origin === "user"
      && ((edge.source_id === sourceId && edge.target_id === targetId)
        || (edge.source_id === targetId && edge.target_id === sourceId)));
    const canSubmit = canEdit && !!graph && !pending && !refreshing && (mode === "link"
      ? !!source && !!target && sourceId !== targetId && !duplicate
      : !!selectedEdge);

    /** @param {()=>void} edit */
    function changed(edit) {
      edit();
      setDraftKey(requestKey());
      setOutcome(null);
    }

    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (!canSubmit || !write || !graph) return;
      // The visible graph page, selected endpoints, and action all belong to the
      // exact owner cut sent by the shared mutation writer.
      if (graph.nodes.some((node) => node.cut !== owner.cut) || graph.edges.some((edge) => edge.cut !== owner.cut)) {
        setOutcome({ status: "conflict", code: "graph_cut_changed", retryable: false });
        return;
      }
      const endpoints = mode === "link" ? [source, target]
        : selectedEdge ? [byId.get(selectedEdge.source_id), byId.get(selectedEdge.target_id)] : [];
      const [from, to] = endpoints;
      if (!from?.memory_id || !to?.memory_id || (mode === "unlink" && !selectedEdge)) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      const args = mode === "link"
        ? {
            source_id: from.memory_id,
            target_id: to.memory_id,
            source_revision: from.revision,
            target_revision: to.revision,
            action: "link",
            relation_kind: "user_association",
            edge_id: null,
          }
        : {
            source_id: from.memory_id,
            target_id: to.memory_id,
            source_revision: from.revision,
            target_revision: to.revision,
            action: "unlink",
            relation_kind: "user_association",
            edge_id: selectedEdge?.edge_id ?? null,
          };
      const expectedRevision = mode === "link" ? null : selectedEdge?.revision ?? null;
      try {
        const result = await write("ui.relation_change", scope, args, expectedRevision, draftKey, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    if (!canEdit) return null;
    return h("section", { className: "rly-graph-write-panel", "aria-label": "User association" },
      h("h3", null, "User association"),
      h("p", { className: "rly-muted" }, "Changes are checked against the current owner cut and Memory revisions."),
      h("form", { className: "rly-memory-write-form", onSubmit: submit },
        h("label", { className: "rly-field" },
          h("span", null, "Action"),
          h("select", {
            value: mode, disabled: pending,
            onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) => changed(() => {
              setMode(/** @type {"link"|"unlink"} */ (event.currentTarget.value));
              setOutcome(null);
            }),
          }, h("option", { value: "link" }, "Link two Memories"),
          h("option", { value: "unlink" }, "Unlink an existing user association"))),
        mode === "link"
          ? h("div", null,
            h("label", { className: "rly-field" }, h("span", null, "From Memory"), h("select", {
              value: sourceId, disabled: pending,
              onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) =>
                changed(() => setSourceId(event.currentTarget.value)),
            }, h("option", { value: "" }, "Choose a Memory"),
            ...nodes.map((node) => h("option", { key: node.memory_id, value: node.memory_id }, node.label)))),
            h("label", { className: "rly-field" }, h("span", null, "To Memory"), h("select", {
              value: targetId, disabled: pending,
              onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) =>
                changed(() => setTargetId(event.currentTarget.value)),
            }, h("option", { value: "" }, "Choose a Memory"),
            ...nodes.map((node) => h("option", { key: node.memory_id, value: node.memory_id }, node.label)))),
            duplicate && h("p", { className: "rly-muted" }, "These Memories already have an active user association."),
          )
          : h("label", { className: "rly-field" }, h("span", null, "Active user association"), h("select", {
            value: edgeId, disabled: pending,
            onChange: (/** @type {{currentTarget:HTMLSelectElement}} */ event) =>
              changed(() => setEdgeId(event.currentTarget.value)),
          }, h("option", { value: "" }, "Choose an association"),
          ...edges.map((edge) => h("option", { key: edge.edge_id, value: edge.edge_id },
            `${byId.get(edge.source_id)?.label} → ${byId.get(edge.target_id)?.label}`)))),
        h("button", { type: "submit", disabled: !canSubmit },
          pending ? "Saving…" : mode === "link" ? "Link Memories" : "Unlink association"),
        h(OutcomeMessage, { outcome, onRefresh })));
  }

  /** @param {{scope:MutationScope,community:import("../types").Community|null,write?:DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props */
  function CommunityRenamePanel({ scope, community, write, onRefresh, refreshing = false }) {
    const [name, setName] = useState(() => community?.name ?? "");
    const [draftKey, setDraftKey] = useState(requestKey);
    const [outcome, setOutcome] = useState(/** @type {DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));
    const owner = scope.owner;
    const canRename = !!write && owner.owner_kind === "REL"
      && owner.capabilities.view && owner.capabilities.manage && owner.capabilities.community_rename;

    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [owner.owner_id, owner.generation, owner.cut, scope.sessionId]);

    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (!canRename || pending || refreshing || !community || !write || !name.trim()) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.community_rename", scope, {
          community_id: community.community_id,
          name,
        }, community.generation, draftKey, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    if (!canRename) return null;
    return h("section", { className: "rly-community-rename", "aria-label": "Rename community" },
      h("form", { className: "rly-memory-write-form", onSubmit: submit },
        h("h3", null, "Rename selected community"),
        !community && h("p", { className: "rly-muted" }, "Current community metadata is unavailable."),
        h("label", { className: "rly-field" }, h("span", null, "Community name"), h("input", {
          value: name, maxLength: 128, disabled: pending,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => {
            const value = event.currentTarget.value;
            setName(value); setDraftKey(requestKey()); setOutcome(null);
          },
        })),
        h("button", { type: "submit", disabled: pending || refreshing || !community || !name.trim() },
          pending ? "Saving…" : "Save community name"),
        h(OutcomeMessage, { outcome, onRefresh })));
  }

  root.ReliquaryDashboardMutations = Object.assign(
    root.ReliquaryDashboardMutations || {},
    { RelationMutationPanel, CommunityRenamePanel },
  );
  if (typeof module !== "undefined" && module.exports) module.exports = { RelationMutationPanel, CommunityRenamePanel };
})(globalThis);
