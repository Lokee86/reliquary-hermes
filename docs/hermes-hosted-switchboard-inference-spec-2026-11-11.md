# Hermes-owned inference for Reliquary Switchboard — implementation specification

**Date:** 2026-11-11

**Status:** implementation target; not implemented or verified

**Deliverables:** one independent upstream Hermes `ctx.llm` embeddings PR, followed by the Reliquary Hermes inference integration.

**Implementation policy:** one canonical hosted inference path; no parallel model configuration or credential ownership.

## Purpose

A user who already configured and authenticated a model provider in Hermes must not configure or authenticate that provider again to use Reliquary. Reliquary's semantic consumers currently invoke ordinary Switchboard endpoint traits, but the Hermes Rust host opens `ConfiguredRuntime::from_path` through a separate `processing.json -> reliquary.cfg` configuration path. This is an avoidable second provider/model setup. The current Hermes `ctx.llm` facade already provides authenticated text and structured completions, but it does not expose embedding generation.

**Agreed product behavior:** In Hermes-hosted mode, **all normal Reliquary Switchboard inference calls use Hermes's authenticated inference via `ctx.llm`**. Hermes owns credentials, OAuth refresh, provider choice, and model configuration. Reliquary owns the semantics of the requested work and consumes the results. No raw Hermes provider credentials are exported to Reliquary. The standalone Reliquary configuration and inference behavior remain unchanged.

The private random `RELIQUARY_HERMES_TOKEN` currently used to authenticate the local Rust service is **service transport authentication**, not a second model-provider login; preserve it.

## Overview

The hosted design changes two genuine integration boundaries: the Hermes plugin embedding capability and the cross-process transport implementation used by Reliquary's existing Switchboard traits. Standalone configuration and REL/PHY data remain independent and unchanged.

## Verified source baseline and ownership

| Responsibility | Current canonical source | Finding |
| --- | --- | --- |
| Hermes plugin inference | `hermes-agent/agent/plugin_llm.py` | `PluginLlm.complete`, `complete_structured` and async siblings exist; `embed`/`aembed` do not. Existing methods route through Hermes `agent.auxiliary_client`. |
| Hermes plugin scope | `hermes-agent/hermes_cli/plugins.py:PluginContext.llm` | Facade is bound to the plugin ID and governed by `plugins.entries.<id>.llm` trust policy; task and provider/model/profile overrides are controlled. |
| Hermes model auth | `hermes-agent/hermes_cli/auth.py`, `agent/credential_pool.py`, provider runtime | Auth store, pooled credentials, refresh, provider routing already exist. No separate credential-read API is needed. |
| Existing Hermes auxiliary routing | `hermes-agent/hermes_cli/plugins.py:register_auxiliary_task`, `agent/plugin_llm.py:_check_task` | Plugin-owned tasks are supported; configuration belongs to Hermes, not Reliquary. |
| Reliquary inference seam | `Reliquary/crates/reliquary-switchboard/src/lib.rs` and `configured.rs` | Existing `GeneralEndpoint`, `DecisionEndpoint` and `EmbeddingEndpoint` traits already define the inference calls. |
| Reliquary configured runtime | `Reliquary/src/configured_runtime.rs` | `ConfiguredRuntime::from_path` binds local CVCFG credentials and endpoints; no hosted transport construction exists yet. |
| Current Hermes native host | `reliquary-hermes/host/src/source_ingest.rs:configured_runtime`, `retrieval.rs:RetrievalService::open` | Import processing and retrieval both resolve independent local processing configuration. |
| Existing host authentication | `reliquary-hermes/host/src/service_http.rs`, `src/reliquary_hermes/client.py` | Profile/instance/lease-bound signed loopback transport with 256-KiB JSON request/response limit. |
| Provider lifecycle | `reliquary-hermes/src/reliquary_hermes/__init__.py`, `provider.py`, `source_worker.py` | Plugin registers MemoryProvider and uses context-bound background threads; no `ctx.llm` bridge exists. |

Arcana was not usable as current structural evidence: the Hermes snapshot reported an unsupported manifest version and the Reliquary checkout had no current Arcana snapshot. This plan is grounded in direct source inspection; the integration gate includes a fresh dependency search (and a graph check if a valid snapshot becomes available).

## Target architecture

```text
Hermes profile — the ONLY hosted provider/model/auth configuration
  ├─ Hermes existing ctx.llm.complete_structured() / acomplete_structured()
  └─ Hermes new ctx.llm.embed() / aembed()
                  │
      profile-bound Python inference worker
                  │ signed, bounded local service protocol
                  ▼
     Reliquary Hermes Rust host inference bridge
                  │ implements existing Switchboard endpoint traits
                  ▼
          Reliquary ConfiguredRuntime
                  │
    Insomnia / Dream / Entity / Decisions / Vectors / Retrieval
```

