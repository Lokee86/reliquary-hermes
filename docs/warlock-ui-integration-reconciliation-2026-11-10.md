# Warlock UI integration reconciliation

## Purpose

Record the exact dirty inputs and source decisions for the authorized consolidation. This is provenance, not a second implementation specification.

## Overview

The original checkout and its index stayed untouched during candidate assembly. All 70 dirty tracked/untracked paths were reviewed and preserved using a separate Git index in commit `9327601926d64524e319f875d553528f22bd2970`. The accepted UI sources preserve every dirty source change, with Git's normal CRLF normalization. Generated bundles are rebuilt from these sources. The graph branch owns the renderer, authenticated transport and Rust projection. The non-graph branch owns the original Knowledge navigation, inspector, relations, scope, Setup and Sources.

| Input | Exact tip |
| --- | --- |
| `main` | `685b0df67742823c8ec0bb71c57eabf78b8fcb2a` |
| `warlock/original-react-graph` | `05d874950ae17d8e40be585cfe366f7ee3108e44` |
| `warlock-ui/nongraph-direct-port` | `4bf34e44b36c28652c6d87953742f6e4e1117fae` |
| Reviewed dirty input | `9327601926d64524e319f875d553528f22bd2970` |

The shared KnowledgePanel and stylesheet retain the original 230px navigation, flexible Graph/List center, 300–420px inspector and responsive container rules. KnowledgeNavigation retains the dirty category/type filters and bounded creation fields. KnowledgeGraph and host.ts retain the graph branch's single renderer, scoped binary transport, exact-cut eligibility and selected Memory bridge. No second owner rail, GraphSelectionInspector, Tauri import or alternate build pipeline remains.

Eligibility transport errors preserve the existing selected ID for the separately authenticated inspector request. This does not grant data access: the inspector still uses the owner/generation/cut-validated dashboard client. A negative eligibility result clears the selection, and stale completions are cancelled.

## File decisions

SHA-256 values below identify the original raw dirty bytes before line-ending normalization. The deleted path is represented explicitly. Original graph source and newer verification changes beyond dirty main are retained through its history merge.

