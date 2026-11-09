# Local Reliquary service and provider

## Purpose

Configure the standalone Hermes provider to attach to a local Reliquary service using existing 2.1 owners. The service owns writer leases and persistent session routing. Hermes owns its transcript and session lifecycle.

## Overview

The pinned Hermes `MemoryProvider` starts an attachment in a context-bound background thread. Its client validates discovery, authenticates the host and receives the durable session binding. The host mounts configured RELs for writing through public Root and mounts the selected PHY read-only. It exposes a provider channel with actual owner status. User edits belong to a separate dashboard channel.

Each configured profile has a separate local service and credential. Multiple sessions in one profile share the service. Each project REL is a distinct child of the main REL in the service registry. A configured project session binds to that child. Other sessions bind to the main REL. The same explicit PHY selection can serve different bot profiles without changing the integration `user_id`.

## Configuration and setup

1. Install the standalone Reliquary plugin and its built host in the active Hermes profile. The default executable is `plugins/reliquary/host/reliquary-hermes-host.exe` under that profile. The verification guide records the Root revision used to build it.
2. Identify an existing main REL with a non-project scope, an active PHY, and a project-scoped REL for each optional project. Create owners with the Reliquary CLI if needed.
3. Choose these paths in Reliquary setup or run `hermes memory setup reliquary` for headless setup. Setup derives profile and service identity, validates the paths through the Rust host, provisions a random credential in Hermes secret storage, and checks the signed host topology before selecting the provider.
4. Start a new Hermes session to attach the provider. Set any explicit session-to-project mapping in the private `owners.json` before the session first attaches.

For a unified directory installation, build the browser and Desktop assets with `node dashboard/scripts/build.cjs` and `node desktop/scripts/build.cjs`. Install the provider Python files from `src/reliquary_hermes/` at the root of the existing `plugins/reliquary` package with its native manifest and host pin. Place the rebuilt host in `host/`, the dashboard manifest, Python router and `dist/` in `dashboard/`, and the generated Desktop entry at `desktop/plugin.js`. The dashboard uses the `reliquary-hermes` plugin namespace. Enable that dashboard contribution in the profile and enable Reliquary in Desktop's Capabilities → Plugins.

For Desktop writes through isolated plugin workers, use the isolated Hermes checkout with the [HU05 hosted native admission patch](../patches/hermes-v0.23.0-hosted-native-admission.patch). The patch applies to the pinned Hermes source and preserves its provider and runtime interfaces.

Open the Reliquary tab in the browser or the Reliquary pane in Desktop. Both use the active Hermes profile. The browser accepts typed paths and Desktop also offers its native file picker. Validation shows the detected owner kinds and stable IDs. Connect starts the service and opens the owner dashboard.

Paths are absolute. Configuration is scoped to the `hermes_home` that the pinned host supplies. The example `<hermes_home>/reliquary/owners.json` below binds a session to the Lantern project.

```json
{
  "profile_id": "work",
  "principal_id": "operator",
  "main_rel": "C:/example/owners/general.rel",
  "active_phy": "C:/example/owners/active.phy",
  "projects": {"lantern": "C:/example/owners/lantern.rel"},
  "session_projects": {"session-lantern": "lantern"}
}
```

`provider.json` stores the absolute `binary` path. Hermes stores `RELIQUARY_HERMES_TOKEN` in the active profile's private secret scope. Both JSON configuration files contain only nonsecret settings. The client starts the binary as `reliquary-hermes-host --state-dir <absolute-directory>` with a bounded JSON token bootstrap over standard input. The child inherits only the OS variables needed for startup and uses the state directory for its temporary files.

## Lifecycle and recovery

The service takes an exclusive process lease before mounting owners. Each writable REL also takes the normal Root writer lease. Once mounted, the service publishes `discovery.json` atomically. An authenticated attach creates the exact durable session route before returning its binding. Known sessions reuse their routes after restart. First startup pins the profile, principal, main REL, configured project set and active PHY to the exact mounted identities. Later starts reject changes to that topology or conflicting accepted session routes.

Back up `owners.json`, `provider.json`, `topology-v1.json` and `sessions-v1/` with the matching owners and their usual Reliquary backups. Keep the profile credential in Hermes secret storage. The lock file and `discovery.json` are runtime coordination data. A stale endpoint that refuses the connection permits a new candidate, which must acquire the lease and publish a new authenticated identity. A timeout, malformed discovery, identity mismatch or authentication failure reports unavailable without attempting another launch.

Provider and host lifetime are separated by a generic **integration runtime lease**. Hermes is the first adapter using it, not the lifecycle owner. While attached, each integration runtime renews its authenticated lease. A clean runtime shutdown first makes volatile adapter-owned source captures durable, then cleanly detaches that lease. The shared Rust host remains alive while any integration runtime lease exists; after the **last clean integration runtime exits**, and provided no unclean runtime fence still requires reconciliation, it stops accepting new work, closes Reliquary owners/workers normally and exits. An expired lease without clean detach is recorded as an unclean integration-runtime termination: the host remains running, persists an integration-scoped crash/reconciliation marker and fences only the affected copied-source continuity until that integration reconnects and resynchronizes. See [HP04 crash/reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md). Configure session-to-project assignments before that session's first attachment, and restart the service to load configuration updates.

## Security and diagnostics

