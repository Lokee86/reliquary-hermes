# Hermes integration verification and remaining gates

## Purpose

### Catalog release preparation, 2026-11-11

The catalog source package unifies directory discovery under `reliquary`, vendors the accepted Root revision, adds a public attested Windows build, and changes processing credentials to Hermes-managed API-key injection with nonsecret JSON routes. Existing deployed-host and real-corpus visual evidence below predates this packaging change and does not prove the new credential route's live-model behavior. The narrated demo labels imported-memory preview recall explicitly.

The rebuilt Web/Desktop bundle passed typechecking and 26 client tests. The complete Python run with isolated dependencies, the audited web dependency pins (FastAPI 0.133.1/Starlette 1.9.0), and both pinned/trusted-history source fixtures passed: 387 passed, 23 skipped, one dependency deprecation warning. The skipped gates require external native binaries, installed-host fixtures, or explicit live acceptance. The shared service documentation check passed. The initial staged-file scan found no executable payloads, Python bytecode, `.env` files, or credential-shaped secrets in 920 tracked files. Catalog dependency validation and the public Native host workflow remain release gates; their final results belong in the submission PR rather than being inferred from earlier installed-host evidence.

The first public Native host run at source commit `d04ddf716524a7028c0f7f09036ff878617e4c0c` failed before compilation because its pinned `lodestone-packed` dependency is hosted in a private repository. No native build or attestation success is claimed for that run. A minimal source-publication review is being prepared separately; private dependency source is not part of this published commit.

The rights holder then approved publishing the four required Lodestone source/license files. The follow-up package includes only that subset, verifies its pinned Git blobs, records its original hashes, and changes Root to a local path dependency. Cargo metadata with `--locked --offline --no-deps` passes. Full offline dependency resolution stops on an uncached public crate; the public workflow supplies the clean native build gate. Python dependencies are declared in `plugin.yaml`; `pyproject.toml` contains only test tooling so Hermes PM synthesizes a small dependency member instead of copying the nested native source tree into its Python workspace, avoiding Windows path-length failures.

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

The [non-graph source parity ledger](warlock-nongraph-ui-parity.md) records the original component and CSS inventory, host adaptations and verification of the shared Knowledge, Setup and Sources presentation.

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

The rich renderer requires the committed Reliquary Root API at `538d22bdbe5040e3ba7fe69d31677425dcb7fc7e`. The Hermes host keeps its canonical `../../Reliquary` path dependency; a clean reproduction checks out that revision in the sibling. The public API provides authorized exact-cut projection and reuses the List predicate for title or body search, community, lifecycle, category and Memory type. The former migration patch is superseded by this committed API and is retained only in Git history.

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

## Original Warlock React graph port

The release worktree starts at deployed checkpoint b216487b9e7c3a282149ca5e6a780c5148567315. Its Web JavaScript, Web stylesheet and Desktop module matched the installed files before the port. The release branch carries only the graph component changes and verification. The integration checkout at 9aad11749f226eab410abd380cd55efcd64debee already had 67 changed paths and retains its separate local work.

The component sources are frozen at Warlock d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b. A scripted source comparison checked exact equality of the point sprite, sphere detail policy, node and territory canvas texture functions, glow boost, edge density scale, additive edge material, point material, scene lighting and bloom. The comparison also verified removal of the extra filled shell and rounded territory card.

Frozen Warlock visual sources by SHA-256.

| Source | SHA-256 |
| --- | --- |
| GraphScene.tsx | 8d584424c14b2176e5c2d71b61278b2e1c7aeecd5b69e11c52d54159c212487b |
| NodeCloud.tsx | df47b097f85d27846a8b5a7c65b6535253601642481d03e0968d3484490cd496 |
| EdgeLines.tsx | ef2569fba67df89ec13785c6ef22a019247c895e38d7183524a04bb5d34e9c21 |
| NodeLabels.tsx | 4971710448a56bebb2624ae22d22f52a029db97a4b70eea85124842cb2aeff69 |
| Territories.tsx | 3710ebf57a1450b3df5d17b4cf4bd9d7d92ed7815f3fdb50a7d80bf392319b88 |
| visuals.ts | 25a240a95a7ca2793dd8a69e32d99c47e76fa5ed1c0fc0fdae7aeef16817529d |

