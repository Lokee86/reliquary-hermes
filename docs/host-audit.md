# HP01 pinned Hermes host audit

## Purpose

Record the pinned Hermes lifecycle, source identity, privacy and plugin surfaces used by the Reliquary integration.

## Overview

The 2026-11-08 HP01-R1 audit repins the HP01 contract to stable Hermes v0.23.0. Local source probes exercise persistence, provider egress and committed lifecycle dispatch against synthetic history in isolated profiles.

## Pin and source authority

The audited Hermes revision is stable `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` in the detached `hermes-agent-reliquary-hp01-v023` worktree. GitHub records the release as immutable, published on November 5, 2026 and neither a draft nor a prerelease. The annotated tag object is `df1774294af26285ae758c6114f3f2f60e2a602d`. [Upstream release](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0)

Historical pin evidence comes from `cf4f3a7396814ffcaef69d9af09f7cfdade3ddbe` in the October canary worktree. The standalone contract started at `428f297604afc4fe43765001e9d4939bae617861` on `hp01/freeze-hermes-contract`. The native 2.1 implementation spec linked by the README governs this audit.

The observations below apply to the stable SHA. `Discovery.validate` enforces a single exact host revision and protocol version. An upgrade requires a new audit and contract test run. The real-process probe verifies stable discovery and rejects the historical pin.

## Actual lifecycle surface

`agent/memory_provider.py::MemoryProvider` defines:

- Required `name`, `is_available`, `initialize(session_id, **kwargs)` and `get_tool_schemas`. `is_available` is configuration/dependency-only, with no network.
- `initialize` gets profile-scoped `hermes_home`, platform, and possibly `agent_context`, agent identity/workspace, parent session and user IDs. No default-home fallback is permitted.
- `prefetch(query, *, session_id='')` returns formatted context. `queue_prefetch` queues background recall. `recall_status` describes only the latest actual prefetch.
- `sync_turn(user_content, assistant_content, *, session_id='', messages=None, turn_author=None)` receives OpenAI-style messages and per-turn author `{id, name, is_bot}`. The callback supplies no explicit branch ID, source revision or durable Reliquary import receipt.
- Optional `on_turn_start`, `on_session_end`, `on_session_switch(new_session_id, *, parent_session_id='', reset=False, rewound=False, **kwargs)`, pre-compression and parent-side delegation hooks. A switch/rewind notification is not itself an authoritative source export.
- `get_config_schema`/`save_config` support provider setup. The generic setup path is `hermes memory setup` and supported `post_setup`, not a parallel Reliquary command.

`agent/memory_manager.py::initialize_all` injects `hermes_home` and binds each fresh provider instance to that profile. `agent/memory_caller_scope.py::caller_scope` fences tool and lifecycle calls to the owning home and refuses unresolved callers in multiplexed processes. The manager refuses a provider instance shared across profile homes. Reliquary loads settings and credentials from its explicit home and keeps attachment state on the instance. `sync_all` serializes background writes and forwards scrubbed transcript and tool content with supported `turn_author` metadata.

`agent/memory_provider.py::ctx_bound` and `spawn_context_thread` propagate caller contextvars. The manager uses these for worker/prefetch work. The test suite imports these real helpers from the pinned, dependency-free ABC module and verifies isolation across worker threads. No full Hermes application import is performed.

HU05 uses the profile-scoped plugin router for a separate pre-configuration API. The manifest imports the active profile's installed Python provider through Hermes `plugins.memory.import_provider_module`. The Desktop SDK registers a native sidebar route, exposes `pickOpenPath()` and sends `ctx.rest()` through the active profile's gateway. `hermes_cli/dashboard_auth/native_http.py` verifies one-use local native grants. At the stable pin, hosted forwarding carries ordinary Hermes authentication and drops the verified native admission. HU05 requires the Hermes fix that binds the redeemed grant to the target worker's home and carries the resulting admission over the existing private IPC. Hermes strips the native ticket before forwarding. Reliquary accepts native worker mutations only when the request carries both hosted Hermes admission and verified native admission and has no Origin. Browser mutations continue to require same-origin admission. [Hosted Desktop verification](verification.md#hu05-isolated-desktop-mutation-checks)

The pinned `agent/turn_context.py` turn prologue calls `on_turn_start` before `MemoryManager.prefetch_all` and asks the manager to describe the returned recall for the indicator. The manager gives external prefetch an eight-second default budget. Provider tools register OpenAI-style schemas and return a JSON string through the manager's profile-scoped dispatch. Reliquary reserves a shorter loopback retrieval budget and resets recall state when the session or turn changes.

