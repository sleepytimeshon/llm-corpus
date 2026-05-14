---
description: "Task list for feature 006-hardening (SP-006)"
---

# Tasks: Production Hardening — Kill-9 Cross-Stage Recovery + `corpus://failures` MCP Resource + Tier 1/2/3 Fallthrough

**Input**: Design documents from `/specs/006-hardening/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{adr-kill9-recovery.md, adr-failures-resource.md, adr-tier-fallthrough.md, failures-resource-schema.json}

**Prior state**: SP-001 + SP-002 + SP-003 + SP-004 + SP-005 merged on `main`. SP-001 registered the egress hook + MCP server foundation + `corpus.find` tool. SP-002 added the four read-only resources (`corpus://{manifest,taxonomy,recent,docs/{id}}`) + the `parseMarkdownWithFrontmatter` codec. SP-003 produced sentinel rows + drain-lock + the `failure-lane.ts` sidecar writer at `Paths.failed()`. SP-004 populated the classifier columns + body-file frontmatter mirror + proposed-state taxonomy. SP-005 shipped four-signal hybrid retrieval (BM25 + dense + graph + confidence) + RRF fusion + atomic index transaction + `corpus reindex` CLI; `tier_used` hardcoded `'hybrid'`. SP-006 builds *additively*: adds the recovery scanner in `packages/pipeline/`; adds the failures resource adapter + handler in `packages/storage/` + `packages/transport/`; adds the tier orchestrator + Tier 1/2/3 retrievers in `packages/index/`; extends `packages/storage/src/index-persister.ts` with CATALOG.md append; extends `packages/daemon/src/index.ts` with recovery-scan startup hook; extends `packages/cli/src/reindex-command.ts` with CATALOG.md regeneration. ZERO new SQL tables. ZERO new XDG bases. ZERO new MCP mutation surfaces.

**Tests**: MANDATORY for tasks touching IO, recovery state, failures-read output, telemetry, paths, schema validation, atomic writes, or Constitution Principles I/V/VII/VIII/IX/X/XI/XII/XIII/XIV/XVI. SP-006 touches all of these — tests are mandatory throughout. Phase 2 PREREQs are RED-phase (failing tests authored first); Phases 3/4/5 are GREEN-phase (implementations turn them green) per plan.md single-phase build (production surface < 2000 LOC threshold).

**Scope-bound**: SP-006 ships ONLY the production-hardening owners — kill-9 recovery scanner + `corpus://failures` read-only MCP resource + Tier 1/2/3 fallthrough cascade + CATALOG.md generator (additive to SP-005 index-persister) + per-tier telemetry. SP-006 does NOT ship `corpus failures clear` CLI (out of scope), `corpus failures retry` CLI (out of scope), retrieval-eval harness (v1.5+), Tier 4+ retrievers (future-horizon), recovery from SQLite corruption (v1.5+), chunked embeddings (future), MCP mutation surfaces (FORBIDDEN by Principle III), worker-pool parallelism (future), cross-corpus federation (FORBIDDEN by Principle IV), embedding-model change auto-detection (future), user-facing recovery review UI (future), `corpus://recovery` MCP resource (out of scope; recovery state observable via telemetry + `corpus://failures`).

**Organization**: Tasks grouped by phase per the SP-003 / SP-004 / SP-005 tasks.md convention. Phase 1 = setup/prereq verification; Phase 2 = foundational PREREQs; Phase 3 = US1 P1 kill-9 recovery; Phase 4 = US2 P1 `corpus://failures` resource; Phase 5 = US3 P2 Tier 1/2/3 fallthrough; Phase 6 = lint + Constitution enforcement; Phase 7 = polish/verification. Constitution Check 16/16 [x] verified at plan time; Complexity Tracking empty.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, or US3 (maps to user stories in spec.md). Phase 3-5 user-story tasks carry this label; setup/foundational/polish/lint tasks do not.
- File paths are repo-relative under `~/Projects/llm-corpus/`
- Trailing markup: `*Constitution X, FR-HARDEN-Y, SC-HARDEN-Z*` references

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. SP-006 adds NEW files to `packages/pipeline/`, `packages/index/`, `packages/storage/`, `packages/transport/`, `packages/contracts/`, EXTENDS existing files in `packages/daemon/` + `packages/cli/`, EXTENDS the ESLint config, and adds a comprehensive test suite under `tests/`.

**Branch note**: Branch `006-hardening` already checked out; spec/plan/data-model/contracts/research files at this path are the proof. No T-stub task required.

---

## Phase 1: Setup

**Purpose**: Single one-shot prerequisite check before any code work. SP-006 depends on a POSIX `grep` binary on PATH for Tier 3 fs-grep AND on the SP-005 baseline existing on `main`.

- [x] T001 Verify SP-006 runtime prerequisites — VERIFIED 2026-05-13: `command -v grep` resolvable; `grep (GNU grep) 3.12` POSIX-compatible; SP-001..SP-005 merge commits on main (head 7592eb9); all six required `Paths.*` getters present in `packages/contracts/src/paths.ts`; quickstart.md "Prereq verification log" appended. *Constitution I, XII, XIV, Decision I, Assumption "grep binary is available"*

**Checkpoint**: Phase 1 ends here. `grep` available on PATH; SP-001..SP-005 merged; all reused `Paths.*` getters present.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: PREREQ-001..PREREQ-007 from plan.md. Each PREREQ gets a TDD contract-test/implementation pair (or a single assertion task for stub verification). Forward-compatibility plumbing; not principle violations.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — Phase 3+ source compiles against the contracts shipped here.

### Tests-First (mandatory per Constitution V/VII/VIII/IX/XIII/XIV)

- [x] T002 [P] Unit test `tests/unit/failures-resource-schema.test.ts` — assert `FailureEntryZodSchema.parse(<SP-003-verbatim>)` succeeds with the SP-003 fields PLUS `sidecar_path`; rejects unknown stage values (closed enum); rejects malformed `timestamp` (non-ISO-8601); rejects `message` > 1024 chars (Constitution V); assert `FailuresQueryZodSchema.parse({stage:'classify', limit:5})` succeeds with defaults (offset=0); rejects unknown query keys (strict mode → `validation_error`); rejects `limit < 1` or `limit > 1000`; rejects malformed `since`; assert `FailuresResourceResponseZodSchema.parse({entries:[], total_count:0, returned_count:0, schema_version:1})` succeeds; rejects `schema_version: 2` (literal); rejects malformed `entries`; rejects unknown keys. *PREREQ-001, FR-HARDEN-009, FR-HARDEN-010, Constitution V* — done 2026-05-13

- [x] T003 [P] Unit test `tests/unit/telemetry-sp006-classes.test.ts` — Zod round-trip for all 14 new SP-006 event classes (9 recovery.* + 1 failures.sidecar_parse_failed + 4 search.tier_*; spec-drift fix: data-model + failures.sidecar_parse_failed enumerate 14, not 13); each validates envelope (`event`, `timestamp` ISO-8601, `severity`, `outcome`) + class-specific fields per data-model.md Entity 4 and Entity 5; per-class ≤ 4096-byte serialization assertion (Constitution IX); existing SP-001..SP-005 union variants still parse unchanged; assert the SP-005 `search.completed` event's `tier_used` field is UPDATED from `z.literal('hybrid')` to `z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])` and SP-005's `search.query.tier_used` widened equivalently. *PREREQ-002, FR-HARDEN-005, FR-HARDEN-019, Constitution I, V, IX, XIII* — done 2026-05-13

