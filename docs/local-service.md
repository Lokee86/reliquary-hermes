# Local Reliquary service and provider

## Purpose

Configure the standalone Hermes provider to attach to a local Reliquary service using existing 2.1 owners. The service owns writer leases and persistent session routing. Hermes owns its transcript and session lifecycle.

## Overview

The pinned Hermes `MemoryProvider` starts an attachment in a context-bound background thread. Its client validates discovery, authenticates the host and receives the durable session binding. The host mounts configured RELs for writing through public Root. Automatic personal-memory processing opens the registered PHY with a writer lease for the internal worker. Model-facing reads retain their separate grant. It exposes a provider channel with actual owner status. User edits belong to a separate dashboard channel.

Each configured profile has a separate local service and credential. Multiple sessions in one profile share the service. Each project REL is a distinct child of the main REL in the service registry. New sessions with trusted Hermes project attribution bind to the matching dedicated REL when one is configured. Other new sessions use General memory. The audited and installed Hermes hosts lack the attribution hook and use General for new attachments. The same explicit PHY selection can serve different bot profiles without changing the integration `user_id`.

## Configuration and setup

### Native hosts

The directory package is named `reliquary` on every surface. Its root entry registers the memory provider and lifecycle observer. The web router resolves the provider's dashboard module through Hermes. Use the native executable built for the same source revision as the plugin. [Native host workflow](../.github/workflows/native.yml)

Version 0.2.0 opens REL and PHY files with the retained history produced by Reliquary's offline 2.1 migration. Select the migrated REL and its paired PHY in Setup using the native host from this package. The bundled host opens the REL for normal writes and enables a PHY writer when an authorized PHY workflow is configured. [Bundled Core revision](../vendor/reliquary/SOURCE-PROVENANCE.md)

Setup and host startup may take over a minute on a large retained history. An owner open has a three-minute deadline. Setup can validate the files and start the service in one request.

The profile-bound Hermes worker provides ordinary/structured completions. A separately selected native Switchboard route provides embeddings using its existing protected configuration and key lifecycle. See the current [installation and disclosures](../README.md).