The lifecycle signatures and context helpers remain compatible. The ABC adds optional profile creation and rename hooks and provider-backed dashboard config methods. Reliquary uses its existing setup path and needs no adapter for those additions. The primary context owns ingestion. A delegation result enters through its parent-authorized path. Per-turn author and group metadata describe the source actor. The explicitly active PHY supplies the stable Reliquary `user_id`. Content without trusted attribution to that user stays REL-only, including unknown or unmapped participants.

## Source identity and copy limitations

`agent/message_metadata.py` defines `message_uid` as the durable logical message ID, retained through host copies, rotation, compaction and rewrite, and restored unconditionally. `_row_id` is a physical row ID, reissued per copy and optionally exposed. A content hash is a revision witness, not a replacement message ID. Identical text can belong to different logical messages.

`agent/turn_finalizer.py::finalize_turn` persists the normal completed turn before passing the live `messages` list to `run_agent.py::_sync_external_memory_for_turn`. The batch persistence path mints each new `message_uid` and sets the stored timestamp in `hermes_state_messages.py::_insert_message_rows`. After commit, `agent/session_persistence.py::_db_flush_write` calls `agent/transcript_repair.py::sync_flushed_message_markers` to copy both fields onto the live messages. Stable persistence tracks already-durable logical IDs during rewrites. The turn-sync adapter forwards the list to `MemoryManager.sync_all`, whose egress scrubbing preserves the IDs and times. `tests/test_pinned_source.py` verifies that the stored rows, live messages and provider callback agree on both fields and that the callback scrubs secrets. The probe executes the source-defined adapter and real persistence and manager code without starting a model turn.

The stable finalizer skips memory sync for a vetoed turn. On a later completed turn, `sync_turn` can still carry an earlier vetoed prompt in a row's display metadata. The new withheld-prompt filtering in the manager applies to other hooks. `capture_snapshot` copies the placeholder content and discards display metadata, as verified by the stable probe.

The callback is a live handoff. The stable provider interface supplies no authorized catch-up export or cursor for missed turns or lifecycle events. The CLI session export is a separate backup surface with different redaction behavior. The state-store reader is used only as audit evidence. Messages missing required UID/time fail copy validation. Unverified actor attribution stays REL-only. Missing branch and revision remain null, and the snapshot digest covers only the permitted copied view with its profile/session namespace, IDs, roles and times.

A queued callback is an input to the import workflow. The durable checkpoint is the accepted product import receipt.

## Archive and delete observer

Hermes exposes `on_session_delete` as a generic plugin observer. A standalone provider can register it alongside `register_memory_provider` through the provider collector's `register_hook` support in `plugins/memory/__init__.py`. The host emits committed deliberate archive and hard delete through the same observer with `reason="archive"` or `reason="delete"`. The payload includes `session_id`, `reason`, the store's profile, optional `deleted_ids` for a lineage or bulk operation and optional `sessions_dir`. It carries no transcript content.

`hermes_state_sessions.py::set_session_archived` and the canonical runtime sidebar mutation emit after archive commits. Gateway single-session DELETE calls the profile store's `delete_session`. Dashboard DELETE goes through the owner or offline runtime mutation. Both paths reach the same post-commit `emit_session_deleted` as bulk delete and retention. It binds observer dispatch to the affected store's profile. The local probe exercises deliberate archive, lineage archive and bulk delete through the real collector and hook dispatch. It reads every affected synthetic session on a separate read-only connection inside the observer to prove post-commit delivery and checks the dispatched profile and home. The cold-discovery probe exercises the ordinary entry point when no provider has initialized. The upstream canonical runtime regression passed against v0.23.0. It verifies the committed delete and archive paths, bulk affected IDs, sweeps and repeated archive. The Gateway HTTP handler was checked in source.

The Reliquary effect for a deliberate archive and a delete is the same copied-source tombstone. HP04 owns durable delivery, profile and source binding, catch-up after missed events, and the fence that prevents older queued copies from reviving a source. The pinned observer runs in-process and can fail open. A host notification alone supplies no durable Reliquary checkpoint.

Hermes' reversible idle auto-archive and unarchive remain silent in the stable observer and stay outside the v1 tombstone policy.

## Plugin discovery and actual commands