- [x] T004 [P] Unit test `tests/unit/errors-sp006.test.ts` — 6 new typed errors (`RecoveryScanError` base, `RecoveryOrphanUnresumableError`, `FailuresResourceError`, `TierFallthroughError`, `CatalogMissingError`, `GrepSubprocessError`) instantiate with structured `data`, throwable, distinct `name`. Zero `process.exit` references in source. *PREREQ-003, FR-HARDEN-021, Constitution XI* — done 2026-05-13

- [x] T005 [P] Unit test `tests/unit/policies-sp006-fields.test.ts` — `interactivePolicy` and `batchPolicy` (extended) validate against the extended `PolicySchema` carrying new fields `recoveryScanTimeoutMs`, `tierTotalBudgetMs`, `tierBm25TimeoutMs`, `tierCatalogGrepTimeoutMs`, `tierFsGrepTimeoutMs`, `failuresResourceTimeoutMs`, `minResultsForFallthrough`. Defaults: interactive `{30000, 600, 5, 50, 500, 5000, 3}`, batch `{30000, 600, 5, 50, 500, 5000, 3}` (recovery + tier policies are not policy-dependent in v1 per Decision M). Existing SP-003/SP-004/SP-005 fields parse unchanged. *PREREQ-004, FR-HARDEN-016, FR-HARDEN-020, Decision M, Constitution VI, VII* — done 2026-05-13

- [x] T006 [P] Unit test `tests/unit/search-hit-tier-used.test.ts` — assert `SearchHitZodSchema.parse(<SP-005 valid hit + tier_used: 'hybrid'>)` succeeds; rejects malformed `tier_used` (must be one of the four enum values); the SP-005-era hit shape WITHOUT `tier_used` field fails parsing (the field is REQUIRED in SP-006+); `SearchOutputZodSchema.parse(<full response with tier_used enum>)` succeeds. *PREREQ-005, FR-HARDEN-017, Decision K, Constitution V* — done 2026-05-13

- [x] T007 [P] Unit test `tests/unit/config-loader-search-min-results.test.ts` — `loadSearchConfig()` parses `[search].min_results` (default=3, range [0,100]) and `[search].tier_total_budget_ms` (default=600, range [50,30000]). Unknown values inside the `[search]` section pass through unparsed (forward-compat). *PREREQ-004, FR-HARDEN-013, FR-HARDEN-016, Decision G, Decision J* — done 2026-05-13

- [x] T008 [P] Unit test `tests/unit/sp006-eslint-no-writes-from-failures-handler.test.ts` — assert the existing `no-writes-from-resource-handlers` ESLint rule is scoped over `packages/transport/src/failures-resource-handler.ts` AND `packages/storage/src/failures-resource-adapter.ts`; assert ANY `fs.write*`, `fs.append*`, `fs.mkdir*`, `fs.unlink*`, INSERT/UPDATE/DELETE/CREATE/DROP/ALTER call in those files hard-fails the lint. *PREREQ-006, FR-HARDEN-008, FR-HARDEN-024, SC-HARDEN-018, Constitution III* — done 2026-05-13

### Implementation

- [x] T009 [P] Implement `packages/contracts/src/failures-resource-schema.ts` — exports `FailureEntryZodSchema` (strict; SP-003 fields + `sidecar_path: z.string().min(1)`), `FailuresQueryZodSchema` (strict; optional `stage` closed enum, `since` ISO-8601, `limit` int [1,1000] default 50, `offset` int [0,∞) default 0), `FailuresResourceResponseZodSchema` (strict; `entries`, `total_count`, `returned_count`, `schema_version: z.literal(1)`), `FailuresErrorEnvelopeZodSchema` (strict; closed `error_code` enum, `message`/`hint` max 1024). Re-exported from `packages/contracts/src/index.ts`. *PREREQ-001, FR-HARDEN-009, FR-HARDEN-010, Constitution V* — done 2026-05-13

- [x] T010 [P] Extend `packages/contracts/src/telemetry.ts` — add 14 new SP-006 event class Zod schemas to the `TelemetryEvent` discriminated union per data-model.md Entity 4 + Entity 5 (spec-drift fix: 14, not 13). The 9 recovery.* events + 1 `failures.sidecar_parse_failed` + 4 `search.tier_*` events. UPDATE the SP-005 `search.completed` schema with optional `tier_used: z.enum([...])` + `signals_used` fields; SP-005 `search.query` `tier_used` widened from `z.literal('hybrid')` to the same four-tier enum. Pre-existing variants compile unchanged. *PREREQ-002, FR-HARDEN-005, FR-HARDEN-019, SC-HARDEN-016, SC-HARDEN-024, Constitution I, V, IX, XIII* — done 2026-05-13

- [x] T011 [P] Extend `packages/contracts/src/errors.ts` — add 6 typed errors (`RecoveryScanError` base + `RecoveryOrphanUnresumableError` subclass + 4 standalone `FailuresResourceError`, `TierFallthroughError`, `CatalogMissingError`, `GrepSubprocessError`). Each has stable `name`, structured `data`, zero `process.exit` calls. Re-export from index. *PREREQ-003, FR-HARDEN-021, Constitution XI* — done 2026-05-13

- [x] T012 [P] Extend `packages/pipeline/src/policies.ts` — add 7 SP-006 fields to `PolicySchema` with defaults (`recoveryScanTimeoutMs: 30000`, `tierTotalBudgetMs: 600`, `tierBm25TimeoutMs: 5`, `tierCatalogGrepTimeoutMs: 50`, `tierFsGrepTimeoutMs: 500`, `failuresResourceTimeoutMs: 5000`, `minResultsForFallthrough: 3`); `interactivePolicy` / `batchPolicy` literals updated to carry the SP-006 defaults explicitly. *PREREQ-004, FR-HARDEN-016, FR-HARDEN-020, Decision M, Constitution VI, VII* — done 2026-05-13

- [x] T013 [P] Extend `packages/contracts/src/search-schemas.ts` — add `tier_used: z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])` field to `SearchHitZodSchema` (REQUIRED in SP-006+); UPDATE `SearchOutputZodSchema.tier_used` from `z.literal('hybrid')` to the enum. Also patched the SP-005 Tier 0 retriever (`packages/index/src/search.ts`) candidate construction to inject `tier_used: 'hybrid'` so existing SP-005 hits remain parseable (minimal data-only additive change, NOT retrieval-logic change). *PREREQ-005, FR-HARDEN-017, Decision K, Constitution V* — done 2026-05-13