1. Install the Reliquary plugin and native host from the same revision. On Linux and macOS the catalog checkout selects a host under `plugins/reliquary/host/bundled/`. Existing profiles using the packaged path resolve the installed bundle on their next host start. Manual release archives provide the single executable in `host/`, and Windows uses the `.exe` in that directory. The runtime also accepts a separately configured host path. [Platform installation](#platform-installation)
2. Select or create a General REL and active PHY. Either REL role accepts a verified REL 2.1 with any stored scope. Selecting an existing file keeps its original header and owner ID. New RELs for both roles report `unspecified`. A Hermes host with trusted session project attribution can select or create a dedicated REL for an active project. Stock Hermes shows saved project REL paths read-only and uses General memory for new conversations. Create Hermes projects through Projects or `hermes project create`, then refresh the list.
3. Review the setup and connect. Hosts with project attribution show a confirmation when projects will use General memory. Setup derives profile and service identity, validates owners through the Rust host, provisions a random credential in Hermes secret storage, and checks the signed host topology before selecting the provider. Run `hermes memory setup reliquary` for headless setup.
4. Start a Hermes session to attach the provider. Already attached sessions keep their accepted REL.

The current target uses stock Hermes v0.23.4 at `8fc0374447313e276f6b9a2764bfc750190c966a`. Hermes `ctx.llm` handles ordinary and structured completions. Select the separate native embedding route as described below. The local service token is independent transport authentication and remains required. Use the native host built from this same plugin revision.

For a unified directory installation, run `npm --prefix dashboard ci` and then `npm --prefix dashboard run build`. One build invocation produces the Web bundle and stylesheet and the Desktop entry from the same source tree. Install all five generated files together: `dashboard/dist/index.js`, `dashboard/dist/index.css`, `dashboard/dist/index.js.LEGAL.txt`, `desktop/plugin.js` and `desktop/plugin.js.LEGAL.txt`. Install the static `dashboard/manifest.json` and `dashboard/plugin_api.py` alongside them. Install the provider Python files from `src/reliquary_hermes/` at the root of the existing `plugins/reliquary` package with its native manifest and host pin. Place the rebuilt host in `host/`. The catalog dashboard uses the `reliquary` plugin namespace. Enable that dashboard contribution in the profile and enable Reliquary in Desktop's Capabilities → Plugins.

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

### Platform installation

For catalog installs on Linux and macOS, Reliquary picks the native OS and CPU where the Hermes backend runs. Apple Silicon uses the ARM64 host under Rosetta. The first authenticated start removes the three unused executable files from the installed checkout. An interrupted cleanup can finish at a later start. Hermes may report those tracked deletions as local edits when it replaces the checkout during an update. Reinstall from the catalog after moving a pruned checkout to a different OS or CPU.

Use the following archives for a manual installation.

| Native bundle | Supported baseline | Archive |
| --- | --- | --- |
| Linux x86-64 | Ubuntu 22.04, glibc 2.35 | `reliquary-hermes-v<version>-linux-x86_64.tar.gz` |
| Linux ARM64 | Ubuntu 22.04, glibc 2.35 | `reliquary-hermes-v<version>-linux-arm64.tar.gz` |
| macOS Intel | macOS 15 | `reliquary-hermes-v<version>-macos-x86_64.zip` |
| macOS Apple Silicon | macOS 15 | `reliquary-hermes-v<version>-macos-arm64.zip` |

Other 64-bit GNU/Linux distributions can run the appropriate bundle with glibc 2.35 or later and the shared libraries listed in the release. Alpine/musl requires its own build. Keep the executable permission when extracting these archives. Unpack the `reliquary/` directory into the active Hermes profile's `plugins/` directory. On Windows, use the matching source package with `scripts/build-native.ps1` or the native artifact from the same revision. [Release downloads](https://github.com/Lokee86/reliquary-hermes/releases)

The macOS host uses an ad-hoc signature and is distributed without Apple notarization. Use the Terminal installation steps on the release page to download and check the ZIP before extracting it with `ditto`. A browser download can require a Gatekeeper approval on first use. [Apple’s Gatekeeper guidance](https://support.apple.com/en-us/102445)

### Native Switchboard embedding route

The native host reads `<hermes_home>/reliquary/processing.json` once at startup. Reuse an existing pointer without moving or rewriting its protected target; an existing absolute target outside the active profile is allowed. The pointer contains only:

```json
{"config_path": "C:/example/active-profile/reliquary/reliquary.cfg"}
```

`config_path` must name an existing absolute Reliquary CVCFG, not a JSON routes document. Its explicitly configured embedding slot uses Switchboard's `OpenAiReady` provider, the selected endpoint/model/dimensions/normalization, and an API-key credential already protected by Switchboard's encrypted configuration and OS key store. Query requests use `input_type=search_query`; document requests use `input_type=search_document`. Switchboard loads the embedding slot and its referenced API key. The native host uses the encrypted config and OS credential store to resolve the key. Hermes handles completions through the active profile's existing login.

To choose a different existing config, use Setup's embedding-config selection or run the ordinary setup command in the intended active profile:

```text
hermes memory setup reliquary
```

Supply the absolute, existing profile-local CVCFG at the embedding-config prompt; leave it blank to keep the current pointer. New selections must resolve inside that active profile. Use standalone Reliquary to provision and protect the API key at the intended CVCFG path before selecting it in Hermes. Use the CLI's explicit `--config` option. The encrypted config and its OS-store master key are tied to the canonical path. Setup verifies the route offline and saves the path in `processing.json`.

For route provisioning only, the standalone CLI accepts an explicit `--config` before `config`. This example changes an existing CVCFG's embedding slot and references an already provisioned Switchboard API-key credential; replace every example value with the service's actual contract. It is not necessary when reusing a configured route:

```text
reliquary --config "C:/example/active-profile/reliquary/reliquary.cfg" config model set-embedding --url https://inference.example.org/embeddings --model example-embedding --dimensions 1024 --normalization none --credential existing-embedding-key
```

Do not treat a standalone CLI-created default config as an embedding-only config or as automatically selected by Hermes. Use Switchboard's protected credential workflow if the referenced key needs provisioning; do not hand-author CVCFG bytes. The checked-in synthetic helper `tests/hosted_hermes_worker.py::configure_embeddings` demonstrates the explicit CLI path and route flags, not a user credential or a verified live-provider setup.

Restart the native host after setup, config changes, or credential repair/rotation; it does not hot-reload the selected route or key. Recheck status after restart. Missing pointer/embedding slot reports `embedding_unconfigured`; unreadable or invalid pointer/config/route reports `embedding_config_invalid`; unavailable protected credentials or OS-store key reports `embedding_credentials_unavailable`. A successful local config check is not proof that the remote provider accepts the key or supports both modes. Source staging, durable receipts and inspection remain available; semantic processing/recall stays pending or unavailable until the route is usable and its owner identity matches.

The implementation owners are `host/src/embedding_route.rs`, `src/reliquary_hermes/setup.py::configure_embedding`, and Switchboard's `protected_config.rs::ResolvedEmbeddingRoute` and `transport.rs::ConfiguredEmbeddingEndpoint` under `vendor/reliquary/crates/reliquary-switchboard/src/`. They are being developed separately from these docs. [Acceptance gates](verification.md#stock-hermes-native-embedding-target)

### Perception decision route

To enable Perception on the profile's writable RELs, add the explicit native decisions URL and the name of a credential already available in the Hermes profile's secret scope to `<hermes_home>/config.yaml`:

```yaml
reliquary:
  perception:
    decisions_url: https://inference.example.org/decisions
    credential_env: JEV_API_KEY
```

Use an HTTPS endpoint that serves `typesafe/jev-1.13`. Loopback HTTP is supported for local endpoints. Store the key value in Hermes secret storage. The worker sends it as the authorization header, bounds the reply, and checks the job's lease before return. The local broker receives only the route identity, model inputs, and result. Removing or invalidating the route pauses new Perception work. Ordinary processing and recall continue on Hermes's configured routes.

The worker binds Perception when the plugin starts, including when there is no active chat. It uses the registry's existing grants and writer leases for the authorized General and project RELs. Set `reliquary.phy_perception: true` beside the `reliquary.perception` route to also process the active PHY. This setting opens the active PHY with a writer lease. When Ego is enabled, both workers share that mount. Existing verified PHY claims remain eligible for recall on a read-only mount. A worker replacement, lost heartbeat or owner switch fences ongoing work through the managed runtime and owner grants.

## Lifecycle and recovery

The service takes an exclusive process lease before mounting owners. Core admits each owner once from its canonical path and holds the writer lease for each writable REL. First startup stages the mounts, checks any stored version 1 assignments against the admitted IDs, and records the accepted profile, principal, owner IDs, and paths in version 2 of `topology-v1.json`. `owners.json` supplies bootstrap configuration. On a configured restart, the accepted topology supplies the expected identities for those same mounts. Once the owners and grants are ready, the service publishes `discovery.json` atomically. An authenticated attach records the durable session route before returning its binding. Known sessions reuse their routes after restart.

Open Setup to switch the General REL, a trusted project's dedicated REL, or the active PHY. Select the files, review the exact owner assignments, then apply them together. Apply admits each new mount once and checks its reviewed owner ID against the leased header before installation. The same native service stays running. New sessions use the current assignments. Existing sessions keep their original REL and PHY. A displaced REL can keep its writer lease to serve those sessions and already accepted source work. If its file becomes unavailable, requests for the bound session report that owner as unavailable.

Switching the active PHY pauses Reliquary for sessions and queued source work tied to an inactive PHY. Selecting the original PHY again restores eligibility for those sessions and jobs. If work is still using the current grants, Setup reports `owner_switch_busy` and keeps the current assignment. If a reply is lost, reopen Setup to see the verified committed assignments. Use matching native, Python and dashboard revisions when upgrading an existing profile.

Back up `owners.json`, `provider.json`, `processing.json`, `topology-v1.json`, `sessions-v1/`, and `embedding-identities-v1/` with the matching owners and their usual Reliquary backups. Preserve immutable embedding markers and source/processing receipt files; do not delete or edit them to bypass compatibility. The embedding records are nonsecret identity evidence, not provider configuration. Back up the selected CVCFG and recover its protected key through Switchboard's existing lifecycle; the pointer alone cannot restore credentials. Keep the local service credential in Hermes secret storage. The lock file and `discovery.json` are runtime coordination data. A stale endpoint that refuses the connection permits a new candidate, which must acquire the lease and publish a new authenticated identity. A timeout, malformed discovery, identity mismatch or authentication failure reports unavailable without attempting another launch.

Provider and host lifetime are separated by a generic **integration runtime lease**. Hermes is the first adapter using it, not the lifecycle owner. While attached, each integration runtime renews its authenticated lease. A clean runtime shutdown first makes volatile adapter-owned source captures durable, then cleanly detaches that lease. The shared Rust host remains alive while any integration runtime lease exists; after the **last clean integration runtime exits**, and provided no unclean runtime fence still requires reconciliation, it stops accepting new work, closes Reliquary owners/workers normally and exits. An expired lease without clean detach is recorded as an unclean integration-runtime termination: the host remains running, persists an integration-scoped crash/reconciliation marker and fences only the affected copied-source continuity until that integration reconnects and resynchronizes. See [HP04 crash/reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md).

## Security and diagnostics

The binary binds `127.0.0.1` on an ephemeral port. Attach verifies protocol version, pinned Hermes revision, profile, principal, instance and lease identity. HTTP signatures authenticate the request body and response to a single instance and nonce. Service credentials stay outside the browser and do not travel in URLs, HTTP headers, process arguments or logs. The private provider token grants only the configured profile's operations. Local filesystem permissions govern access to the profiles, owner paths, and runtime files.

An authenticated `owner_status` request reports the bound REL's processing state and pending count. The provider lifecycle distinguishes connecting, attached, unavailable, non-primary and stopped. Diagnostics are fixed codes and omit private wire data. On startup failure, check the configured executable and owner kinds, then check whether a verified process already owns the lease. A different profile using the same writable REL must resolve that conflict before attaching.

## Copied-source operation

Setup records the profile's automatic capture cutoff in private `reliquary/capture-enrollment-v1.json`. An already configured profile enrolls at its first provider initialization after upgrade. Setup retries and owner changes reuse the recorded cutoff. Keep it with the profile's backups. If `source_capture_setup_required` persists, check the profile state and restore the enrollment record from a trusted backup. A missing or invalid record in a running provider disables new capture until the profile can reopen with valid enrollment. Recall remains available under its existing grants.

### Automatic capture and PHY processing

Automatic capture checks native original-creation and root provenance on the exact Hermes session row. It admits independent conversations created after enrollment. The compatibility gate pauses new capture on Hermes builds without the trusted history contract. Historical resumes, portable restores, copied branches and compression continuations are ineligible. A callback with a pre-enrollment message timestamp or a Hermes compression summary fails as a whole. The worker delivers previously persisted jobs under their original source identities.

With the [completed-turn attribution capability](host-audit.md#source-identity-and-copy-limitations), authenticated local owner turns can publish project Memories into the session REL and personal Memories into its registered PHY. Restart the local service after enabling this Hermes capability, so it opens the PHY with the internal writer grant. Copied jobs retain the signed session's original PHY and resume there after a switch back and reauthorization. The job settles the personal Memories in the PHY for ordinary recall before reporting completion. Unknown, foreign, bot and older authors cannot authorize personal filing. Their personal proposals are held and signed source status reports `source_personal_attribution_unverified`. A held episode follows the existing native import fence for its REL.

### Manual history import

After connecting owners, open **Sources → Import Existing Sessions** in Web or Desktop. Select specific conversations and an authorized General or project REL, then review and confirm. A staged receipt proves the source was accepted. Complete indicates that Root finished processing with Hermes completions and Switchboard embeddings. Re-selecting a completed import verifies its saved receipt against the authorized host, reconnecting if the manual worker stopped that host. A different owner, snapshot digest or receipt is rejected without requeueing. Desktop confirmation requires verified native mutation admission. The source export supports up to 128 complete text rows and reports unavailable when the conversation's stored identity or lineage cannot be represented safely.

The provider hands bounded, text-only Hermes egress to a context-bound worker. The worker persists jobs in the private `source-outbox-v1.sqlite3` and delivers them through the authenticated source channel. `source_capture_pending` is volatile. `source_queued_durable` indicates local persistence and `source_accepted_durable` indicates a verified native staging receipt. Processing can still be pending after staging. Preserve the outbox, `sources-v1/` and `integration-runtimes-v1.json` with the service and owner backups. The runtime registry records unresolved crash fences across host restarts.

Setup enables the directory plugin’s bundled observer, or the `reliquary-source-observer` entry point for a Python installation. It respects explicit plugin disables. Hermes records deletes and rewinds in the transcript transaction at the historical [committed removal pin](host-audit.md); the journal requires a Hermes build with committed transcript removals. On a host with that contract, the observer or the next running provider worker transfers those receipts to the durable outbox, including after a missed callback or a service outage. The worker prioritizes them over older copies. The adapter reports `source_removal_pending` during the wait for the owner's receipt and fences stale publication and provider recall.

Archive and restore keep the copy and its knowledge available. An acknowledged older archive tombstone remains terminal. The adapter holds an undelivered legacy archive intent until the live transcript or a newer committed receipt settles it.

Processing uses the profile-bound worker's `ctx.llm` for ordinary/structured completions and the native Switchboard route for embeddings. The optional native decision setting remains used for Perception Contribution and Verify. An unavailable or incompatible embedding route leaves semantic work visibly pending or unavailable without discarding the staged source receipt. Its key is read only by native Switchboard from the selected protected config, not from Hermes's completion credentials.

Recovery replays the Hermes removal journal and work that reached the outbox. A committed rewind retains the surviving prefix and resumes capture at the acknowledged new source head. If Hermes disappears without a clean detach, the host records an unclean runtime. On reconnect, the affected source remains reconciliation-required until a supported provider transcript snapshot proves continuity. The next normal `sync_turn(..., messages=...)` can provide that snapshot, and stable source IDs and timestamps permit deduplication. Edited or ambiguous overlaps remain fenced pending authoritative reconciliation.

## Recall and model tools

Recall uses the same split runtime as processing: Hermes-backed structured/ordinary decisions and the explicitly selected native Switchboard embedding endpoint. No separate retrieval completion route is selected from the CVCFG. Before vector publication, the durable identity binds provider plus endpoint hash, model, dimensions, query/document input modes, and normalization. Credential renewal alone does not change that identity, but the native host must restart to load repaired or rotated credentials.

The host binds the owner to its embedding identity before vector publication. An owner with vectors and no marker reports `embedding_identity_unbound`. A differing marker reports `embedding_identity_stale`. Inspection and receipt verification remain available.

To reprocess, first keep the old REL, its identity marker, and its source receipts. Create a new REL and select it in Setup with the intended embedding route. For sessions this profile already staged, the existing receipts bind those sessions to the previous owner. Use a fresh Hermes profile with the required trusted history and export capabilities, restore the authorized original conversations through Hermes, and import them explicitly through **Sources → Import Existing Sessions**. Check each new receipt and wait for **Complete** on the new REL before relying on semantic recall.

Hermes can prefetch relevant Memories and verified Observations at turn start and call `memory_query`, `refine_query` and `traverse_graph` within that turn. The service binds retrieval to the session's REL and the profile's active PHY. Core ranks eligible Memories and verified Observations from both owners in one result limit. Each ranked hit identifies the owner and exact revision. The service withholds pending claims and invalidates prepared selections when the active PHY changes. Refinement uses the current turn's search ID, and traversal uses the returned Memory IDs and cut. The latest prefetch counts an Observation-only return as recall and labels the claims and their evidence references in context.

The host checks a 65-second deadline before recording an explicit return. One explicit recall can wait for in-progress prefetch within that budget. The provider client waits up to 67 seconds for the response. Model calls can include both an embedding and a decision. Automatic prefetch keeps a 6.5-second host delivery limit and a 7-second client wait within pinned Hermes' 8-second wait. Enable the `memory` toolset for the session to use explicit recall when automatic prefetch cannot return in time.

Queued prefetch can stage an exact selection in the host. When Hermes asks for matching context, the host checks the current cut and accepted copied-source evidence before recording the selected return. A source crash fence, rewind or tombstone prevents return of Memories grounded in the affected copied evidence.

## Live dashboard

Install the integration Python package in the pinned Hermes environment and stage the live dashboard manifest, router and bundle under the selected profile's user plugin directory. Enable the Reliquary plugin in that profile. Open an attached Hermes provider session to start the configured service. The dashboard discovers that service for the request's admitted profile. Select a configured REL or the active PHY. Enter a durably attached session ID to see status for its accepted REL. Use **Refresh owner data** after an owner cut changes.

The REL inspector shows Memory summaries, current payloads, available history and provenance, graph neighborhoods, current community metadata, and processing state. Session status shows the copied source head or tombstone and the latest recorded recall return when present. An absent or stale community partition and unavailable provenance fields appear as typed unavailable results. The active PHY has read capabilities only.

The graph’s **Display** menu controls edge brightness, node glow and bloom (1× defaults), territory shell opacity (30% default), community shell limit (default and maximum 128), and the camera center marker (off by default). **Animation** starts enabled with a 60-second delay; X and Z speeds default to 0 RPM, Y to 0.4 RPM, and random ranges and counterspin default off. Its controls include per-axis speed and range, reroll, reset motion, pause/start, and saving or restoring the view. Desktop preferences persist under the active Hermes profile, with saved views scoped to the authorized owner. When Web has no safe profile key, preferences use the current dashboard mount’s session store and end with that mount. The popovers inherit the active Hermes palette, remain within the viewport, and support outside-click dismissal and Escape with focus returned to the trigger.

### Graph rendering and bounds

The graph client loads every node chunk at every camera LOD when the manifest has at most 32 chunks and their combined encoded size is at most 16 MiB. Node visibility is independent of edge LOD. Detail edge chunks are used when their own count and byte limits fit. Otherwise the client uses the bounded overview and intermediate edge sets. Above the complete-node budget, overview uses a deterministic spatially distributed sample capped at 32 chunks and 16 MiB, reports “Showing X of Y memories,” and retains bounded point picking and direct lookup by Memory ID.

Each viewport schedules at most two chunk requests at a time to match native host admission. The client drops queued stale work, aborts stale in-flight work, and deduplicates matching chunk requests. A signed retryable overload response permits up to two retries within the original native request deadline. Decoded node and edge caches each cap at 32 MiB and 64 chunks.

## Limits

Graph retrieval follows Root's one-hop workflow. A selection that exceeds the requested result or wire bounds fails before a retrieval receipt is recorded. Dashboard writes require verified same-origin browser or native Desktop admission and the expected owner cut. Setup uses existing Root owners and registry routing. Hermes workspace names, display names and caller-provided owner IDs convey no routing authority.

## Ego on an opted-in profile

Set the profile to use the Reliquary directory plugin and its stock Context Engine. Use the existing Memory provider for retrieval.

```yaml
plugins:
  enabled:
    - reliquary
context:
  engine: reliquary-ego
memory:
  provider: reliquary
  memory_enabled: false
  user_profile_enabled: false
```

Restart the profile's Reliquary service after changing this setting. An opted-in launch mounts the active PHY as writable and admits the Ego controller for its exact owner. Ordinary Memory provider and dashboard grants still follow their established paths. The service drains the Ego worker before changing configured routes or switching owners. Hosted refresh and ordinary Memory recall require Hermes' embedding-capable plugin inference facade. Stock Hermes v0.23.0 provides the Context Engine hook and can render saved Ego records. The [verification procedure](verification.md#ego) also exercises the pinned revision with the embedding facade. The local pending-work database lives in the protected profile state directory. The host counts UTF-8 bytes conservatively for both request packing and the saved PHY cap. If a PHY draft exceeds the cap, one bounded hosted compression job can request up to four local counts and return one candidate for verification.

In the Inspector, open Ego to manage Identities and Pins and inspect the current or a retained summary revision. Each Pin edit uses its saved revision. Summary citations show the source revision and byte range. Open a cited Memory in the selected owner with its source link. Web and supported native Desktop writes use the existing authenticated same-origin or verified native admission. The plain Web read path works on stock Hermes.

Use `/identity <replacement text>` to preview a change to the active Identity. The command returns a short-lived approval bound to the exact draft, current revision, PHY, and session. Use the displayed `/identity approve <ticket>` command to save it once. Create and select the initial Identity in the Inspector.


## Related docs

- [Protocol and authority](protocol.md)
- [Pinned Hermes host audit](host-audit.md)
- [Verification and later gates](verification.md)

## Notes

The operator owns the configured owner paths and their backups. The service has no installer or supervisor in HP03. HP06 owns packaging and installation acceptance.