The shared scene renders resident typed chunks and viewport territories from the existing v3 manifest. It retains the original 75,000-node sphere-to-points threshold and the bounded label candidates. The selected Memory can receive its own label from its resident chunk and authorized title. Aggregate segments use the coarse edge intensity and the packed relation weight. The 128-edge selected overlay uses the original additive material and carries the existing direction markers and omitted-count status.

Compact Rust coordinates need a smaller initial extent than the original 180-unit minimum. Initial and reset framing use the node bounds and real territory radii. The label on a single real territory uses zero depth offset to stay in frame. Unassigned keeps the original wireframe and text style at subdued opacity and a lower label position. Both hosts expose their React instance without a DOM renderer. The tooltip retains the original markup, anchor and styling, with the screen position projected from the Three camera into a host-rendered element.

The paired Chrome 156 screenshots used a native GeForce RTX 3060 with D3D11. They cover selected, unselected and hovered states, linked communities, single real and unassigned territories, a dense selection, and 720- and 1280-pixel canvases. The linked case matched closely after accounting for the one-pixel host border. The bounded labels and compact framing differ as described above. The native interaction harness verified title and short ID hover, dismissal, click and keyboard selection, duplicate-click suppression, incident-edge limits, rotate, wheel zoom, reset and right-pan stability during a delayed viewport response.

The locked offline host suite passed 95 tests with one ignored scale characterization. The release dashboard typecheck and four Node tests passed, and the same script built both host assets. The focused graph render, dashboard and setup API run passed 12 Python tests.

The full Python run passed 388 tests and skipped five optional live cases. The five failing process cases passed on rerun. The stable-pin retrieval and owner-enumeration cases passed together. The three HU08 capture and manual-import cases passed with the HU08 checkout in a fresh interpreter, avoiding cached imports from the older Hermes pin. All 393 enabled cases passed across these runs.

The release assets passed hosted Chrome and Electron smoke tests with independent copies of the November 8 REL and PHY. Web verified chunk MIME and lengths, forged owner and principal rejection, stale generation and render-ID rejection, title and short-ID hover, settled right-pan, reset, keyboard and pointer selection, selected relationships and the REL lifecycle transition from 11 to 13 and back to 11 Memories. Desktop verified both owner canvases through authenticated binary IPC, pointer selection, Graph and List continuity, the full inspector and Sources. The original and copied owners matched their pre-test SHA-256 hashes.

The verified assets from 565080282836692297737ec479b8df53b3620a6e were deployed to the local Web and Desktop plugin directories. The running Web dashboard returned HTTP 200 with matching JavaScript and stylesheet bytes. The installed Desktop module matched its tested build. Configuration, processing settings, the Rust host pin and the Rust host executable matched their pre-deploy hashes.

| Deployed asset | SHA-256 |
| --- | --- |
| Web JavaScript | 871aeb79a23efa3c50855760d8d24938c6253ffbaaa1bfbc5bc356b76edad244 |
| Web stylesheet | ef872ca9021f633c7ac0a5665dd8dcbafa407ca38275c1f063475aed36eef8db |
| Desktop module | 130234c081bd730f28a5085385a8ab1014bbee8a3359bf5d955b768199ad8dda |

The fresh release benchmark reran the established paired harness. All 27 production source files used by the prebuilt candidate matched the current Rust files by SHA-256. Each row is one serial run. The baseline is 8136458.

