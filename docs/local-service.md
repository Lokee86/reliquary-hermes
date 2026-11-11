# Local Reliquary service and provider

## Purpose

Configure the standalone Hermes provider to attach to a local Reliquary service using existing 2.1 owners. The service owns writer leases and persistent session routing. Hermes owns its transcript and session lifecycle.

## Overview

The pinned Hermes `MemoryProvider` starts an attachment in a context-bound background thread. Its client validates discovery, authenticates the host and receives the durable session binding. The host mounts configured RELs for writing through public Root and mounts the selected PHY read-only. It exposes a provider channel with actual owner status. User edits belong to a separate dashboard channel.

Each configured profile has a separate local service and credential. Multiple sessions in one profile share the service. Each project REL is a distinct child of the main REL in the service registry. New sessions with trusted Hermes project attribution bind to the matching dedicated REL when one is configured. Other new sessions use General memory. The audited and installed Hermes hosts lack the attribution hook and use General for new attachments. The same explicit PHY selection can serve different bot profiles without changing the integration `user_id`.

## Configuration and setup

1. Install the standalone Reliquary plugin and its built host in the active Hermes profile. The default executable is `plugins/reliquary/host/reliquary-hermes-host.exe` under that profile. Build it from the Root revision and the HU05 patches recorded in the [verification guide](verification.md#hu05-fresh-real-model-verification).
2. Select or create a General REL and active PHY. Legacy RELs carrying a `project` scope are accepted as General memory for compatibility; the scope does not determine their General role. This does not change the owner bytes or remove the existing checks for dedicated project entries. The Project memories section lists the active Hermes projects. A Hermes host with trusted session project attribution can select or create a dedicated project REL. Stock Hermes shows saved project REL paths read-only and uses General memory for new conversations. Create Hermes projects through the host’s Projects UI or `hermes project create`, then refresh the list.
3. Review the setup and connect. Hosts with project attribution show a confirmation when projects will use General memory. Setup derives profile and service identity, validates owners through the Rust host, provisions a random credential in Hermes secret storage, and checks the signed host topology before selecting the provider. Run `hermes memory setup reliquary` for headless setup.
4. Start a Hermes session to attach the provider. Already attached sessions keep their accepted REL.

For a unified directory installation, run `npm --prefix dashboard ci` and then `npm --prefix dashboard run build`. One build invocation produces the Web bundle and stylesheet and the Desktop entry from the same source tree. Install all five generated files together: `dashboard/dist/index.js`, `dashboard/dist/index.css`, `dashboard/dist/index.js.LEGAL.txt`, `desktop/plugin.js` and `desktop/plugin.js.LEGAL.txt`. Install the static `dashboard/manifest.json` and `dashboard/plugin_api.py` alongside them. Install the provider Python files from `src/reliquary_hermes/` at the root of the existing `plugins/reliquary` package with its native manifest and host pin. Place the rebuilt host in `host/`. The dashboard uses the `reliquary-hermes` plugin namespace. Enable that dashboard contribution in the profile and enable Reliquary in Desktop's Capabilities → Plugins.

With `plugins.isolation: host`, Desktop enables setup and writes when Hermes carries verified native HTTP admission to the active profile's worker. On stock builds without that capability, the Desktop pane shows setup status and supports browsing configured owners. Open the Reliquary web dashboard to connect owners or manage writes. The same plugin enables Desktop setup and writes automatically on a compatible Hermes build. [Stock and fixed Hermes verification](verification.md#hu06-stock-and-fixed-hermes-acceptance)

Open the Reliquary tab in the browser or the Reliquary pane in Desktop. Both use the active Hermes profile. Desktop uses Hermes’ native Open and Save As dialogs. Standalone Windows Web uses a transient Tk chooser when Hermes can verify the direct browser connection, OS user and interactive session. The Web check supports Chrome, Edge and Firefox installed in their standard Program Files locations. When the current connection has no native dialog capability, use **Enter path manually** to supply absolute host paths. The form shows the detected configuration separately and keeps project management behind an optional section after General REL and active PHY are connected. Review checks the selected files and shows their owner kinds and stable IDs. Creating an owner requires a separate confirmation. Created owners remain on disk if setup is cancelled or connection fails. Connect starts the service and opens the owner dashboard. If you connect from the web dashboard, reopen the Desktop pane to browse the configured owners.

Paths are absolute. Configuration is scoped to the `hermes_home` that the pinned host supplies. The example `<hermes_home>/reliquary/owners.json` below associates a dedicated REL with a stable Hermes project ID.

```json
{
  "profile_id": "work",
  "principal_id": "operator",
  "main_rel": "C:/example/owners/general.rel",
  "active_phy": "C:/example/owners/active.phy",
  "projects": {"p_a41e9cd88482": "C:/example/owners/lantern.rel"}
}
```

`provider.json` stores the absolute `binary` path. Hermes stores `RELIQUARY_HERMES_TOKEN` in the active profile's private secret scope. Both JSON configuration files contain only nonsecret settings. The client starts the binary as `reliquary-hermes-host --state-dir <absolute-directory>` with a bounded JSON token bootstrap over standard input. The child inherits only the OS variables needed for startup and uses the state directory for its temporary files.

The graph uses the authenticated Web SDK byte transport. For Desktop graph support, build Hermes Desktop with the [bounded plugin REST byte bridge](../patches/hermes-45882968-plugin-rest-bytes.patch) on an isolated checkout at `458829681db8761e50b8242aa034d23ae9bcdcd5`. The SDK forwards bounded `application/octet-stream` bytes over its existing profile-aware REST and Electron IPC path. On a stock Desktop build, List and the inspector remain available and Graph explains the required host capability.

## Lifecycle and recovery

The service takes an exclusive process lease before mounting owners. Each writable REL also takes the normal Root writer lease. Once mounted, the service publishes `discovery.json` atomically. An authenticated attach creates the exact durable session route before returning its binding. Known sessions reuse their routes after restart. First startup pins the profile, principal, main REL, configured project set and active PHY to the exact mounted identities. Later starts allow an append-only project topology extension with the same profile, principal, General REL, PHY and existing project owner IDs. Removing or replacing accepted owners yields `owner_topology_changed`. Live owner or processing changes return `service_restart_required`. Stop the profile service cleanly before applying the changes again.

Back up `owners.json`, `provider.json`, `topology-v1.json` and `sessions-v1/` with the matching owners and their usual Reliquary backups. Keep the profile credential in Hermes secret storage. The lock file and `discovery.json` are runtime coordination data. A stale endpoint that refuses the connection permits a new candidate, which must acquire the lease and publish a new authenticated identity. A timeout, malformed discovery, identity mismatch or authentication failure reports unavailable without attempting another launch.

Provider and host lifetime are separated by a generic **integration runtime lease**. Hermes is the first adapter using it, not the lifecycle owner. While attached, each integration runtime renews its authenticated lease. A clean runtime shutdown first makes volatile adapter-owned source captures durable, then cleanly detaches that lease. The shared Rust host remains alive while any integration runtime lease exists; after the **last clean integration runtime exits**, and provided no unclean runtime fence still requires reconciliation, it stops accepting new work, closes Reliquary owners/workers normally and exits. An expired lease without clean detach is recorded as an unclean integration-runtime termination: the host remains running, persists an integration-scoped crash/reconciliation marker and fences only the affected copied-source continuity until that integration reconnects and resynchronizes. See [HP04 crash/reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md).

## Security and diagnostics

The binary binds `127.0.0.1` on an ephemeral port. Attach verifies protocol version, pinned Hermes revision, profile, principal, instance and lease identity. HTTP signatures authenticate the request body and response to a single instance and nonce. Service credentials stay outside the browser and do not travel in URLs, HTTP headers, process arguments or logs. The private provider token grants only the configured profile's operations. Local filesystem permissions govern access to the profiles, owner paths, and runtime files.

An authenticated `owner_status` request reports the bound REL's processing state and pending count. The provider lifecycle distinguishes connecting, attached, unavailable, non-primary and stopped. Diagnostics are fixed codes and omit private wire data. On startup failure, check the configured executable and owner kinds, then check whether a verified process already owns the lease. A different profile using the same writable REL must resolve that conflict before attaching.

## Copied-source operation

Setup records the profile's automatic capture cutoff in private `reliquary/capture-enrollment-v1.json`. An already configured profile enrolls at its first provider initialization after upgrade. Setup retries and owner changes reuse the recorded cutoff. Keep it with the profile's backups. If `source_capture_setup_required` persists, check the profile state and restore the enrollment record from a trusted backup. A missing or invalid record in a running provider disables new capture until the profile can reopen with valid enrollment. Recall remains available under its existing grants.

Automatic capture checks native original-creation and root provenance on the exact Hermes session row. It admits independent conversations created after enrollment. The compatibility gate pauses new capture on Hermes builds without the trusted history contract. Historical resumes, portable restores, copied branches and compression continuations are ineligible. A callback with a pre-enrollment message timestamp or a Hermes compression summary fails as a whole. The worker delivers previously persisted jobs under their original source identities.

After connecting owners, open **Sources → Import Existing Sessions** in Web or Desktop. Select specific conversations and an authorized General or project REL, then review and confirm. A staged receipt proves the source was accepted. Complete indicates that Root finished processing. The existing Root processing configuration applies. Re-selecting a completed import verifies its saved receipt against the authorized host, reconnecting if the manual worker stopped that host. A different owner, snapshot digest or receipt is rejected without requeueing. Desktop confirmation requires verified native mutation admission. The source export supports up to 128 complete text rows and reports unavailable when the conversation's stored identity or lineage cannot be represented safely.

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

Install the integration Python package in the pinned Hermes environment and stage the live dashboard manifest, router and bundle under the selected profile's user plugin directory. Enable the Reliquary plugin in that profile. Open an attached Hermes provider session to start the configured service. The dashboard discovers that service for the request's admitted profile. Select a configured REL or the active PHY. Enter a durably attached session ID to see status for its accepted REL. Use **Refresh owner data** after an owner cut changes.

The REL inspector shows Memory summaries, current payloads, available history and provenance, graph neighborhoods, current community metadata, and processing state. Session status shows the copied source head or tombstone and the latest recorded recall return when present. An absent or stale community partition and unavailable provenance fields appear as typed unavailable results. The active PHY has read capabilities only.

The graph’s **Display** menu controls edge brightness, node glow and bloom (1× defaults), territory shell opacity (30% default), community shell limit (default and maximum 128), and the camera center marker (off by default). **Animation** starts enabled with a 60-second delay; X and Z speeds default to 0 RPM, Y to 0.4 RPM, and random ranges and counterspin default off. Its controls include per-axis speed and range, reroll, reset motion, pause/start, and saving or restoring the view. Desktop preferences persist under the active Hermes profile, with saved views scoped to the authorized owner. When Web has no safe profile key, preferences use the current dashboard mount’s session store and end with that mount. The popovers inherit the active Hermes palette, remain within the viewport, and support outside-click dismissal and Escape with focus returned to the trigger.

## Limits

Graph retrieval follows Root's one-hop workflow. A selection that exceeds the requested result or wire bounds fails before a retrieval receipt is recorded. Dashboard writes require verified same-origin browser or native Desktop admission and the expected owner cut. Setup uses existing Root owners and registry routing. Hermes workspace names, display names and caller-provided owner IDs convey no routing authority.

## Related docs

- [Protocol and authority](protocol.md)
- [Pinned Hermes host audit](host-audit.md)
- [Verification and later gates](verification.md)

## Notes

The operator owns the configured owner paths and their backups. The service has no installer or supervisor in HP03. HP06 owns packaging and installation acceptance.
