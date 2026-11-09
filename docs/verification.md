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

To repeat the browser smoke test, prepare the pinned frontend from the locked dependencies in a scratch mirror with the upstream web build script. Point `HERMES_WEB_DIST` at that build's output directory. From the dashboard worktree, stage the manifest and compiled assets in a fresh isolated Hermes home:

```powershell
$run = Join-Path (Get-Location) 'host\.test-tmp\hu01-smoke-enabled'
$env:HERMES_HOME = Join-Path $run 'hermes-home'
$env:TEMP = $run
$env:TMP = $run
$env:TMPDIR = $run
$env:PYTHONPATH = $env:HP01_HERMES_CHECKOUT
$env:PYTHONDONTWRITEBYTECODE = '1'
$plugin = Join-Path $env:HERMES_HOME 'plugins\reliquary-hermes\dashboard'
New-Item -ItemType Directory -Force -Path $plugin | Out-Null
node dashboard/scripts/build.cjs --fixture
Copy-Item -LiteralPath 'host/.test-tmp/dashboard-fixture/manifest.json', 'host/.test-tmp/dashboard-fixture/dist' -Destination $plugin -Recurse
@('plugins:', '  enabled: [reliquary-hermes]') | Set-Content -LiteralPath (Join-Path $env:HERMES_HOME 'config.yaml')
python -B -c 'from hermes_cli.web_server import start_server; start_server(host="127.0.0.1", port=0, open_browser=False, isolated=True)'
```

Use the announced loopback URL in a second terminal with a local Chrome installation and the path to Playwright's `index.mjs`. Set that terminal's `TEMP` and `TMP` to the same worktree scratch directory. Repeat in a fresh Hermes home with `plugins.disabled` and append `--disabled` to the test command.

```powershell
node dashboard/tests/hermes-host-smoke.mjs $dashboardUrl $playwrightModule
```

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

Build the web and Desktop entries and check the shared surface with the local Node.js and TypeScript toolchain.

```powershell
node dashboard/scripts/build.cjs
node dashboard/scripts/build.cjs --fixture
node --test dashboard/tests/dashboard.test.cjs
node desktop/scripts/build.cjs
node --experimental-vm-modules --test desktop/tests/plugin.test.cjs
tsc --noEmit -p dashboard/tsconfig.json
```

Use distinct isolated Hermes profile homes for web-first and Desktop-first setup. Install the same directory package with the rebuilt host in each profile. The Chrome probe is `dashboard/tests/hu05-web-smoke.mjs`. Pass the pinned web address, local Playwright module, and a fixture JSON containing the real owner `paths` and `ids`. Pass `--configured` when reopening the Desktop-first profile.

The Electron probe is `desktop/tests/live-smoke.mjs`. Pass an isolated fixture JSON with `home`, `ownerIds`, an optional `candidate` containing `mainRel`, `activePhy`, and `configPath`, and an optional `expectedConfigPath`. Set `HU05_DESKTOP_EXE`, `HU05_PLAYWRIGHT`, `HU05_DESKTOP_PYTHON`, and `HP01_HERMES_CHECKOUT`. With `HU05_DESKTOP_APP`, the harness supplies isolated Electron paths before importing the unchanged compiled app. The probe supplies deterministic file choices at the Electron dialog boundary and exercises the real picker bridge and profile REST transport.

## HU05 isolated Desktop mutation checks

Use an isolated Hermes worktree based on `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`. Apply [the hosted native admission patch](../patches/hermes-v0.23.0-hosted-native-admission.patch) there. Set `HU05_HERMES_HOSTED_CHECKOUT` to that worktree, then run `tests/test_hosted_desktop_api.py` with the process-test binaries and pytest environment above. The probe creates separate launch and secondary profiles, drives the real gateway ticket checks and plugin workers, and verifies native setup and a persisted Memory mutation in each. It also checks cross-profile, replay, Origin, and spoofed-header denial.

For live Electron verification, point `HP01_HERMES_CHECKOUT` at the patched checkout and set `plugins.isolation: host` in the isolated profile. The launch-profile live proof used the native picker, completed setup, created a REL Memory, and reopened its exact body. The isolated worker was confirmed in the gateway log. The public CLI verified the Memory after shutdown and lease release.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own these checks. Reaudit the pinned checkout before changing any host capability claim.
