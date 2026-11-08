# Reliquary Hermes integration

The standalone repository owns the Hermes provider, loopback service, Python contracts and Rust selected-return bridge.

- Preserve Hermes canonical history and its privacy-filtered provider egress.
- Pin the host audit to the revision in `docs/host-audit.md`.
- Candidate previews and dashboard reads remain non-reinforcing. Reliquary accounts for selected results when it returns them. Keep the temporary Gateway HACK isolated in `host/src/retrieval_hack.rs`.
- No product lower-store imports, guessed source IDs/revisions, direct transcript database reads, credential logging, or in-tree Hermes modifications.
- Run `python -B -m pytest -q --basetemp=.pytest_tmp` with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` and `PYTHONDONTWRITEBYTECODE=1`. All temporary writes belong here, not in Hermes or its caches.
- The pinned ABC probe additionally takes `HP01_HERMES_CHECKOUT` pointing to the audited checkout. The probes use its MemoryProvider ABC and isolated source/lifecycle paths.
- Verify Rust host changes with the locked offline Cargo suite in `docs/verification.md`. The detached host crate uses only public `reliquary-memory` for domain operations. Keep Rust build and test output in this worktree.

Documentation policy and canonical implementation owners are in `docs/documentation-policy.md`. Run the shared docs checker against this repo and the baseline commit as described there; no baselines or blanket exemptions. The service profile and maintainer map cover runtime configuration, security, operation and recovery.
