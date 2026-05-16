<!-- SPECKIT START -->
Active feature: **none** — SP-007 merged on `main` 2026-05-16. **Next: SP-008** (user-acceptance + Maya engagement-proxy gate). Begin with `/speckit-specify "008-user-acceptance"`.
Last sprint: [specs/007-install-first-run/RETROSPECTIVE.md](specs/007-install-first-run/RETROSPECTIVE.md)
Prior art (merged): [specs/006-hardening/plan.md](specs/006-hardening/plan.md) · [specs/005-retrieval/plan.md](specs/005-retrieval/plan.md) · [specs/004-classifier/plan.md](specs/004-classifier/plan.md) · [specs/003-ingest-pipeline/plan.md](specs/003-ingest-pipeline/plan.md) · [specs/002-mcp-resources/plan.md](specs/002-mcp-resources/plan.md) · [specs/001-local-only-mcp-foundation/plan.md](specs/001-local-only-mcp-foundation/plan.md) · [specs/007-install-first-run/plan.md](specs/007-install-first-run/plan.md)
SP-007 retrospective: [specs/007-install-first-run/RETROSPECTIVE.md](specs/007-install-first-run/RETROSPECTIVE.md)
SP-006 retrospective: [specs/006-hardening/RETROSPECTIVE.md](specs/006-hardening/RETROSPECTIVE.md)
Constitution (gates every plan): [.specify/memory/constitution.md](.specify/memory/constitution.md)
<!-- SPECKIT END -->

## SP-002 surface (what this repo ships now)

The MCP server registers four read-only resources alongside the SP-001 `corpus.find` tool:

| URI | List endpoint | Notes |
|---|---|---|
| `corpus://manifest` | `resources/list` | Auto-load annotation. Structural snapshot: doc_count, established_domains, established_tags, last_ingest_timestamp, schema/taxonomy versions. |
| `corpus://taxonomy` | `resources/list` | Promoted-only (Constitution XV). 4-axis envelope: domains, tags, types, source_types. |
| `corpus://recent` | `resources/list` | Last N=10 successful ingests, descending timestamp. Failure-lane + trash excluded. N configurable via `[resources.recent].window_size` in config.toml (range 1-100). |
| `corpus://docs/{id}` | `resources/templates/list` | RFC-6570 template. Per-doc body + frontmatter. The dereferencing target of every `corpus.find` SearchHit URI. |

Every read emits a `resource.read` telemetry event (success AND every failure path). New error envelopes: `-32002 server_initializing`, `-32010 document_not_found`, `-32011 index_locked` (retriable). The empty-baseline schema migration creates `documents` and `taxonomy_terms` SQLite tables; SP-003+ populates them.

SC-010 read-only enforcement is by construction: the `no-writes-from-resource-handlers` ESLint rule scopes the four resource handlers and four storage adapters; any INSERT/UPDATE/DELETE/CREATE/DROP/ALTER in `.exec()`/`.run()` or any `fs.write*`/`fs.append*`/`fs.mkdir*` call hard-fails the build.

## SP-004 surface (semantic classification)

The SP-003 daemon's post-persist hook now auto-invokes the SP-004 classify-stage on each newly-persisted row. A new `corpus reenrich [--dry-run]` CLI subcommand drains the sentinel-row backlog. Both surfaces invoke the SAME `classifyStage` function (Constitution VI — one pipeline, two policies).

**Trigger surfaces** (FR-CLASSIFY-016 commits to zero new MCP mutation surfaces):

- **Daemon post-persist hook** (`packages/daemon/src/index.ts`) — after each SP-003 drain success, re-acquires `Paths.drainLock()` (FR-CLASSIFY-015 drain-lock reuse), iterates `WHERE facet_type='unclassified' ORDER BY ingest_timestamp ASC`, invokes classifyStage under `batchPolicy`. Disable via `classifyEnabled: false` in DaemonOptions for tests / pre-Ollama setups.
- **CLI `corpus reenrich`** (`packages/cli/src/reenrich-command.ts`) — `corpus reenrich` (interactivePolicy + progress on stderr + summary on stdout) and `corpus reenrich --dry-run` (lists docs without Ollama calls or SQL UPDATEs). Concurrent invocation while a daemon drain holds the lock emits `pipeline.lock_contention` and exits 0.