| Nodes / input edges | Baseline prepare | Candidate prepare | Baseline peak working set | Candidate peak working set |
| --- | ---: | ---: | ---: | ---: |
| 25k / 2.5M | 0.78 s | 1.26 s | 258 MB | 377 MB |
| 100k / 1M | 0.40 s | 0.77 s | 150 MB | 195 MB |
| 1M / 10M | 4.05 s | 7.59 s | 1,447 MB | 1,911 MB |

Both release-gated tiers stayed below the time and memory ceilings. The million-node tier packed 32,129,472 bytes in chunks and a 26,562-byte manifest. A second comparison ran the previous rich React renderer and the port against the same candidate binary chunks using SwiftShader at 1280×900. Each case has one six-second overview sample and one eight-second detail sample. Every run reached detail LOD and fetched the same bytes in its pair without page errors.

| Nodes / input edges | Detail p95 previous / port | Used JS heap at detail previous / port |
| --- | ---: | ---: |
| 100k / 1M | 277.8 / 270.9 ms | 9.91 / 9.77 MB |
| 1M / 10M | 319.4 / 326.4 ms | 10.66 / 16.80 MB |

## Consolidated Warlock UI acceptance — November 10, 2026

The integration reconciles graph input `05d8749`, non-graph input `4bf34e4`, current main `685b0df`, and the exact 70-path dirty snapshot `9327601926d64524e319f875d553528f22bd2970`. The [reconciliation matrix](warlock-ui-integration-reconciliation-2026-11-10.md) records every dirty input and its disposition. The original checkout and index stayed untouched during assembly. Generated Web/Desktop files came from one canonical build, reproduced byte for byte.

The shared Knowledge surface has one navigation, one Graph/List switch and one inspector. It retains the original non-graph presentation and the original React graph renderer on the bounded Rust transport. The obsolete GraphSelectionInspector, duplicate owner rail and tooltip CSS are absent; source searches found no Tauri imports or second renderer. The old Root migration patch is superseded by committed Root `538d22bd`.

### Combined checks

| Check | Result |
| --- | --- |
| Dashboard check | TypeScript passed; 4 Node tests passed; Web and Desktop built together |
| Reproducible build | All five UI artifacts reproduced byte for byte |
| Locked offline Rust host | 95 passed, 1 ignored scale test; formatting passed |
| Root exact-cut projection regression | 1 passed; 660 Root compile inputs match the committed deployed source |
| Stable HP01 Python pin | 391 passed, 14 optional skips, 1 HU08-specific deselection |
| Separate HU08 six-module run | 23 passed, 1 optional stock-checkout skip |
| Focused replay/manual/native cases | 24 passed, including shutdown retries and mismatched receipt/owner/digest denial |
| Architecture and documentation | 23 production packages / 76 edges; service docs and Git whitespace passed |

The stable suite used audited Hermes `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19` first on PYTHONPATH. The separate HU08 interpreter used `458829681db8761e50b8242aa034d23ae9bcdcd5` and its history-export v2 contract. Python ran with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, `PYTHONDONTWRITEBYTECODE=1`, `python -B -m pytest -q`, and worktree-local `.pytest/_tmp`. Fresh host binary `C7058D9C...511909` and the existing tested CLI were used in the final process checks. No test assertion or timeout was relaxed.

The 14 stable-pin skips were 9 cases requiring the separate HU08 pin, 2 hosted stock/native optional profiles, and 3 optional HU04 installed/live probes. The HU08-specific deselection and corresponding HU08/native cases passed in the separate run. The stock-checkout parameter remained explicitly skipped. Independently, actual hosted Web and Electron acceptance used copied owners rather than the optional historical HU04 fixture.

### Visual and interaction evidence

Hosted Chrome, Electron Desktop, and the separate Desktop community fixture passed both owner canvases, authenticated binary reads and denials, search, inspector/history/provenance, Sources browsing, scope switching and Graph/List selection continuity. Read-only reference and copied owners retained their SHA-256 values. A separate fresh-owner Web test passed creation, association link/unlink, immutable replacement and terminal retirement; its REL changed intentionally and its PHY did not.