| Original dirty path | Original SHA-256 | Selected implementation and reason |
| --- | --- | --- |
| `dashboard/README.md` | `6a5e5813d59f40bf0d43819fabb7927c1bf4960db2992c7b299afb957635c213` | Dirty combined behavior description plus retained parity-ledger link |
| `dashboard/dist/index.css` | `142bca335586d51a2409a9b68709dd1b1ac217e293f024a65b0dddf29231af0f` | Canonical source build; dirty output superseded |
| `dashboard/dist/index.js` | `ac192c625bd1c982e2ca8a59a214d2722fff568edf4877b9e268d06ec3ec9b86` | Canonical source build; dirty output superseded |
| `dashboard/src/app.css` | `45f7b9cc992e440ff3fdd2ac58a1c0b999347fe10d2aa5add4f3366324138a82` | Duplicate of nongraph-direct-port |
| `dashboard/src/app.tsx` | `ce1cbaf1bb4fe0d8fa07e5776a6c31d459c62d196631c70e22fd5cba7bab53a1` | Unique dirty combination retained |
| `dashboard/src/graph/render/BoundedPicker.tsx` | `41dc34f9a7ab18501621756e0674efed1603b48a47568f717848e2f95dad50a5` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/GraphRenderScene.tsx` | `5b0bda1bccb6f313376fbb2b8213c9c97d40882ea4ff2365a72391ec259d3191` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/RenderEdgeChunk.tsx` | `5ba481b9b42575f655bd7d0b6d81b3a978e0ef3cc2ff4f3fe25e033cde3d3184` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/RenderLabels.tsx` | `8b0b801df7013a01e05644833b651e8d7b8e7b9acb1b903897d25faa1deb5b5f` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/RenderNodeChunk.tsx` | `808d7ac2d4b4013efd2113308bfb18909bf4c82f61ad8a1f9390e5550ab53d13` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/RenderSelectionEdges.tsx` | `5ba29c56bc4f7120a2549a9847d41e2f86ac142588168abdf27ea61050e150aa` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/RenderTerritories.tsx` | `0131364238cee42bf2d1629310bbef2443a7c7a005967bae973078f728d44b86` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/client.ts` | `4ec993dcbda114e7cb3d538f65b4a0f0aea454ed2a86646cc3680b55abf8f6c0` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/clientContract.ts` | `52afc0ff440aa51c0c4cae45c06c6a8b641985c865b7a16bc84ad787a7e326fb` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/graph-render-scene.css` | `d8eb4ee57c69d2457f41fc9291359f263e46d3b2e96e16de51ead0d0a1cdeb97` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/labels.ts` | `d0039b3c9ea30e4c17bb599d50073018212ac5d11d9599d80baae339ba08cc15` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/renderColors.ts` | `89423e44977ee8a2dd613445cd93e8e4a67dc65239689be951dd4b0d65c45d19` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/transport.ts` | `829135f6976cc484b7092525b887596a038c10cbaf944f8994c6d1f269f30846` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/types.ts` | `9db6b7082b79303e9d7267de76c5b5dc3373cb825979c034531ea38777a39ed8` | Duplicate of original-react-graph |
| `dashboard/src/graph/render/useGraphRenderInteraction.ts` | `30a99a7a95b1d3f9c0c5a520e44eb55785ee4cf6773ef9f5a2c247c28723344b` | Duplicate of original-react-graph |
| `dashboard/src/host.ts` | `d86872405233b22afc49c4102161e1efd54c187e150ffdc5ecae1e33644fd3fa` | Duplicate of original-react-graph |
| `dashboard/src/knowledge/GraphSelectionInspector.tsx` | `deleted` | Duplicate of original-react-graph; obsolete inspector removed, no consumers |
| `dashboard/src/knowledge/KnowledgeGraph.tsx` | `902c8e43bd8bc1aed6b995f60ccff5853422104d6422056d54f29e8367899fa2` | Duplicate of original-react-graph |
| `dashboard/src/knowledge/KnowledgeInspector.tsx` | `e925f9c9938faf9e9f7c388c631ea61013b2bddad97901b6939b00ad09e4622d` | Duplicate of nongraph-direct-port |
| `dashboard/src/knowledge/KnowledgeNavigation.tsx` | `62849b4b388f6572c8d7ba944246d2d99611b3ead2c578b14dea3cfcc1dacfe5` | Unique dirty combination retained |
| `dashboard/src/knowledge/KnowledgePanel.tsx` | `11d8df4be6cc6c9133bfe4c16410bbe54e5fba7bb44e078e46c1799f14a90365` | Unique dirty combination retained |
| `dashboard/src/knowledge/KnowledgeRelationsEditor.tsx` | `cd5df12324ad2ff8ec968a4ed83d99f061b833e0051960a0cf8f11c7539511ad` | Duplicate of nongraph-direct-port |
| `dashboard/src/knowledge/KnowledgeScope.tsx` | `095cc09233c3794a71596695c20e42176438b9b921544fb95e028e76a20ab219` | Duplicate of nongraph-direct-port |
| `dashboard/src/knowledge/knowledge.css` | `3d8483e74f5c3eb83319c24e445dfea981a96e3e2bd0c570c86c80f14c5a05f3` | Unique dirty combination retained |
| `dashboard/src/setup.tsx` | `f96d8415a61aea3b026ad01ebbf4f643c284df8ac8571d401a963a2a7816364a` | Duplicate of nongraph-direct-port |
| `dashboard/src/sources.tsx` | `425f92f32c4cfc87d6987aa1b6169f790536491434f4be8d96cdf72f8c4bc7ae` | Duplicate of nongraph-direct-port |
| `dashboard/src/warlock-workflows.css` | `f6107aec3dc0a3788b8f707addc2240e20b1164fb3818df725d23ab892adaf51` | Duplicate of nongraph-direct-port |
| `dashboard/tests/graph-render-client.test.ts` | `0ab5f690dffe8b371c46345b226794d67830067da87c0f965f28cf7df0a30690` | Duplicate of original-react-graph |
| `dashboard/tests/knowledge-live.mjs` | `f3ae7e95948ac0ae5f2b6974c3dd293b491ae2e0c869c7f3cfa29aab56b94a20` | Unique dirty combination retained |
| `dashboard/tests/web-live.mjs` | `323e97fe90827393948dc100ad9763a857bbcc7f9e42f3a4e7c8681a5e8ac3b9` | Unique dirty combination retained |
| `desktop/plugin.js` | `d8b5898f7689cf8d2396ba52583b43d8c5276f1cc77c9ccfd02266057a1d6249` | Canonical source build; dirty output superseded |
| `desktop/tests/live-smoke.mjs` | `40c6a275e1c58bfaadb7e7fcf47faa33c7534309cdd958780c8ac4a06b9fd6b8` | Unique dirty combination retained |
| `docs/INDEX.md` | `b2e35150338cd941cfda13843be98f3d114b414d1ac699b3dd5bc500341773c1` | Unique dirty combination retained |
| `docs/ui-contract.md` | `606b7d603a9012ae6536fc6150327eec102ffbf3baec01a05d81278d8450e1fc` | Duplicate of original-react-graph |
| `docs/verification.md` | `5935fea89239a27244f3a3dfe9b72d3a9b9adbafaf2c16250b66db27c269ba72` | Graph release appendix plus dirty non-graph ledger link; no evidence removed |
| `docs/warlock-graph-original-vs-scalable-audit-2026-11-10.md` | `644c98aefeb40bedccc53a6abae3fb62b937fafc5a78fc9c2149dc977c4b9ba1` | Duplicate of original-react-graph |
| `docs/warlock-nongraph-ui-parity.md` | `bd6cbf94f57804436008bab5e169e3b2e7c207a771569827501fd678d79dd976` | Unique dirty combination retained |
| `docs/warlock-rich-scalable-graph-spec-2026-11-10.md` | `9ff7e26d465ea2264a483642ea84eec03f20810534348ccb6221765226ab7d0b` | Duplicate of original-react-graph |
| `host/src/graph_render.rs` | `0233d5cadcfaaa948d93f4c69acc8ed9d31fbf119f03b95f0c11b385ab5784d8` | Duplicate of original-react-graph |
| `host/src/graph_render_contract.rs` | `f020a4ce547e0ac78f16bd97c9e2c76a9140dcc5ca458b1a38541e692d7f85b0` | Duplicate of original-react-graph |
| `host/src/graph_render_contract_tests.rs` | `ae257d3970c314435806c7109aee8f7148ebf0c977f66805cf64824c79bf10ad` | Duplicate of original-react-graph |
| `host/src/graph_render_edge_projection.rs` | `dac806ab7ed928b24721a404a5259a5ce96216572f45630b771f6cecde47ebe5` | Duplicate of original-react-graph |
| `host/src/graph_render_edge_projection_model.rs` | `e3ef2d39d17f0f8845830b627627aac0e2f4e98773022ee3262abb2e4052cd31` | Duplicate of original-react-graph |
| `host/src/graph_render_generation.rs` | `3f6445433f1aa1d2f5fa561e423cdc0b3c5bb3977cb3e24acc85b46b6f8419e2` | Duplicate of original-react-graph |
| `host/src/graph_render_hierarchy.rs` | `90cbd600801488ce67f074b92d3ec65080266b64eb4cee4eb80a15c830186ed8` | Duplicate of original-react-graph |
| `host/src/graph_render_hierarchy_model.rs` | `9e93d0cda78d35c5d3fd8005242813bd07617b89387c9a2d2c280848a74e42b3` | Duplicate of original-react-graph |
| `host/src/graph_render_host.rs` | `70255166f62fa4502c158de7a61d0c418e9d25b4e486826492e3bb014d248250` | Duplicate of original-react-graph |
| `host/src/graph_render_layout.rs` | `2ed40bda1353b63107a0337bf40e8bba530a77f270c495772127cf1fb99bd7b4` | Duplicate of original-react-graph |
| `host/src/graph_render_layout_grid.rs` | `3f8ac62b4aa23c55fb8e919c34217558f66e34895d340c3f271470e16d6b55db` | Duplicate of original-react-graph |
| `host/src/graph_render_layout_tests.rs` | `79b5a12584400f4ccc04be2679cfb853349a379030fa644bf8b17349a3ceed45` | Duplicate of original-react-graph |
| `host/src/graph_render_manifest.rs` | `caf807e470391e4c24fa10354cff0f94a9f24b22588809bcb5bb0cf6182cf660` | Duplicate of original-react-graph |
| `host/src/graph_render_manifest_tests.rs` | `3af7b30334ff937df1dfb06e048d40198084b9fc268c0cc59b140f4cc2ea9e19` | Duplicate of original-react-graph |
| `host/src/graph_render_node_materialization.rs` | `3e646e8020bb1018ba588f88a6a681b68c1e1fb4d65e05b41d48d64fb9402919` | Duplicate of original-react-graph |
| `host/src/graph_render_prepare.rs` | `7d1e51ab973468a0158f955777dd2002f5656233289043c7472f529a4fafa189` | Duplicate of original-react-graph |
| `host/src/graph_render_reuse_tests.rs` | `8f2d37b488705e1dd91169885229a875d3fe7015c8becd84d0ff7821d1671d30` | Duplicate of original-react-graph |
| `host/src/graph_render_root_projection.rs` | `dd05f6f0df5648f787c224a9bfef703cc962aa0393cc1bf6259a3a42a6820d37` | Duplicate of original-react-graph |
| `host/src/graph_render_scale_tests.rs` | `12112dacf7f632e88acbc10bb9ed259a424255662d1dc51eab96ed0c57d671f2` | Duplicate of original-react-graph |
| `host/src/graph_render_source.rs` | `835f1101ea0bc08fea7e5f2f1773573ce3c0994473bb8f8e9eee1e9e620b5741` | Duplicate of original-react-graph |
| `host/src/service.rs` | `6fdab5437c2c23eec6958bd2517cae34317b8889b7e1b0bd0dfadb6c17d10213` | Duplicate of original-react-graph |
| `host/src/service_http.rs` | `80f40746c760800032b63010ae25ef5268130b30621c52e09fdd93f00f5a29a7` | Duplicate of original-react-graph |
| `patches/reliquary-fa574eec-filtered-graph-projection.patch` | `b1fe90f350b875ca05bf43b98e2bee695466ab338011a8af50a07e888f40e88f` | Superseded migration patch removed; public API committed in Root 538d22bd, original preserved in input history |
| `src/reliquary_hermes/client.py` | `5883fb069041e22e7c69268f1c0f759f151ad4bed5d2217fb19a0281135512cb` | Duplicate of original-react-graph |
| `src/reliquary_hermes/dashboard_api.py` | `f5c1f1e0e0a24847666fc0439f34136e74d238dcb29455be0073daf7d3a4545b` | Duplicate of original-react-graph |
| `src/reliquary_hermes/graph_render_api.py` | `5cb873021c762f0607683fb18b7c680d830a855df3c3c9ee268f1e8b164c0f28` | Duplicate of original-react-graph |
| `tests/test_graph_render_api.py` | `4151ddfd8bfac1e03b6a2c12245e4319a3e1df4187e371b2db67381b305cd5e8` | Duplicate of original-react-graph |

## Related docs

- [Consolidation specification](warlock-ui-integration-consolidation-spec-2026-11-10.md)
- [Verification](verification.md)
- [Non-graph source parity](warlock-nongraph-ui-parity.md)

## Root dependency verification

The deployed source checkout at `C:\Users\archa\Documents\Codex\2026-11-10\g\work\Reliquary` is clean at `538d22bdbe5040e3ba7fe69d31677425dcb7fc7e`. Its 660 tracked compile/source inputs match both the isolated API verification tree and the current sibling `C:\!bin\workspace\Reliquary` byte for byte. The latter checkout's branch, index and existing dirty work remain unchanged. Thus the path dependency compiles committed source bytes without requiring an uncommitted foreign patch or a task-specific Cargo path.

The isolated Root regression passed on verification commit `b56d46a3056d8f621e964f64ce3125ff3ef9048d`. All 64 host Rust source files also match the already deployed source. The existing executable and host pin both identify SHA-256 `722f9054e053a4a98575bd42a5c348297e066a4baaa60426b8ad3ef83bfeb96e`; they require no replacement.

## Additional integration correction

`src/reliquary_hermes/manual_delivery.py` now reconnects only completed local receipts across host shutdown and bounded transient read failures. Tests prove exact receipt/owner/digest rejection and no extra queue rows. This is a Sources lifecycle fix exposed by combined acceptance; no owner data, source-import policy, configuration, API schema or renderer changed. The hosted fixture uses a local processor before validation and awaits completion with the unchanged deadline and assertions.

## Notes

No REL/PHY owner, configuration, session routing or source enrollment is part of these source changes. Historical HU05/HU08 work remains out of scope. Cleanup requires ancestry and worktree ownership checks after acceptance.