**Telemetry classes emitted by classify-stage** (per Entity 6 of `specs/004-classifier/data-model.md`, 11 SP-004 variants in the `TelemetryEvent` Zod discriminated union; ≤ 4 KB per record):

`classify.started` · `classify.ollama_request` · `classify.ollama_response` · `classify.schema_invalid` · `classify.vocabulary_violation` · `classify.term_proposed` · `classify.completed` · `classify.failed` · `classify.ollama_unavailable` · `classify.batch_halted` · `classify.frontmatter_incomplete`

**Proposed-term routing contract** (FR-CLASSIFY-007 + Principle XV gate, not auto-trigger):

The classifier MAY emit `facet_domain_proposed: string` and/or `facet_tags_proposed: string[]` optional fields. Each entry that is NOT already in the established-vocabulary snapshot is INSERTed via `packages/storage/src/taxonomy-terms-adapter.ts insertProposedTerm(db, axis, term, signal)` — the SQL string contains a hardcoded `'proposed'` state literal; the function signature accepts no state parameter; the promoted-state INSERT is structurally impossible from any SP-004 code path (verified by `tests/integration/no-established-insert-in-sp004.test.ts`). `ON CONFLICT(axis, term) DO NOTHING` collapses duplicate proposals to a single row. `corpus://taxonomy` (SP-002 read contract) continues to surface only `state='established'` rows.

**Atomicity contract** (FR-CLASSIFY-008 + Decision F + ADR-CLASSIFIER-ATOMICITY):

The classify-persister commits the SQL UPDATE + 0..N taxonomy_terms INSERTs + body-file frontmatter rewrite (via `withTempDir` + atomic rename) in a single SQLite transaction (`BEGIN IMMEDIATE → UPDATE → INSERTs → rename → COMMIT`). The `AND facet_type='unclassified'` clause on the UPDATE is defense-in-depth idempotency per FR-CLASSIFY-012. On any failure: ROLLBACK + tmp body file cleanup + `<doc-id>.error.json` sidecar at `Paths.failed()`.

**Per-document budget** (Constitution XVI honesty — empirical, not target):

The SP-004 per-document classifier wall-clock budget is set to 60s (interactive policy) / 300s (batch policy) per Decision D. Empirical measurement against the user's pai-node01 with qwen3.5:9b on CPU is exercised end-to-end via `tests/integration/end-to-end-classify.test.ts` (mock-Ollama-driven for repeatable CI) + the live operator walkthrough in `specs/004-classifier/quickstart.md`. If qwen3.5:9b exceeds the budget on degenerate inputs, the fallback to `gemma3:4b` (Decision A) is a one-line config change in `config.toml [classifier].model`.

## SP-005 surface (hybrid retrieval — BM25 + dense + graph + confidence)

The SP-003 daemon's post-classify hook chain now extends with `retrievalOrchestrator` (`packages/pipeline/src/retrieval-orchestrator.ts`): after each successful classify, the daemon runs `embed-stage → edges-build-stage → BEGIN IMMEDIATE → index-stage + persistIndex → COMMIT` inside the same `Paths.drainLock()` window. The corpus.find MCP tool's handler (`packages/transport/src/corpus-find-tool.ts`) now delegates to `searchOrchestrator` (`packages/index/src/search.ts`) — the four-signal hybrid retriever (BM25 over FTS5 + dense cosine over sqlite-vec + bidirectional graph traversal over edges + confidence weighting). Zero new MCP mutation surfaces.

**Trigger surfaces** (FR-RETRIEVAL-017 — no new MCP surfaces):

- **Daemon post-classify hook** — `packages/daemon/src/index.ts` invokes `retrievalOrchestrator` after each successful `classifyStage` under `batchPolicy`. Disable via `retrievalEnabled: false` in `DaemonOptions` for tests / pre-Ollama setups.
- **CLI `corpus reindex`** — `packages/cli/src/reindex-command.ts` backfills `documents_fts` + `documents_vec` + `edges` for classified-but-unindexed rows. `--dry-run` lists candidates without Ollama HTTP calls or SQL writes. Drain-lock contention emits `pipeline.lock_contention` + exits 0.

**Telemetry classes** (14 SP-005 variants in `TelemetryEvent`):

`embed.started` · `embed.completed` · `embed.failed` · `index.started` · `index.completed` · `index.failed` · `edges.started` · `edges.completed` · `edges.failed` · `search.started` · `search.query` · `search.completed` · `search.degraded` · `search.error`

