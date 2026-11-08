# HP01 pinned Hermes host audit

## Purpose

Record the pinned Hermes lifecycle, source identity, privacy and plugin surfaces used by the Reliquary integration.

## Overview

The 2026-11-08 audit repins the HP01 contract to a Hermes revision with the generic archive/delete observer. Focused source probes exercise the pinned persistence, provider egress and lifecycle dispatch paths against synthetic history in an isolated profile.

## Pin and source authority

The audited Hermes revision is upstream `cf4f3a7396814ffcaef69d9af09f7cfdade3ddbe` in the detached `hermes-agent-reliquary-hp01-pin` worktree. The standalone contract started at `428f297604afc4fe43765001e9d4939bae617861` on `hp01/freeze-hermes-contract`. The native 2.1 implementation spec linked by the README governs this audit.

The source observations below apply to this SHA only. `Discovery.validate` rejects another host SHA or protocol version; upgrade requires a new audit and contract test run. It does not attempt compatibility fallback.

## Actual lifecycle surface

`agent/memory_provider.py::MemoryProvider` defines:

- Required `name`, `is_available`, `initialize(session_id, **kwargs)` and `get_tool_schemas`. `is_available` is configuration/dependency-only, with no network.
- `initialize` gets profile-scoped `hermes_home`, platform, and possibly `agent_context`, agent identity/workspace, parent session and user IDs. No default-home fallback is permitted.
- `prefetch(query, *, session_id='')` returns formatted context. `queue_prefetch` queues background recall. `recall_status` describes only the latest actual prefetch.
- `sync_turn(user_content, assistant_content, *, session_id='', messages=None, turn_author=None)` receives OpenAI-style messages and per-turn author `{id, name, is_bot}`. The callback supplies no explicit branch ID, source revision or durable Reliquary import receipt.
- Optional `on_turn_start`, `on_session_end`, `on_session_switch(new_session_id, *, parent_session_id='', reset=False, rewound=False, **kwargs)`, pre-compression and parent-side delegation hooks. A switch/rewind notification is not itself an authoritative source export.
- `get_config_schema`/`save_config` support provider setup. The generic setup path is `hermes memory setup` and supported `post_setup`, not a parallel Reliquary command.

`agent/memory_manager.py::initialize_all` injects `hermes_home` and binds the manager to that profile. `agent/memory_caller_scope.py::caller_scope` fences tool/lifecycle calls to the owning home and refuses unresolved callers in multiplexed processes. `sync_all` serializes background writes and forwards redacted transcript/tool content and supported `turn_author` metadata. The integration copies only the authorized provider egress.

`agent/memory_provider.py::ctx_bound` and `spawn_context_thread` propagate caller contextvars. The manager uses these for worker/prefetch work. The test suite imports these real helpers from the pinned, dependency-free ABC module and verifies isolation across worker threads. No full Hermes application import is performed.

The primary context owns ingestion. A delegation result enters through its parent-authorized path. Per-turn author and group metadata describe the source actor. The explicitly active PHY supplies the stable Reliquary `user_id`. Content without trusted attribution to that user stays REL-only, including unknown or unmapped participants.

## Source identity and copy limitations

`agent/message_metadata.py:27-35` defines `message_uid` as the durable logical message ID, retained through host copies, rotation, compaction and rewrite, and restored unconditionally. `_row_id` is a physical row ID, reissued per copy and optionally exposed. A content hash is a revision witness, not a replacement message ID. Identical text can belong to different logical messages.

`agent/turn_finalizer.py::finalize_turn` persists the normal completed turn before passing the live `messages` list to `run_agent.py::_sync_external_memory_for_turn`. The batch persistence path mints each new `message_uid` and sets the stored timestamp in `hermes_state_messages.py::_insert_message_rows`. After commit, `agent/session_persistence.py::_db_flush_write` calls `agent/transcript_repair.py::sync_flushed_message_markers` to copy both fields onto the live messages. The turn-sync adapter forwards the list to `MemoryManager.sync_all`, whose egress scrubbing preserves these fields. `tests/test_pinned_source.py` verifies that the stored rows, live messages and provider callback agree on both IDs and timestamps and that the provider receives redacted content. The probe executes the source-defined adapter and real persistence and manager code without starting a model turn.

The live callback supplies a permitted view of the current turn. HP04 must establish an authorized restart/catch-up interface that preserves IDs, original times and the privacy-filtered view. The state-store reader code is audit evidence. The plugin uses supported provider and source-export interfaces for all reads. Messages missing required UID/time fail copy validation. Unverified actor attribution stays REL-only. Missing branch and revision remain null, and the snapshot digest covers only the permitted copied view with its profile/session namespace, IDs, roles and times.

A queued callback is an input to the import workflow. The durable checkpoint is the accepted product import receipt.

## Archive and delete observer

Hermes exposes `on_session_delete` as a generic plugin observer. A standalone provider can register it alongside `register_memory_provider` through the provider collector's `register_hook` support in `plugins/memory/__init__.py`. The host emits committed deliberate archive and hard delete through the same observer with `reason="archive"` or `reason="delete"`. The payload includes `session_id`, `reason`, the store's profile, optional `deleted_ids` for a lineage or bulk operation and optional `sessions_dir`. It carries no transcript content.

