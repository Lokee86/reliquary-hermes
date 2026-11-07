# HP01 pinned Hermes host audit

## Purpose

Record the actual pinned Hermes lifecycle, identity, privacy and request-handoff surfaces without claiming unavailable capabilities.

## Overview

Status: source audit and deterministic contract fixtures, dated 2026-11-07. No Hermes core changes or deployable plugin are included.

## Pin and source authority

Audited checkout: `hermes-agent` at `11c1f1bbe65fca1cf8bcaa005443473a67915712`, clean before work. Standalone repository baseline: `c54c4298aa8996ca631d07534c97f202f619abb6`, branch `hp01/freeze-hermes-contract`. Planning authority is the native 2.1 implementation spec linked by the README, not historical 2.0 corpus or an assumed compatible reader.

The source observations below apply to this SHA only. `Discovery.validate` rejects another host SHA or protocol version; upgrade requires a new audit and contract test run. It does not attempt compatibility fallback.

## Actual lifecycle surface

`agent/memory_provider.py::MemoryProvider` defines:

- Required `name`, `is_available`, `initialize(session_id, **kwargs)` and `get_tool_schemas`. `is_available` is configuration/dependency-only, with no network.
- `initialize` gets profile-scoped `hermes_home`, platform, and possibly `agent_context`, agent identity/workspace, parent session and user IDs. No default-home fallback is permitted.
- `prefetch(query, *, session_id='')` returns formatted context. `queue_prefetch` queues background recall. `recall_status` describes only the latest actual prefetch.
- `sync_turn(user_content, assistant_content, *, session_id='', messages=None, turn_author=None)` receives OpenAI-style messages and per-turn author `{id, name, is_bot}`. It has **no explicit source revision or branch argument**, no durable import receipt, and no model acceptance acknowledgment.
- Optional `on_turn_start`, `on_session_end`, `on_session_switch(new_session_id, *, parent_session_id='', reset=False, rewound=False, **kwargs)`, pre-compression and parent-side delegation hooks. A switch/rewind notification is not itself an authoritative source export.
- `get_config_schema`/`save_config` support provider setup. The generic setup path is `hermes memory setup` and supported `post_setup`, not a parallel Reliquary command.

`agent/memory_manager.py::initialize_all` injects `hermes_home`. `sync_all` redacts provider egress, including transcript/tool content, and forwards `messages`/`turn_author` only to accepting signatures. It serializes background writes. A plugin must not bypass that privacy boundary by rereading unredacted data.

`agent/memory_provider.py::ctx_bound` and `spawn_context_thread` propagate caller contextvars. The manager uses these for worker/prefetch work. The test suite imports these real helpers from the pinned, dependency-free ABC module and verifies isolation across worker threads. No full Hermes application import is performed.

Non-primary `subagent`, `cron` and `flush` contexts do not duplicate primary ingestion. Delegation is observed only through the parent-authorized path. Group participants are resolved every turn; startup user identity does not make every participant the operator.

## Source identity and copy limitations

`agent/message_metadata.py:27-35` defines `message_uid` as the durable logical message ID, retained through host copies, rotation, compaction and rewrite, and restored unconditionally. `_row_id` is a physical row ID, reissued per copy and optionally exposed. A content hash is a revision witness, not a replacement message ID. Identical text can belong to different logical messages.

`hermes_state_messages.py` persists IDs at insertion and exposes `get_messages`/`get_messages_as_conversation`. These are audited source facts, **not permission for the plugin to open Hermes SQL or private stores**. HP04 must choose a supported authorized source-export/reader path that preserves the same IDs, timestamps and privacy-filtered view. The callback does not guarantee all original per-message author metadata or a complete durable canonical transcript. Missing UID, timestamp, trustworthy actor attribution, revision or branch cannot be repaired by guessing.

Version-one copied snapshots explicitly carry nullable `branch_id` and `source_revision`. Null means unavailable in the current callback, not a fabricated default branch/revision. `snapshot_digest` covers the exact permitted copied view with profile/session namespace and original roles/times. It is not a canonical unredacted-source revision. Restart must reproduce the same authorized view and verify IDs/digest before publication. Additional branch/revision guarantees need a supported export capability and tests.

A callback job is merely queued, not a durable checkpoint. Until supported normalization/import and a durable receipt exist, no real ingestion or strict compaction checkpoint is claimed.

## Model-request hooks: observed gap