Native Chrome used NVIDIA GeForce RTX 3060 Laptop GPU / Direct3D11. It verified hover title and short ID, pointer/keyboard selection, neighborhood, settled right-pan and Reset. The 1440×920 graph-source comparison used the same 11-node corpus and exact 663×596 canvas bounds for selected and unselected reset states. Only the visual fixture overrode candidate sizing; no tracked CSS changed. Long-label overlap appears in both reset baselines and is inherited graph behavior. Candidate natural allocation is narrower because it now contains the required three-panel shell.

At 600 and 390 pixels there was no horizontal overflow. At 390, actual wheel scrolling exposed the inspector and its State label passed a hit-test inside every clipping ancestor. Navigation, center and inspector retained independent scrolling. Electron captures verified the responsive composition. Software-rendered smoke results are not GPU performance evidence.

### Renderer characterization

All 27 production renderer source files matched the prebuilt release harness. Each row below is one fresh serial baseline/candidate pair; these are not statistical medians. The timer covers renderer preparation, not Root mounting, network transfer or GPU work.

| Nodes / input edges | Baseline / candidate prepare | Baseline / candidate peak working set |
| --- | --- | --- |
| 25k / 2.5M | 1,619 / 3,438 ms | 257,609,728 / 377,339,904 bytes |
| 100k / 1M | 514 / 830 ms | 149,520,384 / 195,043,328 bytes |
| 1M / 10M | 4,706 / 7,817 ms | 1,447,067,648 / 1,910,575,104 bytes |

The million-node result was 1.66× baseline time and 1.32× baseline memory, below the 2.5× / 2× regression limits and the 30-second preparation ceiling. It packed 32,129,472 chunk bytes and a 26,562-byte manifest.

### Sources replay correction

Combined verification exposed a completed-import race: the manual worker could detach and stop its host between owner authorization and the saved receipt read. The manual-delivery seam now reconnects for completed local receipts and retries bounded transient shutdown/transport failures. Exact owner, snapshot digest and receipt checks remain mandatory; mismatches and pending work do not gain a new import path. The regression first failed on the prior implementation and passed after the fix, with no added queue row.

The hosted test fixture now configures its existing deterministic loopback processor before setup validation. Root must process each prior historical window before accepting the following one. The poll waits for Complete before exercising the unchanged already-imported assertion, with the original 20-second deadline and authorization assertions preserved. No production processing configuration was modified.

### Accepted UI artifacts

The plugin manifest remains version 0.1.0; the integration Git commit identifies the release. Deployment receipt and final main revision are recorded after installation.

| Artifact | SHA-256 |
| --- | --- |
| Web JavaScript | `cc1c060fa70041be0ac997d3aeb2a22b7fd266b0ffa845a041d8d5396610531e` |
| Web stylesheet | `04f5ef5cdd1d27850f8e657478722b54619acbe936b72bdd434a3e935e98eb64` |
| Web legal notice | `8e8d25fd9cf497a25efb043111b56df8b0278ea2b38a5e7b2cd200cbc3a443d7` |
| Desktop module | `72e7e1adf4f9d62327d1d6d5072f70613eaf793c7e708063ebbf629583ad543f` |
| Desktop legal notice | `58a6ef9bd0ac264cc1c582e4bc4200f1d70394ff3cddaebf2b78d809ac8b177e` |

### Installed release and cleanup receipt (2026-11-11)

Source commit `8e8e94579671134db1f347403f06f31dcd456399` is installed in Hermes Web and the Desktop plugin directory. Read-only post-install verification matched all six release hashes below; the Web route returned HTTP 200 with JavaScript and CSS bytes matching those hashes. The new dashboard is PID `69624`; its Python Web listener is PID `66356`, and the old dashboard/backend exited. The Desktop plugin file hash matches the release, but no Hermes Desktop process was running during verification; the fresh candidate Electron smoke is separate-process evidence and does not establish that an open Desktop app loaded the installed file.

