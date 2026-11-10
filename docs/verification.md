# Hermes integration verification and remaining gates

## Purpose

Record reproducible checks for the standalone provider and dashboard contracts.

## Overview

HP01 verifies the pinned Hermes interfaces and the Python provider, owner routing and copied-source fixtures. HP02 verifies the selected-return bridge, copied-source import and dashboard product operations through the public Root API.

## Standalone checks

From the plugin repository with Python 3.11+, pytest 9.1.x, jsonschema 4.x, the pinned Hermes runtime dependencies and the audited checkout available:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent-reliquary-hp01-v023'
python -B -m pytest -q --basetemp .pytest_tmp
git diff --check
```

The checkout must be at the exact SHA in [host audit](host-audit.md). Without `HP01_HERMES_CHECKOUT`, checkout-based probes skip explicitly. The Python suite uses deterministic inputs and keeps pytest state in this worktree. The shared documentation checker and commit comparison commands are in the [documentation policy](documentation-policy.md).

## Evidence covered

- Strict bounded request and response DTOs reject spoofed authority, extra fields, malformed wire data and mismatched IDs, cuts or provenance. Each selected Memory has one correlated source-provenance entry.
- Provider grants require authenticated profile and principal and a configured session REL. General and project sessions resolve independently of the active PHY. Profile/bot changes preserve the selected PHY's stable user ID. Only exact trusted attribution to that active human can route a source row to the PHY.
- The fixture queues a bounded copy of filtered source input with exact IDs and timestamps. Bound-source import verifies scopes, digests and row attribution without treating the current speaker as the author of earlier messages. Fixture receipts express replay and revision semantics in memory.
- Session/branch/rewind changes invalidate scoped recall. Explicit archive and delete mark the same session tombstone, stop recall and reject old or newly scoped replay. Transient invalidation rejects old source epochs after resync.
- The dashboard contract distinguishes candidate, selected and returned Memory sets and validates authorized REL/PHY scope, paging, cuts, tombstone state, user edits and bounded graph/provenance reads.
- Pinned host facts, dependency boundaries and lifecycle coverage are recorded in [host audit](host-audit.md).

Before HP01-R1, the integrated HP01 suite passed all 290 tests with the historical canary pin enabled. The shared minimal-profile documentation check and Git whitespace check passed.

The HP02 dashboard contract passed all 298 Python tests with the same Hermes pin. It verifies correction through an immutable successor, terminal results without synthetic body IDs, REL-only management authority, mutation cut advancement within one history generation, and community member paging at an exact generation.

## HP02 host and product facade verification

Use the sibling `Reliquary` checkout at `8363ec377f044c0e00a699266e14090284829477` and a Rust toolchain with the offline dependency cache available. From this repository in PowerShell:

```powershell
$hostScratch = Join-Path (Get-Location) 'host\.test-tmp'
New-Item -ItemType Directory -Force -Path $hostScratch | Out-Null
$env:TEMP = $hostScratch
$env:TMP = $hostScratch
$env:TMPDIR = $hostScratch
cargo fmt --manifest-path host/Cargo.toml --check
cargo test --manifest-path host/Cargo.toml --locked --offline -j 1
python -B ../Reliquary/scripts/check_architecture.py
```

The host proof seeds a Freshness-enrolled Memory through public Root import and processing. A deterministic loopback decision endpoint chooses the selection. Candidate and inspection reads leave the REL unchanged. Two concurrent calls share one return object and produce one content return. The Root historical proof counts one additional retained record. Exact replay through a newly opened Gateway preserves that proof and the resulting REL byte for byte. The negative cases cover a revoked credential, a truncated projection, mismatched delivery evidence and a selected Memory without Freshness enrollment.

The copied-source tests cover source identity, author and branch metadata, REL-only processing, foreign binding denial and terminal replay after reopen. The Root-only product tests cover checked creation, correction, retirement, association and community management. The mixed-write test reopens a single owner and replays four prior mutation receipts without changing its bytes. The maintenance regressions cover reference closure, pruning recovery and safe refusal when a rewrite or divergent merge cannot preserve write authority.

The local suites passed 8 Rust host tests, 668 product workspace tests, 17 CLI tests and 14 detached Root consumer tests. The architecture guard reported 23 production packages and 76 production dependency edges. The composed G4 gate passed two matching semantic runs and the separate cohort-dependent Root consumer test. Fresh processes checked 48 authored turns and recorded 27 CLI observations with unchanged source bytes. The runner checks both supported PHY reads and rejection when a CLI command targets the wrong owner kind.

The selected-return shim requires the exact preview and an accepted Freshness write for the whole selected set. A truncated projection or a selection containing an unenrolled Memory fails before content is released. Directly authored Memories, including correction successors, currently lack automatic Freshness enrollment. Community reads and rename require an accepted current partition. Exact source-turn bytes are available for authorized provenance, while extraction-quote offsets are unavailable. These acceptance runs used deterministic local endpoints.

From the sibling product root, use the existing offline G4, GM and P01 checks. The composed G4 script creates two fresh deterministic cohorts and exercises the real CLI and Root-only consumer in separate processes. All generated owner files and logs stay in the local repository.

```powershell
$productScratch = Join-Path (Get-Location) '.test-tmp\hp02-final'
New-Item -ItemType Directory -Force -Path $productScratch | Out-Null
$env:TEMP = $productScratch
$env:TMP = $productScratch
$env:TMPDIR = $productScratch
python -B scripts/check_architecture.py
cargo fmt --all --check
cargo fmt --manifest-path cli/Cargo.toml --check
cargo fmt --manifest-path tests/external-consumer/Cargo.toml --check
cargo check --workspace --locked --offline
cargo test --workspace --locked --offline -- --test-threads=1
cargo test --manifest-path cli/Cargo.toml --locked --offline -- --test-threads=1
cargo check --manifest-path tests/external-consumer/Cargo.toml --locked --offline
cargo test --manifest-path tests/external-consumer/Cargo.toml --locked --offline -- --test-threads=1
& ./scripts/run_g4_acceptance.ps1
```

## HP03 local process verification

Use the same pinned Hermes and Reliquary checkouts. The following Windows commands build the actual host and product CLI, then run the Python suite with all process proofs enabled. The local-service guide owns runtime setup. [Local service](local-service.md)

```powershell
$scratch = Join-Path (Get-Location) 'host\.test-tmp\hp03'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
$env:TMPDIR = $scratch
cargo fmt --manifest-path host/Cargo.toml --check
cargo test --manifest-path host/Cargo.toml --locked --offline -- --test-threads=1
cargo build --manifest-path host/Cargo.toml --locked --offline
cargo build --manifest-path ../Reliquary/cli/Cargo.toml --locked --offline --target-dir host/target
$env:HP03_HOST_BINARY = (Resolve-Path host/target/debug/reliquary-hermes-host.exe).Path
$env:HP03_RELIQUARY_CLI = (Resolve-Path host/target/debug/reliquary.exe).Path
$env:HP01_HERMES_CHECKOUT = 'C:\!bin\workspace\hermes-agent-reliquary-hp01-v023'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -B -m pytest -q --basetemp .pytest_tmp
python -B ../Reliquary/scripts/check_architecture.py
```

The process tests create native owners with the product CLI. They exercise startup, authenticated attachment to a running host, invalid credentials, competing processes, cross-profile writer denial, outage and restart. A real pinned Hermes setup hook provisions an isolated profile and the provider attaches to the Rust process and recovers after its exit. The HP03 test supplies no source rows and verifies that the REL stays unchanged. Separate profiles with distinct REL writers retain the same explicitly selected PHY identity. Unit tests cover stale attach completion, transport authentication and framing, durable registry conflicts and actual Root status.

The original HP03 gate passed 16 Rust tests and 311 Python tests with the historical canary pin and real-process probes enabled. The architecture guard reported 23 production packages and 76 production dependency edges. All runs used synthetic owners under the local plugin worktree.

## HP01-R1 stable host verification

The detached Hermes checkout resolves `v0.23.0` to `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`. The [host audit](host-audit.md) records the release provenance, the historical canary SHA and each relevant interface. The provider and lifecycle callback signatures stayed compatible, so the repin changes the exact revision without an adapter or fallback.

Run the standalone and HP03 process commands above from the repin worktree. The current HP04 product checkpoint is `b31aaee577fc0e1caa3b9d7913c18f8155c4f972` in the sibling `Reliquary` checkout. It descends from the earlier HP02 and HP03 proof base and supplies the copied-source public Root APIs for the stable rerun.

The integrated run with HP04 checkpoint `074d49b` passed 337 Python tests with zero skips. HP03 proved real setup and attachment, stable revision acceptance, historical revision and wrong credential rejection, duplicate writer and lease behavior, profile and owner routing, and restart recovery. The locked offline Rust host suite passed 18 tests, including exact-once selected returns and copied-source replay after reopen. Rust formatting and the product architecture guard passed. The latter reported 23 production packages and 76 dependency edges.

The pinned source probes reverified stable completed-turn identity, timestamps and copy redaction, cold observer discovery, committed archive and delete, affected IDs, and profile rebinding. The real HP04 process run reproduced a Windows long-path error after Root had staged a copy. The host now canonicalizes the receipt directory before the atomic rename. The same process test and a Windows regression for long receipt paths passed on rerun.

From the repin worktree, the bounded upstream dashboard checks passed 22 tests across two runs. They exercised manifest discovery, authenticated plugin routes, secondary-profile assets and secrets, the plugin WebSocket Host and Origin gate, and token-page CORS. The SDK version and globals were checked in stable source. The separate canonical archive and delete observer test also passed.

```powershell
$hermes = $env:HP01_HERMES_CHECKOUT
$scratch = Join-Path (Get-Location) 'host/.test-tmp/hp01-r1/dashboard'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
$env:TMPDIR = $scratch
$env:XDG_CACHE_HOME = $scratch
$env:HERMES_HOME = Join-Path $scratch 'hermes-home'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -B -m pytest -q -rs -p no:cacheprovider -c "$hermes/pyproject.toml" --basetemp .pytest_tmp `
  "$hermes/tests/hermes_cli/test_web_server.py::TestPluginAPIAuth" `
  "$hermes/tests/hermes_cli/test_web_server.py::TestDashboardPluginManifestExtensions" `
  "$hermes/tests/hermes_cli/test_web_server_plugin_secret_scope.py" `
  "$hermes/tests/hermes_cli/test_plugin_secondary_profile_host.py::test_browser_assets_follow_the_selected_profile"