`agent/turn_api_request.py::_fire_pre_api_request_hook` runs before dispatch, after several request transforms. Its `request` field calls `agent/api_request_hooks.py::_api_request_payload_for_hook`. The sanitizer redacts sensitive keys and caps string, sequence, depth and total payload size. Some request messages are shallow observability copies. The pinned memory-provider guide also documents optional prefetch spilling to a head/tail preview plus private file path; returning the original context is not evidence that all of it reached the model. Later transport/backend transforms may still differ. This is not a proof of successful accepted model payload.

`agent/turn_response_intake.py::_fire_post_api_request_hook` carries response/usage/assistant fields and request identifiers, but **no exact request body/content manifest**. `api_request_error` carries sanitized request/error observability, not positive acceptance proof. Correlating pre and post events or guessing from response text does not close the gap.

No audited generic callback supplies the exact successfully accepted final model content and terminal failed/cancelled/uncertain outcomes. `PINNED_HANDOFF_API_VERSION` is therefore `None`. Current-host retrieval is non-reinforcing even when a fixture fabricates an accepted-looking event. The proposed generic handoff-v1 requirement is in [handoff-contract.md](handoff-contract.md), not an implemented Hermes API.

## Plugin discovery and actual commands

`plugins/AGENTS.md` requires standalone memory providers; no new in-tree backend or Reliquary-specific core branches. `plugins/memory/__init__.py` supports memory-provider directory discovery and `hermes_agent.memory_providers` entry points with `register_memory_provider` capture.

The real guide is `website/docs/developer-guide/memory-provider-plugin.md`. The older nested path mentioned by a routing guide is absent at this SHA. `website/docs/developer-guide/plugins/index.md` documents:

```text
hermes plugins doctor . --ci
hermes plugins validate /path/to/your-plugin --install-deps
```

These commands are reserved for HP06 against an actual packaged plugin in an isolated profile. HP01 has no manifest/registration/dependencies to validate and does not run either command or provision an environment. `--install-deps` would mutate an environment and is not part of this bounded task.

The actual Hermes suite runner is `scripts/run_tests.sh`, not bare pytest. Relevant existing suites include `tests/agent/test_memory_provider.py`, `test_memory_session_switch.py`, `test_memory_sync_redaction.py`, `tests/plugins/memory/test_discovery_sources.py` and `test_provider_threads_inherit_profile.py`. No Hermes tests or caches were modified/run. The standalone HP01 pytest command is separate and frozen in [verification.md](verification.md).

## Pinned web-dashboard loader, SDK and auth

The web dashboard contract is distinct from native desktop `@hermes/plugin-sdk`. At this SHA, `web/src/plugins/registry.ts::SDK_CONTRACT_VERSION` is `1.1.0`; its runtime global is `window.__HERMES_PLUGIN_SDK__`. `sdk.d.ts` is the public typed surface. The host exposes its own React/hooks/components, `fetchJSON` and `authedFetch`; a bundle must use the host React instance rather than loading another one. `window.__HERMES_PLUGINS__.register` registers the tab; `PluginPage.tsx` waits for registration and reports load/no-register failures.

The canonical guide `website/docs/user-guide/features/extending-the-dashboard.md` defines `dashboard/manifest.json` with name/label/tab, prebuilt `entry`, optional CSS and optional `api=plugin_api.py`. Backend routes export a FastAPI router under `/api/plugins/<name>/`; no bundle/manifest/backend is shipped by HP01.

`hermes_cli/web_server_dashboard.py::_mount_one_plugin_api` applies enabled/disabled source trust gates and refuses project plugin backend auto-import. User backends must be enabled; the path remains within the plugin dashboard directory. Hosted plugin isolation resolves the plugin in the requesting profile and forwards authenticated requests; `_plugin_route_secret_scope` binds the profile/secret context through the existing config-profile scope. `web_server.py` applies dashboard authentication before the plugin route and rechecks disabled plugins at request time. The SDK handles the host's session-token/cookie modes; the plugin must not read/export session or service tokens itself.

These existing host gates are necessary but not Reliquary owner authorization. The new UI DTO contract requires server-derived profile/principal plus owner/capability grants, same-origin mutation enforcement and current generation/cut checks. A `?profile=` route selection cannot grant access to another Reliquary profile or PHY. No live route/auth/browser test was run for HP01, so this audit is not integration acceptance.

## Product boundary audit

Accepted product target `Reliquary-rebuild/src/lib.rs` exposes opaque owner handles, trusted host admission, management/maintenance and selected queue/host types. It is not a complete plugin retrieval/worker/edit/confirmed-consumption facade. HP02 must expose narrow existing workflows through public Root/Gateway/Application operations. The future host may depend on public `reliquary-memory` only for domain work, not lower mutable stores. This contract adds no Rust package or production dependency edge.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