**Degraded-signals contract** (FR-RETRIEVAL-003 acceptance scenarios):

If ANY retriever fails (embedding unavailable, FTS5 corrupted, graph empty, confidence config missing), the orchestrator emits `search.degraded` + continues with the remaining signals; the response carries `degraded_signals: [...]` annotation as a successful MCP tool response (NOT a transport-level error). Only when ALL FOUR retrievers fail does the response become `{error_code: 'all_signals_failed', ...}` envelope.

**Atomicity contract** (FR-RETRIEVAL-007 + Constitution VIII):

The retrieval-orchestrator opens a single SQLite transaction wrapping the three SP-005 INSERTs: `INSERT INTO documents_fts(...) → INSERT INTO documents_vec(...) → INSERT OR IGNORE INTO edges(...)`. All three commit together OR none commit. The embedding HTTP call runs OUTSIDE the transaction (per R6 — embedding is multi-second and cannot block the writer). If embed/index/edges fails, the doc stays classified-but-unindexed and routes to `corpus reindex` for recovery.

**Confidence-weight config** (`config.toml [ranker.confidence_weights]` — defaults in `packages/index/src/confidence-adapter.ts DEFAULT_CONFIDENCE_WEIGHTS`):

`research-paper=1.20, manual=1.10, form=1.10, reference=1.10, article=1.00, notes=0.95, transcript=0.90, podcast=0.90, video=0.90, book=1.05`. Mapped onto the SCHEMA.md 7-value `facet_type` enum via the data-model.md §"Entity 6 Mapping (v1)" table. Recency boost: `+0.05` if `ingest_timestamp` is within the last 90 days. Unknown facet_type values default to 1.0.

**Per-document budget** (Decision L, Constitution XVI honesty):

Interactive policy: 10s embed / 5s index / 15s edges-build / 10s HTTP / 5s per-retriever SQL / 30s whole-search / topK=64. Batch policy: 30/10/60/30/10/60/64. Empirically: live-Ollama embedding of a 500-word excerpt completes sub-second on pai-node01; index + edges-build are sub-100ms for N ≤ 10k corpora.

**Tier 1/2/3 deferred** (FR-RETRIEVAL-010): SP-005's `tier_used` is hardcoded `'hybrid'`. Tier 1 (BM25-only when sub-20ms target), Tier 2 (grep-CATALOG when SQLite fails), Tier 3 (fs-grep when everything fails) — SP-006 scope (now ACTIVE — see SP-006 surface below).

## SP-006 surface (production hardening — kill-9 recovery + `corpus://failures` + tier 1/2/3 fallthrough)

The final substrate sprint. Three orthogonal deliverables — all read-only / idempotent / drain-lock-serialized; ZERO new MCP mutation surfaces; ZERO new SQL tables; ZERO new XDG bases.

**1. Kill-9 cross-stage recovery** (`packages/pipeline/src/recovery-scanner.ts` + daemon startup-hook extension): on daemon restart after SIGKILL/OOM-kill/power-loss, BEFORE accepting new ingest work the recovery scanner acquires `Paths.drainLock()`, scans `Paths.telemetry()` JSONL backwards to the most-recent `daemon.started` marker, builds a `(doc_id, stage)` orphan map, routes each orphan through the resumability matrix (Decision B), re-queues resumable orphans into existing SP-003 → SP-005 idempotent transitions, writes `<doc-id>.recovery.error.json` sidecars at `Paths.failed()` for non-resumable cases. Resumability matrix: `ingest` resumable IF inbox file present; `classify`/`embed`/`index`/`edges-build` ALL resumable (Constitution X idempotency contracts). The recovery scanner is itself idempotent (Scenario 5 — recovery-during-recovery detected via `recovery.scan_reentry` event).