python -B -m pytest -q -rs -p no:cacheprovider -c "$hermes/pyproject.toml" --basetemp .pytest_tmp `
  "$hermes/tests/hermes_cli/test_web_server_host_header.py::test_plugin_websockets_run_the_core_host_origin_gate" `
  "$hermes/tests/hermes_cli/test_web_server_host_header.py::test_token_page_and_route_map_are_not_cors_readable_from_another_local_port"
python -B -m pytest -q -rs -p no:cacheprovider -c "$hermes/pyproject.toml" --basetemp .pytest_tmp `
  "$hermes/tests/hermes_state/test_session_delete_hook.py::test_every_delete_and_archive_path_fires_once_after_commit"
```

## HP04 stable host rerun

HP04's implemented behavior was reverified against v0.23.0 with the HP03 build and Python commands above. The run included all three process tests in `tests/test_hp04_host.py`, plus the pinned egress and observer probes and durable outbox tests. Tests use synthetic owner files and deterministic loopback endpoints.

The run covered real provider delivery, completed native append, idempotent replay after restart before acknowledgment, late same-session rewind callbacks, committed archive and delete, bulk and lineage affected IDs, and rejection of stale work after a terminal fence. Prior HP04 product evidence includes 668 workspace tests and three detached Root processing tests for completed append and divergent maintenance replay. The independent Root extension proof uses `cargo test --manifest-path ../Reliquary/tests/external-consumer/Cargo.toml --locked --offline --test operational_processing`.

The stable-host compatibility gate is green for delivered source work. HP04 final acceptance remains provisional because stable Hermes supplies neither a provider-equivalent history export nor a durable lifecycle cursor for missed callbacks.

## HU01-R1 dashboard host acceptance

HU01-R1 passed in headless Chrome against Hermes `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`. The frontend came from that revision's source and npm lockfile, built with Node 26.0.0 and npm 11.17.0 in scratch under the dashboard worktree. The Python server came from the detached checkout.

The enabled profile discovered the Reliquary manifest, served the exact bundle and stylesheet, and opened `/reliquary` using SDK 1.1.0 and the host React instance. The smoke test exercised graph/list selection, project REL switching with an unchanged active PHY, the copied-source tombstone, and safe body text. The disabled profile withheld the tab and its assets. The fixture manifest has no API and an authenticated probe received 404. The 22 upstream Hermes checks above cover host plugin API auth and profile routing using Hermes test plugins. Reliquary owner authorization belongs to HU03.

The dashboard build and TypeScript check passed, along with all 5 Node component tests and 353 Python tests with the exact Hermes checkout and the HP01-R1 host and product CLI binaries. The Python count includes the 16 dashboard fixture validations.

The fixture UI used for this historical checkpoint was retired in the Warlock rebuild. Current UI checks use the live Hermes SDK and isolated profile owners.