Core config, owner/provider/processing files, host binary/pin, and active REL/PHY matched their recorded pre-install fingerprints. Optional capture-enrollment and the processing `config_path` target were fingerprinted after installation; both last-write times predate installation. Their pre-install hashes were not persisted, so these optional-file checks provide timestamp plus post-install-fingerprint evidence.

Cleanup removed six UI worktrees (graph, old integration, baseline, details, host, candidate) and retired eight UI aliases (graph, integration, details, host, direct-port, knowledge, candidate, dirty snapshot). The Knowledge and direct-port directories remain detached to preserve all 764 and 2,332 original untracked parity paths, respectively; a final preservation check confirmed each path still exists. HU05, HU08, HU07 and codex-render-host worktrees remain. The Root verification worktree was removed; the `b56d46a3056d8f621e964f64ce3125ff3ef9048d` API snapshot ref remains, and the original Root dirty state is unchanged.

| Installed artifact | SHA-256 |
| --- | --- |
| Web JavaScript | `CC1C060FA70041BE0AC997D3AEB2A22B7FD266B0FFA845A041D8D5396610531E` |
| Web stylesheet | `04F5EF5CDD1D27850F8E657478722B54619ACBE936B72BDD434A3E935E98EB64` |
| Web legal notice | `8E8D25FD9CF497A25EFB043111B56DF8B0278EA2B38A5E7B2CD200CBC3A443D7` |
| Desktop plugin | `72E7E1ADF4F9D62327D1D6D5072F70613EAF793C7E708063EBBF629583AD543F` |
| Desktop legal notice | `58A6EF9BD0AC264CC1C582E4BC4200F1D70394FF3CDDAEBF2B78D809AC8B177E` |
| Shared `manual_delivery.py` | `0DB137E083F31EF899FB019C1A72E042D16DE0DDA04E9E3BCD372F7A22DF752B` |


### Active Hermes theme inheritance

The plugin surface now reads the live Hermes palette rather than Warlock's fixed colors. Desktop publishes `--dt-*`; Web publishes `--background-base`, readable `--midground`, and semantic `--color-*` slots. The aliases live on `.knowledge-surface`; compile-time Tailwind aliases are not assumed to exist at runtime. No theme presets, observer, copied host stylesheet, or separate theme state were added. Controls inherit the host color scheme, and the transparent WebGL canvas reveals the same themed background. Graph data colors and layout are unchanged.

Native Chrome on a copied 11-Memory REL switched through the actual Hermes Teal and Nous Blue picker while the graph remained mounted. Computed background, text, input and panel borders, primary/selected controls, focus rings and tooltip colors matched the active host values. The composited canvas corner changed from RGBA `[4,28,28,255]` to `[232,242,253,255]`; canvas identity and surface/graph dimensions stayed unchanged. Both reference and copied REL/PHY hashes were unchanged. The probe is under `host/.test-tmp/theme-follow`; this is a Web theme-switch check, not an installed Desktop session claim.

TypeScript, all four dashboard Node tests, and the combined Web/Desktop build passed. A declaration comparison confirmed unchanged non-color layout, typography, border widths and shadow geometry in all three surface stylesheets. All five installed UI files matched the build hashes below; the running Web route served identical JS/CSS bytes. Provider code, configuration and REL/PHY fingerprints remained unchanged, and no service was restarted.

