# Local Reliquary service and provider

## Purpose

Configure the standalone Hermes provider to attach to a local Reliquary service using existing 2.1 owners. The service owns writer leases and persistent session routing. Hermes owns its transcript and session lifecycle.

## Overview

The pinned Hermes `MemoryProvider` starts an attachment in a context-bound background thread. Its client validates discovery, authenticates the host and receives the durable session binding. The host mounts configured RELs for writing through public Root and mounts the selected PHY read-only. It exposes a provider channel with actual owner status. User edits belong to a separate dashboard channel.

Each configured profile has a separate local service and credential. Multiple sessions in one profile share the service. Each project REL is a distinct child of the main REL in the service registry. A configured project session binds to that child. Other sessions bind to the main REL. The same explicit PHY selection can serve different bot profiles without changing the integration `user_id`.

## Configuration and setup

1. Build the Rust executable with `cargo build --manifest-path host/Cargo.toml --locked --offline`. Use the sibling product revision in the verification guide.
2. Identify an existing main REL with a non-project scope, an existing active PHY, and a project-scoped REL for each project. Create new owners with the product CLI if needed. The provider setup opens explicitly configured files.
3. In a profile where the pinned Hermes revision has discovered the standalone provider, run `hermes memory setup` and select Reliquary. Enter the profile ID, authenticated principal ID, main REL path, active PHY path and absolute host binary path. The setup hook provisions a random profile credential through the Hermes secret writer and activates the provider after saving the configuration.
4. Configure project entries in the private `owners.json` before starting the service. Map the exact Hermes session IDs that belong to those projects. Start a new Hermes session and wait for provider attachment.

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

Provider shutdown discards its local binding and leaves the shared service available for other sessions. To stop an operator-managed service, use its process supervisor. The service holds its writer leases until it exits. Configure session-to-project assignments before that session's first attachment, and restart the service to load configuration updates.

## Security and diagnostics

The binary binds `127.0.0.1` on an ephemeral port. Attach verifies protocol version, pinned Hermes revision, profile, principal, instance and lease identity. HTTP signatures authenticate the request body and response to a single instance and nonce. Service credentials stay outside the browser and do not travel in URLs, HTTP headers, process arguments or logs. The private provider token grants only the configured profile's operations. Local filesystem permissions govern access to the profiles, owner paths, and runtime files.

An authenticated `owner_status` request reports the bound REL's processing state and pending count. The provider lifecycle distinguishes connecting, attached, unavailable, non-primary and stopped. Diagnostics are fixed codes and omit private wire data. On startup failure, check the configured executable and owner kinds, then check whether a verified process already owns the lease. A different profile using the same writable REL must resolve that conflict before attaching.

## Copied-source operation

The provider hands bounded, text-only Hermes egress to a context-bound worker. The worker persists jobs in the private `source-outbox-v1.sqlite3` and delivers them through the authenticated source channel. `source_capture_pending` is volatile. `source_queued_durable` indicates local persistence and `source_accepted_durable` indicates a verified native staging receipt. Processing can still be pending after staging. Preserve the outbox and `sources-v1/` with the service and owner backups.

Setup enables the ordinary `reliquary-source-observer` companion unless the profile explicitly disables it. The observer records committed deliberate archive and delete notifications even when the service is down. The next running provider worker prioritizes that terminal intent over older copies. An existing native import epoch must settle before Root can write its tombstone. The host still denies replay during that wait. A terminal fence does not schedule new extraction for a stopped import.

To enable native processing, create a private `<hermes_home>/reliquary/processing.json` containing `config_path` set to the absolute path of an existing Reliquary binary configuration. Configure the required processing routes through Reliquary. The host uses those routes for REL-only work. A profile without processing configuration can stage a copy, and its import may remain open.

Recovery replays work that reached the outbox. The audited Hermes export redacts differently from the provider egress and can include rows without a completed text-only callback. Missing callbacks and terminal notifications therefore remain unavailable for catch-up. The pinned Gateway and dashboard deliberate delete paths reach the post-commit observer. Dispatch can fail open, so a delivered notification is the boundary of automatic recovery. Same-session rewind and edited or ambiguous overlaps remain fenced pending authoritative reconciliation.

## Dashboard owner discovery

Install the integration Python package in the pinned Hermes environment and stage the live dashboard manifest, router and bundle under the selected profile's user plugin directory. Enable the Reliquary plugin in that profile. Open an attached Hermes provider session to start the configured service. The dashboard discovers that service for the request's admitted profile and lists configured owners. Enter a configured project session ID or a durably attached general session ID to resolve its REL.

## Limits

Recall, prefetch and model tools begin in HP05. Dashboard mutations require the later authenticated user channel. Setup uses existing Root owners and registry routing. Hermes workspace names, display names and caller-provided owner IDs convey no routing authority.

## Related docs

- [Protocol and authority](protocol.md)
- [Pinned Hermes host audit](host-audit.md)
- [Verification and later gates](verification.md)

## Notes

The operator owns the configured owner paths and their backups. The service has no installer or supervisor in HP03. HP06 owns packaging and installation acceptance.