For hosted inference, Switchboard continues choosing the **capability and semantic operation** to invoke; Hermes resolves the **actual provider and model** through its own settings. Do not reinterpret an old Reliquary model route as a Hermes model override. Standalone mode retains `ConfiguredRuntime::from_path` and CVCFG-managed credentials.

This is one real cross-process adapter, not a second provider family or model endpoint registry. New signed local transport *operations* are internal IPC, not user-configurable model endpoints.

## A. Independent upstream Hermes change: embedding support on ctx.llm

### Public API contract

Add two additive methods to `agent.plugin_llm.PluginLlm`:

```python
ctx.llm.embed(
    inputs: Sequence[str], *,
    input_type: Literal["query", "document"] = "document",
    provider: str | None = None,
    model: str | None = None,
    dimensions: int | None = None,
    timeout: float | None = None,
    profile: str | None = None,
    purpose: str | None = None,
) -> PluginLlmEmbeddingResult

await ctx.llm.aembed(inputs, **same_keyword_arguments)
```

Return a typed result containing `vectors: list[list[float]]`, the **actually resolved** `provider` and `model`, `dimensions: int`, `usage: PluginLlmUsage`, and a nonsecret `audit` record. Preserve input order and exact result count. Reject empty/oversized requests, dimension disagreement, ragged vectors, NaN/Infinity, missing vectors, and invalid/nonembedding responses. Accept input-type distinctions without silently changing query/document semantics; use provider-specific mappings only when supported.

Existing `complete` and `complete_structured` signatures and behavior remain unchanged. Reuse their trust-policy machinery: explicit provider/model/profile overrides remain fail-closed and subject to configured allowlists. An ordinary call with no overrides uses Hermes-selected embedding inference. No raw tokens, provider-key values, refresh tokens, or auth-store paths appear in plugin results, exceptions, or logs.

### Hermes model selection

Chat-model auto-routing is **not** a valid embedding-model default. Add one **Hermes-owned embedding model selection** within Hermes's existing model/auxiliary configuration and picker (prefer `auxiliary.embedding` if it can be made capability-correct without sending requests through a chat completion path). Resolve a provider/model supported for embeddings and its dimension behavior; reject unavailable or incompatible combinations with a typed `embedding_unconfigured` or `embedding_unsupported` status. Do not insert a silent general-chat fallback or manufacture embeddings from completion text.

Provider routing and credentials must use Hermes's existing active profile, credential pool, expiry/refresh, and provider-runtime mechanisms. Implement a real embeddings transport for supported provider families (initial acceptance: available OpenAI-compatible embedding providers, including selected custom/OpenRouter routes). Non-compatible OAuth grants, such as chat-only Codex routes, must fail as unsupported rather than be treated as general API bearer tokens. Further native-provider transports are extensions, not a prerequisite to honest initial support.

### Upstream tests and documentation

- Extend `tests/agent/test_plugin_llm.py` (and focused provider/credential tests) for sync/async, order, dimensions, input types, size bounds, no keys in results, and existing completion regressions.
- Verify auto embedding-model selection, explicit override denials, allowlists, per-profile isolation, refresh/rotation using test credentials, provider failures and unsupported providers.
- Use deterministic loopback embedding fixtures; probe with synthetic inputs only. Never use real Memory content in a provider-readiness probe.
- Document the new API and Hermes-side embedding selection in the normal plugin SDK/model-configuration documentation.
- Open an independent upstream PR, suggested title: `feat(plugins): expose authenticated embeddings through ctx.llm`. Do not include Reliquary-specific imports or memory policy in that PR.

## B. Reliquary integration: canonical hosted Switchboard transport

### Interface ownership

Retain the existing public Switchboard contracts:
- `GeneralEndpoint::complete_json` for structured Insomnia, Dream, Entity and other general operations;
- `DecisionEndpoint::evaluate` for existing decision consumers;
- `EmbeddingEndpoint::embed` / `embed_bounded` for query/document vectors.

Build **one Hermes-hosted implementation of those contracts**, backed by the private inference bridge. The host must not configure independent HTTP model URLs, credential IDs, models, or provider credentials. It must not call an external model API directly for hosted inference.

Provide a narrow explicit construction path in Switchboard/Root, e.g. a host-provided transport bundle bound to `ConfiguredRuntime`, so `SourceService`, `RetrievalService` and other consumers keep their existing Root calls. This path must work without `reliquary.cfg` or a populated `processing.json`. Non-inference product defaults (retrieval policy, concurrency limits) remain available. Avoid exposing a second user-facing model route configuration.