| Theme-aware artifact | Installed SHA-256 |
| --- | --- |
| Web JavaScript | `B919811DB79D0332C384AC44F725511F6949EA4983A2B8368D8D80E163D741FD` |
| Web stylesheet | `566FC109B0A7546E1A40B1367BCF29C87D7181E993469B93249088C775D0AEE4` |
| Web legal notice | `8E8D25FD9CF497A25EFB043111B56DF8B0278EA2B38A5E7B2CD200CBC3A443D7` |
| Desktop module | `73EDC51F8F27DA93C3055543FBC1329FA5C666818023B9DFDCBE94286FAFB7A8` |
| Desktop legal notice | `58A6EF9BD0AC264CC1C582E4BC4200F1D70394FF3CDDAEBF2B78D809AC8B177E` |

## Warlock v1 graph preferences

This UI implementation restores the original v1 Display and Animation menus described in the [adaptation specification](warlock-v1-graph-preferences-reliquary-adaptation-spec-2026-11-10.md). The user explicitly limited final verification to the outstanding Desktop bridge, active themes, menu clipping and a focused point-mode check. Renderer/backend scalability was already validated; those suites were not repeated and no new acceptance gates were added.

`npm --prefix dashboard run check` passes TypeScript, 25 focused Node tests and canonical Web/Desktop builds. The tests cover defaults, clamping/malformed data, unavailable or failing storage, profile/owner isolation, finite and overflow-safe camera vectors/bounds, rotation, animation readiness/delta, marker geometry, shell factors/selection, node glow and all-LOD brightness composition. No production Rust or Python behavior changed.

The actual Web smoke passes on a copied 11-active-Memory REL and 4-Memory PHY: the existing Knowledge/List/inspector/Sources and authenticated binary/picking checks pass before preferences. Display min/default/max checks compare raw WebGL pixels rather than overlaid HTML menu screenshots. All sliders affect the graph; zero shell opacity retains labels. Delay, camera motion, keyboard interruption, pause, reset, view capture/factory restore, unchanged canvas and zero cosmetic graph requests pass. Web writes no global preference keys when the public host has no safe profile namespace.

The existing Desktop Knowledge smoke passes in an isolated native Electron profile. Its preferences check observes the real main-process HTTP bridge, rather than incorrectly treating renderer-page network events as native REST traffic. The focused Desktop preferences run passes all slider/frame, menu, animation, profile storage and factory-reset checks. Example changed-pixel counts at minimum/maximum are 806/1,005 for edge brightness, 203,397/61,573 for node glow, and 380,435/85,629 for bloom. Shell opacity zero retains 3,801 label-colored pixels. Three-axis motion changes 205,283 pixels; cosmetic controls issue no extra prepare/chunk/read requests and retain the canvas. Desktop software framebuffer capture uses a three-second delay window so capture overhead does not exhaust the one-second Web test interval.

Menus are measured after resize layout settles, avoiding a stale pre-resize rectangle. Clipping checks cover the viewport and overflow ancestors; theme-menu checks additionally hit-test all four corners and verify Escape focus return. Source component screenshots and DOM measurements use the original v1 files at 1440/493/390 pixels. Source hashes and justified visual differences are recorded in the specification’s parity ledger.

Theme/menu checks pass through the actual Web theme picker (Hermes Teal and Nous Blue) and Desktop’s real Shift+X appearance toggle (dark and light). All 15 palette aliases match active host values, including background, readable text, primary/secondary/accent, borders, inputs, rings and popovers. Painted menu text/background/borders match those aliases; every corner is hit-testable at 390/493/1440 pixels, and Escape restores trigger focus. The Web canvas remains mounted through its theme switch. Desktop native control color-scheme changes with its host; Web inherits its host’s normal color-scheme while its explicit colors and accents follow the palette.

The focused point-component check bundles the canonical `RenderNodeChunk.tsx`, renders a three-node resident chunk with `totalNodeCount=75001`, and confirms that its public registration callback receives `THREE.Points`. Glow zero/default/max each changes 3,100 raw WebGL pixels; all 3,100 base-colored pixels remain visible at zero glow. Canvas identity is unchanged and there are no browser errors. This deliberately avoids another backend/scaling test.

