(function (root) {
  "use strict";

  const sdk = root.ReliquaryDashboardHost;
  const h = sdk.React.createElement;
  const { useState, useEffect, useRef } = sdk.hooks;
  const { useRead } = root.ReliquaryDashboardState;

  function requestKey() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** @param {import("../types-owner-content").DashboardMutationOutcome|null} outcome @param {(()=>void)|undefined} onRefresh */
  function resultMessage(outcome, onRefresh) {
    if (!outcome) return null;
    if (outcome.status === "ok") {
      return h("p", { className: "rly-write-success", role: "status" },
        `Saved. Receipt ${outcome.value.result.receipt_id}. Use Refresh owner data to inspect the committed Memory.`);
    }
    const conflict = outcome.status === "conflict" || outcome.status === "stale_cursor";
    return h("div", { className: "rly-write-error", role: "status" },
      h("p", null, conflict ? "The owner changed after this draft was loaded." :
        `Could not save this draft (${outcome.code}). The draft and request key are preserved.`),
      conflict && onRefresh && h("button", { type: "button", onClick: onRefresh }, "Refresh owner data"),
      !conflict && outcome.retryable && h("p", { className: "rly-muted" }, "Submit again to retry this same draft."));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},memoryId:string,detail:import("../types").MemoryDetail|null,detailState:import("../types").ReadState<import("../types").MemoryDetail>,write:import("../types-owner-content").DashboardMutationWriter,onRefresh?:()=>void,refreshing:boolean}} props */
  function CorrectionForm({ scope, memoryId, detail, detailState, write, onRefresh, refreshing }) {
    const [draft, setDraft] = useState(() => /** @type {{title:string,body:string,key:string,baseRevision:string|null,initialized:boolean}} */
      ({ title: "", body: "", key: requestKey(), baseRevision: null, initialized: false }));
    const [outcome, setOutcome] = useState(/** @type {import("../types-owner-content").DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));
    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [scope.owner.owner_id, scope.owner.generation, scope.owner.cut, scope.sessionId]);
    useEffect(() => {
      if (detail?.body.availability === "available" && !draft.initialized) {
        setDraft((old) => old.initialized ? old : {
          ...old, title: detail.memory.title ?? "", body: detail.body.content ?? "",
          baseRevision: detail.body.revision, initialized: true,
        });
      }
    }, [detail?.body.revision, detail?.body.availability]);

    /** @param {"title"|"body"} field @param {string} value */
    function edit(field, value) {
      setDraft((old) => ({ ...old, [field]: value, key: requestKey() }));
      setOutcome(null);
    }
    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (pending || refreshing || outcome?.status === "ok" || !detail || detail.memory.lifecycle !== "active" ||
          detail.body.availability !== "available" || !draft.initialized ||
          !draft.title.trim() || !draft.body.trim() || !detail.body.revision) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.memory_edit", scope, {
          memory_id: memoryId, title: draft.title, body: draft.body,
        }, detail.body.revision, draft.key, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }
    return h("form", { className: "rly-memory-write-form", onSubmit: submit },
      h("h3", null, "Correct selected Memory"),
      detailState.status !== "ok" && h("p", { className: "rly-muted", role: "status" },
        detailState.status === "loading" ? "Loading the exact current Memory revision…" :
          `Current Memory detail is unavailable (${detailState.status === "idle" ? "unavailable" : detailState.code}).`),
      draft.baseRevision && detail && draft.baseRevision !== detail.body.revision &&
        h("p", { className: "rly-write-conflict", role: "status" },
          `Draft started from revision ${draft.baseRevision}; latest revision is ${detail.body.revision}. Review before resubmitting.`),
      detail && detail.memory.revision !== detail.body.revision && h("p", { className: "rly-muted" }, "The exact body revision differs from the summary revision."),
      h("label", { className: "rly-field" }, h("span", null, "Replacement title"), h("input", {
        value: draft.title, maxLength: 128,
        onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("title", event.currentTarget.value),
      })),
      h("label", { className: "rly-field" }, h("span", null, "Replacement body"), h("textarea", {
        value: draft.body, maxLength: 32768, rows: 5,
        onChange: (/** @type {{currentTarget:HTMLTextAreaElement}} */ event) => edit("body", event.currentTarget.value),
      })),
      h("button", { type: "submit", disabled: pending || refreshing || outcome?.status === "ok" || !detail || detail.memory.lifecycle !== "active" ||
        detail.body.availability !== "available" ||
        !draft.initialized || !draft.title.trim() || !draft.body.trim() }, pending ? "Saving…" : "Save correction"),
      resultMessage(outcome, onRefresh));
  }

  /** @param {{client:import("../types").DashboardClient,scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},memoryId:string|null,write?:import("../types-owner-content").DashboardMutationWriter,onRefresh?:()=>void,refreshing?:boolean}} props */
  function MemoryMutationPanel({ client, scope, memoryId, write, onRefresh, refreshing = false }) {
    const [draft, setDraft] = useState(() => ({ title: "", body: "", category: "fact", memory_type: "general", key: requestKey() }));
    const [outcome, setOutcome] = useState(/** @type {import("../types-owner-content").DashboardMutationOutcome|null} */ (null));
    const [pending, setPending] = useState(false);
    const controller = useRef(/** @type {AbortController|null} */ (null));
    const capabilities = scope.owner.capabilities;
    const canCreate = !!write && scope.owner.owner_kind === "REL" && capabilities.manage && capabilities.memory_create;
    const canEdit = !!write && scope.owner.owner_kind === "REL" && capabilities.manage && capabilities.memory_edit;
    const canRetire = !!write && scope.owner.owner_kind === "REL" && capabilities.manage && capabilities.memory_retire;
    const detail = useRead(client, "ui.memory_detail", scope, memoryId && (canEdit || canRetire)
      ? { memory_id: memoryId, revision: null } : null);
    useEffect(() => {
      setPending(false);
      return () => controller.current?.abort();
    }, [scope.owner.owner_id, scope.owner.generation, scope.owner.cut, scope.sessionId]);

    /** @param {"title"|"body"|"category"|"memory_type"} field @param {string} value */
    function edit(field, value) {
      setDraft((old) => ({ ...old, [field]: value, key: requestKey() }));
      setOutcome(null);
    }
    /** @param {{preventDefault():void}} event */
    async function submitCreate(event) {
      event.preventDefault();
      if (!write || pending || refreshing || outcome?.status === "ok" || !draft.title.trim() || !draft.body.trim()) return;
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.memory_create", scope, {
          title: draft.title, body: draft.body, category: draft.category, memory_type: draft.memory_type,
        }, null, draft.key, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    if (scope.owner.owner_kind !== "REL" || !write || (!canCreate && !canEdit && !canRetire)) return null;
    return h("section", { className: "rly-memory-write-panel", "aria-label": "Memory management" },
      canCreate && h("form", { className: "rly-memory-write-form", onSubmit: submitCreate },
        h("h3", null, "Create user-origin Memory"),
        h("label", { className: "rly-field" }, h("span", null, "Title"), h("input", {
          value: draft.title, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("title", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Body"), h("textarea", {
          value: draft.body, maxLength: 32768, rows: 5,
          onChange: (/** @type {{currentTarget:HTMLTextAreaElement}} */ event) => edit("body", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Category"), h("input", {
          value: draft.category, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("category", event.currentTarget.value),
        })),
        h("label", { className: "rly-field" }, h("span", null, "Memory type"), h("input", {
          value: draft.memory_type, maxLength: 128,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => edit("memory_type", event.currentTarget.value),
        })),
        h("button", { type: "submit", disabled: pending || refreshing || outcome?.status === "ok" || !draft.title.trim() || !draft.body.trim() || !draft.category.trim() || !draft.memory_type.trim() },
          pending ? "Saving…" : "Create Memory"), resultMessage(outcome, onRefresh)),
      canEdit && memoryId && h(CorrectionForm, { key: memoryId, client, scope, memoryId,
        detail: detail.state.status === "ok" ? detail.state.value : null,
        detailState: detail.state, write, onRefresh, refreshing }),
      canRetire && detail.state.status === "ok" && detail.state.value.memory.lifecycle === "superseded" &&
        detail.state.value.superseded_by && h(RetirementForm, {
          key: detail.state.value.memory.memory_id, scope, write, onRefresh, refreshing,
          memory: detail.state.value.memory,
        }));
  }

  /** @param {{scope:import("../types").ReadScope & {owner:import("../types").OwnerBinding},
   * memory:import("../types").MemorySummary,write:import("../types-owner-content").DashboardMutationWriter,
   * onRefresh?:()=>void,refreshing:boolean}} props */
  function RetirementForm({ scope, memory, write, onRefresh, refreshing }) {
    const [key] = useState(requestKey);
    const [confirmed, setConfirmed] = useState(false);
    const [pending, setPending] = useState(false);
    const [outcome, setOutcome] = useState(/** @type {import("../types-owner-content").DashboardMutationOutcome|null} */ (null));
    const controller = useRef(/** @type {AbortController|null} */ (null));
    useEffect(() => {
      setPending(false);
      setConfirmed(false);
      return () => controller.current?.abort();
    }, [scope.owner.cut, memory.revision]);

    /** @param {{preventDefault():void}} event */
    async function submit(event) {
      event.preventDefault();
      if (!confirmed || pending || refreshing || outcome?.status === "ok") return;
      const active = new AbortController();
      controller.current = active;
      setPending(true);
      try {
        const result = await write("ui.memory_retire", scope, { memory_id: memory.memory_id, effect: "retire" },
          memory.revision, key, active.signal);
        if (!active.signal.aborted) setOutcome(result);
      } catch {
        if (!active.signal.aborted) setOutcome({ status: "error", code: "request_failed", retryable: true });
      } finally {
        if (!active.signal.aborted) setPending(false);
      }
    }

    return h("form", { className: "rly-memory-write-form", onSubmit: submit },
      h("h3", null, "Retire superseded Memory"),
      h("label", { className: "rly-confirmation" },
        h("input", { type: "checkbox", checked: confirmed, disabled: pending,
          onChange: (/** @type {{currentTarget:HTMLInputElement}} */ event) => setConfirmed(event.currentTarget.checked),
        }), " Confirm terminal retirement of this revision"),
      h("button", { type: "submit", disabled: !confirmed || pending || refreshing || outcome?.status === "ok" },
        pending ? "Saving…" : "Retire Memory"),
      resultMessage(outcome, onRefresh));
  }

  root.ReliquaryDashboardMutations = /** @type {typeof root.ReliquaryDashboardMutations} */ ({ MemoryMutationPanel });
})(globalThis);
