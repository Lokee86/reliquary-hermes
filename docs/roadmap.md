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

## REL homogeneity

Core creation uses the neutral 2.1 header value. Hermes accepts any verified REL 2.1 as General or dedicated project memory and keeps the original owner identity and stored scope. Explicit configuration and trusted attribution supply the role and routing. The [local service guide](local-service.md#configuration-and-setup) describes setup and matching the Python and native revisions.

The [vendored Core revision](../vendor/reliquary/SOURCE-PROVENANCE.md) includes the durable REL dependency port. Those declarations belong to the owner files. Hermes project assignments belong to the profile configuration.

## Live owner switching

Setup can switch General and dedicated project RELs and the active PHY on a running service. Accepted sessions and queued imports keep their original owner bindings. See the [live switching design](hermes-live-owner-switching-spec-2026-11-18.md) and [verification](verification.md#live-owner-switching).

## Dashboard rebuild

The current dashboard uses the shared React interface and Warlock graph renderer in Web and Desktop. The rebuild retains the provider, Setup and Sources contracts. Graph-capable hosts use authenticated binary transport. See the [dashboard rebuild design](warlock-ui-hard-cut-rebuild-spec-2026-11-10.md) and [verification guide](verification.md).

## Purpose

Record pending service lifecycle features and the status of owner setup and the dashboard rebuild.

## Overview

Configurable queued-work keepalive remains a proposed service feature. The local service and verification guides describe the behavior available today.

## Related docs

- [Local service guide](local-service.md)
- [Verification guide](verification.md)
- [Maintainer map](maintainer-map.md)

## Notes

See the local service and verification guides for the current owner setup contract and accepted checks.