One earlier copied 80,000-Memory REL end-to-end attempt timed out after 90 seconds before graph-ready. It did not reach the point-mode assertions. The source/copy REL/PHY hashes remained unchanged. That attempt was stopped and recorded; the backend was not investigated or rerun under the final scope. No product failure was observed in the completed focused UI checks.

The implementation keeps the existing binary client, bounded picker, cache/residency policy and selected relationship overlay. Preferences only update renderer presentation and camera state. Backend regression, exhaustive cross-profile browser scenarios and additional scaling tiers were not rerun under the user’s narrowed scope. Web preferences are intentionally session-local when no safe host profile namespace is available; Desktop uses its public profile/connection key. The isolated fixture REL/PHY and their original sources are hash-checked after each run.

The canonical build artifacts used by the focused UI runs have these hashes. All five are deployed together; the final install receipt records source/installed and served Web hash equality.

| Artifact | SHA-256 |
| --- | --- |
| `dashboard/dist/index.js` | `88620CABFF156C47D755183FB5C4B4E8B484B0C246219FFE91B96912D4E6C48E` |
| `dashboard/dist/index.css` | `01293A38365421DEB440652FBB96D474EE025A1314086DB1C34AE9AC5E9059B4` |
| `dashboard/dist/index.js.LEGAL.txt` | `280E12E511A5320B190D121018E006ADDBE8852E760DF3E41FCF6684788ACC95` |
| `desktop/plugin.js` | `E7FB300D25EB8305EA828D26678AF9A5B3870518223F0E0701B64BD7A9ED19CE` |
| `desktop/plugin.js.LEGAL.txt` | `3860F9BFFED9DCAB2DB8714AD7AAA166FE376B4A916377FE3B77B533F59CC660` |

The five installed files and the running Web route’s JS/CSS match these exact hashes. Provider code, protected configuration, host/pin, and configured REL/PHY hashes are unchanged across installation; no live service was restarted. Native Desktop acceptance used a fresh isolated Electron session with the same plugin hash; this does not claim an already-open Desktop process reloaded the installed module.

Temporary fixture generators, copied RELs, browser profiles, caches and the three merged execution worktrees/branches were removed after retaining the compact verification receipt and representative screenshots. No pre-existing worktree, unrelated work, configuration or live REL/PHY is part of that cleanup.

## Global graph overview display deployment (2026-11-11)

The client now treats node and edge LOD independently. `GraphRenderClient` admits all node chunks at every camera zoom when both the 32-chunk and 16 MiB encoded-byte budgets fit; for larger node sets, its bounded overview sample spreads selection across the global spatial buckets and applies the same chunk and byte limits. Detail edges are independently admitted up to 32 chunks / 16 MiB, otherwise the existing overview/intermediate edge LOD applies. The client bounds chunk fetch concurrency at eight, drops queued requests from obsolete viewport generations, aborts stale in-flight requests, deduplicates shared chunk work, and caps decoded node and edge caches separately at 64 chunks / 32 MiB. Focused client regressions cover full-fit versus overflow planning, separated spatial regions under a byte cap, stale viewport requests, cache eviction and resident byte accounting.

The layout source trace starts with the frozen Warlock `clusteredLayout.ts` and `forceLayout.ts` weighted local/group placement behavior. The bounded Rust translation enters through `build_graph_render_layout_with_topology` and separates group-center and local-member passes in `host/src/graph_render_layout.rs`; spatial lookup limits candidate force work rather than imposing grid positions. This trace documents the implementation path; real-corpus visual comparison and its limits are recorded below.

Canvas draw evidence is exposed as container data attributes: `data-drawn-node-count` and `data-drawn-node-chunks` are populated from node object `onAfterRender` callbacks; resident and planned counts remain separate attributes. For a nonempty frame, graph-ready waits until every planned node chunk has submitted a draw; an empty loaded frame signals readiness directly. `data-edge-lod` reports the edge LODs actually included in the active frame. These counters indicate GPU-submitted chunk instances/points, not pixel-level visibility.

