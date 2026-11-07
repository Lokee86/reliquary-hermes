# HP01 verification and remaining gates

## Purpose

Provide reproducible standalone checks, observed evidence and explicit later acceptance gates.

## Overview

Status: contract-only implementation. Observed commands and outcomes are dated 2026-11-07. This is not full Hermes, product, service, UI or real-model acceptance.

## Frozen standalone test command

Prerequisites: existing Python 3.11+ with pytest `>=9.1,<10` and jsonschema `>=4,<5`; no dependency installation is performed by this task. From `reliquary-hermes` in PowerShell:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HP01_HERMES_CHECKOUT='C:\!bin\workspace\hermes-agent'
python -B -m pytest -q --basetemp=.test-tmp
```

The source pin fixture checks `git rev-parse HEAD` and loads only `agent/memory_provider.py` via importlib. It avoids normal Hermes runtime imports, real profile configuration, secrets, models, setup and plugins. `-B`, disabled plugin autoload and disabled pytest cache keep test writes out of Hermes and user caches. Any temporary pytest files belong to `.test-tmp` in this repository.

Without `HP01_HERMES_CHECKOUT`, the pinned ABC tests skip explicitly. Pure DTO/receipt tests still run, but do not constitute the full HP01 evidence. A wrong revision fails the pinned fixture rather than silently switching compatibility.

## Focused evidence

The deterministic suites cover:

- Strict request/result schemas, malformed/duplicate/nonfinite/oversized JSON, protocol versions, missing/blank identity, bounds and owner/path/token-field tampering.
- Profile token/principal binding, operation capabilities that deny provider-origin user edits, explicit authenticated per-author PHY mapping and REL-only unknown/group/bot defaults.
- Source logical IDs and exact copied digest, explicit unknown revision/branch, no physical-row/hash ID fallback, missing timestamp, unsupported multimodal data, duplicate IDs and unavailable source rejection.
- In-memory specification of revision/CAS, stable idempotency, replay without duplicate publication/clocks and no acknowledgment before simulated durable acceptance.
- Real pinned ABC instantiation and context/thread helpers, two profile/session bindings, per-turn participant callback capture and separate grant-helper checks, non-primary suppression, bounded volatile sync queue and unavailable/backpressure status.
- Fresh recall indicators, stale prefetch/session switch/resume/branch/rewind invalidation, cancelled tools, source/service outage and wrong-profile reinitialization.
- No consumption on prefetch/read/tool/dashboard/queue or on current-host handoff absence. Proposed future events reject failure, cancellation, uncertain/replaced/omitted context, stale scope, tampered manifests, transformed/truncated/missing text, malformed event data and UTF-8 character/byte-offset confusion. Exact future attestation earns one simulated receipt across retries.

Hand-authored snapshot parsing and the original `FakeImports` ledger remain shape/simulation evidence only. The added `BoundSourceImporter` contract fake explicitly consumes a real fake-provider `ReferenceJob`, binds profile/principal/session/invalidation epoch, exact callback egress IDs/digest and an out-of-band registered normalized source snapshot, and records the separate authenticated per-turn actor assertion. Whole copied snapshots remain REL-only; exact per-message source assertions alone may resolve that row through server-owned PHY grants. Current-turn identity cannot authorize prior/unknown/mixed rows. Replays reuse one simulated receipt; changed source/payload/author, cross-profile and stale jobs fail. Unknown/mixed/unmapped-bot or unverified actors cannot acquire a PHY and remain REL-only. Shared-session and mixed-row regressions prove a current speaker cannot grant its PHY to history, unknown rows, another participant or an unmapped bot. The trusted fixture registry is not real Hermes authentication, a supported source exporter or durable import; those remain HP04 work.

The current snapshot DTO has no authoritative invalidation transport. Fake host-only stale/deleted/rewound/unavailable notice tests specify that retrieval stops and old manifests remain invalid after resync, without claiming a current authenticated event transport or durable invalidation. The real pinned ABC probe checks a dependency-free interface and context helpers, not source authentication.

The complete UI-spec DTO vocabulary is now frozen in [ui-contract.md](ui-contract.md) and the exported JSON Schema. Its tests cover every owner/session, paged Memory/detail/history/provenance, graph/community/status and required user-action operation, exact cut/cursor/revision/target checks, provider/viewer/cross-profile/foreign-owner/cross-session/same-origin denials, trusted owner kind/label/capability correlation, no historical fallback, graph/page/byte limits and no fabricated confirmed-use status. They are typed HU01 fixtures, not a running tab, real login or real product receipt.

All tests use deterministic endpoints/fakes. They make no model-quality, extraction-quality, durability, real authentication service, process lifecycle, lease or privacy end-to-end claim.

## Outcomes

The first full run exposed pytest-generated parameter IDs containing a 262 KiB test input, causing test setup errors. Explicit short fixture IDs fixed that test-harness problem. The final scoped suite passed: **282 passed in 1.93s**, using Python 3.11.15 and pytest 9.1.1 and jsonschema 4.26.0 with the pinned ABC enabled. The final commit report includes the rerun outcome. Rerun the exact command above against any changed tree.

`git diff --check` is the whitespace gate. The first shared documentation check returned `documentation check failed: missing configuration: docs-standard.json`. A genuine minimal fixture configuration, explicit owners, root index and document policy were then added after inspecting the shared profiles/template and standalone examples. The current full checker passes with zero findings and zero baselines. This does not install a private Archivist ledger, CI or Pitlord policy. No `ddocs fix`, architecture refresh, environment mutation or global cache write is performed merely to manufacture a clean compliance claim.

## Later real commands, not run for HP01

The source-backed Hermes test entry point is `scripts/run_tests.sh` with the focused files named in [host-audit.md](host-audit.md). That runner owns isolated profile/test-environment setup. Do not run it during a no-caches/no-original-modification task without separately allowing its outputs.

After HP06 creates a real standalone package, use the audited `hermes plugins doctor . --ci` and `hermes plugins validate <path> --install-deps` commands under a disposable isolated profile/environment. No plugin manifest is fabricated now to create false installability evidence.

Current public Rust consumer/product suites belong to HP02 with its real facade changes and G4/GM/P01 acceptance. **No Cargo command was run for HP01.** A real authorized model smoke belongs to HP07 and must be labeled separately from deterministic tests.

## Remaining blockers and handoff

- Hermes lacks the required exact successful terminal payload hook. The generic proposal needs independent Hermes implementation/test evidence before enabling consumption. Current retrieval must remain non-reinforcing.
- The callback lacks explicit source revision/branch and may lack complete original metadata. HP04 needs a supported privacy-preserving authoritative source export/cursor; do not open private SQL, guess source revisions or backfill unredacted text.
- Root/Gateway/Application still need the narrow supported host facade. No mutable store, guessed compatibility reader, hidden production edge or second memory engine is permitted.
- HP03 must implement authenticated loopback service, private credential configuration, profile-bound UI session exchange, owner registry, one-writer lease/discovery, startup/attach/outage/restart and process-ambiguity handling.
- HP04 must bind provider ReferenceJobs to a supported trusted source adapter/export and verified candidate registration, implement durable job/cursor recovery, supported copied-source import, invalidation before stale evidence returns, idempotency/crash tests and end-to-end authenticated actor-owner routing. No HP01 hand-authored snapshot/digest or simulated durable flag supplies that authority.
- HP05 must connect bounded tools/prefetch and registered exact terminal events to real product receipts, not this fake reducer.
- The full required HU inspection/edit DTO vocabulary and strict typed mocks are frozen now. HU01 must still pin donor/license/build scripts and load a real dashboard bundle; HU02/HU03 implement the views/actions, and HU04 requires real-service cut/privacy/recovery acceptance. HP06/HP07 packaging and consented model demonstration remain separate.
- The minimal fixture documentation checker now passes without baselines. A vendored checker/CI gate, Archivist ledger and Pitlord semantic policy remain uninstalled; do not claim production tool adoption or alter sibling registries.

## Documentation impact

- Inspected: planning HP implementation spec, pinned Hermes root/plugin/test guidance and lifecycle/identity/dispatch/discovery sources; accepted product public exports.
- Updated: standalone README/guidance, pinned provider/web-SDK audit, provider and complete UI DTO/authority contracts, exported dashboard schema, proposed handoff contract, minimal docs configuration/index/policy and this verification record.
- Not affected: Hermes core/config/caches, Reliquary product/production DAG, historical corpus, dashboard assets and source history ownership.
- Compliance check: focused tests, whitespace, local links and the shared minimal-profile checker; final commit report records exact outcomes.
- Known documentation gaps: later real host/plugin/service acceptance and production CI/Archivist/Pitlord adoption as listed above.

## Architecture impact

- Standards added or changed: none. This freezes repository-specific HP01 boundary DTOs only.
- Ownership or boundary impact: Hermes canonical transcript; per-profile server grants; copied-source provenance; public product facade only; no receipt credit without trusted exact terminal handoff.
- Pitlord enforcement impact: no production edge or Pitlord policy changed. Future real host dependency checks are HP02/HP03 work.
- Other verification impact: strict Python/standard-JSON-Schema validators, pinned-ABC and bound-source behavioral fixtures, proposed-hook reducer and complete UI DTO tests. The existing bounded jsonschema dependency was declared without environment installation.
- Known architectural gaps: real public facade, durable import/receipt lifecycle, source export, process/service authentication and upstream hook remain unimplemented.

## Related docs

- [Documentation policy and ownership](documentation-policy.md)
- [Contract documentation index](INDEX.md)
- [Repository status and usage](../README.md)

## Notes

The Reliquary integration maintainers own this fixture contract. Reaudit the pinned source and update the matching tests before changing an authority or compatibility guarantee. Future production behavior must be labeled separately from deterministic fixture evidence.
