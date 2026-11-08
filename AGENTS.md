# HP01 contract repository

This is a standalone contract and deterministic fake-provider harness. It is not yet an installable provider, local service, Rust host, or product facade.

- Preserve Hermes canonical history and its privacy-filtered provider egress.
- Pin the host audit to the revision in `docs/host-audit.md`.
- Candidate previews and dashboard reads remain non-reinforcing. Reliquary accounts for selected results when it returns them. Keep the temporary Gateway HACK isolated in the future Rust host.
- No product lower-store imports, guessed source IDs/revisions, direct transcript database reads, credential logging, or in-tree Hermes modifications.
- Run `python -B -m pytest -q --basetemp=.pytest_tmp` with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` and `PYTHONDONTWRITEBYTECODE=1`. All temporary writes belong here, not in Hermes or its caches.
- The pinned ABC probe additionally takes `HP01_HERMES_CHECKOUT` pointing to the audited checkout. The probes use its MemoryProvider ABC and isolated source/lifecycle paths.
- Do not run Cargo for HP01. Documentation must distinguish executable fixture behavior from proposed hooks and unimplemented product/service behavior.

Documentation policy and canonical implementation owners are in `docs/documentation-policy.md`. Run the shared docs checker against this repo and the baseline commit as described there; no baselines or blanket exemptions. The minimal fixture profile must be reevaluated when a real service/provider is introduced.
