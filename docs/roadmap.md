# Reliquary integration roadmap

## Deferred service lifecycle features

### Configurable queued-work keepalive

**Status:** future feature; explicitly not required for HP04/HP05/hackathon acceptance.

Current milestone behavior is integration-agnostic:

- unclean integration-runtime crash -> Rust Reliquary host stays alive for that integration's recovery/reconnect;
- clean runtime detach -> host remains alive while any other runtime lease exists;
- after the **last clean integration runtime exits**, the host exits gracefully unless an unclean runtime fence still requires reconciliation;
- durable pending Reliquary work may resume on the next start.

Future configuration should allow operators to choose a keepalive policy after the **last clean integration runtime exits** while Reliquary still has queued or running work.

Candidate policy shape:

- `shutdown_with_last_runtime` — current/default behavior;
- `drain_then_exit` — keep host alive only until eligible queued work drains or reaches a terminal/held state;
- potentially `stay_running` for operator-managed deployments.

Before implementation, define:

- which Reliquary queues/processors count as active work;
- maximum drain/idle bounds;
- behavior for held/failed/provider-dependent jobs;
- interaction with writer leases and restart;
- dashboard/status representation;
- operator shutdown override.

Do not add this policy opportunistically during HP04. It belongs to a later service lifecycle/configuration phase.

## Deferred REL scope retirement (core architecture)

**Status:** deferred. ADR 0029 (accepted 2026-09-04) requires homogeneous RELs and a dependency DAG. The rebuilt core still persists legacy `OwnerScope` values, and this Hermes integration historically rejected project-scoped RELs as General memory.

**Immediate bridge:** The Hermes host now accepts **any valid legacy REL scope in the General slot** while preserving all existing owner identity, format, PHY, project route, writer grant and topology checks. Dedicated project entries retain their existing scope check for now. The bridge is not a new REL class or a migration.

**Full correction:** The authoritative roadmap is `C:\!bin\workspace\Reliquary\docs\rel-homogeneity-and-dependency-roadmap-2026-11-10.md`. Inventory and remove behavioral scope predicates from core and host adapters, preserve legacy owner file compatibility, and verify/restore explicit multi-parent inter-REL dependency DAG semantics. No core change or on-disk rewrite is authorized as part of the Hermes test workaround.

## Purpose

Record deferred integration lifecycle and REL-homogeneity work outside the current acceptance scope.

## Overview

Current deferred items are configurable queued-work keepalive and the core REL-scope/homogeneous-dependency correction. Neither is part of the immediate Hermes compatibility patch.

## Related docs

- [Local service guide](local-service.md)
- [Verification guide](verification.md)
- [Maintainer map](maintainer-map.md)

## Notes

These roadmap entries do not authorize the deferred architectural work during the current Hermes compatibility patch.