`plugins/AGENTS.md` requires standalone memory providers; no new in-tree backend or Reliquary-specific core branches. `plugins/memory/__init__.py` supports memory-provider directory discovery and `hermes_agent.memory_providers` entry points with `register_memory_provider` capture. The collector adds an optional `hold_stream` argument to `register_hook`. The existing observer registration is compatible.

The real guide is `website/docs/developer-guide/memory-provider-plugin.md`. The older nested path mentioned by a routing guide is absent at this SHA. `website/docs/developer-guide/plugins/index.md` documents:

```text
hermes plugins doctor . --ci
hermes plugins validate /path/to/your-plugin --install-deps
```

These commands apply at HP06 against the packaged plugin in an isolated profile. HP01-R1 verifies local registration and setup through source and process tests.

The Hermes suite runner is `scripts/run_tests.sh`. Relevant suites include `tests/agent/test_memory_provider.py`, `test_memory_session_switch.py`, `test_memory_sync_redaction.py`, `tests/plugins/memory/test_discovery_sources.py`, `test_provider_threads_inherit_profile.py` and `tests/hermes_state/test_session_delete_hook.py`. The standalone tests use the pinned Hermes checkout and its local runtime dependencies for source probes, provider registration and setup. Their child profiles and synthetic databases live under the plugin test temp directory. See [verification.md](verification.md) for the standalone command.

## Pinned web-dashboard loader, SDK and auth

The web dashboard contract is distinct from native desktop `@hermes/plugin-sdk`. At this SHA, `web/src/plugins/registry.ts::SDK_CONTRACT_VERSION` is `1.1.0`; its runtime global is `window.__HERMES_PLUGIN_SDK__`. `sdk.d.ts` is the public typed surface. The host exposes its own React/hooks/components, `fetchJSON` and `authedFetch`; a bundle must use the host React instance rather than loading another one. `window.__HERMES_PLUGINS__.register` registers the tab; `PluginPage.tsx` waits for registration and reports load/no-register failures.

The canonical guide `website/docs/user-guide/features/extending-the-dashboard.md` defines `dashboard/manifest.json` with name/label/tab, prebuilt `entry`, optional CSS and optional `api=plugin_api.py`. Backend routes export a FastAPI router under `/api/plugins/<name>/`; no bundle/manifest/backend is shipped by HP01.

`hermes_cli/web_server_dashboard.py::_mount_one_plugin_api` applies enabled/disabled source trust gates and refuses project plugin backend auto-import. User backends must be enabled; the path remains within the plugin dashboard directory. The launch profile uses its configured in-process or hosted mode. An admitted request for a secondary profile's user plugin forwards to that profile's own plugin host, even if the plugin prefers in-process loading. The in-process dependency `_plugin_route_secret_scope` binds the effective profile and secrets. `web_server.py` applies dashboard authentication before plugin routes and rechecks disabled plugins at request time. The SDK handles the host's session-token and cookie modes. The manifest, router prefix, SDK version and globals are compatible with the prior audit. Stable tightens the local CORS policy and checks the core Host and Origin boundary before admitting plugin WebSockets.

These existing host gates provide the HU03 v1 dashboard authentication boundary. Reliquary owner authorization is derived server-side from the **verified Hermes profile scope plus that profile's existing configured Reliquary topology**; no separate dashboard owner-grant store or user-account system is required for the local v1 plugin. The active PHY stable ID is the UI/Reliquary user principal; the Hermes profile is routing scope only. The backend keeps the private service credential server-side and derives capabilities from owner kind plus actually implemented operations. A `?profile=` route selection, browser owner ID or browser principal cannot widen this set. Mutations still require authenticated same-origin/sensitive-route admission plus generation/cut/CAS checks. See [HU03 dashboard authorization](hu03-dashboard-authorization-2026-11-08.md). HU01-R1 verified the fixture bundle in the stable dashboard; HU03 uses the stable plugin route guard and request-scoped Hermes home for owner discovery, live reads and named Root writes. [HU01-R1 dashboard acceptance](verification.md#hu01-r1-dashboard-host-acceptance)

## Product boundary audit

The accepted G4 product exposes opaque owner handles, trusted host admission, management/maintenance and selected queue/host types. HP02 must expose narrow existing workflows through public Root/Gateway/Application operations. The temporary `HACK` receipt bridge belongs inside the Rust host at the selected-Memory result-return boundary. The standalone Python provider transport carries retrieval and source operations. The Rust host depends on public `reliquary-memory` for domain work.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Local service and setup](local-service.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