The binary binds `127.0.0.1` on an ephemeral port. Attach verifies protocol version, pinned Hermes revision, profile, principal, instance and lease identity. HTTP signatures authenticate the request body and response to a single instance and nonce. Service credentials stay outside the browser and do not travel in URLs, HTTP headers, process arguments or logs. The private provider token grants only the configured profile's operations. Local filesystem permissions govern access to the profiles, owner paths, and runtime files.

An authenticated `owner_status` request reports the bound REL's processing state and pending count. The provider lifecycle distinguishes connecting, attached, unavailable, non-primary and stopped. Diagnostics are fixed codes and omit private wire data. On startup failure, check the configured executable and owner kinds, then check whether a verified process already owns the lease. A different profile using the same writable REL must resolve that conflict before attaching.

## Copied-source operation

The provider hands bounded, text-only Hermes egress to a context-bound worker. The worker persists jobs in the private `source-outbox-v1.sqlite3` and delivers them through the authenticated source channel. `source_capture_pending` is volatile. `source_queued_durable` indicates local persistence and `source_accepted_durable` indicates a verified native staging receipt. Processing can still be pending after staging. Preserve the outbox, `sources-v1/` and `integration-runtimes-v1.json` with the service and owner backups. The runtime registry records unresolved crash fences across host restarts.

Setup enables the directory plugin’s bundled observer, or the `reliquary-source-observer` entry point for a Python installation. It respects explicit plugin disables. The observer records committed deliberate archive and delete notifications even when the service is down. The next running provider worker prioritizes that terminal intent over older copies. An existing native import epoch must settle before Root can write its tombstone. The host still denies replay during that wait. A terminal fence does not schedule new extraction for a stopped import.

Setup preserves the path in an existing `<hermes_home>/reliquary/processing.json`. For a fresh profile it detects an existing local `RELIQUARY_CONFIG_PATH` or `<hermes_home>/reliquary/reliquary.cfg`. Supply a different absolute config path during setup to override the detected path. Configure the required processing routes through Reliquary. The host uses those routes for REL-only work. A profile without processing configuration can stage a copy, and its import may remain open.

Recovery replays work that reached the outbox. If Hermes disappears without a clean detach, the host records an unclean runtime and keeps running rather than claiming the copied source is current. On reconnect, the affected source remains reconciliation-required until a supported provider-authoritative transcript snapshot proves continuity; the next normal `sync_turn(..., messages=...)` can provide that snapshot and is deduplicated by stable source IDs/timestamps. This is intentionally best-effort recovery: a Hermes event committed and then lost before callback delivery may not be exactly reconstructable. Same-session rewind and edited or ambiguous overlaps remain fenced pending authoritative reconciliation.

## Recall and model tools

Configure the `memory-retrieval-decision` model route in the Reliquary configuration selected by `processing.json`. The product CLI exposes `config model set-memory-retrieval-decision`. Restart the host after changing the configuration. Root uses its configured embedding route when available.

Hermes can prefetch relevant Memories at turn start and call `memory_query`, `refine_query` and `traverse_graph` within that turn. The service binds retrieval to the session's REL. Refinement uses the current turn's search ID, and traversal uses the returned Memory IDs and cut. Hermes displays a recall indicator only for context returned by the latest prefetch.

The host checks a 65-second deadline before recording an explicit return. One explicit recall can wait for in-progress prefetch within that budget. The provider client waits up to 67 seconds for the response. Model calls can include both an embedding and a decision. Automatic prefetch keeps a 6.5-second host delivery limit and a 7-second client wait within pinned Hermes' 8-second wait. Enable the `memory` toolset for the session to use explicit recall when automatic prefetch cannot return in time.

Queued prefetch can stage an exact selection in the host. When Hermes asks for matching context, the host checks the current cut and accepted copied-source evidence before recording the selected return. A source crash fence, rewind or tombstone prevents return of Memories grounded in the affected copied evidence.

## Live dashboard

Install the integration Python package in the pinned Hermes environment and stage the live dashboard manifest, router and bundle under the selected profile's user plugin directory. Enable the Reliquary plugin in that profile. Open an attached Hermes provider session to start the configured service. The dashboard discovers that service for the request's admitted profile. Select a configured REL or the active PHY. Enter a configured project session ID or a durably attached general session ID to see status for its mapped REL. Use **Refresh owner data** after an owner cut changes.

The REL inspector shows Memory summaries, current payloads, available history and provenance, graph neighborhoods, current community metadata, and processing state. Session status shows the copied source head or tombstone and the latest recorded recall return when present. An absent or stale community partition and unavailable provenance fields appear as typed unavailable results. The active PHY has read capabilities only.

## Limits

Graph retrieval follows Root's one-hop workflow. A selection that exceeds the requested result or wire bounds fails before a retrieval receipt is recorded. Dashboard writes require an authenticated same-origin Hermes request and the expected owner cut. Setup uses existing Root owners and registry routing. Hermes workspace names, display names and caller-provided owner IDs convey no routing authority.

## Related docs

- [Protocol and authority](protocol.md)
- [Pinned Hermes host audit](host-audit.md)
- [Verification and later gates](verification.md)

## Notes

The operator owns the configured owner paths and their backups. The service has no installer or supervisor in HP03. HP06 owns packaging and installation acceptance.
