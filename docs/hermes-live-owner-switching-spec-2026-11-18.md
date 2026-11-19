# Live owner switching in Hermes

## Purpose

Let a connected Hermes profile change its General REL, a dedicated project's REL, or its active PHY through Setup without restarting the native service. A switch changes assignments for future attachments and preserves the owner IDs on accepted sessions and source work.

## Overview

The host currently fixes owner grants at startup, pins one topology in `topology-v1.json`, and stores only the REL in each session route. On attach it takes the user ID from the profile's active PHY. Live switching requires an explicit assignment commit and a persisted REL/PHY pair for every accepted session. Use the existing Gateway and profile transport. The Hermes registry owns profile assignments, and Root owns file admission, mounts, leases, and owner grants.

## Operator behavior

| Setup change | First attachment after the switch | Existing session |
| --- | --- | --- |
| General REL | Unbound sessions without a configured trusted project match use the new General REL. | Keeps its original REL. |
| Dedicated project REL | Unbound sessions with that trusted project ID use the new dedicated REL. Other sessions use their normal routing. | Keeps its original REL, including a previously accepted General fallback. |
| Active PHY | The session binds to the new active PHY and the REL resolved by the current assignments. | The stored pair stays intact. Reliquary pauses for a session whose PHY is inactive and can resume when its original PHY is selected again. Hermes conversation history remains available. |

Reuse Setup's Select, Review, and Apply flow in Web and authorized Desktop. Review shows the changed assignments and explains their effect on the current session. A review may contain one or several changed roles. Apply commits the changes together. An omitted role keeps its assignment. Dedicated project additions and replacements use the same operation with a verified active Hermes project ID. The current trusted project-attribution check governs project controls and new routing.

## State and authority

- **Assignments.** Use a v2 record at the existing `topology-v1.json` location as the host-owned commit point. Store the profile and principal, the assignment generation, the current General/PHY/project role IDs, and the verified canonical paths and kinds keyed by owner ID. Retain displaced REL paths and the roles in which they were accepted. A project display parent follows the current General REL. REL dependency declarations belong to their owner files.
- **Session bindings.** Persist the exact REL ID and PHY ID before acknowledging a new attach. Continue reading existing `sessions-v1` records using the original accepted topology's PHY ID and REL assignments. Capture that baseline once in v2 before any role changes. Keep existing route files and their stable lookup keys. Route validation checks the accepted assignment history and the exact session ID. If its original PHY is inactive or its REL unavailable, return a typed unavailable result with no fallback attachment.
- **Mounts and grants.** Keep one Gateway and one mount per owner ID. Retain displaced RELs so accepted sessions and source work can continue on their original writers. A retained REL may still have a writer lease after it stops being a default. Scope access to a validated session or previously accepted source operation. Offer current role owners for new manual imports. Mount the selected PHY read-only, grant access only to the active PHY, and release the previous PHY when the switch completes. When a retained REL cannot reopen, report its bound sessions as unavailable and continue serving verified current roles.
- **Request authority.** Replace the service's startup-only Instance and configuration fingerprint with the Registry's current, generation-bound view for owner requests. Stage and revoke the provider and dashboard Root admissions through the existing controls. Use a service-private in-memory credential for these admissions so rotation does not extend the Hermes profile secret's lifetime. Derive dashboard user identity from the committed PHY. Bind recalls, capture, dashboard reads and writes to the relevant authorized owner and session pair. Refresh affected graph, selection and retrieval state through the existing invalidation paths. Keep the profile credential, signed discovery, process lease and inference worker registration.
- **Source continuity.** Keep accepted work bound to its original REL and PHY across switches and restarts. Automatic capture uses the stored session binding. Pin the PHY at selection for queued manual imports and retain it in the host's accepted source state. Resolve pre-upgrade work through the pinned v1 PHY. Pending work for an inactive PHY stays queued until its original authority is active. Preserve import receipts, terminal events and the profile's capture-enrollment cutoff.

## Switch and recovery

