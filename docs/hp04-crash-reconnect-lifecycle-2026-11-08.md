# HP04 crash/reconnect lifecycle and resynchronization

**Date:** 2026-11-08

**Status:** HP04 accepted locally on stable Hermes v0.23.0. See the [verification record](verification.md#hp04-stable-host-and-runtime-verification).

## Purpose

Define how the local host distinguishes clean adapter shutdown from a crash and recovers copied-source continuity.

## Overview

Hermes v0.23.0 delivers completed conversation state and lifecycle events to Reliquary through provider callbacks. Once a callback reaches Reliquary's durable source outbox, HP04 already provides replay, idempotency and tombstone protection.

One narrow crash window remains: Hermes may commit transcript or lifecycle state and terminate before the provider callback reaches Reliquary. The plugin does not need a transactionally coupled upstream event journal for the current milestone. It does need to know that the Hermes runtime disappeared uncleanly so it does not silently treat its copied source state as current.

The local Rust Reliquary host must also have an integration-agnostic process lifecycle:

- survive an unclean integration-runtime crash so it can retain owner state and recovery context;
- shut down gracefully after the **last clean integration runtime exits**, provided no unclean runtime fence still requires reconciliation;
- allow any supported integration to reconnect and reconcile its own source scope.

Hermes is the first integration using this lifecycle; it must not become the ownership model for the host itself.

## Target Architecture

Add a generic **integration runtime lease** between an adapter/provider runtime and the Rust Reliquary host.

A runtime registers/renews a lease while attached. The host persists enough runtime/source status to distinguish a clean detach from lease expiry. Each lease identifies its integration kind and opaque runtime instance independently of Hermes profile/session concepts.

### Clean lifecycle

1. An integration runtime starts.
2. Its adapter attaches and obtains a runtime lease ID.
3. The adapter renews the lease while alive.
4. Clean runtime shutdown first makes any volatile adapter-owned source captures durable, then sends an authenticated clean detach for its exact lease.
5. The host retires that lease.
6. When the **last live integration runtime lease** is cleanly retired and there is no unresolved crash-recovery fence, the host stops accepting new work, closes Reliquary owners/workers cleanly and exits.

A session/provider/adapter eviction must not kill a shared host while any other integration runtime lease still exists. The host lifecycle is therefore not keyed to Hermes, a Hermes profile, or any single adapter.

### Crash lifecycle

1. An integration runtime commits whatever upstream state it owns.
2. That runtime/process disappears without clean detach.
3. Its heartbeat/runtime lease expires.
4. The Rust host **does not exit**.
5. The host persists an unclean-runtime/crash marker scoped to that integration/runtime and fences only the affected copied-source state as reconciliation-required/uncertain.
6. Stale copied evidence is not presented as proven current across that crash boundary.
7. A later instance of that integration reconnects with a new lease.
8. Its adapter/service enters resynchronization for the affected source scope.
9. Integration-specific authoritative evidence is reconciled using that adapter's stable source identities and the existing Reliquary overlap/idempotency rules.
10. Once current source continuity is accepted, that integration's crash fence is cleared for the reconciled scope.

For the Hermes adapter specifically, the authoritative evidence is the permitted transcript snapshot with stable Hermes message IDs/timestamps.

If immediate full transcript evidence is not available at provider initialization, the scope remains reconciliation-required until a supported provider callback supplies it. Do not read Hermes SQLite directly or fabricate source identity to clear the fence.

## Implementation Decisions

### Runtime lease

The lease is separate from:

- the existing Rust service process lease;
- Root writer leases;
- session-to-REL routing;
- source-generation/tombstone state.

It represents the liveness of one external integration runtime attachment.

Each lease has:

- opaque lease ID;
- integration kind/namespace;
- opaque runtime instance ID;
- authenticated principal/adapter scope;
- attached source/session identity where applicable;
- last renewal time;
- clean/unclean terminal state.

Hermes profile/session fields belong inside the Hermes adapter's scope; they are not fields required of every future integration.

All renew/detach operations use the existing authenticated loopback transport.

### Heartbeat

Use a low-rate bounded heartbeat. Exact interval/expiry values are implementation constants with tests; they are not product semantics.

A temporary delayed heartbeat does not immediately destroy data. Expiry marks the runtime unclean and requires reconciliation.

### Crash marker

The host records the crash marker durably before treating the source as uncertain.

The marker does not claim which Hermes event was missed. It records only that Reliquary cannot prove source continuity after its last accepted state.

### Resynchronization

Use existing HP04 source-copy machinery:

- stable `message_uid`;
- persisted timestamps;
- canonical source digest;
- overlap/predecessor verification;
- idempotent receipts;
- terminal anti-resurrection fences.

The normal `sync_turn(..., messages=...)` callback provides the provider-authoritative permitted transcript view when it next occurs. Reconciliation deduplicates already accepted rows and imports only valid new source state.

A crash does not clear an existing archive/delete tombstone.

### Clean host shutdown

The Hermes provider uses the runtime lease contract to drain its captures and retire its lease during shutdown.

On clean integration-runtime shutdown:

1. persist volatile adapter-owned source captures to durable storage;
2. stop accepting new work for that runtime instance;
3. send clean detach for its runtime lease;
4. allow the host to exit only after the **final live integration runtime lease** is gone and no unclean runtime fence requires recovery;
5. host closes Reliquary state through normal shutdown/drop paths.

The Hermes provider implements this generic detach contract from `provider.shutdown()`; future integrations use the same host lifecycle contract.

Pending durable Reliquary work does **not** keep the host alive in this milestone. Durable work resumes on the next start.

## Testing Decisions

### Clean shutdown

Prove:

- one provider cleanly detaches;
- shared host remains while another live lease exists;
- final clean detach causes graceful host exit;
- discovery is removed/invalidated appropriately;
- owner/write leases are released;
- volatile callback work is durably queued before detach;
- restart resumes durable work.

### Crash

Kill the Hermes/provider process without shutdown and prove:

- Rust host remains running;
- runtime lease expires;
- crash marker is durable;
- affected source becomes reconciliation-required;
- stale source replay cannot advance across the crash fence;
- host remains attachable by the next Hermes process.

### Reconnect/resync

Prove:

- new provider obtains a new lease;
- same session retains existing REL/PHY routing;
- next full provider transcript snapshot reconciles by stable IDs/timestamps;
- exact old rows do not duplicate;
- new rows import once;
- crash fence clears only after accepted reconciliation;
- existing tombstones remain terminal;
- restart during reconciliation remains safe.

### False-positive resilience

Prove:

- delayed heartbeat within allowed bounds does not create duplicate crash epochs;
- clean detach followed by host shutdown is not recorded as a crash;
- stale detach/heartbeat from an older lease cannot affect a replacement lease.

## Out of Scope

- a transactionally coupled Hermes provider feed;
- guaranteed recovery of every event committed before a process crash;
- reading Hermes private SQLite from the plugin;
- changing Hermes core for this recovery path;
- provider/model success accounting;
- Reliquary compaction/Ego/Context Engine integration.

## Known v1 Limitation

If Hermes commits an event and dies before the corresponding provider callback, Reliquary may not know the exact missing event. The crash marker prevents silent continuity claims. Reconciliation recovers whatever the next supported full provider transcript can prove. Events no longer representable through that source view remain an explicit recovery limitation.

## Future Roadmap Dependency

A future service-lifecycle feature may optionally keep the Rust host alive after the **last clean integration runtime exits** while Reliquary still has queued/running work. That policy is explicitly deferred and must be configurable; it is not part of HP04 acceptance.

## Completion Gates

HP04 crash recovery is accepted when:

- crash and clean shutdown are distinguishable;
- unclean integration-runtime termination leaves the Rust host alive;
- crash state is durable, integration-scoped and fences only the affected copied-source continuity;
- reconnect starts reconciliation without changing owner routing;
- a valid subsequent integration-specific source snapshot can clear the relevant crash fence;
- the last clean integration-runtime detach shuts the host down gracefully;
- all behavior is proven against the pinned stable Hermes v0.23.0 host;
- no upstream durable-feed or maintainer-approval dependency remains.

## Related docs

- [Local service](local-service.md)
- [Protocol and authority](protocol.md)
- [Verification](verification.md)

## Notes

The stable host audit owns the exact Hermes source and lifecycle interfaces used by the adapter.