Candidate validation: the locked offline Rust checks pass 101 tests (84 host unit tests, one library test and 16 integration tests); the scale characterization remains explicitly ignored in the normal suite. Dashboard typecheck, all 26 Node tests and the shared Web/Desktop bundle build pass. The Python suite passes 382 tests with 23 optional process checks skipped; one setup-route test fails with FastAPI/Pydantic recursion and reproduces against the unchanged base repository. The graph route tests pass in that run. The service documentation checker and Root architecture guard pass.

The optimized benchmark compiles the exact renderer source modules without the storage stack. It prepares 100,000 nodes / 1,000,000 relations in 7,654 ms with 252,133,376 bytes peak working set, and 1,000,000 nodes / 10,000,000 relations in 23,938 ms with 2,426,654,720 bytes peak working set. Packed chunks total 3,448,992 and 32,129,472 bytes respectively; manifests are 4,319 and 26,562 bytes. These are bounded renderer measurements, not million-node end-to-end database or GPU throughput claims. Compared with the earlier grid renderer, force placement costs more CPU and peak memory. Large-population local, coarse and global iteration caps preserve bounded work; the 2,191-node corpus retains the full-quality path.

The final host candidate uses the installed public Root revision `dca06ffa9933f8a6105036b05814cabbbccb17ef`, built offline with the host crate optimized (`cargo rustc ... -- -C opt-level=3`) while retaining the pinned dependency cache. Its SHA-256 is `9fb81761f029c13d0c7eb50d02d295b8bb90ebd193bb9fe1da71ba7c769e8720`. The active REL and PHY are copied through read-only mappings and verified by SHA-256; acceptance never rewrites them.

A source-derived browser comparison renders the same 2,191 real nodes, 19,392 bounded detail relationships and 12 authoritative communities using frozen Warlock `d9e38cb9e53dd2f8de345dd90cba08d00c27ac3b`, then the typed-chunk renderer. Its reference scene receives the exact candidate positions; a separate reference also runs the original JavaScript layout only inside the comparison fixture. Real bounded labels are retained, and unavailable fixture labels explicitly identify render IDs. The production path contains no JavaScript force solver. The final candidate shows a continuous 3D graph and individual connected nodes inside subtle community regions, with no unassigned enclosure. Both original-source and port screenshots have no browser errors.

Installed Web display verification is complete for the overview capture. The read-only installed-browser receipt at `host/.test-tmp/global-graph/installed-web/installed-web-receipt.json` records host SHA-256 `9fb81761f029c13d0c7eb50d02d295b8bb90ebd193bb9fe1da71ba7c769e8720` and UI bundle SHA-256 `64f90ae7d9f7cc94893e59bc9fd491d926f1bde60e6db7a2b884eca1fdab83f7`. It records all 13 of 13 node chunks and edge chunks received with HTTP 200, 2,191 resident and GPU-submitted nodes, zero downsampling, and no page errors. The corresponding screenshot is `host/.test-tmp/global-graph/installed-web/installed-web-overview.png`. This is an installed Web display result; it does not complete every acceptance item in the remediation specification.

This receipt does not establish that an already-open Desktop process reloaded the module or verify the deployed graph in Desktop. Full Memory inspector content acceptance is also outside this display check; a separate review found that the inspector metadata lookup scans at most four 128-entry pages (512 memories), which can leave later memories unavailable and remains open. The earlier installed baseline returned zero node chunk responses despite a 2,191-node manifest. Video capture and the remaining interaction and platform acceptance are tracked separately; no video or full-spec completion claim is made here.

## Related docs

- [HU09 native file-dialog specification](hu09-native-file-dialogs-onboarding-spec-2026-11-09.md)
- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own these checks. Reaudit the pinned checkout before changing any host capability claim.