## HU02 read-only dashboard acceptance

The browser reads the current dashboard DTOs through a typed client. Deterministic fixture scenarios cover the general and project REL sessions and an independently selected PHY. Each scenario exposes only its active PHY. Requests carry an abort signal, and the client rejects results from an old request, owner binding, generation, cut, or selected revision.

The tab supports paged and filtered Memory lists, keyboard graph and list navigation, bounded graph expansion and edge inspection, exact detail and revision history, copied-source provenance, communities and members, and operational status. The pruned revision fixture retains its historical body identity and returns no body content. The project fixture shows a tombstoned source with an active Memory.

The dashboard build and TypeScript check passed. Eight Node tests exercised the client, cursor scope and expiry, bounded graph pages, fixture selection, cancellation, and plugin registration. The full Python suite passed 383 tests with the pinned host probes and process binaries enabled, including 46 fixture response checks against the exported schema and canonical DTO correlation rules.

The [Hermes browser smoke commands](#hu01-r1-dashboard-host-acceptance) also exercise HU02 on the exact v0.23.0 dashboard. The enabled Chrome run covers independent REL, session and PHY controls, empty and invalid-filter states, keyboard selection, list paging, pruned history, graph expansion, edge inspection, community navigation and the copied-source tombstone. The disabled run verifies that Hermes withholds the tab and assets. Live transport and owner authorization remain HU03 scope.

## HU03 live dashboard verification

The live plugin uses the approved Hermes profile and active-PHY boundary against the signed Rust service. The dashboard integrates the accepted HP05 host baseline, including HP04 source and runtime lifecycle. Owner, Memory, graph, community and status responses are bound to a verified owner cut. The active PHY remains read-only. User-origin writes use the private Root actor derived from that active PHY.

The two-profile proof checks the pinned launch profile and the secondary hosted plugin worker. It exercises unauthenticated, disabled and unknown profiles, forged browser identity, foreign owners and sessions, stale cuts, cross-origin mutation denial and PHY write denial. The same pinned route verifies create, immutable correction, terminal retirement, association link/unlink, active-PHY provenance and exact mutation replay. An isolated signed-service proof with a real seeded Root community verified list, member paging, rename, stale cursor rejection and replay after a service restart.

The HP04 proof verifies dashboard source tombstone status after restart. The HP05 process proof inspects three imported Memories and their bounded graph, checks exact copied-source receipt and cursor evidence, and verifies the returned Memory IDs and delivery ID after real Hermes retrieval. Prepared recall does not appear as a return. Read-only inspection leaves the retained Freshness receipt count unchanged.

Chrome on Hermes v0.23.0 verified owner and session switching, read-only PHY controls, user-origin Memory creation, literal rendering of HTML-shaped text, and stale-cut conflict with the draft preserved through refresh. The fixture bundle passed the enabled and disabled Chrome checks and remains isolated from the live API. TypeScript passed, along with 10 Node tests, 20 locked offline Rust tests and 350 Python tests with the pinned binaries and checkout.

To repeat the focused service proofs, use the environment from [HP03 local process verification](#hp03-local-process-verification) with the rebuilt dashboard host.

```powershell
python -B -m pytest -q --basetemp .pytest_tmp tests/test_hu03_dashboard.py tests/test_dashboard_api.py tests/test_hp04_host.py tests/test_hp05_retrieval.py
npm.cmd --prefix dashboard run check
```

The HU03 run treated imported revision timestamps and exact Hermes quote spans as unavailable. HU04 adds persisted revision times and accepted source identity with a null span when the quote was never retained. The live recall view reports confirmed returns and marks the wider candidate set unavailable.

## HP04 stable host and runtime verification

Use the HP03 build and test commands with Hermes `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` and the sibling Reliquary checkout at `b31aaee577fc0e1caa3b9d7913c18f8155c4f972`. The [host audit](host-audit.md) records the stable pin and provider callback evidence. The process proofs use synthetic owners and deterministic loopback processing endpoints.

The HP04 suite covers stable transcript IDs and timestamps, privacy-filtered provider delivery, native append and exact replay, same-session rewind, committed archive/delete notices and tombstone anti-resurrection. The runtime tests exercise heartbeat expiry, a durable scoped crash fence, reconnect with the original owner binding, authoritative recovery and final clean shutdown. The independent Root extension proof is:

```powershell
cargo test --manifest-path ../Reliquary/tests/external-consumer/Cargo.toml --target-dir host/target --locked --offline --test operational_processing
```

HP04 passed local acceptance on November 8, 2026. The final run passed 344 Python tests with both process binaries and the stable Hermes checkout enabled. It also passed 19 locked offline Rust host tests and all three detached Root processing tests. Rust formatting, Git whitespace and the Reliquary architecture guard passed.

The process suite killed an attached pinned provider and observed the durable fence after the production lease expired. The surviving host accepted a replacement provider with the same REL/PHY binding. A subsequent full callback imported the new row once, while stale snapshots and old lease messages were rejected. The restart proof found the existing fence when a live runtime added the affected scope, kept the fence while import was pending and advanced its epoch after another host restart. Registration recovered when an intermediate reattach attempt failed. Archive stayed terminal. Clean shutdown drained volatile captures to the outbox, removed discovery and released the owner leases for restart.

A crash can leave a fence until a supported Hermes callback supplies the required source overlap. An upstream event absent from that view can remain unrecoverable. See the [HP04 crash/reconnect lifecycle](hp04-crash-reconnect-lifecycle-2026-11-08.md).

## HP05 stable retrieval verification

Use the HP03 process-test commands with the same stable Hermes and Reliquary pins as HP04. The focused Python process proof is `tests/test_hp05_retrieval.py`. It stages three copied Hermes turns through the authenticated host, processes them through the public Reliquary CLI, and uses deterministic loopback decisions for retrieval. The actual v0.23.0 Hermes memory manager exercises turn-start prefetch and all three tools against the Rust host.

Queued preparation and Root inspection leave the REL bytes and retained history unchanged. Turn-start prefetch reuses the prepared decision and, together with an exact replay, adds one retained record. Query, refinement and one-hop traversal add one record each and return distinct selections within the tool turn. The proof checks the exact accepted snapshot digest, rejection of deeper traversal, and refusal to return stale copied evidence after a rewind from another session bound to the same REL. The Rust selected-return proof separately covers concurrent and reopened replay through the same Root receipt.

HP05 passed local acceptance on November 8, 2026. The pinned suite passed 346 Python tests, 19 locked offline Rust host tests and all three detached Root processing tests. The focused process proof also passed with the exact digest and cross-session rewind assertions. Rust formatting, Git whitespace, the service documentation check and the Reliquary architecture guard passed.

The local model endpoint verifies routing, grounding and receipt behavior with fixed synthetic decisions. HP07 owns the authorized real-model run.

## HU04 installed dashboard acceptance

HU04 uses Hermes v0.23.0 at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` and public Root at `9cb0dfa3`. The acceptance branch starts from the dashboard provenance and imported history fix at `fb10d21`. The installed test copies the verified HP06 directory plugin into a fresh Hermes profile and runs `hermes memory setup reliquary` with the current HU04 host binary. It stages the built dashboard bundle under that same profile.

The pinned Hermes session persistence and MemoryManager paths ingest a conversation with Hermes-assigned message IDs. The public Root CLI processes the accepted copied import. A separate later session recalls the exact Memory and source digest. Chrome verifies general and project REL routing, the independently bound read-only PHY, graph and list inspection, revision history, copied-source identity, and the returned Memory ID. The provider, Rust host and Hermes web process restart against the same profile and native owners. The later recall matches before and after restart. A committed Hermes archive reaches the installed observer, tombstones the copied source, fences stale replay and prevents recall from returning that source. Chrome verifies the tombstone, and the signed HTTP checks deny the foreign profile.

The contract suite also checks exact imported revision timestamps, retained historical payloads after correction, cursor scope, verified provenance, mutation conflicts, durable retirement and community rename replay. The HP05 process regression checks that both detail and provenance hide copied source identifiers during a reconciliation fence, while the native source turn still exists.

Use the HP03 process environment with a rebuilt HU04 host, the exact Root CLI and pinned Hermes checkout. Set `HERMES_WEB_DIST` to the compiled dashboard for that pinned Hermes checkout and `HU04_PLAYWRIGHT` to an installed Playwright `index.mjs` with Chrome available. Set `HP06_PLUGIN_DIR` to the verified extracted directory package. Provide `HU04_COMMUNITY_REL` as a synthetic project REL with a current accepted community and a same-stem JSON file containing `community_id`, `generation`, `name`, `name_origin`, and at least two distinct Memory IDs in `members`.

```powershell
$env:HU04_LIVE_ACCEPTANCE = '1'
python -B -m pytest -q --basetemp .pytest_tmp tests/test_hu04_installed.py tests/test_hu04_acceptance.py tests/test_hp05_retrieval.py
```

The processing and retrieval routes use deterministic loopback model decisions. The proof uses the installed provider, signed Rust host, native REL and PHY owners, and pinned Hermes web dashboard.

HU04 passed local acceptance. The full pinned run passed 354 Python tests, 20 locked offline Rust host tests and 10 Node tests. TypeScript, Chrome live and enabled/disabled fixture checks, Rust formatting, Git whitespace and the service documentation policy passed.

## HP07 real-model acceptance

Use the verified HP06 directory package and the HU04 dashboard from `f3b4256` in an isolated pinned Hermes profile with fresh REL and PHY owners. Install the updated provider client and host together. Point `processing.json` at the authenticated development Reliquary configuration. Limit the isolated Hermes session to the `memory` toolset for recall and leave model fallbacks and MCP servers disabled.

Run a one-shot with two related synthetic facts. Wait for the copied import to reach ready and compare its native provenance against the Hermes message identity and timestamp. Open a new one-shot session with a question that omits the facts and asks Hermes to use `memory_query`. Compare the tool delivery ID and returned Memory IDs with `ui.operational_status`. Check that the tool's source snapshot digest matches the original copy receipt. Stop the isolated gateway and host, verify owner lease release, and repeat from a new session. Attempt the provenance read from a foreign profile and verify typed denial.

HP07 passed with Hermes v0.23.0 at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` and the host built against Root `6496b888721588f52b4371f1df92d7b2622872fc`. The run used the existing authenticated Reliquary development configuration, including the General fallback for recall on Codex `gpt-5.6-luna` and OpenRouter's 1024-dimensional `qwen/qwen3-embedding-8b` route. The isolated Hermes profile used its existing OpenRouter endpoint, credential and `openai/gpt-5.5-pro` model with a 2048-token output limit for the recall turns.

Reliquary combined the two Lantern handoff facts into one Memory. The dashboard showed one graph node and zero edges, and its provenance matched the native source digest and original Hermes message. Both real recall turns returned the amber checklist and cedar binder. They returned the same Memory and source snapshot digest in distinct sessions and host instances with distinct delivery IDs. The dashboard matched each tool receipt. Both shutdowns released the owner lease, and the foreign-profile provenance requests returned typed denial.

The focused Python suite passed 19 tests. Its signed-host regression starts an eight-second prepare, then verifies that explicit recall waits and returns the expected Memory. It also verifies that a later prepare preserves the last confirmed dashboard return. All 20 locked offline Rust host tests passed against the same Root snapshot.

## HU05 setup backend verification

Use Hermes `v0.23.0` at `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` and the accepted HP07 Root revision `6496b888721588f52b4371f1df92d7b2622872fc`. That Root revision opens the binary config and credential bindings read-only during preflight. Run the locked offline host tests and use the rebuilt executable for the Python process fixtures above.

Run `tests/test_setup.py` and `tests/test_setup_api.py` with the pinned Python environment. The service proof covers default resolution, activation, rollback after a real host exits before publishing discovery, stable credentials and project-session mappings. The installed API proof loads the active profile's provider through Hermes and checks the actual Hermes token gate, origin admission, one-use native tickets, foreign profile denial and the request bound before any owners exist.

## HU05 web and Desktop checks

For current builds and smoke tests, see [Warlock Knowledge verification](#warlock-knowledge-verification). The following Electron probe records how the isolated test profile and native dialog checks were configured.

The Electron probe is `desktop/tests/live-smoke.mjs`. Pass an isolated fixture JSON with `home`, `ownerIds`, an optional `candidate` containing `mainRel`, `activePhy`, and `configPath`, and an optional `expectedConfigPath`. Set `HU05_DESKTOP_EXE`, `HU05_PLAYWRIGHT`, `HU05_DESKTOP_PYTHON`, and `HP01_HERMES_CHECKOUT`. With `HU05_DESKTOP_APP`, the harness supplies isolated Electron paths before importing the unchanged compiled app. The probe supplies deterministic file choices at the Electron dialog boundary and exercises the real picker bridge and profile REST transport.

## HU05 fresh real-model verification

Build the HU05 host and CLI with the [chronological extraction ledger patch](../patches/reliquary-6496b888-chronological-extraction-ledger.patch) applied to an isolated Root worktree at `6496b888721588f52b4371f1df92d7b2622872fc`. The patch limits the initial ledger, its repair passes and the wording model to eligible attribution choices for each user turn. The existing chronology, authority, and exact quote checks still validate the result.

The host manifest resolves `../../Reliquary` relative to its crate. To preserve the current product checkout, stage the patched Root as `<scratch>/Reliquary` and copy the HU05 host manifest, lockfile, `src/`, and `tests/` to `<scratch>/integration/host/`. Build and test the staged host with `--locked --offline` and a target directory inside the HU05 worktree. Build the matching CLI from the patched Root's `cli/Cargo.toml`.

Install the rebuilt host in a fresh isolated Hermes profile and select the existing authenticated development configuration through setup. Send a synthetic standing project rule in one real conversation and verify that the copied source retains the original user turn and that background processing commits a grounded Memory. Check the committed import through `rel source status` and public owner reads. Verify real recall in two distinct sessions across a clean host restart, including exact Memory ID, source snapshot digest, tool and dashboard receipts, and foreign-profile denial.

The isolated Windows proof used HU05 `e5be550`, Root `244d10ec`, and the original pinned Hermes provider backend. It started with an empty REL. Real extraction produced one grounded Memory with zero rejected episodes. The staged import resumed to `completed` under the same configuration. Two real recall sessions returned that Memory and its original source snapshot digest across distinct host instances. The tool and dashboard receipts agreed, foreign-profile access was denied, and both shutdowns released the owner lease.

## HU05 sealed import replay

Apply the [sealed replay patch](../patches/reliquary-244d10ec-sealed-import-replay.patch) after the chronological extraction patch, then use the same locked offline build layout. Sealed replay verifies the live endpoint against the active profile already bound to the import. REL and routed PHY vector coverage use that exact profile ID. The frozen route binding, dimensional and normalization checks, bounded probes, cosine threshold, and import write guards still apply. An older seal without a processing binding keeps the exact-profile lookup.

The detached `operational_processing` suite checks that compatible drift changes the fresh probe hash while replay preserves the completed receipt, processing report, and REL and PHY bytes across a fresh mount. Incompatible vectors and changes to the bound routes still return typed conflicts.

The Windows live proof used an isolated copy of the fresh HU05 sealed import. The old CLI reproduced the conflict with the original real configuration. The patched CLI replayed that import before and after restarting the signed host. Both returned the same completed receipt and report, with byte-identical owners and source receipts. The original fixture, development config, and credential-key file retained their hashes.

## HU05 isolated Desktop mutation checks

The installed Hermes checkout at `b766b76988449e15e3914037d3e03fb96af72774` reproduced the gap in both launch and secondary profiles. Native setup status and owner discovery returned HTTP 200. Native setup validation and apply returned HTTP 403 with `same_origin_required`. After same-origin web setup, native Memory create returned HTTP 200 with a typed `denied` result. Same-origin web Memory create succeeded in both profiles.

The HU05 positive test host uses Hermes `104a7c4158e98719750e32347cd4101a7b35bc8d`, based on the installed revision above. HU06 retains this revision as the positive test host and supports public-plugin use on stock Hermes through its capability gate. [Stock and fixed Hermes verification](#hu06-stock-and-fixed-hermes-acceptance)

Set `HU05_HERMES_HOSTED_CHECKOUT` to the Hermes installation under test. Use the process-test binaries and pytest environment above. The probe creates separate launch and secondary profiles in the test workspace, exercises the gateway's real ticket checks and private IPC, and confirms two distinct worker processes. It checks setup, owner discovery, Memory create, correction and retirement, and the exact body and tombstone reads. It also checks cross-profile denial, ticket replay, browser Origin and forged admission headers, and accepts an ordinary same-origin dashboard write.

```powershell
$env:HU05_HERMES_HOSTED_CHECKOUT = 'C:\path\to\installed\hermes-agent'
python -B -m pytest -q --basetemp .pytest_tmp tests/test_hosted_desktop_api.py
```

The installed Windows gateway passed this probe at `104a7c4158e98719750e32347cd4101a7b35bc8d` in both profile workers. The Hermes regression `tests/hermes_cli/test_plugin_host_route_auth.py` passed all five tests on the fix. Its launch and secondary native-admission cases reproduced the lost admission on the stock parent.

For the live Electron probe, point `HP01_HERMES_CHECKOUT` at the same Hermes installation and set `plugins.isolation: host` in the isolated profile. Use a fresh fixture with `verifyMemoryWrite` set to true to exercise the picker, setup, Memory create, correction, and retirement. The probe opens the created and corrected bodies and reads the superseded Memory's tombstone.

The Windows live run used the installed Desktop build from `b766b76988449e15e3914037d3e03fb96af72774` with Electron 44.9.3 and the installed gateway at `104a7c4158e98719750e32347cd4101a7b35bc8d`. The native picker and first-run setup passed in a fresh profile with an isolated worker. The Desktop pane opened both configured owners, created a Memory, showed its exact body, opened its corrected replacement, and confirmed the superseded original's tombstone after retirement.

## HU06 stock and fixed Hermes acceptance

Use the same Reliquary directory package with isolated profiles on stock Hermes `b766b76988449e15e3914037d3e03fb96af72774` and fixed Hermes `104a7c4158e98719750e32347cd4101a7b35bc8d`. The fixed revision is a positive test host. The public plugin supports setup and writes through the web dashboard on stock Hermes, alongside Desktop setup status and reads. Desktop enables its setup and write controls automatically when the authenticated status request has verified native admission.

Build and stage the unified directory package once using the [local service guide](local-service.md). Set `HU06_PLUGIN_DIR` to that package, `HU06_HERMES_STOCK_CHECKOUT` and `HU05_HERMES_HOSTED_CHECKOUT` to the two Hermes checkouts, and `HU06_COMMUNITY_REL` to a synthetic main REL with a current accepted community partition. Use the HP03 process-test binary environment and run `python -B -m pytest -q --basetemp=.pytest_tmp tests/test_hosted_desktop_api.py`. The probe installs the same directory into both test profiles on each host and checks the isolated worker routes, native capability, web fallback, and existing authorization denials.

The Windows hosted matrix passed both cases with a single package whose `host-pin.json` SHA-256 was `21351cbbb255f53401df8ad385cc1060db0af1c9562950488c5c905f23044391`. On stock Hermes, native status reported `false` and native reads succeeded. Same-origin web setup, Memory create/edit/retire, association link/unlink, and community rename succeeded. On fixed Hermes, native status reported `true` and the same operations succeeded with native admission. Same-origin web writes also passed on the fixed host. Both cases confirmed distinct launch and secondary workers, and denial of foreign profiles, replayed tickets, Origin-bearing tickets, and forged admission fields.

Run `desktop/tests/live-smoke.mjs` with the Desktop environment above. On stock Hermes, use `expectDesktopReadOnly` in both a fresh fixture and a fixture configured through the web dashboard. The fresh fixture verifies the notice, picker, and disabled Validate and Connect actions. The configured fixture verifies owner and Memory reads with no mutation controls. On fixed Hermes, use a fresh fixture with `verifyMemoryWrite` to verify native setup and the Memory lifecycle.

The Windows Electron 44.9.3 run on stock Hermes passed the fresh setup and picker check with Validate and Connect disabled. It reopened the stock HTTP fixture configured through the same-origin web path, browsed both owners, and displayed the persisted corrected Memory body without exposing mutation controls. On fixed Hermes, Electron passed fresh native setup, both owner reads, Memory create and correction, and terminal retirement with tombstone readback. The runs used scripted file-picker selections at the native dialog boundary. The SHA-256 checks matched all 25 package files across the stock and fixed installs.

The local HU05 regression run passed eight HP04 and HP05 process cases with a synthetic blank processing config and short temporary paths. An isolated run on stock Hermes also passed provider drain/restart and ingestion/recall, using the stock turn-start signature in the test harness. Both runs used deterministic loopback model responses. The unadapted pinned suite had 352 passes, four skips, and four baseline-reproduced failures during synthetic Root CLI credential initialization.

## HU07 Hermes-native presentation

The shared surface receives its controls through the existing host seam. The web live and fixture bundles use Hermes dashboard SDK 1.1.0 controls. Desktop imports the corresponding primitives from `@hermes/plugin-sdk`. Each host adapter translates Select values and options to its SDK contract. Hermes styles the controls and supplies text colors and fonts. The shared stylesheet retains layout, overflow and graph geometry. Web SDK 1.1.0 has no Textarea export, so the web uses a browser textarea for multiline Memory fields.

Run the dashboard, fixture and Desktop builds and the Node and TypeScript checks in [HU05 web and Desktop checks](#hu05-web-and-desktop-checks). The tests check SDK control injection, setup submission and capability gating, select values, and the absence of a Reliquary control theme. The installed probes exercise setup and owner browsing with Hermes themes, native focus and long paths, and the stock Desktop compatibility notice.

The local Chrome smoke passed against Hermes `104a7c4158e98719750e32347cd4101a7b35bc8d` in Hermes Teal dark and Nous Blue light. Keyboard focus was visible and 216- and 218-character owner paths fit the inputs. Validation, connection, owner selection and reload passed. The fixture bundle passed against web SDK 1.1.0 and host React, including graph, list and provenance reads. The configured sidebar uses the SDK's compact action size to keep its labels on one line.

Electron 44.9.3 passed the stock Hermes `b766b76988449e15e3914037d3e03fb96af72774` light-theme check with the native picker, visible keyboard focus and disabled setup writes. On fixed Hermes `104a7c4158e98719750e32347cd4101a7b35bc8d` in dark mode, native setup, owner selection and Memory create, correction and retirement passed through tombstone readback. Both hosts used isolated profiles and scripted native file-picker selections.

## HU05 project-aware onboarding amendment

The authenticated setup checks exercise active-profile Hermes inventory, multi-folder project grouping, archived project exclusion, browser and verified native creation admission, and destination validation. Run `tests/test_setup_api.py` with the pinned Hermes checkout and `tests/test_hosted_desktop_api.py` with the installed host matrix. The hosted probe creates General, project and PHY owners in an isolated profile and verifies their signed topology and existing management operations. The Rust `setup_validation` and registry suites cover exclusive creation, owner preflight and durable binding through restart.

The stock and installed hosts expose the project registry but lack authoritative project attribution in the provider lifecycle. Their project lists and owner selection are available. New sessions attach to General memory and the UI reports the missing routing capability. Live project-specific routing requires the host contract recorded in the [host audit](host-audit.md).

## HU05 release-safe stock fallback

A stock Hermes build shows the project inventory and saved project paths read-only. Its review submits General REL and PHY setup without project assignment fields. Hosts that declare trusted attribution retain project assignment controls and the fallback confirmation for unassigned projects. The shared dashboard test covers both capability states.

Use the stock Web and Desktop smoke fixtures to check General and PHY selection, creation through Web, the project capability notice, and saved paths on reopen. Use an isolated profile with a preaccepted dedicated session to verify that stock provider startup and restart bind fresh sessions to General while preserving the signed dedicated route, owner configuration, and topology.

## HU08 selective import and automatic capture

Run the pinned stock suite with the HP03 process binaries. Stock retains recall and the configured dashboard while new automatic capture and manual import require trusted native creation and history-export capability. Verify the capture, portable restore, and explicit import on the isolated installed Hermes checkout with the HU08 contract applied.

Set `HU08_HERMES_INSTALLED_CHECKOUT` to that checkout and `HU05_HERMES_HOSTED_CHECKOUT` to the same path for the installed gateway probe. In a fresh Python process with the same binaries, run:

```powershell
python -B -m pytest -q --basetemp .pytest_tmp tests/test_capture_policy.py tests/test_hu08_capture.py tests/test_hu08_manual_processing.py tests/test_hp04_host.py tests/test_hp04_runtime_process.py tests/test_hosted_desktop_api.py
```

The probes use synthetic profiles and deterministic local processing. They cover native creation evidence, portable restore with synthesized creation time, old resumes, trusted message identity, privacy scrubbing, authorized General and dedicated RELs, Web and Desktop-native confirmation, duplicate import, and processing while an unrelated Hermes session is active. Run the dashboard build, shared Web and Desktop tests, TypeScript check and locked offline Rust host suite as above.

Manual history export v2 removes the whole-conversation message/byte cap while retaining bounded, overlapping source windows and the existing native import/processing boundary. Version 1 remains sufficient for automatic new-session capture but **not** unrestricted manual history import. Verify a 300-message ordered/restartable outbox and the signed-host test that inspects the oldest and newest original Root turns after sequential extensions (`tests/test_hu08_long_history.py`, `tests/test_hu08_manual_processing.py`). Do not claim that compressed or copied-branch lineages are importable until their original source history can be exported and verified. No installed plugin or upstream PR is updated by these local tests.

## HU09 plugin-local file dialogs

Implementation `90f7a88` (`90f7a88a0cc2cbafe8e4183ff1da0e3c59fae414`) was deployed on installed Hermes `4588296`. The installer copied and hash-checked seven integration files. The production dashboard restarted, served byte-identical installed Web assets, and returned HTTP 200 for authenticated setup status. The protected configuration, credentials, processing settings, and host pin matched their pre-deploy hashes.

### Installed Windows evidence

- The feasibility probe used the running dashboard's Python 3.14.9 executable in Windows Session 1. Tcl/Tk 9.0.4 opened a genuine Windows Open File dialog, which was canceled.
- The isolated dashboard on `127.0.0.1:9130` used the installed Hermes runtime and the final integration build. Select REL, Select PHY, Create REL, and Create PHY each opened and canceled a genuine Windows dialog. The optional configuration picker also opened and was canceled. The Open File dialogs returned the existing synthetic REL and PHY paths.
- An authenticated same-origin request from a non-browser loopback process returned `unavailable` despite spoofed forwarding headers. The retired listing route returned HTTP 404. Manual paths remain the fallback when Windows cannot verify a supported browser connection under the same OS account and in the same active desktop session.

### Automated checks and limits

The Web and Desktop builds and TypeScript check passed. The suites passed 29 Web, 12 Desktop, 17 Python setup/API and locality, and 33 locked offline Rust host tests. The Web tests covered separate confirmation. The setup and host tests covered exclusive creation and overwrite refusal. Documentation policy and Git whitespace checks passed.

Window testing stopped before live Save As selection, separate creation confirmation, and connection with newly created synthetic owners. The packaged Desktop modal evidence comes from the previous build. This revision used the Desktop automated suite. macOS and Linux dialog behavior was outside this Windows verification.

## Warlock Knowledge verification

The source inventory is Warlock `cf41c6690e089cab4a00950d6048ad6828eaeab7` and Hermes baseline `7ccc429e51e37bb731313dc6184f426f527d34ce`. The Warlock worktree had local Cargo manifest and lockfile edits. The port used the tracked source at the frozen revision and pinned the renderer dependencies in `dashboard/package-lock.json`. The public Root graph source landed at `fa574eec`.

The Web and Desktop bundles share the React UI, renderer and host theme mapping. The live runs used Chrome with Hermes Web SDK 1.1.0 and Electron 44.9.3 with the Hermes Desktop byte bridge on `458829681db8761e50b8242aa034d23ae9bcdcd5`. The Web smoke checks the authenticated chunk media type and length, rejects forged owner and principal selectors and stale generation and render IDs, and checks that the current chunk remains usable. The Desktop canvas uses the same binary decoder through the SDK's authenticated byte IPC. The final Desktop smoke exercised native Save As, separate creation confirmation and native owner selection before connecting. Stock Desktop exposes List and the inspector with an explanation of the required graph capability.

The November 8 corpus was copied through a read-only mapped view to avoid the source file's Windows byte-range lock. Root independently verified 13 visible REL Memories at Memory version 26 and graph version 10, with 10 active Memory-to-Memory relations. Root verified four PHY Memories at Memory version 4 and graph version 0. The REL manifest contained 13 nodes and 10 detail segments. The PHY manifest contained four nodes. The active-only List showed 11 REL Memories. The lifecycle toggle exposes other states. The graph uses the Warlock Memory-to-Memory projection. The public Root source also carries typed relations with other endpoint kinds.

Astra independently checked the Web graph, binary traffic, picking into the same Memory, revision history, provenance, PHY switching, Setup and Sources, and layouts at 1440, 1280, 900 and 600 pixels. The agent accepted the final Web layout and reviewed the Desktop graph and inspector captures after the real Desktop smoke passed. Missing source evidence in the reference corpus is reported explicitly. Community availability is independent of the List. The existing Hermes write scope allows user associations and community rename where granted.

Run the local checks from the integration repository.

```powershell
npm --prefix dashboard run check
cargo fmt --manifest-path host/Cargo.toml --check
cargo test --manifest-path host/Cargo.toml --locked --offline -- --test-threads=1
node dashboard/tests/web-live.mjs $dashboardUrl $playwrightModule $webFixture
node desktop/tests/live-smoke.mjs $desktopFixture
```

The UI build, typecheck and four focused TypeScript tests passed. The locked host suite passed 90 tests. The installed bundle and host-pin SHA-256 hashes matched in both isolated packages. The reference and both browsed copies of each corpus owner matched byte for byte. Its separate ignored characterization exercises the two synthetic tiers. Use a fresh isolated profile and corpus copies for each live run. Provide `home`, `ownerIds`, `counts` and optional `candidate` in each fixture. Web also accepts `expectedEdges` and optional `expectedEdgeLod`, which defaults to detail. The Desktop runner takes `HU05_DESKTOP_EXE`, `HU05_DESKTOP_APP`, `HU05_PLAYWRIGHT`, `HU05_DESKTOP_PYTHON`, and `HP01_HERMES_CHECKOUT`. When supplied, `candidate.createPhy` uses a synthetic destination to exercise the native Save As and separate creation confirmation. To exercise community workflows, use a synthetic REL with an accepted partition. Set `community` with `name`, `memberTitle`, `memberCount`, and `renamed`. Set `onNextPage` within that object for a community on the second page.

The pinned Python run passed 391 tests. The history capability and automatic capture checks passed in the separate 20-test installed-source run. The hosted native-admission case on Hermes `45882968` reached its existing manual-import polling step, where the session stayed queued past the test deadline. The same timeout and shutdown assertion reproduced at Hermes integration `2e59dc1` with its original host binary. Three optional HU04 live checks require their separate installed fixtures.

Synthetic Web and Desktop runs exercised owner setup, Memory creation, user association, and replacement through their respective authenticated routes. Retirement of a superseded Memory succeeds after its active links are cleared. Root protects superseded Memories with active relationships from retirement. Hermes presents that refusal and retains the exact-cut guard. Reopening the Desktop fixture showed the tombstone with explicit body, history and provenance availability. The signed linked-Memory probe kept detail readable and returned the typed retirement conflict.

A separate Root-verified synthetic REL had 101 active Memories, a 100-link chain, and community pages of 100 and one. Web and Desktop both reached the final community, filtered to its single Memory, returned to the first page, and saw the renamed community after the owner refresh. Both retained List through the refresh. Web verified 100 intermediate edge segments and received authenticated binary edge chunks. The chain links cross leaves, so the renderer represents them as aggregates. Small graphs can load intra-leaf detail and cross-leaf intermediate chunks together within the existing detail budget. On a separate six-Memory REL with two accepted communities, the initial hosted Web frame fetched four detail segments and one cross-community intermediate segment, with exact binary response lengths. Astra accepted the community controls on both hosts.

The release characterization compiled the exact renderer modules in isolation with a deterministic input graph and fixed relation style.

| Input nodes | Logical edges | Prepare time | Packed bytes | Manifest bytes | Output segments |
| --- | --- | --- | --- | --- | --- |
| 100,000 | 1,000,000 | 0.36–0.62 s | 3,448,992 | 3,702 | 32,772 |
| 1,000,000 | 10,000,000 | 6.07–7.82 s | 32,129,472 | 24,151 | 253,983 |

Peak process working set across both tiers was 1.35 GiB. The largest node and edge chunks were 786,464 and 262,176 bytes. The signed host caps chunk responses at 1 MiB and manifests at 4 MiB. The client retains bounded LRU chunk caches and applies the Warlock viewport and picking budgets. Small graphs that fit those detail budgets show their nodes and edges at the initial camera distance.

The Warlock September 28 baseline assembled whole-graph JavaScript objects and uploaded their geometry. The Hermes measurements cover Rust projection and binary packing. GPU timings and million-node transport throughput in Hermes are unmeasured. The live Web and Desktop checks used the copied 13-node REL and 4-node PHY.

## Rich Warlock graph verification

The rich renderer requires Reliquary Root at `fa574eec` with the [filtered semantic graph projection patch](../patches/reliquary-fa574eec-filtered-graph-projection.patch) applied. The checkout layout stays the same. The Hermes host resolves `../../Reliquary` from its Cargo manifest. The patch adds authorized, exact-cut reads and reuses the List predicate for title or body search, community, lifecycle, category and Memory type.

Run the existing Rust, Python and dashboard suites from the integration checkout. Run the Root test `hp02_memory_graph_expands_active_neighbors_at_one_cut` in `oc06_inspection` to check List parity, induced relationships, early stop and stale cuts. The Web and Electron probes use independent copies of the November 8 REL and PHY. The active-only graph should show 11 REL Memories and four PHY Memories. Turning on Show non-active memories should show 13 REL Memories. Record the input and browsed file hashes separately for each host.

The paired renderer benchmark uses the baseline at `8136458` and the candidate under the same release profile and graph generator. For the 100k-node/1M-edge and 1M-node/10M-edge tiers, the release gate allows up to 2.5 times the baseline preparation time and twice its peak working set. The million-node preparation must also fit the 30-second host response window before host and transport overhead. Report a dense moderate tier separately. Hosted timings must record browser heap, frame timing and p95 hover and selected-neighborhood response time. Record the sample count and build for every reported timing.

The isolated release benchmark compiled the production renderer modules for each revision. The table records the final paired sample for each tier on the same Windows host. The timer covers generation preparation, and peak working set includes creation of the synthetic source. Root mounting, network transfer and GPU work are outside these measurements.

| Nodes / input edges | Baseline prepare | Candidate prepare | Baseline peak working set | Candidate peak working set |
| --- | ---: | ---: | ---: | ---: |
| 25k / 2.5M | 0.75 s | 1.07 s | 258 MB | 377 MB |
| 100k / 1M | 0.74 s | 0.58 s | 149 MB | 195 MB |
| 1M / 10M | 6.99 s | 6.78 s | 1,447 MB | 1,911 MB |

All three tiers retained the baseline packed chunk size. The 1M tier used 32,129,472 packed bytes and a 26,562-byte manifest. The two release-gated tiers met both ceilings. The standalone release harness passed 15 layout and hierarchy tests, including weight-sensitive distance across territories, exact deterministic positions, and minimum node clearance across local population boundaries.

The matched browser comparison served those same binary chunks over loopback to each revision's production React renderer in Chrome with SwiftShader at 1280×900. Overview used the manifest center. Detail centered on the nearest leaf, kept the manifest's extent for LOD thresholds, and zoomed through the normal controls. The harness sampled six seconds at overview and eight seconds at detail.

| Nodes / input edges | Renderer | Overview p95 / frames | Detail p95 / frames | Used JS heap overview / detail | Detail node bytes fetched |
| --- | --- | ---: | ---: | ---: | ---: |
| 100k / 1M | Baseline | 173.6 ms / 42 | 253.5 ms / 33 | 9.0 / 15.6 MB | 786,464 |
| 100k / 1M | Rich | 187.6 ms / 37 | 263.9 ms / 34 | 8.7 / 9.8 MB | 40,736 |
| 1M / 10M | Baseline | 284.7 ms / 38 | 270.8 ms / 32 | 9.1 / 16.0 MB | 786,464 |
| 1M / 10M | Rich | 173.7 ms / 39 | 319.5 ms / 29 | 9.1 / 10.5 MB | 786,464 |

The candidate selected a smaller leaf in the 100k sample. At 1M both renderers fetched one full node chunk and the same edge bytes at detail. The rich renderer used less JS heap and had a longer p95 detail frame interval in this software-rendered sample. All four browser runs reached both LODs without page errors. The hosted corpus run below measures the new inspect and neighborhood routes, which were absent from the frozen baseline.

The locked offline host suite passed 95 tests. All four Root inspection tests passed. The graph projection case verified the same result as List for combined query, category, type and lifecycle filters, induced links, early visitor stop, and stale-cut denial. The pinned Python API, setup and source lifecycle run passed 19 tests. The installed-source run passed six capture, history and manual processing tests. The shared dashboard passed typecheck and four TypeScript tests and produced both bundles.

The signed loopback smoke used independent copies of the November 8 owners. It verified 11 active and 13 total REL Memories, v3 descriptors, binary framing, title inspection, incident counts, locate, filter exclusion, and stale and cross-owner denial. For 20 sequential reads each on the final debug host, signed loopback p95 was 100.77 ms for inspection and 100.81 ms for the neighborhood. These samples cover the signed host round trip.

Hosted Hermes Web passed the copied-corpus smoke in Chrome with SwiftShader. It covered both owner canvases, authenticated binary responses, owner and generation denial, graph click through to full detail, Graph and List selection continuity, search, provenance, history and Sources. The lifecycle control moved the REL graph from 11 to 13 and back to 11 Memories. The final interaction run verified five visible hover tooltips and five selected neighborhoods, single-selection double-click, keyboard selection and a settled right-drag with selection retained. During a concurrent Desktop smoke, the final Web run measured request p95 of 592.7 ms for inspect and 570.7 ms for neighborhood, 18.2 MB of used JS heap, and p95 frame interval of 105 ms over 23 animation frames.

Hosted Hermes Desktop passed the copied-corpus Electron smoke with both owner canvases, full Memory inspection, Sources, and Graph and List selection continuity. A second isolated REL had six Memories in two accepted communities and one cross-community relation. The Desktop smoke filtered to the selected community's three-node canvas, selected a Memory, and retained the selection through List and Graph. The profile exposed community browsing under its read-only grant.

The original November 8 REL and PHY and both final hosted copies matched the initial SHA-256 hashes after verification.

## Related docs

- [HU09 native file-dialog specification](hu09-native-file-dialogs-onboarding-spec-2026-11-09.md)
- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own these checks. Reaudit the pinned checkout before changing any host capability claim.