`hermes_state_sessions.py::set_session_archived` and the canonical runtime sidebar mutation emit after the archive commits. The single/bulk delete, runtime delete and retention paths share the emitter in `hermes_state_common.py`. It binds observer dispatch to the affected store's profile. The local probe exercises real archive/delete transitions through the real provider registration and hook dispatch. It reads the synthetic session on a separate read-only connection from within the observer to prove post-commit delivery. The pinned upstream suite `tests/hermes_state/test_session_delete_hook.py` also covers lineage, bulk, sweeps, runtime mutations, repeated archive and observer failure isolation.

The Reliquary effect for a deliberate archive and a delete is the same copied-source tombstone. HP04 owns durable delivery, profile and source binding, catch-up after missed events, and the fence that prevents older queued copies from reviving a source. The pinned observer runs in-process and can fail open. A host notification alone supplies no durable Reliquary checkpoint.

Hermes' reversible idle auto-archive and unarchive are silent in the pinned observer. If idle auto-archive is included in the integration's archive policy, the minimal generic host addition is to publish the IDs changed by `_auto_archive_lineage` through the same profile-scoped post-commit observer. It must preserve the idle-archive provenance and emit only for the actual transition. The plugin has no state-store polling path.

## Plugin discovery and actual commands

`plugins/AGENTS.md` requires standalone memory providers; no new in-tree backend or Reliquary-specific core branches. `plugins/memory/__init__.py` supports memory-provider directory discovery and `hermes_agent.memory_providers` entry points with `register_memory_provider` capture.

The real guide is `website/docs/developer-guide/memory-provider-plugin.md`. The older nested path mentioned by a routing guide is absent at this SHA. `website/docs/developer-guide/plugins/index.md` documents:

```text
hermes plugins doctor . --ci
hermes plugins validate /path/to/your-plugin --install-deps
```

These commands are reserved for HP06 against an actual packaged plugin in an isolated profile. HP01 has no manifest/registration/dependencies to validate and does not run either command or provision an environment. `--install-deps` would mutate an environment and is not part of this bounded task.

The Hermes suite runner is `scripts/run_tests.sh`. Relevant suites include `tests/agent/test_memory_provider.py`, `test_memory_session_switch.py`, `test_memory_sync_redaction.py`, `tests/plugins/memory/test_discovery_sources.py`, `test_provider_threads_inherit_profile.py` and `tests/hermes_state/test_session_delete_hook.py`. The standalone HP01 tests use the pinned Hermes checkout and the installed host runtime dependencies for the source probes. Their child profiles and synthetic databases live under the plugin test temp directory. See [verification.md](verification.md) for the standalone command.

## Pinned web-dashboard loader, SDK and auth

The web dashboard contract is distinct from native desktop `@hermes/plugin-sdk`. At this SHA, `web/src/plugins/registry.ts::SDK_CONTRACT_VERSION` is `1.1.0`; its runtime global is `window.__HERMES_PLUGIN_SDK__`. `sdk.d.ts` is the public typed surface. The host exposes its own React/hooks/components, `fetchJSON` and `authedFetch`; a bundle must use the host React instance rather than loading another one. `window.__HERMES_PLUGINS__.register` registers the tab; `PluginPage.tsx` waits for registration and reports load/no-register failures.

The canonical guide `website/docs/user-guide/features/extending-the-dashboard.md` defines `dashboard/manifest.json` with name/label/tab, prebuilt `entry`, optional CSS and optional `api=plugin_api.py`. Backend routes export a FastAPI router under `/api/plugins/<name>/`; no bundle/manifest/backend is shipped by HP01.

`hermes_cli/web_server_dashboard.py::_mount_one_plugin_api` applies enabled/disabled source trust gates and refuses project plugin backend auto-import. User backends must be enabled; the path remains within the plugin dashboard directory. Hosted plugin isolation resolves the plugin in the requesting profile and forwards authenticated requests; `_plugin_route_secret_scope` binds the profile/secret context through the existing config-profile scope. `web_server.py` applies dashboard authentication before the plugin route and rechecks disabled plugins at request time. The SDK handles the host's session-token/cookie modes; the plugin must not read/export session or service tokens itself.

These existing host gates are necessary but not Reliquary owner authorization. The new UI DTO contract requires server-derived profile/principal plus owner/capability grants, same-origin mutation enforcement and current generation/cut checks. A `?profile=` route selection cannot grant access to another Reliquary profile or PHY. No live route/auth/browser test was run for HP01, so this audit is not integration acceptance.

## Product boundary audit

The accepted G4 product exposes opaque owner handles, trusted host admission, management/maintenance and selected queue/host types. HP02 must expose narrow existing workflows through public Root/Gateway/Application operations. The temporary `HACK` receipt bridge belongs inside the Rust host at the selected-Memory result-return boundary. The standalone Python provider transport carries retrieval and source operations. The Rust host depends on public `reliquary-memory` for domain work.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