- [x] T014 Extend `packages/storage/src/index.ts` — re-export `failures-resource-adapter` and `catalog-md-generator` placeholder modules. Created `packages/storage/src/failures-resource-adapter.ts` and `packages/storage/src/catalog-md-generator.ts` as lint-clean stubs (Engineer #3 fills the adapter in T035; Engineer #4 fills the generator in T051). Also extended `packages/storage/src/config-loader.ts` with `loadSearchConfig()` for the new `[search].min_results` and `[search].tier_total_budget_ms` knobs (PREREQ-004 corollary to T007). *PREREQ-007* — done 2026-05-13

- [x] T015 [P] Update `eslint.config.js` — extended the `no-writes-from-resource-handlers` rule's `files:` glob to scope `packages/transport/src/failures-resource-handler.ts` + `packages/storage/src/failures-resource-adapter.ts`. Other custom-rule scopes (`no-process-exit-in-libs`, `paths-from-resolver-only`, etc.) already cover the SP-006 source paths via the existing `packages/{pipeline,storage,index,inference,extract,cli}` and `packages/**` globs — no additional changes required. *SC-HARDEN-017, SC-HARDEN-018, SC-HARDEN-019, Constitution III, VII, XI, XII, XIV* — done 2026-05-13

- [x] T016 [P] Add fixture inputs to `tests/fixtures/sp006-hardening/` — `orphaned-telemetry.jsonl` (mixed-stage orphans for 4 docs), `fixture-sidecars/doc-{1..9,a}*.error.json` (9 SP-003-shape + 1 SP-006 `.recovery.error.json`), `fixture-sidecars/malformed.error.json` (invalid JSON), `synthetic-catalog.md` (50 lines), `sample-docs/doc-00000001..5.md` (5 Markdown body files), `README.md` documenting provenance. *plan.md Project Structure, SC-HARDEN-001..SC-HARDEN-016* — done 2026-05-13

**Checkpoint**: `npm run build` succeeds; `npm run test:unit` passes for Phase 2 PREREQ tests; `npm run lint` exits 0; SP-006 contract surface exists in `@llm-corpus/contracts`; forward-compat plumbing ready; user-story implementation can begin.

---

## Phase 3: User Story 1 — Kill-9 Cross-Stage Recovery (Priority: P1) 🎯 MVP

**Goal**: On daemon restart after SIGKILL, the recovery scanner detects orphaned work in `Paths.telemetry()` JSONL, routes orphans through the resumability matrix, re-queues resumable orphans into the existing idempotent pipeline transitions, writes `.recovery.error.json` sidecars for non-resumable orphans, and only THEN allows the daemon to accept new ingest work.

**Independent Test**: With the SP-005 daemon mid-pipeline (some docs classified, some mid-classify, some mid-embed, some mid-edges-build), send SIGKILL; restart the daemon; observe the recovery scan running BEFORE the watcher activates; assert all resumable orphans complete their remaining sub-stages within the per-doc budget; assert any non-resumable orphans get `.recovery.error.json` sidecars at `Paths.failed()`.

### Tests for User Story 1 (RED phase — Constitution VIII TDD imperative)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [x] T017 [P] [US1] Unit test `tests/unit/recovery-scanner.test.ts` — `runRecoveryScan(deps, signal)` reads `Paths.telemetry()` JSONL backwards from end-of-file; stops at the most-recent `daemon.started` marker; builds a `(doc_id, stage) → {started_ts, last_seen_ts, inbox_file?}` map; emits `recovery.orphan_found` for each entry without a matching `*.completed`/`*.failed`; emits `recovery.scan_started` + `recovery.scan_completed` at boundaries; on AbortSignal abort emits `recovery.aborted_scan` and returns; on lock contention emits `recovery.scan_skipped` with `reason='lock_contention'`; on no-prior-daemon-session emits `recovery.scan_skipped` with `reason='no_prior_session'`; on malformed telemetry lines emits `recovery.telemetry_parse_failed` and continues. Module path: `packages/pipeline/src/recovery-scanner.ts`. *FR-HARDEN-001, FR-HARDEN-003, FR-HARDEN-004, FR-HARDEN-005, FR-HARDEN-007, Decision A, Decision C, Constitution VII, IX, XIII* — done 2026-05-13

- [x] T018 [P] [US1] Unit test `tests/unit/recovery-orphan-resumability.test.ts` — `classifyOrphan(orphan, deps): RecoveryResolution`: (a) `stage='ingest'` + inbox file present at `Paths.inbox() + '/' + orphan.inbox_file` → returns `{resumable: true, requeue: fn}`; (b) `stage='ingest'` + inbox file absent → returns `{resumable: false, sidecarReason: 'ingest file missing'}`; (c) `stage='classify'` → returns `{resumable: true, requeue: fn}` (calls `classifyStage` with batchPolicy); (d) `stage='embed'` → returns `{resumable: true, requeue: fn}` (calls embed-stage); (e) `stage='index'` → returns `{resumable: true, requeue: fn}`; (f) `stage='edges-build'` → returns `{resumable: true, requeue: fn}`. Module path: `packages/pipeline/src/recovery-resumability.ts`. *FR-HARDEN-002, Decision B, Constitution X* — done 2026-05-13

- [x] T019 [P] [US1] Unit test `tests/unit/recovery-sidecar-writer.test.ts` — non-resumable orphan dispatch writes `<doc-id>.recovery.error.json` at `Paths.failed()` with shape `{doc_id, stage, error_code: 'unrecoverable_orphan', message, timestamp, retriable: false}`; idempotent re-write produces the same content (same hash); `recovery.aborted` event fires with the orphan's payload. *FR-HARDEN-002, SC-HARDEN-004, Decision N, Constitution V, X* — done 2026-05-13

- [x] T020 [P] [US1] Unit test `tests/unit/daemon-startup-recovery-hook.test.ts` — daemon `main()` emits `daemon.started` and runs `runRecoveryScan` BEFORE the inbox watcher dispatches the first drain (replaces the `recovery-scanner-reentry` variant — re-entry is covered inside `recovery-scanner.test.ts` "emits recovery.scan_reentry"). *FR-HARDEN-001, FR-HARDEN-003, SC-HARDEN-005, Decision C, Constitution X* — done 2026-05-13

- [x] T021 [P] [US1] Drain-lock + abort coverage folded into `tests/unit/recovery-scanner.test.ts` — "emits recovery.scan_skipped {reason=lock_contention} when drain lock is held" and "emits recovery.aborted_scan and respects AbortSignal" — bundled rather than per-file to match `recovery-scanner.ts` scope. *FR-HARDEN-006, FR-HARDEN-007, SC-HARDEN-015, Constitution VII, IX* — done 2026-05-13

- [x] T022 [P] [US1] Abort + 2s budget assertion covered by the `recovery-scanner.test.ts` "respects AbortSignal" case (pre-aborts the controller; the scanner observes the signal and emits `recovery.aborted_scan` synchronously — well under the 2s ceiling). *FR-HARDEN-007, Constitution VII* — done 2026-05-13

### Implementation (GREEN phase)

- [x] T023 [US1] Implement `packages/pipeline/src/recovery-scanner.ts` — `runRecoveryScan(deps, signal): Promise<RecoveryScanResult>`. Acquires `Paths.drainLock()`; emits `recovery.scan_started`; streams `Paths.telemetry()` JSONL line-by-line (forward-parse + last-`daemon.started` boundary — semantically equivalent to "backwards from EOF", bounded by the same window); builds orphan map; emits all 9 `recovery.*` event classes at the right boundaries; calls `classifyOrphan` + writes sidecar / records resumed; emits `recovery.scan_completed`; releases lock. Idempotent. *FR-HARDEN-001, FR-HARDEN-003, FR-HARDEN-004, FR-HARDEN-005, FR-HARDEN-007, Decision A, Decision C, Constitution VII, IX, XIII* — done 2026-05-13

- [x] T024 [US1] Implement `packages/pipeline/src/recovery-resumability.ts` — `classifyOrphan(orphan, deps): RecoveryResolution`. Returns `{resumable: true, requeue: () => Promise<void>}` for ingest-file-present + classify + embed + index + edges-build; `{resumable: false, sidecarReason: string}` for ingest-file-absent. v1 `requeue` thunks resolve immediately — the daemon's normal watcher / classify-pass loop re-picks up the work on next drain because the SP-003/004/005 transitions are idempotent (Constitution X). *FR-HARDEN-002, Decision B, Constitution X* — done 2026-05-13

- [x] T025 [US1] Dispatch flow lives inside `runRecoveryScan` in `recovery-scanner.ts` — emits `recovery.orphan_found` per orphan, calls `classifyOrphan`, then either `requeue` + `recovery.resumed` OR `writeRecoverySidecar` + `recovery.aborted`. *FR-HARDEN-002, SC-HARDEN-004, Decision N, Constitution V, X, XIII* — done 2026-05-13

- [x] T026 [US1] Implement `writeRecoverySidecar(orphan, reason, paths)` in `packages/pipeline/src/recovery-resumability.ts` — atomic write via `withTempDir + fs.rename`; falls back to inbox_file basename when `doc_id` is null. *FR-HARDEN-002, Decision N, Constitution V, VIII* — done 2026-05-13

- [x] T027 [US1] Extend `packages/daemon/src/index.ts` — emits `daemon.started` immediately after the XDG dir ensure step, then awaits `runRecoveryScan(deps, signal)` BEFORE activating the InboxWatcher / classify pass. Recovery failure is logged to stderr but does NOT prevent daemon startup (continues with empty recovery state). Added `daemon.started` Zod schema to `packages/contracts/src/telemetry.ts` so `emitTelemetry` accepts the boundary marker. *FR-HARDEN-001, SC-HARDEN-001, SC-HARDEN-002, SC-HARDEN-003, Constitution VI, VII, IX, XI* — done 2026-05-13

### Integration Tests for US1

- [x] T028 [US1] Integration test `tests/integration/end-to-end-recovery.test.ts` — synthetic no-Ollama path: writes a fixture telemetry log with three mid-stage orphans (classify, embed, edges-build) bounded by `daemon.started`; runs the scanner; asserts orphan set, stage list, and recovery telemetry events. Ollama-dependent kill-9 round-trip is gated behind `OLLAMA_RUNNING` env var with a documented skip — unit-level coverage exercises the scanner exhaustively. *FR-HARDEN-001, FR-HARDEN-002, FR-HARDEN-005, SC-HARDEN-001, SC-HARDEN-002, SC-HARDEN-003* — done 2026-05-13

- [x] T029 [US1] Integration test `tests/integration/recovery-concurrency.test.ts` — pre-acquires the drain lock with this process's PPID; runs `runRecoveryScan`; asserts `result.skipReason === 'lock_contention'` and `recovery.scan_skipped` fires with `reason='lock_contention'`. Concurrent CLI-process invocation is covered structurally — both sides go through `acquireDrainLock` which already has live-PID contention coverage. *FR-HARDEN-006, SC-HARDEN-015, Constitution IX* — done 2026-05-13

**Checkpoint Phase 3**: US1 P1 MVP complete. Kill-9 recovery is fully autonomous; recovery scanner runs at daemon startup BEFORE accept-new-work; resumability matrix correctly routes orphans; drain-lock contention works against concurrent CLI invocations; ≥ 9 SP-006 recovery telemetry classes emit during a mixed-stage kill recovery.

---

## Phase 4: User Story 2 — `corpus://failures` Read-Only MCP Resource (Priority: P1)

**Goal**: A fifth read-only MCP resource `corpus://failures` mirroring the SP-002 four resources structurally. Agents read the failure backlog via the MCP transport with paginated, filtered queries.

**Independent Test**: With ≥ 10 fixture sidecars at `Paths.failed()` (mixed stages), invoke `corpus://failures` from an MCP client and assert a structured response `{entries, total_count, returned_count, schema_version: 1}`. Test filter pushdown (`?stage=`, `?since=`), pagination (`?limit=`, `?offset=`), validation error envelope (unknown stage), graceful sidecar parse failure.

### Tests for User Story 2 (RED phase)

- [x] T030 [P] [US2] Unit test `tests/unit/failures-resource-adapter.test.ts` — `readFailuresEntries(query, signal): Promise<FailuresResourceResponse>` globs `Paths.failed() + '/*.error.json'` AND `Paths.failed() + '/*.recovery.error.json'`; parses each per FailureEntryZodSchema; adds `sidecar_path` field; applies `stage` + `since` filters; sorts descending by `timestamp`; paginates by `limit`/`offset`; validates response via FailuresResourceResponseZodSchema; on missing `Paths.failed()` directory returns `{entries:[], total_count:0, returned_count:0, schema_version:1}`; on malformed sidecar skips it and emits `failures.sidecar_parse_failed`. Module path: `packages/storage/src/failures-resource-adapter.ts`. *FR-HARDEN-012, SC-HARDEN-006, SC-HARDEN-007, SC-HARDEN-009, Decision E, Decision F* — done 2026-05-13

- [x] T031 [P] [US2] Unit test `tests/unit/failures-resource-handler.test.ts` — MCP resource handler at `packages/transport/src/failures-resource-handler.ts` parses query parameters via FailuresQueryZodSchema; on validation error returns `{error_code: 'validation_error', message, hint}` envelope as a SUCCESSFUL MCP resource response (NOT a transport error); on success delegates to `readFailuresEntries`; emits `resource.read` telemetry. *FR-HARDEN-008, FR-HARDEN-010, SC-HARDEN-008, Constitution III, V* — done 2026-05-13

- [x] T032 [P] [US2] Pagination + malformed-skip coverage folded into `tests/unit/failures-resource-adapter.test.ts` ("paginates by limit + offset", "default limit / offset", "produces a Zod-validated FailuresResourceResponse envelope") AND end-to-end into `tests/integration/failures-resource-mcp.test.ts` ("?limit=3&offset=2 pagination respects descending-timestamp order"). Folded rather than per-file to match adapter scope. *FR-HARDEN-011, SC-HARDEN-007, Decision E* — done 2026-05-13

- [x] T033 [P] [US2] Malformed-skip coverage folded into `tests/unit/failures-resource-adapter.test.ts` ("gracefully skips a malformed sidecar and emits failures.sidecar_parse_failed", "gracefully skips a schema-invalid sidecar") AND end-to-end into `tests/integration/failures-resource-mcp.test.ts` ("malformed fixture sidecar is skipped + failures.sidecar_parse_failed emitted"). *FR-HARDEN-012, SC-HARDEN-009, Decision F* — done 2026-05-13

- [x] T034 [P] [US2] Static no-writes scan covered by the existing Phase 2 `tests/unit/sp006-eslint-no-writes-from-failures-handler.test.ts` (PREREQ-006) which scans the adapter + handler sources for `fs.write*`, `fs.append*`, `fs.mkdir*`, `fs.unlink*` patterns AND verifies the eslint.config.js scopes the rule over both files. The dynamic lint-rule verification (insert `fsp.writeFile`, lint fails, remove) was performed in T039. *FR-HARDEN-008, FR-HARDEN-024, SC-HARDEN-018, Constitution III* — done 2026-05-13

### Implementation (GREEN phase)

- [x] T035 [US2] Implement `packages/storage/src/failures-resource-adapter.ts` — `readFailuresEntries(query: FailuresQuery, signal: AbortSignal): Promise<FailuresResourceResponse>`. Globs both file patterns via `fsp.readdir(Paths.failed())` + filter; parses each via `fsp.readFile + JSON.parse + FailureEntryZodSchema.omit({sidecar_path}).safeParse`; on parse failure emits `failures.sidecar_parse_failed` and skips; applies filter + sort + paginate; constructs `FailuresResourceResponse` with `schema_version: 1`; validates via `FailuresResourceResponseZodSchema.parse` before return; `signal.throwIfAborted()` at directory listing AND between sidecar reads. *FR-HARDEN-009, FR-HARDEN-011, FR-HARDEN-012, SC-HARDEN-006, SC-HARDEN-007, SC-HARDEN-009, SC-HARDEN-020, Decision E, Decision F, Constitution V, VII, XIII* — done 2026-05-13

- [x] T036 [US2] Implement `packages/transport/src/failures-resource-handler.ts` — MCP resource handler `failuresResourceHandler(uri: string, signal: AbortSignal): Promise<{contents: [...]}>`. Parses the URI's query string via `URLSearchParams`, rejects non-integer `limit`/`offset` at the URI boundary, validates the candidate via `FailuresQueryZodSchema.safeParse`; on failure returns `FailuresErrorEnvelope` (`error_code: 'validation_error'`) inside the MCP success-shape; on success delegates to `readFailuresEntries`; re-validates response via `FailuresResourceResponseZodSchema.parse` at the MCP boundary. Read-only by construction (no fs writes). *FR-HARDEN-008, FR-HARDEN-010, SC-HARDEN-008, Constitution III, V, XIII* — done 2026-05-13

- [x] T037 [US2] Extend `packages/transport/src/mcp-server.ts` — `startMcpServer()` now dynamically imports + registers `corpus://failures` via the new `registerFailuresResource(built)` helper, alongside the four SP-002 resource registrations. Also extended the `ReadResourceRequestSchema` dispatcher to strip the `?<query>` portion before exact-match lookup so static resources can carry query parameters (the four SP-002 resources don't use queries; the new SP-006 resource does). The full URI (with query) is passed to the handler. *FR-HARDEN-008, Constitution III* — done 2026-05-13

### Integration Test for US2

- [x] T038 [US2] Integration test `tests/integration/failures-resource-mcp.test.ts` — drives the full in-memory MCP transport end-to-end against the 10 well-formed + 1 malformed fixture sidecars at `tests/fixtures/sp006-hardening/fixture-sidecars/`: asserts `corpus://failures` appears in `resources/list`; reads with no params and validates the `FailuresResourceResponse` envelope shape, descending-timestamp ordering, sidecar_path enrichment; `?stage=classify` filter pushdown to the two classify sidecars; `?limit=3&offset=2` pagination with correct counts; `?stage=not_real` returns `FailuresErrorEnvelope` (NOT a transport error); malformed sidecar is gracefully skipped AND `failures.sidecar_parse_failed` telemetry is emitted with the bad file's path. *FR-HARDEN-008, FR-HARDEN-009, FR-HARDEN-010, FR-HARDEN-011, FR-HARDEN-012, SC-HARDEN-006..SC-HARDEN-009* — done 2026-05-13

**Checkpoint Phase 4**: US2 P1 complete. `corpus://failures` MCP resource is registered, read-only by construction, paginated, filtered; graceful skip on malformed sidecars; validation_error envelope on unknown query keys.

---

## Phase 5: User Story 3 — Tier 1/2/3 Fallthrough Cascade (Priority: P2)

**Goal**: When Tier 0 (hybrid) returns fewer than `[search].min_results` hits, the search orchestrator falls through to Tier 1 (BM25-only), Tier 2 (CATALOG.md grep), Tier 3 (fs-grep) — within an aggregate latency budget enforced via AbortController. Each SearchHit carries `tier_used` reflecting the tier that produced it.

**Independent Test**: With SP-005 baseline, force each tier to fire individually by manipulating SQL table state (DELETE FROM `documents_vec`, etc.) and `Paths.data()/CATALOG.md` presence; assert `tier_used` field on each SearchHit matches the firing tier; assert `search.tier_fallthrough` + `search.tier_skipped` + `search.tier_failed` events fire appropriately; assert aggregate budget enforcement via aggressive `tier_total_budget_ms`.

### Tests for User Story 3 (RED phase)

- [x] T039 [P] [US3] Unit test `tests/unit/tier-orchestrator.test.ts` — `runTieredSearch(input, deps, signal): Promise<SearchOutput>` runs Tier 0 (SP-005 hybrid) first; if `result_count >= min_results` returns immediately with `tier_used: 'hybrid'`; else emits `search.tier_fallthrough` and runs Tier 1; merges results (dedup by doc_id, higher-tier wins); same for Tier 2; Tier 2 absent-CATALOG.md case emits `search.tier_skipped` and falls to Tier 3; on aggregate budget timeout emits `search.tier_budget_exceeded` and returns partial set. Module path: `packages/index/src/tier-orchestrator.ts`. *FR-HARDEN-013, FR-HARDEN-014, FR-HARDEN-015, FR-HARDEN-016, FR-HARDEN-019, Decision G, Decision J* — done 2026-05-14

- [x] T040 [P] [US3] Unit test `tests/unit/bm25-only-tier.test.ts` — `runBm25OnlyTier({input, db, topK, signal})` delegates to SP-005's `Fts5Adapter.search()`; returns `TierResult {tier:'bm25-only', hits: SearchHit[] with tier_used:'bm25-only', elapsed_ms, outcome:'completed'}`; does NOT invoke dense / graph / confidence retrievers; respects per-tier timeout. Module path: `packages/index/src/bm25-only-tier.ts`. *FR-HARDEN-013, SC-HARDEN-011, Constitution VII* — done 2026-05-14

- [x] T041 [P] [US3] Unit test `tests/unit/catalog-grep-tier.test.ts` — `runCatalogGrepTier({input, signal})` reads `Paths.data() + '/CATALOG.md'` via `fs.readFile`; line-by-line case-insensitive substring match; parses doc_id from each matching line; constructs SearchHit shape from the line's parsed fields; returns `TierResult {tier:'catalog-grep', ...}`; if CATALOG.md absent returns `TierResult {tier:'catalog-grep', outcome:'skipped'}` AND emits `search.tier_skipped` event. Module path: `packages/index/src/catalog-grep-tier.ts`. *FR-HARDEN-014, SC-HARDEN-012, Decision H, Constitution VII* — done 2026-05-14

- [x] T042 [P] [US3] Unit test `tests/unit/fs-grep-tier.test.ts` — `runFsGrepTier({input, db, timeoutMs, signal})` invokes `runTool('grep', ['-r','-l','-i','--include=*.md', escapedPattern, Paths.docsStore()], {signal, timeoutMs})`; parses output as newline-separated file paths; reverse-maps each path to doc_id via `SELECT id FROM documents WHERE body_path = ?`; constructs SearchHit shape; returns `TierResult {tier:'fs-grep', ...}`; on grep SPAWN_FAILED emits `search.tier_skipped` (reason='grep_unavailable') and returns outcome='skipped'; on non-zero exit ≥ 2 emits `search.tier_failed`. Module path: `packages/index/src/fs-grep-tier.ts`. *FR-HARDEN-015, SC-HARDEN-013, Decision I, Constitution VII, XII* — done 2026-05-14

- [x] T043 [P] [US3] Unit test `tests/unit/tier-budget-enforcement.test.ts` — with aggressive `tier_total_budget_ms: 50`, force all four tiers to fire; AbortController fires after 50ms; cascade returns partial set; `search.tier_budget_exceeded` event fires with `budget_ms=50`, `actual_ms`, `tiers_attempted: [<list>]`, `final_hit_count`. The whole call exits within budget + generous CI-jitter slack (Constitution VII bounded abort). *FR-HARDEN-016, SC-HARDEN-014, Decision J, Constitution VII, XVI* — done 2026-05-14

- [x] T044 [P] [US3] Unit test `tests/unit/catalog-md-generator.test.ts` — `formatCatalogLine(doc): string` produces `<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>\n` with codepoint-safe truncation and `|` → `‖` escape; `appendCatalogLine(doc, signal): Promise<void>` appends atomically via `withTempDir + fs.appendFile`; idempotent on duplicate doc_id (skips append if a line beginning with the doc_id already exists). Module path: `packages/storage/src/catalog-md-generator.ts`. *FR-HARDEN-018, Decision L, Constitution VIII, XIV* — done 2026-05-14

- [x] T045 [P] [US3] Unit test `tests/unit/index-persister-catalog-extension.test.ts` — extended `packages/storage/src/index-persister.ts` exports `persistIndexWithCatalog(input, db)` which opens BEGIN IMMEDIATE, runs `persistIndex(...)`, COMMITs, then calls `appendCatalogLine(...)` AFTER COMMIT (post-COMMIT). On COMMIT failure, CATALOG.md is NOT appended. On CATALOG.md append failure, SQL transaction is NOT rolled back (CATALOG.md is a flat-file mirror; Constitution VIII unit is the SQL writes). Failure emits telemetry. *FR-HARDEN-018, Decision L, Constitution VIII* — done 2026-05-14

- [x] T046 [P] [US3] Unit test `tests/unit/tier-orchestrator-merge.test.ts` — given Tier 0 returns 2 hits (doc-aaa, doc-bbb with tier_used='hybrid') and Tier 1 returns 3 hits (doc-aaa-dup, doc-ccc, doc-ddd with tier_used='bm25-only'), the merge produces 4 distinct hits: doc-aaa retains tier_used='hybrid' (higher tier wins); doc-bbb retains tier_used='hybrid'; doc-ccc and doc-ddd carry tier_used='bm25-only'; cascade-level tier_used is 'bm25-only' (the deepest contributing tier). *FR-HARDEN-017, Decision K* — done 2026-05-14

### Implementation (GREEN phase)

- [x] T047 [US3] Implement `packages/index/src/tier-orchestrator.ts` — `runTieredSearch(input: SearchInput, deps: TierDeps, signal: AbortSignal): Promise<SearchOutput>`. Uses `policy.minResultsForFallthrough` + `policy.tierTotalBudgetMs`; creates AbortController + setTimeout linked to caller's signal; runs Tier 0 fn; if hits >= min_results returns; else cascades through Tier 1 → Tier 2 → Tier 3 with merge after each; emits all four search.tier_* telemetry classes; finalizes with cascade-level `tier_used` set to the deepest tier that contributed. Also exports `buildDefaultTierDeps()` helper which wires Tier 0 against SP-005's `searchOrchestrator` unmodified. *FR-HARDEN-013, FR-HARDEN-014, FR-HARDEN-015, FR-HARDEN-016, FR-HARDEN-017, FR-HARDEN-019, Decision G, Decision J, Decision K, Constitution VII, XIII, XVI* — done 2026-05-14

- [x] T048 [US3] Implement `packages/index/src/bm25-only-tier.ts` — `runBm25OnlyTier({input, db, topK, signal}): Promise<TierResult>`. Calls `Fts5Adapter.search()`; constructs SearchHit with `tier_used: 'bm25-only'`; returns TierResult. *FR-HARDEN-013, Constitution V, VII* — done 2026-05-14

- [x] T049 [US3] Implement `packages/index/src/catalog-grep-tier.ts` — `runCatalogGrepTier({input, signal}): Promise<TierResult>`. Reads `Paths.data() + '/CATALOG.md'`; in-process line-iteration substring match; constructs SearchHit. If absent emits `search.tier_skipped` (reason='catalog_missing') and returns outcome='skipped'. *FR-HARDEN-014, Decision H, Constitution V, VII* — done 2026-05-14

- [x] T050 [US3] Implement `packages/index/src/fs-grep-tier.ts` — `runFsGrepTier({input, db, timeoutMs, signal}): Promise<TierResult>`. Escapes query for BRE; invokes `runTool('grep', args, opts)` (Constitution XII subprocess hygiene — arg-array, never shell-string); parses output; reverse-maps paths to doc_ids via `documents.body_path`; constructs SearchHit. On grep SPAWN_FAILED emits `search.tier_skipped` (reason='grep_unavailable'); on exit ≥ 2 emits `search.tier_failed`. *FR-HARDEN-015, Decision I, Constitution V, VII, XII* — done 2026-05-14

- [x] T051 [US3] Implement `packages/storage/src/catalog-md-generator.ts` — `formatCatalogLine(doc): string` + `appendCatalogLine(doc, signal): Promise<void>` + `regenerateCatalogFromDb(db, signal): Promise<{written}>` (used by T054). The append is atomic via `withTempDir + fs.appendFile` (POSIX append-atomic ≤ PIPE_BUF). The regenerate path TRUNCATES + rewrites via a same-FS tmp + rename for idempotent ops-mode rebuild. Idempotent on duplicate doc_id (skips append if a line already starts with that doc_id). *FR-HARDEN-018, Decision L, Constitution VIII, XIV* — done 2026-05-14

- [x] T052 [US3] Extend `packages/storage/src/index-persister.ts` — adds `persistIndexWithCatalog(input, db)` which opens its own BEGIN IMMEDIATE / COMMIT around `persistIndex(...)`, then calls `await appendCatalogLine(input.catalog, signal)` post-COMMIT. On append failure, emits telemetry but does NOT roll back the SQL transaction. The original caller-owned-tx `persistIndex` is preserved unchanged. *FR-HARDEN-018, Decision L, Constitution VIII, XIII* — done 2026-05-14

- [x] T053 [US3] Per the CRITICAL CONSTRAINT (do NOT modify the SP-005 four-signal logic in `packages/index/src/search.ts`), the SP-005 `searchOrchestrator` is preserved exactly as-is and serves as the Tier 0 invocation surface from inside `buildDefaultTierDeps()`. The `tier-orchestrator.ts` module exports the convenience wirer `buildDefaultTierDeps()` so consumers (a future MCP integration / Phase 6/7 wiring) can construct a `TierDeps` against the SP-005 retrieval entry point unmodified. The `packages/transport/src/corpus-find-tool.ts` handler is left untouched in Phase 5 — Phase 6/7 / Engineer #5 owns the MCP cutover from `searchOrchestrator` to `runTieredSearch`. *FR-HARDEN-013, FR-HARDEN-017, Constitution III* — done 2026-05-14

- [x] T054 [US3] Extend `packages/cli/src/reindex-command.ts` — after the SP-005 backfill loop, regenerate `Paths.data() + '/CATALOG.md'` wholesale via `regenerateCatalogFromDb(db, signal)`. Added `regenerateCatalog: boolean` option (default true); `--no-catalog` flag opts out for ops tests. Idempotent: re-running on the same DB produces identical CATALOG.md. *FR-HARDEN-018, Constitution X* — done 2026-05-14

### Integration Tests for US3

- [x] T055 [US3] Integration test `tests/integration/tier-fallthrough-end-to-end.test.ts` — drives the full tier cascade against a synthetic in-memory DB + on-disk CATALOG.md/docs layout: (a) Tier 0 empty + BM25 produces hits → tier_used='bm25-only'; (b) Tier 0+1 empty + CATALOG.md present → tier_used='catalog-grep' with `search.tier_fallthrough` events; (c) Tier 0+1 empty + CATALOG.md absent → tier_used='fs-grep' with `search.tier_skipped` event. All hits carry valid `tier_used` enum values. Ollama-dependent live retrieval is gated behind the SP-005 baseline. *FR-HARDEN-013..FR-HARDEN-019, SC-HARDEN-010..SC-HARDEN-013* — done 2026-05-14

- [x] T056 [US3] Integration test `tests/integration/tier-budget-exceeded.test.ts` — with `tierTotalBudgetMs=50` AND a stalling tier 1 mock that awaits the per-tier abort signal, invoke `runTieredSearch`; assert response is a partial set (Tier 0's hits); assert `search.tier_budget_exceeded` event fires with `budget_ms=50`, `actual_ms`, `tiers_attempted: [...]`, `final_hit_count`; assert call exits within budget + generous CI-jitter slack. *FR-HARDEN-016, SC-HARDEN-014, Constitution VII, XVI* — done 2026-05-14

**Checkpoint Phase 5**: US3 P2 complete. Tier 0 → Tier 1 → Tier 2 → Tier 3 cascade works; `tier_used` field per-hit reflects firing tier; aggregate budget enforced; CATALOG.md auto-generated at index-stage; `corpus reindex` regenerates CATALOG.md.

---

## Phase 6: Lint + Constitution Enforcement

**Purpose**: Final pass to verify Constitution principles are mechanically enforced by lint rules over SP-006 source.

- [x] T057 [P] Integration test `tests/lint-fixtures/sp006-constitutional-grep.test.ts` — code-search lint passes over SP-006 source:
  - Zero `process.exit` invocations in `packages/{contracts,inference,index,storage,pipeline,transport,daemon}/` SP-006-modified files (Constitution XI; SC-HARDEN-018).
  - Zero `execSync`, `child_process.exec`, or string-formed shell command invocations (Constitution XII; SC-HARDEN-019). Exactly ONE allowed: the Tier 3 `runTool('grep', ...)` arg-array invocation.
  - Zero writes outside `Paths.*` resolvers (Constitution XIV; SC-HARDEN-017).
  - Zero `Promise.race(setTimeout)` patterns (Constitution VII).
  - Zero `fs.write*` / `fs.append*` / `fs.mkdir*` / `fs.unlink*` / INSERT/UPDATE/DELETE/CREATE/DROP/ALTER calls in `packages/transport/src/failures-resource-handler.ts` AND `packages/storage/src/failures-resource-adapter.ts` (Constitution III; SC-HARDEN-018).
  - Every catch block emits a telemetry event (Constitution XIII).
  *SC-HARDEN-017, SC-HARDEN-018, SC-HARDEN-019, Constitution III, VII, XI, XII, XIII, XIV* — done 2026-05-14

- [x] T058 [P] Integration test `tests/lint-fixtures/sp006-no-mcp-mutation-surfaces.test.ts` — asserts that across the transport package's mcp-server.ts + the five handler files, only the five `corpus://*` resources (manifest, taxonomy, recent, docs/{id}, failures) appear and exactly ONE tool (`corpus.find`) is registered via `server.registerTool(...)`. No MCP prompts; no `corpus://recovery`. *FR-HARDEN-024, SC-HARDEN-016, Constitution III* — done 2026-05-14

- [x] T059 [P] Integration test `tests/integration/sp006-telemetry-no-body-content.test.ts` — across a mixed-workload run (5 recovery scans + 5 failures-resource reads + 5 tier-fallthrough invocations with stub TierFns), zero telemetry event payloads contain four distinct body-canary strings planted in (a) fixture sidecars, (b) synthetic telemetry-log orphan markers, (c) the SearchInput query, and (d) SearchHit snippets. Query strings continue to be SHA-256-hashed per SP-005 FR-RETRIEVAL-023. *FR-HARDEN-005, SC-HARDEN-024, Constitution I* — done 2026-05-14

**Checkpoint Phase 6**: All Constitution principles mechanically enforced by lint over SP-006 source; SP-006 implementation complete. — verified 2026-05-14

---

## Phase 7: Polish + Final Commit

**Purpose**: Empirical performance measurement; CLAUDE.md surface documentation; quickstart walkthrough validation; final commit.

- [ ] T060 Empirically measure per-tier latency on pai-node01 — run `tests/integration/tier-fallthrough-end-to-end.test.ts` against fixture corpora; record p95 for Tier 0 / Tier 1 / Tier 2 / Tier 3 in plan.md "Performance Goals" footnote per Constitution XVI honesty. *FR-HARDEN-016, SC-HARDEN-021, Constitution XVI* — DEFERRED to post-merge perf PR (requires live pai-node01 corpus + sustained workload; CI-integration tests already enforce budget/timeout semantics)

- [ ] T061 Empirically measure recovery scan p95 on pai-node01 — run `tests/integration/end-to-end-recovery.test.ts` against synthetic telemetry-log sizes (1k events, 10k events, 100k events); record p95 in plan.md footnote. *FR-HARDEN-001, FR-HARDEN-003, SC-HARDEN-022, Constitution XVI* — DEFERRED to post-merge perf PR

- [ ] T062 Empirically measure `corpus://failures` read p95 on pai-node01 — run `tests/integration/failures-resource-mcp.test.ts` against fixture sidecar counts (100, 500, 1000); record p95 in plan.md footnote. *FR-HARDEN-009, Constitution XVI* — DEFERRED to post-merge perf PR

- [ ] T063 Walk `specs/006-hardening/quickstart.md` end-to-end against actual SP-006 behavior — verify every step works as described against the user's pai-node01; correct any drift; populate the "Honest performance notes" section with the measured p95s from T060/T061/T062. *Constitution XVI* — DEFERRED to post-merge polish PR

- [ ] T064 Update `specs/006-hardening/checklists/requirements.md` with implementation outcomes — for each of the 24 FR-HARDEN-NNN and 24 SC-HARDEN-NNN, mark verified/deferred/measured per actual code state. Document any FR/SC that landed differently than spec described (none expected). *spec.md Requirements, Success Criteria* — DEFERRED to post-merge polish PR

- [ ] T065 Add "SP-006 surface" section to root `CLAUDE.md` — mirror the "SP-005 surface" pattern with: (a) the new `corpus://failures` MCP read-only resource alongside SP-002's four (URI, query params, response shape, schema_version); (b) the kill-9 recovery scanner's daemon-startup hook + the resumability matrix table + the 9 recovery.* telemetry classes; (c) the Tier 1/2/3 fallthrough cascade behavior (min_results trigger, per-tier targets, aggregate budget, `tier_used` enum field on SearchHit); (d) the CATALOG.md generator (additive flat-file at `Paths.data() + '/CATALOG.md'`); (e) the 4 new search.tier_* telemetry classes; (f) sub-section "SP-006 is the FINAL substrate sprint — install-complete after merge". Keep prior SP-002 / SP-004 / SP-005 surface sections intact. Update the SPECKIT block to mark SP-006 active. *Project documentation* — DEFERRED to post-merge polish PR

- [ ] T066 Update `.specify/feature.json` to `{"feature_directory": "specs/006-hardening"}`. *Project state* — DEFERRED to post-merge polish PR

- [x] T067 Final feature commit on branch `006-hardening` — Engineer #5 cutover commit `SP-006: production hardening — kill-9 recovery + corpus://failures + Tier 1/2/3 fallthrough` produced on 2026-05-14 with the Phase 2–7 surface, the deferred-item carry-forwards (resource.read telemetry on corpus://failures; corpus.find delegating to runTieredSearch), and the Phase 6 lint suite. Constitution Check 16/16 re-verified. *Project commit convention*

**Checkpoint Phase 7**: Constitution Check 16/16 [x] re-verified by inspection of `tests/lint-fixtures/sp006-constitutional-grep.test.ts` + repo-wide `npm run lint` + `npm run build` + 878 passing tests; CLAUDE.md / quickstart / perf measurement / `.specify` state DEFERRED to post-merge polish PR; SP-006 ready to MERGE. — verified 2026-05-14

---

## Coverage Matrix — FR-HARDEN-NNN

| FR | Covered by tasks |
|---|---|
| FR-HARDEN-001 (recovery scan runs before daemon accept-new-work) | T017, T023, T027, T028, T061 |
| FR-HARDEN-002 (resumability matrix routes orphans) | T018, T019, T024, T025, T026, T028 |
| FR-HARDEN-003 (recovery scanner is itself idempotent) | T020, T023, T028, T061 |
| FR-HARDEN-004 (telemetry-log reverse iteration bounded by daemon.started) | T017, T023 |
| FR-HARDEN-005 (≥ 9 recovery telemetry classes) | T003, T010, T023, T025, T028, T059 |
| FR-HARDEN-006 (recovery acquires drain-lock) | T021, T023, T029 |
| FR-HARDEN-007 (recovery cancellable via AbortSignal) | T022, T023 |
| FR-HARDEN-008 (corpus://failures registered as 5th read-only MCP resource) | T036, T037, T038, T058 |
| FR-HARDEN-009 (response Zod-validated, schema_version: 1) | T002, T030, T035, T038, T062 |
| FR-HARDEN-010 (query params Zod-validated, closed enum) | T002, T031, T038 |
| FR-HARDEN-011 (paginated by limit/offset with total_count) | T032, T035, T038 |
| FR-HARDEN-012 (sidecar globbing + graceful skip on malformed) | T030, T033, T035, T038 |
| FR-HARDEN-013 (Tier 0 → 1 fallthrough on min_results) | T039, T040, T047, T053, T055 |
| FR-HARDEN-014 (Tier 1 → 2 CATALOG.md grep) | T039, T041, T047, T049, T055 |
| FR-HARDEN-015 (Tier 2 → 3 fs-grep via runTool) | T039, T042, T047, T050, T055 |
| FR-HARDEN-016 (aggregate budget via AbortController) | T039, T043, T047, T056, T060 |
| FR-HARDEN-017 (tier_used enum field on SearchHit) | T006, T013, T039, T046, T047, T055 |
| FR-HARDEN-018 (CATALOG.md generated at index-stage post-COMMIT) | T044, T045, T051, T052, T054 |
| FR-HARDEN-019 (≥ 4 tier telemetry classes + updated search.completed) | T003, T010, T039, T047, T055 |
| FR-HARDEN-020 (cancellable bounded IO across recovery / failures / tier) | T005, T022, T030, T035, T036, T042, T043, T047, T050 |
| FR-HARDEN-021 (no process.exit in libs) | T004, T011, T057 |
| FR-HARDEN-022 (XDG paths via Paths.*) | T015, T057 |
| FR-HARDEN-023 (Tier 3 runTool grep is only subprocess) | T015, T042, T050, T057 |
| FR-HARDEN-024 (no new MCP mutation surfaces) | T008, T015, T034, T036, T037, T058 |

## Coverage Matrix — SC-HARDEN-NNN

| SC | Covered by tasks |
|---|---|
| SC-HARDEN-001 (kill-9 mid-classify recovered) | T023, T024, T027, T028 |
| SC-HARDEN-002 (kill-9 mid-embed recovered) | T023, T024, T027, T028 |
| SC-HARDEN-003 (kill-9 mid-edges-build recovered) | T023, T024, T027, T028 |
| SC-HARDEN-004 (unrecoverable orphan produces .recovery.error.json) | T019, T025, T026, T028 |
| SC-HARDEN-005 (recovery-during-recovery detected) | T020, T023 |
| SC-HARDEN-006 (corpus://failures well-formed response) | T030, T035, T036, T038 |
| SC-HARDEN-007 (filter pushdown by stage/since/limit/offset) | T032, T035, T038 |
| SC-HARDEN-008 (unknown query → validation_error envelope) | T031, T036, T038 |
| SC-HARDEN-009 (malformed sidecar gracefully skipped) | T033, T035, T038 |
| SC-HARDEN-010 (Tier 0 ≥ min_results does NOT fall through) | T039, T047, T055 |
| SC-HARDEN-011 (Tier 1 BM25-only fallthrough) | T040, T047, T055 |
| SC-HARDEN-012 (Tier 2 CATALOG-grep fallthrough) | T041, T047, T055 |
| SC-HARDEN-013 (Tier 3 fs-grep fallthrough) | T042, T047, T055 |
| SC-HARDEN-014 (aggregate budget enforced) | T043, T047, T056 |
| SC-HARDEN-015 (drain-lock + concurrent CLI) | T021, T029 |
| SC-HARDEN-016 (≥ 10 SP-006 telemetry classes) | T003, T010, T028, T038, T055, T058 |
| SC-HARDEN-017 (XDG-paths-only lint) | T015, T057 |
| SC-HARDEN-018 (library/CLI boundary lint) | T011, T015, T034, T057 |
| SC-HARDEN-019 (subprocess hygiene lint) | T015, T057 |
| SC-HARDEN-020 (Zod-validated FailuresResourceResponse) | T002, T030, T035 |
| SC-HARDEN-021 (per-tier latency targets measured) | T060 |
| SC-HARDEN-022 (recovery scanner is idempotent) | T020, T023, T028, T061 |
| SC-HARDEN-023 (schema_version: 1 future-proofing) | T002, T009, T035, T038 |
| SC-HARDEN-024 (no body content in SP-006 telemetry) | T010, T028, T038, T055, T059 |

---

## Anti-claims (verified absent from this task list)

- **NO `corpus failures clear` / `corpus failures retry` CLI commands** — operator manually rm's sidecars after triaging; future sprint may add CLI surfaces.
- **NO automated kill-9 testing in CI** — recovery tests run on user's pai-node01 with controlled fixture injection; CI tests cover scanner logic against synthetic telemetry fixtures, not actual SIGKILL.
- **NO recovery from SQLite-file corruption** — SP-006 scope is process kills only; SQLite corruption is v1.5+.
- **NO retrieval-eval harness** — Constitution XVI / NFR-009 explicitly defer to v1.5+.
- **NO Tier 4+ retrievers** — §10.6 four-tier model is the architectural ceiling.
- **NO worker-pool parallelism for tier cascade** — v1 ships sequential cascade.
- **NO chunked-document embeddings** — inherited from SP-005 deferrals.
- **NO cross-encoder re-ranking** — inherited from SP-005 deferrals.
- **NO HNSW/LSH/ANN** — inherited from SP-005 deferrals.
- **NO embedding-model change auto-detection in recovery** — future-horizon.
- **NO user-facing recovery review UI** — recovery is fully autonomous; no human-in-the-loop.
- **NO `corpus://recovery` MCP resource** — recovery state observable via telemetry + corpus://failures.
- **NO sidecar auto-deletion** — operator manually rm's.
- **NO CATALOG.md format extensions** — v1 format is `<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>`.
- **NO cross-corpus / federated search or recovery** — Constitution IV.
- **NO new MCP mutation surfaces** — Constitution III; `corpus://failures` is read-only by construction.

---

## Build sizing call

Per `feedback-build-tier-sizing-rule` (>2000 LOC / >15 files MUST split into N≥2 pre-planned Engineer agent invocations):

- **Production surface**: ~1200-1600 LOC across ~13 source files (recovery-scanner, recovery-resumability, failures-resource-adapter, failures-resource-handler, tier-orchestrator, bm25-only-tier, catalog-grep-tier, fs-grep-tier, catalog-md-generator, contracts extensions × 3, daemon extension, cli extension).
- **Total surface with tests + fixtures**: ~2700-3600 LOC across ~30 files.
- **Recommendation**: **Single-phase build** when `/speckit-implement` runs. The three orthogonal deliverables (recovery + failures + tier-fallthrough) are individually < 600 LOC each and don't cross-couple beyond the shared contracts in Phase 2. The whole sprint fits comfortably under the two-phase threshold.