**Mapping:**

| Existing Switchboard operation | Python worker action |
| --- | --- |
| General structured inference, including Insomnia/Dream/Entity | `ctx.llm.complete_structured` or async sibling |
| Decision evaluation | `ctx.llm.complete_structured` with the existing decision schema |
| Query/document embeddings | `ctx.llm.embed(input_type="query" / "document")` or async sibling |

The Rust side must still validate the exact schemas and vector shape. Hermes's structured-completion parser is not a substitute for Root's validation or acceptance policy.

### One-way, deadlock-safe cross-process transport

A synchronous Rust endpoint call cannot directly invoke a Python method. Extend the **existing authenticated host loopback protocol**, not external model routing:

1. Rust registers a bounded inference job in a private broker, with operation, schema/input, deadline, correlation ID, and the current profile/instance/lease epoch.
2. A separate **profile-bound Python inference worker** polls/claims jobs through signed `HostClient` operations. It holds the registered plugin's `ctx.llm`, and executes the requested call in the verified Hermes profile/secret scope. Start this worker from plugin registration/lifecycle, not from a browser request.
3. The Python worker returns a correlated result or typed failure through signed transport; Rust validates it and completes the waiting Switchboard call.
4. Cancellation, worker exit, profile changes, host restarts, lease changes and expired deadlines invalidate pending jobs and reject stale/late results.

Use a dedicated context-propagating worker (the existing `spawn_context_thread` pattern), **not** `SourceWorker`'s delivery thread or an HTTP/WebUI request thread. Preserve the current signed nonce, body, Host/Origin and response-proof checks; do not add an unauthenticated listener, a browser API, a public inference proxy, or a separate secret.

The host currently has four HTTP workers. **Do not wait for inference while occupying all four**: reserve authenticated claim/result servicing capacity via a bounded admission limit or independent control dispatcher, and never hold SourceService/Registry/Retrieval/Root locks across a model call. Queue waits and network calls must have bounded deadlines; excess concurrent requests return typed backpressure rather than deadlock. Processing work must continue when no chat turn is active. An unavailable Python worker yields a visible unavailable/retryable status, not an alternative provider login.

The existing signed JSON framing has a **256-KiB limit**. Split large embedding batches/results into bounded, correlated parts (or use a comparably authenticated bounded binary framing) with exact length, ordering, digest and final-count validation. Never truncate vectors or silently exceed transport limits. Avoid durable plaintext inference-prompt caches; existing durable import/replay receipts remain the recovery authority.

### Runtime selection and old configuration

Select the runtime explicitly by integration context:
- **Hermes-hosted:** host-backed Switchboard inference exclusively; no `ConfiguredRuntime::from_path` model loading, no independent provider selection or key provisioning, and no fallback to local credentials if Hermes fails.
- **Standalone Reliquary:** existing `reliquary.cfg`, protected credentials and model routes continue unchanged.

In Hermes-hosted mode remove the operative inference dependency on `src/reliquary_hermes/setup.py`'s `config_path` prompt and `host/src/source_ingest.rs`'s `processing.json -> ConfiguredRuntime::from_path`; update the retrieval initialization at the same time. A previous `processing.json` or `reliquary.cfg` may already exist on disk: **do not delete, rewrite or export these files automatically**. Treat existing configured model routes as inactive for Hermes-hosted inference. Eliminate them from the active setup flow and documentation without an ongoing dual-config fallback. Owner paths (`owners.json`), REL/PHY selection, runtime leases, local service HMAC secret, and user data remain unchanged.

### Model identity and vector compatibility

Preserve downstream processing and vector invariants:
- A credential refresh or pool rotation must **not** alter the model/embedding identity by itself.
- The actual provider, model, embedding dimensions, input-type handling and normalization policy must determine the hosted processing/vector identity. Bind the identity before publishing vectors and before resuming a pending import.
- A different embedding model, dimensions, query/document behavior, or normalization invalidates compatibility of prior vectors; use the existing rebuild/reprocess/compatibility workflow, **never silently mix spaces in a REL**.
- Do not infer dimensions from a user-entered Reliquary setting. Get the selected embedding model's actual capabilities and verify returned vectors.
- A provider change that affects generation semantics must invalidate stale pending processing results and the relevant existing `ProcessingRouteIdentity` replay assumptions without erasing accepted receipts.
- Disclose which Hermes provider/model actually serviced the work, without logging prompts, source content or secrets.

## Migration strategy

A **staged hard cut** for hosted inference, with a separately additive upstream API PR:

1. **Upstream Hermes:** implement, document, test and PR `ctx.llm.embed/aembed` with Hermes-owned embedding selection. Preserve existing `ctx.llm` completions.
2. **Reliquary Root/Switchboard:** add exactly one injection seam for a host-provided implementation of the three existing endpoint traits and a stable hosted route identity. Do not change REL/PHY schemas.
3. **Hermes plugin/native host:** implement the signed request broker, context-bound Python worker, hosted runtime construction and complete replacement of `processing.json`-backed inference in import/retrieval. Reuse existing instance/profile/lease authentication.
4. **Setup/packaging/docs:** remove the additional inference configuration from Hermes setup, retain only owner selection and non-provider operational settings, update feature discovery and the catalog README. Pre-upstream stock Hermes explicitly reports `embedding_unavailable` rather than silently using separate credentials.
5. **Integration gate:** build and test both repositories and run isolated Hermes+Reliquary acceptance. No legacy hosted model-config path remains live.

No transient second model-adapter registry, key copier, provider-auth bridge, hidden compatibility fallback, or generated embedding approximation is allowed. Keep the upstream PR independently reviewable; Reliquary's catalog/plugin update is a separate integration deliverable.

## Testing decisions and completion gates

### Upstream Hermes gate

- `ctx.llm.embed/aembed` work with authenticated, supported providers and return valid finite vectors in input order.
- Provider refresh, profile isolation, denied overrides, explicit unsupported credentials, cancellation/timeouts and malformed replies are tested.
- Ordinary `ctx.llm.complete/complete_structured` and plugin task-routing tests remain green.
- No credentials are exposed through the facade.

### Reliquary integration gate

1. Hermes's existing configured and authenticated provider runs Insomnia extraction, Dream/Entity/decision processing, **query and document embedding**, and vector-assisted recall through ordinary Root/Switchboard calls.
2. A clean Hermes profile with REL + PHY configured and an embedding model selected **in Hermes alone** succeeds without `reliquary.cfg`, `processing.json`, duplicated API keys, a second OAuth login, or any separate model-route UI.
3. Verify a copied disposable REL/PHY through import, processing, retrieval and replay with the exact same provenance and accepted receipts as before.
4. Parallel calls, 256-KiB wire boundaries, unavailable Python worker, host crash/restart, same-profile reconnect, wrong profile, wrong HMAC, late response and model-selection change all behave deterministically without deadlock, data leakage or false completion.
5. An embedding-space change refuses incompatible reuse and requires the existing reprocessing/compatibility path.
6. Hermes credential renewal works through its own machinery; revocation makes hosted inference unavailable without accessing or falling back to Reliquary credentials.
7. Standalone Reliquary configured inference and its existing CVCFG/key lifecycle tests remain green.
8. Graph rendering, source history authority, REL/PHY formats, project/session routing, memory ownership, UI mutation authorization and unrelated development work are unaffected.
9. Verification includes source inspection for old `processing.json -> ConfiguredRuntime::from_path` hosted call sites and a whole-repo build/test gate. A current structural graph may supplement but cannot replace code/test verification.
10. The public plugin's installation guide clearly states Hermes-owned inference authentication, embedding prerequisite on the compatible Hermes version, and no second model provider setup.

**Not complete** merely because unit tests pass: finish with a real Hermes-hosted, correctly profile-scoped test using deterministic local models, plus an optional explicitly authorized live-provider smoke; record the actual model identity and vector dimensionality without logging corpus content.

## Out of scope

- Sharing or copying Hermes API keys/OAuth tokens into Reliquary, CVCFG, environment variables or JavaScript.
- Giving Hermes access to Reliquary's standalone credential store.
- Replacing Hermes's login, auth store, or credential pool.
- Changes to REL/PHY formats, semantic algorithms, UI graph rendering, or Memory access permissions.
- Native embedding transports for every possible provider in the first upstream PR. Unsupported providers must be explicit.
- A second Reliquary model configuration panel or an embedding HTTP endpoint configured directly in the plugin.

## Related docs

- [Local service and provider](local-service.md)
- [Hermes service protocol](protocol.md)
- [HU03 Hermes-profile dashboard authorization](hu03-dashboard-authorization-2026-11-08.md)
- [Verification and integration gates](verification.md)
- [Documentation index](INDEX.md)

## Notes

This specification changes only the proposed architecture. No implementation, provider configuration, credential store, installed host, live REL/PHY, or upstream PR was changed by writing it. The independent upstream patch must be based on an appropriate current Hermes main revision; the inspected local Hermes checkout was on an unrelated feature branch. The main Reliquary checkout was already dirty, so it must not be used as a scratch workspace for this work.