**2. `corpus://failures` read-only MCP resource** (`packages/storage/src/failures-resource-adapter.ts` + `packages/transport/src/failures-resource-handler.ts`): the fifth MCP resource alongside SP-002's four. Globs `Paths.failed() + '/*.error.json'` AND `Paths.failed() + '/*.recovery.error.json'` (both SP-003 verbatim + SP-006 recovery sidecars surfaced uniformly). Query params `?stage=<stage>&since=<ISO date>&limit=<int>&offset=<int>`; defaults `stage=*, since=unbounded, limit=50, offset=0` (hard cap limit=1000). Response shape `{entries: FailureEntry[], total_count, returned_count, schema_version: 1}` — Zod-validated. Per-sidecar graceful degradation on malformed JSON via `failures.sidecar_parse_failed` events. Read-only by construction via `no-writes-from-resource-handlers` ESLint rule scoped over the new handler + adapter. The `sidecar_path` field is SP-006-added so operators can `rm` after triaging.

**3. Tier 1/2/3 fallthrough cascade** (`packages/index/src/tier-orchestrator.ts` + three new tier retrievers + CATALOG.md generator extension to SP-005's index-persister): when Tier 0 (the SP-005 four-signal hybrid retriever, unchanged) returns < `[search].min_results` (default=3) hits, the orchestrator falls through to Tier 1 (BM25-only against `documents_fts`), Tier 2 (in-process body grep over `Paths.data() + '/CATALOG.md'`), Tier 3 (`runTool('grep', ['-rn','-l','--include=*.md', <pattern>, Paths.docs()])` per Constitution XII subprocess hygiene). Each SearchHit carries a new `tier_used: z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])` field. Cascade is bounded by `config.toml [search].tier_total_budget_ms` (default 600 ms = 20 + 5 + 50 + 500 + 25 ms slack per §10.6) enforced via AbortController + setTimeout/clearTimeout (NEVER Promise.race(setTimeout) — Constitution VII forbidden). Per-tier targets per §10.6 are TARGETS not guarantees (Constitution XVI honest commitment at 5x aspirational).

**CATALOG.md generator** (FR-HARDEN-018): auto-generated at SP-005 index-stage time. SP-006 extends `packages/storage/src/index-persister.ts` to append a line after each successful index transaction (post-COMMIT — Constitution VIII transactional unit is the SQL writes; CATALOG.md is a flat-file mirror like the SP-004 body-file frontmatter). Format: `<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>`. `corpus reindex` (SP-006-extended) regenerates CATALOG.md wholesale. Lives at `Paths.data() + '/CATALOG.md'`. If absent (legacy DB), Tier 2 emits `search.tier_skipped` with `reason='catalog_missing'` and falls through to Tier 3.

**Telemetry classes** (14 SP-006 variants in `TelemetryEvent` + 1 updated SP-005 variant):

Recovery: `recovery.scan_started` · `recovery.scan_completed` · `recovery.scan_skipped` · `recovery.scan_reentry` · `recovery.orphan_found` · `recovery.resumed` · `recovery.aborted` · `recovery.telemetry_parse_failed` · `recovery.aborted_scan`

Failures resource: `failures.sidecar_parse_failed`

Tier fallthrough: `search.tier_fallthrough` · `search.tier_skipped` · `search.tier_failed` · `search.tier_budget_exceeded` · `search.completed` (UPDATED — `tier_used` field upgraded from `z.literal('hybrid')` to `z.enum([...])`)

**Drain-lock contract** (FR-HARDEN-006): the recovery scanner acquires `Paths.drainLock()` BEFORE reading telemetry AND before re-queueing. Concurrent CLI invocations (`corpus drain`, `corpus reenrich`, `corpus reindex`) during recovery emit `pipeline.lock_contention` + exit 0 (FR-INGEST-011 / FR-CLASSIFY-015 / FR-RETRIEVAL-018 contract preserved across the new recovery surface). Read paths (`corpus://failures`, `corpus.find` queries) are NOT gated by the drain-lock — Constitution III substrate reads are non-blocking.

**Trigger surfaces** (FR-HARDEN-024 — no new MCP surfaces beyond the read-only `corpus://failures`):

- **Daemon startup hook** — `packages/daemon/src/index.ts` invokes `await runRecoveryScan(deps, signal)` AFTER Ollama-availability check AND BEFORE watcher / classify-hook / embed-hook chain activation.
- **MCP resource handler** — `packages/transport/src/failures-resource-handler.ts` delegates to `failures-resource-adapter.ts`. Read-only by construction.
- **Tier orchestrator** — `packages/index/src/tier-orchestrator.ts` wraps the SP-005 `searchOrchestrator` as Tier 0 then cascades.

**SP-006 is the FINAL substrate sprint**: after merge, the corpus substrate is install-complete (SP-001..SP-006 all on `main`). Product / app sprints (v1.5+) build on top — retrieval-eval harness, CLI for failures cleanup, dimension-change migration, chunked embeddings, etc.

## SP-007 surface (install + 90-second first-run UX — `corpus init` + uninstall + taxonomy promote + failures CLI)

The install-completion sprint. SP-007 makes a clean Linux or macOS workstation with Node ≥ 18 + Ollama install-able in under 90 seconds via `npx @llm-corpus/cli init`. All four deliverables ship additively on `packages/cli/` + `packages/contracts/` only; ZERO new packages; ZERO new SQL tables; ZERO new `Paths.*` getters; ZERO new MCP mutation surfaces.

**1. `corpus init` 11-step pipeline + optional `--smoke` step 12** (`packages/cli/src/install-command.ts` + `packages/cli/src/install-helpers/*.ts`): the 11 steps are (1) preflight → (2) idempotency check → (3) XDG bringup → (4) SQLite singlefile → (5) `config.toml` → (6) curated taxonomy seed → (7) MCP-client config → (8) OS firewall → (9) auto-start unit (only if `--enable-autostart`) → (10) install-receipt → (11) next-step output. The whole pipeline is wrapped in a 90-second `AbortController` budget per FR-INSTALL-002 (NEVER `Promise.race(setTimeout)` — Constitution VII; uses `setTimeout + clearTimeout + controller.abort()`). On `--smoke` the harness adds a 12th step with its own 30-second sub-budget: spawn `corpus daemon`, copy `packages/cli/fixtures/first-run-seed.md` into `Paths.inbox()`, poll telemetry for `edges-build.completed`, spawn `corpus mcp` and invoke `corpus.find` via real MCP-stdio, assert ≥ 1 SearchHit; tear down. On any step failure the rollback walks the in-memory `InstallReceipt`'s recorded side-effects in reverse order. **Idempotent** per Constitution X: re-run on existing install is a no-op printing `"already initialized"` + exit 0.

**2. `corpus uninstall [--purge]` receipt-driven reverse** (`packages/cli/src/uninstall-command.ts`): reads `Paths.state()/install-receipt.json`, Zod-validates as `InstallReceiptZodSchema`, then reverses every recorded side-effect: (a) `mcpServers.corpus` removed from MCP-client config (preserving other entries; atomic via `withTempDir`); (b) firewall rules reversed via each recorded `reverse_command` through `runTool()`; (c) auto-start unit reversed (`systemctl --user disable --now corpus.service` or `launchctl unload <plist>`); (d) on `--purge` XDG subtree removed + receipt deleted; otherwise receipt marked `uninstalled: true` + `uninstalled_at: <now>` + XDG preserved. On missing/malformed receipt or platform mismatch: exit non-zero + ZERO destructive operations. SIGINT mid-flow records partial-uninstall state for idempotent resume.

**3. `corpus taxonomy promote` proposed→established CLI** (`packages/cli/src/taxonomy-promote-command.ts` + `packages/cli/src/install-helpers/taxonomy-promote-helpers.ts`): accepts `--axis=<v> --term=<t>` (repeatable) OR `--from-proposed-with-count-ge=<N>` (mutually exclusive — Zod XOR refinement). Acquires `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)`; opens `BEGIN IMMEDIATE`; UPDATEs `taxonomy_terms` rows from `state='proposed'` to `state='established'` and sets `established_at=datetime('now')` in a single transaction; releases lock. Idempotent on already-established (prints `"already established: <axis>/<term>"`, no SQL UPDATE). Missing-term throws `TaxonomyPromoteMissingTermError` with ZERO SQL writes. Lock contention emits `taxonomy.promote_lock_contention` + ZERO SQL writes. Closes C-045 (cold-start vocabulary UX gap).

**4. `corpus failures list | show` thin CLI** (`packages/cli/src/failures-command.ts`): human-operator surface over `Paths.failed()`. `list` is a paginated table or `--json` listing (filterable by `--stage=`, `--since=`, `--limit=`, `--offset=`); `show <doc-id>` prints the full sidecar JSON. **Read-only by construction** — reads `Paths.failed()` directly via `fs.readdir` + `fs.readFile`; never spawns an MCP server (the `corpus://failures` MCP resource is for AI agents). NO new MCP mutation surfaces per FR-INSTALL-023.

**5. Curated ≤ 50-term taxonomy seed** (`packages/cli/src/install-resources/taxonomy-seed.json`, 33 entries: 6 domain + 7 type + 13 tag + 7 source_type; all axis floors exceeded): bundled into the published package via `packages/cli/package.json` `files` field. Step 6 of the install pipeline INSERTs these as `state='established'` rows under drain-lock. Operator-authored taxonomy rows with the same `(axis, term)` are preserved via `INSERT OR IGNORE` (Constitution X idempotency).

**6. OS firewall provisioning per ADR-013** (`packages/cli/src/install-helpers/firewall-provisioner.ts`): UID-scoped rules (Constitution IV + ADR-001 path (b)). Linux uses `iptables -A OUTPUT -m owner --uid-owner <uid> ! -d 127.0.0.1/8 -j REJECT -m comment --comment llm-corpus` via `runTool()`; macOS uses `pfctl` with an anchor `corpus`. Sudo elevation handled via `runTool('sudo', ['iptables', ...])` with stdin/stderr 'inherit' so the operator sees the password prompt; sudo prompt NEVER logged in telemetry. Idempotent (existing-rule detection); captures the `reverse_command` into the install-receipt so uninstall is verbatim. ZERO string-formed shell commands per Constitution XII.

**Telemetry classes** (12 SP-007 variants in `TelemetryEvent`):

Install: `install.preflight_failed` · `install.step_failed` · `install.completed` · `install.smoke_started` · `install.smoke_completed` · `install.smoke_failed`

Uninstall: `uninstall.preflight_failed` · `uninstall.step_failed` · `uninstall.completed`

Taxonomy: `taxonomy.promote_completed` · `taxonomy.promote_lock_contention` · `taxonomy.promote_missing_term`

(Plus the existing SP-006 `pipeline.lock_contention` class re-used by `corpus taxonomy promote` per Edge Cases + SC-007-022.)

**Schema-gap resolution** (Engineer #3, 2026-05-16): the spec referenced a `proposed_count` column on `taxonomy_terms` that was never added by any SP-004..SP-006 migration. Adding one conflicted with "ZERO new SQL tables / columns" — instead, `runTaxonomyPromote --from-proposed-with-count-ge=<N>` computes the count at query time from `documents.facet_domain` / `documents.tags_json` / `documents.facet_type` / `documents.source_type` rows already written by the classifier persister. Lossless — the count IS the historical truth.

**Two explicit deferrals** (per FR-INSTALL-026 + FR-INSTALL-027 → C-043 + C-044, routed to post-SP-007 polish PR): C-043 (`signals_used: []` reporting bug in tier-orchestrator), C-044 (`regenerateCatalogFromDb` references non-existent `summary` column). Documented in `docs/SESSION_STATE.md`.

**SP-007 is the INSTALL-COMPLETION sprint**: after merge, the corpus substrate is operator-installable end-to-end on a clean Linux or macOS workstation with Node ≥ 18 + Ollama via `npx @llm-corpus/cli init` in ≤ 90 seconds. The next sprint (SP-008) builds on top with user-acceptance + Maya engagement-proxy gate.

# Working in this repo

This is a local-first knowledge substrate. Sixteen NON-NEGOTIABLE principles in [`.specify/memory/constitution.md`](.specify/memory/constitution.md) govern every change. Every feature plan must pass a 16-checkbox Constitution Check; violations require Complexity Tracking justification.

## Constitutional non-negotiables (top of mind)

- **I. No egress.** No code path may reach a non-localhost endpoint. Default inference + embedding + index adapters are local. Cloud fallback is forbidden in v1.0.0.
- **III. Substrate, not surface.** Two surfaces only: `corpus` CLI (one-shot text) and the MCP stdio transport. No HTTP server, no TUI, no browser, no agent-facing mutations.
- **VII. Cancellable, bounded IO.** Every external IO call takes an `AbortSignal`. `Promise.race` against `setTimeout` is forbidden — use `AbortController`.
- **XI. Library/CLI boundary.** No `process.exit` in `packages/{contracts,core,storage,index,inference,extract,pipeline}/`. Library functions return `Result<T, E>` or throw typed errors.
- **XII. Subprocess hygiene.** All subprocess invocation goes through `runTool(name, args[], opts)` with arg arrays. `execSync`, `exec`, and string-formed shell commands are forbidden.
- **XIII. Telemetry-or-die.** Every catch block emits a structured event before throwing or returning. AST-level lint enforcement lands in SP-003.
- **XIV. XDG paths.** Every path goes through `Paths.{data,state,config,cache}()`. The single user override is `CORPUS_HOME`. No writes outside `$HOME`.

The full 16 principles are in the constitution file. Read it before any non-trivial change.

## Source-of-truth hierarchy

When two artifacts disagree, the higher-numbered authority wins:

1. `WHITEPAPER-FINAL.md` — informational only.
2. `.product/CHARTER.md` — immutable. Original intent + WHITEPAPER SHA.
3. `.product/` non-charter artifacts — frozen at `pre-speckit-archive`. Reference-only.
4. `ARCHITECTURE-FINAL.md` — frozen at `pre-speckit-archive`. Reference-only.
5. `.specify/memory/constitution.md` — governing principles.
6. `specs/NNN-{slug}/spec.md` — per-feature specifications.
7. `specs/NNN-{slug}/plan.md` — per-feature plans (Constitution Check gated).
8. `specs/NNN-{slug}/tasks.md` — per-feature task lists.

## Workflow

Feature lifecycle uses spec-kit slash commands:

1. `/speckit-specify "feature description"` — creates `specs/NNN-{slug}/spec.md` and a feature branch.
2. `/speckit-clarify` — optional Q&A round.
3. `/speckit-plan` — produces `plan.md` after the Constitution Check gate.
4. `/speckit-tasks` — produces `tasks.md` from the locked plan.
5. `/speckit-implement` — executes tasks in order.

## Commit discipline

- Conventional Commits (`feat(scope): subject`, `fix(scope): subject`, etc.).
- Every commit on a feature branch references the feature slug in branch name or commit body.
- `--no-verify` is forbidden.
- Force-push to `main` is forbidden. Feature branches may be force-pushed by the author until merge.

## Stack

- TypeScript 5.5+ strict mode; Node.js 20+ runtime.
- npm workspaces monorepo under `packages/`.
- vitest for unit + integration testing.
- ESLint 9 flat config with six custom rules:
  - `no-forbidden-network-imports` — NFR-001 lint scope.
  - `no-process-exit-in-libs` — Constitution XI.
  - `paths-from-resolver-only` — Constitution XIV.
  - `no-direct-worker-spawn` — Constitution XII / NFR-002a.
  - `no-shell-string-exec` — Constitution XII.
  - `no-writes-from-resource-handlers` — SC-010 / Constitution III. Scoped to the four SP-002 resource-handler files and four storage adapters.
- `@modelcontextprotocol/sdk`, `undici`, `zod`, `better-sqlite3`, `sqlite-vec`, `js-yaml`, `@iarna/toml`.

## Extending

- New feature: run `/speckit-specify`. Stay strictly on the feature branch.
- New native addon: update the allowlist in `build/verify-native-addons.ts` AND cite the allowlist promotion in the feature plan's Complexity Tracking if the addon is not in `{better-sqlite3, sqlite-vec}`.
- New custom lint rule: add under `tools/eslint-rules/`, register in `eslint.config.js`, add a fixture suite under `tests/lint-fixtures/`.
- New egress primitive (uncommon): patch in `packages/transport/src/egress-hook.ts`, add a test pair (block + loopback passthrough), update `contracts/egress-hook-api.md`.
- New telemetry event class: add Zod schema in `packages/contracts/src/telemetry.ts` as a variant of the `TelemetryEvent` discriminated union, document in a new `contracts/telemetry-{class}-events.md`. SP-002 added `resource.read`.
- New MCP resource: add a Zod payload schema in `packages/contracts/src/resource-schemas.ts`, a read-only adapter in `packages/storage/`, a handler in `packages/transport/src/resource-{name}-handler.ts`, register via `BuiltMcpServer.registerStaticResource()` (or `registerResourceTemplate()` for URI templates) inside `startMcpServer()`. The `no-writes-from-resource-handlers` rule MUST be scoped to the new handler + adapter in `eslint.config.js`.

## Honesty rules (Constitution XVI)

- Performance numbers are targets, not guarantees.
- Cross-agent compatibility is a property of the MCP protocol, not a v1 user-validated feature.
- README, CLI `--help`, and any docs MUST NOT claim cross-agent compatibility as v1 user-validated.
- v1 ships no formal retrieval-evaluation harness; the 50-query labeled benchmark is Future Work (v1.5+).

## Verification gate (before commit)

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
npm run test:lint
npm test
npm run verify:native-addons
```

Root-gated tests (`LLM_CORPUS_ROOT_TESTS=1`) are optional outside CI; they run under `sudo` for the iptables/tcpdump SCs (SC-002, SC-004).
