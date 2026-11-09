# HU03 dashboard authorization decision

**Date:** 2026-11-08  
**Status:** approved v1 authorization model; implementation may proceed.

## Purpose

Define the trust boundary for the live Reliquary dashboard in Hermes.

## Overview

### Decision

HU03 does **not** require a new Reliquary user-account system, a separate dashboard credential, or separately provisioned owner grants.

Hermes already authenticates and profile-scopes dashboard plugin requests. The Reliquary dashboard backend is trusted server-side plugin code running inside that admitted scope. It may therefore use the Reliquary integration configuration for that verified Hermes profile to construct the UI authority context.

The browser is never an authority source.

## V1 mapping

For one authenticated dashboard request:

1. Hermes verifies the dashboard/plugin request and binds it to one Hermes profile/home.
2. The Reliquary dashboard backend resolves that profile's existing Reliquary integration configuration and private service credential.
3. The backend reads the **server-owned configured topology** already used by the integration:
   - main/general REL;
   - configured project child RELs;
   - configured session -> REL mappings;
   - active PHY.
4. Those configured owners are the complete owner universe exposed by `ui.owner_sessions` for that integration instance. Browser-supplied owner IDs cannot widen it.
5. The active PHY stable owner ID is the Reliquary **user identity** and supplies the UI `principal_id` for v1 user-origin provenance.
6. The Hermes profile/home is routing/authentication scope only. It is not the human identity and must not create or select a PHY.
7. The existing configured service principal/credential remains a private backend transport concern. It is not the UI principal and never reaches the browser.
8. Owner capabilities are derived server-side from owner kind and live implemented operations:
   - configured RELs may expose only the read/manage capabilities actually implemented and tested;
   - the active PHY is read-only in v1;
   - unsupported operations remain absent/false.
9. A mutation additionally requires Hermes-authenticated same-origin/sensitive-route admission. Hidden or disabled browser controls are not authorization.

## `ui.owner_sessions`

The first HU03 live slice is now unblocked.

The backend may return:

- every configured REL authorized by the selected integration instance;
- the active PHY if its view capability is available;
- the configured session -> REL map;
- the request/active session if it is present in that map.

No additional owner-grant database or provisioning step is required for v1.

## Authority boundaries

The following remain forbidden:

- treating `?profile=`, browser `profile_id`, `principal_id`, owner IDs or session IDs as grants;
- exposing the private Reliquary service credential to JavaScript;
- using the provider `ProfileGrant.authorize()` as dashboard authorization;
- deriving the human identity from Hermes bot/profile names or `agent_identity`;
- allowing a request scoped to one Hermes profile to open another profile's Reliquary configuration;
- exposing owner paths or arbitrary filesystem access.

The dashboard backend constructs `VerifiedUIContext` from Hermes-authenticated profile scope plus the existing server-owned Reliquary topology. It then uses the private service channel to execute the authorized operation.

## Future expansion

A future multi-user/remote deployment may add explicit per-human dashboard grants, roles or shared-owner ACLs. That is a separate product feature and is not required for the local single-user Hermes plugin milestone.

## Completion gate

HU03 authorization is no longer a design blocker. Implementation may proceed when:

- the plugin backend obtains verified Hermes profile scope from the host request;
- it resolves only that profile's Reliquary configuration;
- it constructs `VerifiedUIContext` from configured topology and active PHY;
- it keeps the service credential server-side;
- `ui.owner_sessions` proves browser owner/profile spoofing cannot widen the returned set.

## Related docs

- [Dashboard DTO contract](ui-contract.md)
- [Service protocol](protocol.md)
- [Stable Hermes audit](host-audit.md)

## Notes

The dashboard-v1 response returns the mapping for the requested or host-selected session. The first live slice accepts exact configured project sessions and durably attached general sessions. With no session selection it returns the configured owners and active PHY with null session fields.
