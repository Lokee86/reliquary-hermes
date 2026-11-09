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

## Purpose

Record deferred service lifecycle work outside the current acceptance scope.

## Overview

The only roadmap item here is configurable queued-work keepalive, explicitly deferred until a later lifecycle/configuration phase.

## Related docs

- [Local service guide](local-service.md)
- [Verification guide](verification.md)
- [Maintainer map](maintainer-map.md)

## Notes

This roadmap entry does not alter current milestone behavior or authorize implementation during HP04.