1. Shared Python Setup verifies the authenticated profile, applies existing Web or native admission and managed-profile checks, and resolves the approved project IDs. The signed native review returns current generation and verified candidate IDs and paths. The apply request carries that generation and the reviewed role changes. The host validates paths and kinds again and compares the actual opened mount's owner ID with the review. The current mount supplies verified evidence for a known owner at its accepted canonical path.
2. Serialize Apply with owner request admission, binding publication and service shutdown. If an in-flight request or native owner job still relies on the old grants, return a retryable busy result before publishing. Work that has only been queued retains its original binding. Use the existing source-job and recall lifecycle to enforce that boundary. Keep heartbeat and inference replies available while the switch is pending. An attach racing Apply receives exactly one complete assignment generation.
3. Stage the new mounts and replacement Root grants before publication. Refuse unavailable writers, duplicate current assignments, or a different path for an already registered owner ID. A stale generation requires a fresh review. Selecting the same accepted owner and canonical path is a no-op. Release staging on failure, including any acquired leases.
4. Atomically replace and sync the accepted topology, publish that generation in the live Registry, revoke superseded grants, and release the old read-only PHY before acknowledging success. If disk publication is uncertain, fence owner operations until the host can verify and finish the committed generation or reopen the previous one. A client that loses the reply reads the committed assignments before retrying. Restart verifies stored paths against committed IDs and recovers from that same record.

## Compatibility and migration

On upgrade, read the accepted v1 topology and its existing `owners.json` paths under the service lease. Verify the pinned owners before writing v2. Keep `owners.json` as bootstrap input and use the committed native topology for current assignments, including Setup status on a stopped profile. Starting with a different path or ID in bootstrap configuration cannot retarget an accepted profile. Existing project setup applies through the same reviewed switch path. Use the existing setup lock to start an accepted profile when needed.

Version the host-owned record at its original path so an older native host rejects upgraded state. Ship the matching native host, Python setup and dashboard together. Keep REL/PHY 2.1 headers, owner IDs, session binding response fields, receipts and owner-local history. The switch changes the accepted configuration directly. Moving sessions or owner data, retiring retained RELs, and cleaning up the retrieval receipt bridge have their own scope.

## Implementation plan

| Order | Change and exit check |
| --- | --- |
| 1. Core lifecycle | Reuse the public Root mount and grant APIs. Add a narrow trusted-host operation for detaching a read-only PHY using Gateway's existing quiesce path. Use existing REL management quiesce to discard staging. Verify a failed stage leaves existing mounts intact, then pin the accepted Core source in Hermes. |
| 2. Registry and service | Implement the v1 reader, v2 config and route commit, retained REL resolution, and serialized switch. Move owner dispatch, dashboard scope, source acceptance and recovery onto the live grant and binding checks. Check the old and new routes through attach and restart. |
| 3. Setup and UI | Use shared Setup review/apply on all supported surfaces. Update Python's status and outbox, and refresh the displayed assignment and session after apply. Reuse the existing picker, project capability, confirmation and error presentation. |
| 4. Integrate | Build the matched package, run the focused cases and applicable suite checks, and update the service, protocol and maintainer docs with the measured result. |

## Focused verification

- Extend `host/src/registry_tests.rs` with a v1 profile and bound General and project sessions. Switch both REL roles with the same PHY and verify old sessions remain usable on their original RELs. Switch the PHY, prove old-session access is paused, then switch back and reopen. Use the same fixture for stale review, a contended writer and one failed or interrupted publication.
- Extend `tests/test_hp03_host.py` with a signed Setup/attach run on one native process. Confirm the same service identity across Apply, the persisted route after restart, and an inactive PHY session and queued source job blocked without rerouting. Extend the existing Setup admission test for a foreign profile or an unauthorized surface.
- Exercise the shared dashboard review against a real isolated Setup session and check the recognized current session binding after refresh. Run the repository's required locked Rust, Python and dashboard checks once at integration. Use disposable RELs and PHYs and compare the compatibility fixtures' owner IDs and headers.

## Related docs

- [Local service and profile lifecycle](local-service.md)
- [Signed transport, setup and owner scope](protocol.md)
- [Project attribution and release behavior](hu05-release-fallback-and-hermes-attribution-spec-2026-11-09.md)
- [Crash and reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md)
- [Verification](verification.md)
- [Vendored Core revision](../vendor/reliquary/SOURCE-PROVENANCE.md)

## Notes

This proposal starts from Hermes `856cb61` and Core `76c9e085`. It follows Core's ADR 0038 on a shared Gateway and one authorized PHY per Instance, preserved in Core Git at `f431401e`. A release is complete when all three role changes work through the authorized Setup path without restarting, old bindings and durable source work recover consistently, and an inactive PHY cannot contribute private context or receive writes.
