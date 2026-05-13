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

- [ ] T001 Verify SP-006 runtime prerequisites — assert `grep --version` returns POSIX-compatible output AND a non-zero exit code on success; assert `which grep` returns a path resolvable on Linux/macOS; assert SP-001..SP-005 merged on `main` via `git log --oneline | grep -E 'feat\(sp-(001|002|003|004|005)\)'` returning 5 lines; assert `Paths.failed()`, `Paths.telemetry()`, `Paths.docs()`, `Paths.data()`, `Paths.drainLock()`, `Paths.inbox()` getters all exist in `packages/contracts/src/paths.ts`; document `grep --version` output + SP-005 commit hash in `specs/006-hardening/quickstart.md` "Operator prereqs". *Constitution I, XII, XIV, Decision I, Assumption "grep binary is available"*

**Checkpoint**: Phase 1 ends here. `grep` available on PATH; SP-001..SP-005 merged; all reused `Paths.*` getters present.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: PREREQ-001..PREREQ-007 from plan.md. Each PREREQ gets a TDD contract-test/implementation pair (or a single assertion task for stub verification). Forward-compatibility plumbing; not principle violations.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — Phase 3+ source compiles against the contracts shipped here.

### Tests-First (mandatory per Constitution V/VII/VIII/IX/XIII/XIV)

- [ ] T002 [P] Unit test `tests/unit/failures-resource-schema.test.ts` — assert `FailureEntryZodSchema.parse(<SP-003-verbatim>)` succeeds with the SP-003 fields PLUS `sidecar_path`; rejects unknown stage values (closed enum); rejects malformed `timestamp` (non-ISO-8601); rejects `message` > 1024 chars (Constitution V); assert `FailuresQueryZodSchema.parse({stage:'classify', limit:5})` succeeds with defaults (offset=0); rejects unknown query keys (strict mode → `validation_error`); rejects `limit < 1` or `limit > 1000`; rejects malformed `since`; assert `FailuresResourceResponseZodSchema.parse({entries:[], total_count:0, returned_count:0, schema_version:1})` succeeds; rejects `schema_version: 2` (literal); rejects malformed `entries`; rejects unknown keys. *PREREQ-001, FR-HARDEN-009, FR-HARDEN-010, Constitution V*

- [ ] T003 [P] Unit test `tests/unit/telemetry-sp006-classes.test.ts` — Zod round-trip for all 13 new SP-006 event classes (9 recovery.* + 1 failures.sidecar_parse_failed + 4 search.tier_*); each validates envelope (`event`, `timestamp` ISO-8601, `severity`, `outcome`) + class-specific fields per data-model.md Entity 4 and Entity 5; per-class ≤ 4096-byte serialization assertion (Constitution IX); existing SP-001..SP-005 union variants still parse unchanged; assert the SP-005 `search.completed` event's `tier_used` field is UPDATED from `z.literal('hybrid')` to `z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])` and the old literal hardcoding no longer parses. *PREREQ-002, FR-HARDEN-005, FR-HARDEN-019, Constitution I, V, IX, XIII*

- [ ] T004 [P] Unit test `tests/unit/errors-sp006.test.ts` — 6 new typed errors (`RecoveryScanError` base, `RecoveryOrphanUnresumableError`, `FailuresResourceError`, `TierFallthroughError`, `CatalogMissingError`, `GrepSubprocessError`) instantiate with structured `data`, throwable, distinct `name`. Zero `process.exit` references in source. *PREREQ-003, FR-HARDEN-021, Constitution XI*

- [ ] T005 [P] Unit test `tests/unit/policies-sp006-fields.test.ts` — `interactivePolicy` and `batchPolicy` (extended) validate against the extended `PolicySchema` carrying new fields `recoveryScanTimeoutMs`, `tierTotalBudgetMs`, `tierBm25TimeoutMs`, `tierCatalogGrepTimeoutMs`, `tierFsGrepTimeoutMs`, `failuresResourceTimeoutMs`, `minResultsForFallthrough`. Defaults: interactive `{30000, 600, 5, 50, 500, 5000, 3}`, batch `{30000, 600, 5, 50, 500, 5000, 3}` (recovery + tier policies are not policy-dependent in v1 per Decision M). Existing SP-003/SP-004/SP-005 fields parse unchanged. *PREREQ-004, FR-HARDEN-016, FR-HARDEN-020, Decision M, Constitution VI, VII*

- [ ] T006 [P] Unit test `tests/unit/search-hit-tier-used.test.ts` — assert `SearchHitZodSchema.parse(<SP-005 valid hit + tier_used: 'hybrid'>)` succeeds; rejects malformed `tier_used` (must be one of the four enum values); the SP-005-era hit shape WITHOUT `tier_used` field fails parsing (the field is REQUIRED in SP-006+); `SearchOutputZodSchema.parse(<full response with tier_used enum>)` succeeds. *PREREQ-005, FR-HARDEN-017, Decision K, Constitution V*

- [ ] T007 [P] Unit test `tests/unit/config-loader-search-min-results.test.ts` — `loadConfig()` parses `[search].min_results` (default=3, range [0,100]) and `[search].tier_total_budget_ms` (default=600, range [50,30000]). Unknown values inside the `[search]` section pass through unparsed (forward-compat). *PREREQ-004, FR-HARDEN-013, FR-HARDEN-016, Decision G, Decision J*

- [ ] T008 [P] Unit test `tests/unit/sp006-eslint-no-writes-from-failures-handler.test.ts` — assert the existing `no-writes-from-resource-handlers` ESLint rule is scoped over `packages/transport/src/failures-resource-handler.ts` AND `packages/storage/src/failures-resource-adapter.ts`; assert ANY `fs.write*`, `fs.append*`, `fs.mkdir*`, `fs.unlink*`, INSERT/UPDATE/DELETE/CREATE/DROP/ALTER call in those files hard-fails the lint. *PREREQ-006, FR-HARDEN-008, FR-HARDEN-024, SC-HARDEN-018, Constitution III*

### Implementation

- [ ] T009 [P] Implement `packages/contracts/src/failures-resource-schema.ts` — exports `FailureEntryZodSchema` (strict; SP-003 fields + `sidecar_path: z.string().min(1)`), `FailuresQueryZodSchema` (strict; optional `stage` closed enum, `since` ISO-8601, `limit` int [1,1000] default 50, `offset` int [0,∞) default 0), `FailuresResourceResponseZodSchema` (strict; `entries`, `total_count`, `returned_count`, `schema_version: z.literal(1)`), `FailuresErrorEnvelopeZodSchema` (strict; closed `error_code` enum, `message`/`hint` max 1024). Re-exported from `packages/contracts/index.ts`. *PREREQ-001, FR-HARDEN-009, FR-HARDEN-010, Constitution V*

- [ ] T010 [P] Extend `packages/contracts/src/telemetry.ts` — add 13 new SP-006 event class Zod schemas to the `TelemetryEvent` discriminated union per data-model.md Entity 4 + Entity 5. The 9 recovery.* events + 1 `failures.sidecar_parse_failed` + 4 `search.tier_*` events (`search.tier_fallthrough`, `search.tier_skipped`, `search.tier_failed`, `search.tier_budget_exceeded`). Each schema asserts ≤4096-byte serialization. UPDATE the SP-005 `search.completed` schema's `tier_used` field from `z.literal('hybrid')` to `z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])`. Pre-existing variants compile unchanged. Re-export from index. *PREREQ-002, FR-HARDEN-005, FR-HARDEN-019, SC-HARDEN-016, SC-HARDEN-024, Constitution I, V, IX, XIII*

- [ ] T011 [P] Extend `packages/contracts/src/errors.ts` — add 6 typed errors (`RecoveryScanError` base + 5 subclasses). Each subclass of `Error` (or `RecoveryScanError`) with stable `name`, structured `data`, zero `process.exit`. Re-export from index. *PREREQ-003, FR-HARDEN-021, Constitution XI*

- [ ] T012 [P] Extend `packages/pipeline/src/policies.ts` — add SP-006 fields to `PolicySchema` AND extend `interactivePolicy` / `batchPolicy` with defaults per PREREQ-004. Re-export unchanged. *PREREQ-004, FR-HARDEN-016, FR-HARDEN-020, Decision M, Constitution VI, VII*

- [ ] T013 [P] Extend `packages/contracts/src/search-schemas.ts` — add `tier_used: z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])` field to `SearchHitZodSchema` (REQUIRED in SP-006+); UPDATE `SearchOutputZodSchema.tier_used` from `z.literal('hybrid')` to the enum. The other SP-005 fields (`uri`, `score`, `title`, `facet_domain`, `facet_type`, `tags`, `snippet`) unchanged. *PREREQ-005, FR-HARDEN-017, Decision K, Constitution V*

- [ ] T014 Extend `packages/storage/src/index.ts` — re-export `failures-resource-adapter` and `catalog-md-generator` modules for downstream `packages/transport/` + `packages/cli/` consumption. *PREREQ-007*

- [ ] T015 [P] Update `eslint.config.js` to scope existing custom rules (`no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`, `no-promise-race-settimeout`, `no-forbidden-network-imports`, `no-writes-from-resource-handlers`) over the new SP-006 source paths: `packages/pipeline/src/{recovery-scanner,recovery-resumability}.ts`, `packages/index/src/{tier-orchestrator,bm25-only-tier,catalog-grep-tier,fs-grep-tier}.ts`, `packages/storage/src/{failures-resource-adapter,catalog-md-generator}.ts` + the EXTENDED `index-persister.ts`, `packages/transport/src/failures-resource-handler.ts`, `packages/contracts/src/failures-resource-schema.ts`, `packages/daemon/src/index.ts` (recovery hook), `packages/cli/src/reindex-command.ts` (CATALOG.md regen). The `no-writes-from-resource-handlers` rule MUST cover the new `failures-resource-handler.ts` + `failures-resource-adapter.ts`. *SC-HARDEN-017, SC-HARDEN-018, SC-HARDEN-019, Constitution III, VII, XI, XII, XIV*

- [ ] T016 [P] Add fixture inputs to `tests/fixtures/sp006-hardening/` — `orphaned-telemetry.jsonl` (synthetic telemetry log with mixed orphans across all five stages), `fixture-sidecars/*.error.json` (10 SP-003-shape sidecars mixed across stages), `fixture-sidecars/malformed.error.json` (invalid JSON for graceful-skip testing), `synthetic-catalog.md` (50-line CATALOG.md for Tier 2 fixtures), `sample-docs/*.md` (5 Markdown body files for Tier 3 fs-grep tests), `README.md` documenting provenance. *plan.md Project Structure, SC-HARDEN-001..SC-HARDEN-016*

**Checkpoint**: `npm run build` succeeds; `npm run test:unit` passes for Phase 2 PREREQ tests; `npm run lint` exits 0; SP-006 contract surface exists in `@llm-corpus/contracts`; forward-compat plumbing ready; user-story implementation can begin.

---

## Phase 3: User Story 1 — Kill-9 Cross-Stage Recovery (Priority: P1) 🎯 MVP

**Goal**: On daemon restart after SIGKILL, the recovery scanner detects orphaned work in `Paths.telemetry()` JSONL, routes orphans through the resumability matrix, re-queues resumable orphans into the existing idempotent pipeline transitions, writes `.recovery.error.json` sidecars for non-resumable orphans, and only THEN allows the daemon to accept new ingest work.

**Independent Test**: With the SP-005 daemon mid-pipeline (some docs classified, some mid-classify, some mid-embed, some mid-edges-build), send SIGKILL; restart the daemon; observe the recovery scan running BEFORE the watcher activates; assert all resumable orphans complete their remaining sub-stages within the per-doc budget; assert any non-resumable orphans get `.recovery.error.json` sidecars at `Paths.failed()`.

### Tests for User Story 1 (RED phase — Constitution VIII TDD imperative)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [ ] T017 [P] [US1] Unit test `tests/unit/recovery-scanner.test.ts` — `runRecoveryScan(deps, signal)` reads `Paths.telemetry()` JSONL backwards from end-of-file; stops at the most-recent `daemon.started` marker; builds a `(doc_id, stage) → {started_ts, last_seen_ts, inbox_file?}` map; emits `recovery.orphan_found` for each entry without a matching `*.completed`/`*.failed`; emits `recovery.scan_started` + `recovery.scan_completed` at boundaries; on AbortSignal abort emits `recovery.aborted_scan` and returns; on lock contention emits `recovery.scan_skipped` with `reason='lock_contention'`; on no-prior-daemon-session emits `recovery.scan_skipped` with `reason='no_prior_session'`; on malformed telemetry lines emits `recovery.telemetry_parse_failed` and continues. Module path: `packages/pipeline/src/recovery-scanner.ts`. *FR-HARDEN-001, FR-HARDEN-003, FR-HARDEN-004, FR-HARDEN-005, FR-HARDEN-007, Decision A, Decision C, Constitution VII, IX, XIII*

- [ ] T018 [P] [US1] Unit test `tests/unit/recovery-orphan-resumability.test.ts` — `classifyOrphan(orphan, deps): RecoveryResolution`: (a) `stage='ingest'` + inbox file present at `Paths.inbox() + '/' + orphan.inbox_file` → returns `{resumable: true, requeue: fn}`; (b) `stage='ingest'` + inbox file absent → returns `{resumable: false, sidecarReason: 'ingest file missing'}`; (c) `stage='classify'` → returns `{resumable: true, requeue: fn}` (calls `classifyStage` with batchPolicy); (d) `stage='embed'` → returns `{resumable: true, requeue: fn}` (calls embed-stage); (e) `stage='index'` → returns `{resumable: true, requeue: fn}`; (f) `stage='edges-build'` → returns `{resumable: true, requeue: fn}`. Module path: `packages/pipeline/src/recovery-resumability.ts`. *FR-HARDEN-002, Decision B, Constitution X*

- [ ] T019 [P] [US1] Unit test `tests/unit/recovery-sidecar-writer.test.ts` — non-resumable orphan dispatch writes `<doc-id>.recovery.error.json` at `Paths.failed()` with shape `{doc_id, stage, error_code: 'unrecoverable_orphan', message, timestamp, retriable: false}`; idempotent re-write produces the same content (same hash); `recovery.aborted` event fires with the orphan's payload. *FR-HARDEN-002, SC-HARDEN-004, Decision N, Constitution V, X*

- [ ] T020 [P] [US1] Unit test `tests/unit/recovery-scanner-reentry.test.ts` — when `Paths.telemetry()` contains a `recovery.scan_started` without a matching `recovery.scan_completed` (prior scan was killed), the new scan: (a) emits `recovery.scan_reentry` with the prior-scan-start-ts; (b) proceeds with current-session orphan scan against current end-of-log; (c) does NOT recurse on the prior orphaned scan. *FR-HARDEN-003, SC-HARDEN-005, Decision C, Constitution X*

- [ ] T021 [P] [US1] Unit test `tests/unit/recovery-scanner-drain-lock.test.ts` — `runRecoveryScan(deps, signal)` acquires `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)` BEFORE reading telemetry; on success releases after scan completes; on contention (mocked existing lock-holder) emits `recovery.scan_skipped` with `reason='lock_contention'` and returns without scanning. *FR-HARDEN-006, SC-HARDEN-015, Constitution IX*

- [ ] T022 [P] [US1] Unit test `tests/unit/recovery-scanner-abortable.test.ts` — mid-scan `controller.abort()` causes the scanner to: (a) throw `AbortError` from the current chunk read; (b) emit `recovery.aborted_scan` event; (c) release the drain-lock; (d) return within 2s (Constitution VII budget). *FR-HARDEN-007, Constitution VII*

### Implementation (GREEN phase)

- [ ] T023 [US1] Implement `packages/pipeline/src/recovery-scanner.ts` — `runRecoveryScan(deps: RecoveryDeps, signal: AbortSignal): Promise<RecoveryScanResult>`. Acquires `Paths.drainLock()` via `acquireDrainLock(signal)`; emits `recovery.scan_started`; reads `Paths.telemetry()` JSONL via `createReverseLineIterator()` (NEW helper in same file) until `daemon.started` marker found; builds orphan map; emits `recovery.orphan_found` per orphan; calls `dispatchOrphan(orphan, deps, signal)` for each; emits `recovery.scan_completed`; releases lock; returns summary. Handles malformed-line skip via `recovery.telemetry_parse_failed`. Idempotent. *FR-HARDEN-001, FR-HARDEN-003, FR-HARDEN-004, FR-HARDEN-005, FR-HARDEN-007, Decision A, Decision C, Constitution VII, IX, XIII*

- [ ] T024 [US1] Implement `packages/pipeline/src/recovery-resumability.ts` — `classifyOrphan(orphan: RecoveryOrphan, deps: RecoveryDeps): RecoveryResolution`. Returns `{resumable: true, requeue: () => Promise<void>}` for the matrix-resumable cases; `{resumable: false, sidecarReason: string}` otherwise. The `requeue` thunk delegates to the existing SP-003/004/005 stage surfaces (NOT a separate recovery write path). *FR-HARDEN-002, Decision B, Constitution X*

- [ ] T025 [US1] Implement `dispatchOrphan(orphan, deps, signal)` in `packages/pipeline/src/recovery-scanner.ts` — calls `classifyOrphan(orphan, deps)`; on resumable, calls `resolution.requeue()` AND emits `recovery.resumed` event; on non-resumable, writes `<doc-id>.recovery.error.json` sidecar at `Paths.failed()` via `writeRecoverySidecar(orphan, resolution.sidecarReason)` AND emits `recovery.aborted` event. *FR-HARDEN-002, SC-HARDEN-004, Decision N, Constitution V, X, XIII*

- [ ] T026 [US1] Implement `writeRecoverySidecar(orphan, reason)` in `packages/pipeline/src/recovery-scanner.ts` — writes JSON file at `Paths.failed() + '/' + orphan.doc_id + '.recovery.error.json'` with shape per FR-HARDEN-002. Atomic via `withTempDir + fs.rename`. *FR-HARDEN-002, Decision N, Constitution V, VIII*

- [ ] T027 [US1] Extend `packages/daemon/src/index.ts` — `startDaemon(opts: DaemonOptions): Promise<void>` invokes `await runRecoveryScan(deps, signal)` AFTER the Ollama-availability check AND BEFORE activating the file watcher / classify-hook / embed-hook chains. The recovery scan's master AbortSignal is wired to the daemon's master controller (so daemon shutdown propagates to recovery). If `runRecoveryScan` returns success, the daemon proceeds to accept-new-work state; if it throws, the daemon exits via its CLI caller (Constitution XI). *FR-HARDEN-001, SC-HARDEN-001, SC-HARDEN-002, SC-HARDEN-003, Constitution VI, VII, IX, XI*

### Integration Tests for US1

- [ ] T028 [US1] Integration test `tests/integration/end-to-end-recovery.test.ts` — drives the full kill-9 + restart + recovery flow: starts daemon, drops 10 mixed-MIME fixtures, waits ~3s (some docs mid-classify), sends SIGKILL via `process.kill(daemon_pid, 'SIGKILL')`, restarts daemon, asserts recovery scan runs BEFORE accept-new-work, asserts all 10 docs complete their remaining sub-stages, asserts `documents_fts` + `documents_vec` row counts are 10 + 10, asserts `recovery.scan_started` + `recovery.scan_completed` + `recovery.orphan_found` × N + `recovery.resumed` × N events fire. *FR-HARDEN-001, FR-HARDEN-002, FR-HARDEN-005, SC-HARDEN-001, SC-HARDEN-002, SC-HARDEN-003*

- [ ] T029 [US1] Integration test `tests/integration/recovery-concurrency.test.ts` — with daemon mid-recovery (drain-lock held), invokes `corpus drain`, `corpus reenrich`, `corpus reindex` from separate processes; each emits `pipeline.lock_contention` AND exits 0 within 100 ms; recovery scan continues unaffected. *FR-HARDEN-006, SC-HARDEN-015, Constitution IX*

**Checkpoint Phase 3**: US1 P1 MVP complete. Kill-9 recovery is fully autonomous; recovery scanner runs at daemon startup BEFORE accept-new-work; resumability matrix correctly routes orphans; drain-lock contention works against concurrent CLI invocations; ≥ 9 SP-006 recovery telemetry classes emit during a mixed-stage kill recovery.

---

## Phase 4: User Story 2 — `corpus://failures` Read-Only MCP Resource (Priority: P1)

**Goal**: A fifth read-only MCP resource `corpus://failures` mirroring the SP-002 four resources structurally. Agents read the failure backlog via the MCP transport with paginated, filtered queries.

**Independent Test**: With ≥ 10 fixture sidecars at `Paths.failed()` (mixed stages), invoke `corpus://failures` from an MCP client and assert a structured response `{entries, total_count, returned_count, schema_version: 1}`. Test filter pushdown (`?stage=`, `?since=`), pagination (`?limit=`, `?offset=`), validation error envelope (unknown stage), graceful sidecar parse failure.

### Tests for User Story 2 (RED phase)

- [ ] T030 [P] [US2] Unit test `tests/unit/failures-resource-adapter.test.ts` — `readFailuresEntries(query, signal): Promise<FailuresResourceResponse>` globs `Paths.failed() + '/*.error.json'` AND `Paths.failed() + '/*.recovery.error.json'`; parses each per FailureEntryZodSchema; adds `sidecar_path` field; applies `stage` + `since` filters; sorts descending by `timestamp`; paginates by `limit`/`offset`; validates response via FailuresResourceResponseZodSchema; on missing `Paths.failed()` directory returns `{entries:[], total_count:0, returned_count:0, schema_version:1}`; on malformed sidecar skips it and emits `failures.sidecar_parse_failed`. Module path: `packages/storage/src/failures-resource-adapter.ts`. *FR-HARDEN-012, SC-HARDEN-006, SC-HARDEN-007, SC-HARDEN-009, Decision E, Decision F*

- [ ] T031 [P] [US2] Unit test `tests/unit/failures-resource-handler.test.ts` — MCP resource handler at `packages/transport/src/failures-resource-handler.ts` parses query parameters via FailuresQueryZodSchema; on validation error returns `{error_code: 'validation_error', message, hint}` envelope as a SUCCESSFUL MCP resource response (NOT a transport error); on success delegates to `readFailuresEntries`; emits `resource.read` telemetry. *FR-HARDEN-008, FR-HARDEN-010, SC-HARDEN-008, Constitution III, V*

- [ ] T032 [P] [US2] Unit test `tests/unit/failures-resource-pagination.test.ts` — with 20 fixture sidecars, `readFailuresEntries({limit:5, offset:10})` returns `entries.length === 5`, `total_count === 20`, `returned_count === 5`; `readFailuresEntries({limit:50, offset:0})` returns `entries.length === 20`, `total_count === 20`, `returned_count === 20`; ordering is descending by `timestamp`. *FR-HARDEN-011, SC-HARDEN-007, Decision E*

- [ ] T033 [P] [US2] Unit test `tests/unit/failures-resource-malformed-skip.test.ts` — with 10 well-formed + 1 malformed sidecar at `Paths.failed()`, `readFailuresEntries({})` returns `entries.length === 10`, `total_count === 10`; a `failures.sidecar_parse_failed` event fires with the malformed sidecar's path. *FR-HARDEN-012, SC-HARDEN-009, Decision F*

- [ ] T034 [P] [US2] Unit test `tests/unit/failures-resource-no-writes.test.ts` — code-search lint over `packages/storage/src/failures-resource-adapter.ts` AND `packages/transport/src/failures-resource-handler.ts` detects zero `fs.write*`, `fs.append*`, `fs.mkdir*`, `fs.unlink*`, INSERT/UPDATE/DELETE/CREATE/DROP/ALTER calls. (The `no-writes-from-resource-handlers` ESLint rule's positive test.) *FR-HARDEN-008, FR-HARDEN-024, SC-HARDEN-018, Constitution III*

### Implementation (GREEN phase)

- [ ] T035 [US2] Implement `packages/storage/src/failures-resource-adapter.ts` — `readFailuresEntries(query: FailuresQuery, signal: AbortSignal): Promise<FailuresResourceResponse>`. Globs both file patterns via `fs.readdir(Paths.failed())` + filter; parses each via `fs.readFile + JSON.parse + FailureEntryZodSchema.safeParse`; on parse failure emits `failures.sidecar_parse_failed` and skips; applies filter + sort + paginate; constructs `FailuresResourceResponse` with `schema_version: 1`; validates via `FailuresResourceResponseZodSchema.parse` before return; `signal.throwIfAborted()` between sidecar reads. *FR-HARDEN-009, FR-HARDEN-011, FR-HARDEN-012, SC-HARDEN-006, SC-HARDEN-007, SC-HARDEN-009, SC-HARDEN-020, Decision E, Decision F, Constitution V, VII, XIII*

- [ ] T036 [US2] Implement `packages/transport/src/failures-resource-handler.ts` — MCP resource handler. Receives the resource URI (with optional query parameters); parses query via `FailuresQueryZodSchema.safeParse`; on failure returns `validation_error` envelope; on success delegates to `readFailuresEntries`; emits `resource.read` telemetry with `outcome` + query parameter values. *FR-HARDEN-008, FR-HARDEN-010, SC-HARDEN-008, Constitution III, V, XIII*

- [ ] T037 [US2] Extend `packages/transport/src/mcp-server.ts` — register `corpus://failures` via `BuiltMcpServer.registerStaticResource('corpus://failures', failuresResourceHandler)` inside `startMcpServer()`. The four existing SP-002 resource registrations unchanged. *FR-HARDEN-008, Constitution III*

### Integration Test for US2

- [ ] T038 [US2] Integration test `tests/integration/failures-resource-mcp.test.ts` — drives the full MCP-server end-to-end flow: seeds `Paths.failed()` with fixture sidecars; starts MCP server; invokes `corpus://failures` via test MCP client with no params; asserts response shape; invokes with `?stage=embed`; asserts filter pushdown; invokes with `?stage=invalid`; asserts validation_error envelope (NOT transport error); invokes with `?limit=3&offset=5`; asserts pagination semantics; injects malformed sidecar mid-test; asserts graceful skip + `failures.sidecar_parse_failed` event. *FR-HARDEN-008, FR-HARDEN-009, FR-HARDEN-010, FR-HARDEN-011, FR-HARDEN-012, SC-HARDEN-006..SC-HARDEN-009*

**Checkpoint Phase 4**: US2 P1 complete. `corpus://failures` MCP resource is registered, read-only by construction, paginated, filtered; graceful skip on malformed sidecars; validation_error envelope on unknown query keys.

---

## Phase 5: User Story 3 — Tier 1/2/3 Fallthrough Cascade (Priority: P2)

**Goal**: When Tier 0 (hybrid) returns fewer than `[search].min_results` hits, the search orchestrator falls through to Tier 1 (BM25-only), Tier 2 (CATALOG.md grep), Tier 3 (fs-grep) — within an aggregate latency budget enforced via AbortController. Each SearchHit carries `tier_used` reflecting the tier that produced it.

**Independent Test**: With SP-005 baseline, force each tier to fire individually by manipulating SQL table state (DELETE FROM `documents_vec`, etc.) and `Paths.data()/CATALOG.md` presence; assert `tier_used` field on each SearchHit matches the firing tier; assert `search.tier_fallthrough` + `search.tier_skipped` + `search.tier_failed` events fire appropriately; assert aggregate budget enforcement via aggressive `tier_total_budget_ms`.

### Tests for User Story 3 (RED phase)

- [ ] T039 [P] [US3] Unit test `tests/unit/tier-orchestrator.test.ts` — `tierFallthroughSearch(input, deps, signal): Promise<SearchOutput>` runs Tier 0 (SP-005 hybrid) first; if `result_count >= min_results` returns immediately with `tier_used: 'hybrid'`; else emits `search.tier_fallthrough` and runs Tier 1; merges results (dedup by doc_id, higher-tier wins); same for Tier 2; Tier 2 absent-CATALOG.md case emits `search.tier_skipped` and falls to Tier 3; on aggregate budget timeout emits `search.tier_budget_exceeded` and returns partial set. Module path: `packages/index/src/tier-orchestrator.ts`. *FR-HARDEN-013, FR-HARDEN-014, FR-HARDEN-015, FR-HARDEN-016, FR-HARDEN-019, Decision G, Decision J*

- [ ] T040 [P] [US3] Unit test `tests/unit/bm25-only-tier.test.ts` — `Tier1Bm25Only.search(query, {topK, filters, signal})` delegates to SP-005's `Fts5Adapter.search()`; returns `TierResult {tier:'bm25-only', hits: SearchHit[] with tier_used:'bm25-only', elapsed_ms, outcome:'completed'}`; does NOT invoke dense / graph / confidence retrievers; respects per-tier timeout. Module path: `packages/index/src/bm25-only-tier.ts`. *FR-HARDEN-013, SC-HARDEN-011, Constitution VII*

- [ ] T041 [P] [US3] Unit test `tests/unit/catalog-grep-tier.test.ts` — `Tier2CatalogGrep.search(query, {topK, filters, signal})` reads `Paths.data() + '/CATALOG.md'` via `fs.readFile`; line-by-line case-insensitive substring match; parses doc_id from each matching line; constructs SearchHit shape from the line's parsed fields; returns `TierResult {tier:'catalog-grep', ...}`; if CATALOG.md absent returns `TierResult {tier:'catalog-grep', outcome:'skipped'}` AND emits `search.tier_skipped` event. Module path: `packages/index/src/catalog-grep-tier.ts`. *FR-HARDEN-014, SC-HARDEN-012, Decision H, Constitution VII*

- [ ] T042 [P] [US3] Unit test `tests/unit/fs-grep-tier.test.ts` — `Tier3FsGrep.search(query, {topK, filters, signal})` invokes `runTool('grep', ['-rn','-l','--include=*.md', escapedPattern, Paths.docs()], {signal, timeoutMs: 500})`; parses output as newline-separated file paths; reverse-maps each path to doc_id via `SELECT id FROM documents WHERE body_path = ?`; constructs SearchHit shape; returns `TierResult {tier:'fs-grep', ...}`; on `ENOENT` returns `TierResult {tier:'fs-grep', outcome:'failed', error:'ENOENT'}` AND emits `search.tier_failed`. Module path: `packages/index/src/fs-grep-tier.ts`. *FR-HARDEN-015, SC-HARDEN-013, Decision I, Constitution VII, XII*

- [ ] T043 [P] [US3] Unit test `tests/unit/tier-budget-enforcement.test.ts` — with aggressive `tier_total_budget_ms: 50`, force all four tiers to fire; AbortController fires after 50ms; cascade returns partial set; `search.tier_budget_exceeded` event fires with `budget_ms=50`, `actual_ms≈50`, `tiers_attempted: [<list>]`, `final_hit_count`. The whole call exits within budget + 50ms slack (Constitution VII bounded abort). *FR-HARDEN-016, SC-HARDEN-014, Decision J, Constitution VII, XVI*

- [ ] T044 [P] [US3] Unit test `tests/unit/catalog-md-generator.test.ts` — `formatCatalogLine(doc): string` produces `<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>\n` with codepoint-safe truncation and `|` → `‖` escape; `appendCatalogLine(doc, signal): Promise<void>` appends atomically via `withTempDir + fs.appendFile`; idempotent on duplicate doc_id (the line is appended; future ADR may add dedup). Module path: `packages/storage/src/catalog-md-generator.ts`. *FR-HARDEN-018, Decision L, Constitution VIII, XIV*

- [ ] T045 [P] [US3] Unit test `tests/unit/index-persister-catalog-extension.test.ts` — extended `packages/storage/src/index-persister.ts` calls `appendCatalogLine(doc, signal)` AFTER the SP-005 SQL transaction commits (post-COMMIT). On COMMIT failure, CATALOG.md is NOT appended. On CATALOG.md append failure, SQL transaction is NOT rolled back (CATALOG.md is a flat-file mirror; Constitution VIII unit is the SQL writes). Failure emits `catalog.append.failed` telemetry. *FR-HARDEN-018, Decision L, Constitution VIII*

- [ ] T046 [P] [US3] Unit test `tests/unit/tier-orchestrator-merge.test.ts` — given Tier 0 returns 2 hits (doc-aaa, doc-bbb with tier_used='hybrid') and Tier 1 returns 3 hits (doc-aaa-dup, doc-ccc, doc-ddd with tier_used='bm25-only'), the merge produces 4 distinct hits: doc-aaa retains tier_used='hybrid' (higher tier wins); doc-bbb retains tier_used='hybrid'; doc-ccc and doc-ddd carry tier_used='bm25-only'; ordering preserves higher-tier-first. *FR-HARDEN-017, Decision K*

### Implementation (GREEN phase)

- [ ] T047 [US3] Implement `packages/index/src/tier-orchestrator.ts` — `tierFallthroughSearch(input: SearchInput, deps: SearchDeps, signal: AbortSignal): Promise<SearchOutput>`. Reads `config.search.min_results` (default 3) + `config.search.tier_total_budget_ms` (default 600); creates AbortController + setTimeout linked to caller's signal; runs Tier 0 via SP-005's `searchOrchestrator`; if `result_count >= min_results` returns; else cascades through Tier 1 → Tier 2 → Tier 3 with merge after each; emits the four search.tier_* telemetry classes; finalizes with `search.completed` carrying the deepest-tier `tier_used`. *FR-HARDEN-013, FR-HARDEN-014, FR-HARDEN-015, FR-HARDEN-016, FR-HARDEN-017, FR-HARDEN-019, Decision G, Decision J, Decision K, Constitution VII, XIII, XVI*

- [ ] T048 [US3] Implement `packages/index/src/bm25-only-tier.ts` — `class Tier1Bm25Only { async search(query, opts): Promise<TierResult> }`. Calls `Fts5Adapter.search()`; constructs SearchHit with `tier_used: 'bm25-only'`; returns TierResult. *FR-HARDEN-013, Constitution V, VII*

- [ ] T049 [US3] Implement `packages/index/src/catalog-grep-tier.ts` — `class Tier2CatalogGrep { async search(query, opts): Promise<TierResult> }`. Reads `Paths.data() + '/CATALOG.md'`; in-process line-iteration substring match; constructs SearchHit. If absent emits `search.tier_skipped` and returns outcome='skipped'. *FR-HARDEN-014, Decision H, Constitution V, VII*

- [ ] T050 [US3] Implement `packages/index/src/fs-grep-tier.ts` — `class Tier3FsGrep { async search(query, opts): Promise<TierResult> }`. Escapes query for BRE; invokes `runTool('grep', args, opts)`; parses output; reverse-maps paths to doc_ids; constructs SearchHit. On ENOENT emits `search.tier_failed`. *FR-HARDEN-015, Decision I, Constitution V, VII, XII*

- [ ] T051 [US3] Implement `packages/storage/src/catalog-md-generator.ts` — `formatCatalogLine(doc): string` + `appendCatalogLine(doc, signal): Promise<void>`. The append is atomic via `withTempDir + fs.appendFile`. *FR-HARDEN-018, Decision L, Constitution VIII, XIV*

- [ ] T052 [US3] Extend `packages/storage/src/index-persister.ts` — after the SP-005 SQL `COMMIT`, call `await appendCatalogLine(doc, signal)`. On append failure, emit `catalog.append.failed` telemetry but do NOT roll back the SQL transaction. *FR-HARDEN-018, Decision L, Constitution VIII, XIII*

- [ ] T053 [US3] Refactor `packages/index/src/search.ts` — the existing SP-005 `searchOrchestrator` is preserved as the Tier 0 implementation; the new EXPORTED entry point delegates to `tierFallthroughSearch`. The `packages/transport/src/corpus-find-tool.ts` handler is unchanged in surface (still delegates to `searchOrchestrator`'s exported entry, which now wraps the tier cascade). *FR-HARDEN-013, FR-HARDEN-017, Constitution III*

- [ ] T054 [US3] Extend `packages/cli/src/reindex-command.ts` — after the SP-005 backfill loop, regenerate `Paths.data() + '/CATALOG.md'` wholesale by iterating all classified rows AND appending their CatalogLine via `appendCatalogLine`. Idempotent: re-running on an existing CATALOG.md produces the same lines (the regenerate path TRUNCATES + rewrites; subsequent `corpus reindex` invocations on the same DB produce identical CATALOG.md). *FR-HARDEN-018, Constitution X*

### Integration Tests for US3

- [ ] T055 [US3] Integration test `tests/integration/tier-fallthrough-end-to-end.test.ts` — drives the full tier cascade against the SP-005 baseline: (a) baseline query returns all hits with `tier_used: 'hybrid'`; (b) DELETE FROM `documents_vec`, repeat query; some hits `tier_used='hybrid'` + some `tier_used='bm25-only'` + `search.tier_fallthrough` event; (c) DELETE FROM `documents_fts`, repeat query; hits with `tier_used='catalog-grep'` + two fallthrough events; (d) mv `CATALOG.md` away, repeat query; hits with `tier_used='fs-grep'` + tier_skipped event; (e) restore via `corpus reindex`. *FR-HARDEN-013..FR-HARDEN-019, SC-HARDEN-010..SC-HARDEN-013*

- [ ] T056 [US3] Integration test `tests/integration/tier-budget-exceeded.test.ts` — with `tier_total_budget_ms=50` config override AND all tables emptied to force cascade, invoke `corpus.find`; assert response is a partial set; assert `search.tier_budget_exceeded` event fires; assert call exits within budget + 50ms slack. *FR-HARDEN-016, SC-HARDEN-014, Constitution VII, XVI*

**Checkpoint Phase 5**: US3 P2 complete. Tier 0 → Tier 1 → Tier 2 → Tier 3 cascade works; `tier_used` field per-hit reflects firing tier; aggregate budget enforced; CATALOG.md auto-generated at index-stage; `corpus reindex` regenerates CATALOG.md.

---

## Phase 6: Lint + Constitution Enforcement

**Purpose**: Final pass to verify Constitution principles are mechanically enforced by lint rules over SP-006 source.

- [ ] T057 [P] Integration test `tests/lint-fixtures/sp006-constitutional-grep.test.ts` — code-search lint passes over SP-006 source:
  - Zero `process.exit` invocations in `packages/{contracts,inference,index,storage,pipeline,transport,daemon}/` SP-006-modified files (Constitution XI; SC-HARDEN-018).
  - Zero `execSync`, `child_process.exec`, or string-formed shell command invocations (Constitution XII; SC-HARDEN-019). Exactly ONE allowed: the Tier 3 `runTool('grep', ...)` arg-array invocation.
  - Zero writes outside `Paths.*` resolvers (Constitution XIV; SC-HARDEN-017).
  - Zero `Promise.race(setTimeout)` patterns (Constitution VII).
  - Zero `fs.write*` / `fs.append*` / `fs.mkdir*` / `fs.unlink*` / INSERT/UPDATE/DELETE/CREATE/DROP/ALTER calls in `packages/transport/src/failures-resource-handler.ts` AND `packages/storage/src/failures-resource-adapter.ts` (Constitution III; SC-HARDEN-018).
  - Every catch block emits a telemetry event (Constitution XIII).
  *SC-HARDEN-017, SC-HARDEN-018, SC-HARDEN-019, Constitution III, VII, XI, XII, XIII, XIV*

- [ ] T058 [P] Integration test `tests/lint-fixtures/sp006-no-mcp-mutation-surfaces.test.ts` — assert `packages/transport/src/mcp-server.ts` registers exactly FIVE resources (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, `corpus://docs/{id}`, `corpus://failures`) and ONE tool (`corpus.find`). Zero new MCP tools, zero new prompts. The `corpus.find` tool's surface (input/output Zod schema names) preserved unchanged. *FR-HARDEN-024, SC-HARDEN-016, Constitution III*

- [ ] T059 [P] Integration test `tests/integration/sp006-telemetry-no-body-content.test.ts` — across a mixed-workload run (5 recovery scans + 5 failures-resource reads + 5 tier-fallthrough invocations), zero telemetry event payloads contain substrings drawn from body text of indexed documents NOR raw query text (query strings continue to be SHA-256-hashed per SP-005 FR-RETRIEVAL-023). *FR-HARDEN-005, SC-HARDEN-024, Constitution I*

**Checkpoint Phase 6**: All Constitution principles mechanically enforced by lint over SP-006 source; SP-006 implementation complete.

---

## Phase 7: Polish + Final Commit

**Purpose**: Empirical performance measurement; CLAUDE.md surface documentation; quickstart walkthrough validation; final commit.

- [ ] T060 Empirically measure per-tier latency on pai-node01 — run `tests/integration/tier-fallthrough-end-to-end.test.ts` against fixture corpora; record p95 for Tier 0 / Tier 1 / Tier 2 / Tier 3 in plan.md "Performance Goals" footnote per Constitution XVI honesty. *FR-HARDEN-016, SC-HARDEN-021, Constitution XVI*

- [ ] T061 Empirically measure recovery scan p95 on pai-node01 — run `tests/integration/end-to-end-recovery.test.ts` against synthetic telemetry-log sizes (1k events, 10k events, 100k events); record p95 in plan.md footnote. *FR-HARDEN-001, FR-HARDEN-003, SC-HARDEN-022, Constitution XVI*

- [ ] T062 Empirically measure `corpus://failures` read p95 on pai-node01 — run `tests/integration/failures-resource-mcp.test.ts` against fixture sidecar counts (100, 500, 1000); record p95 in plan.md footnote. *FR-HARDEN-009, Constitution XVI*

- [ ] T063 Walk `specs/006-hardening/quickstart.md` end-to-end against actual SP-006 behavior — verify every step works as described against the user's pai-node01; correct any drift; populate the "Honest performance notes" section with the measured p95s from T060/T061/T062. *Constitution XVI*

- [ ] T064 Update `specs/006-hardening/checklists/requirements.md` with implementation outcomes — for each of the 24 FR-HARDEN-NNN and 24 SC-HARDEN-NNN, mark verified/deferred/measured per actual code state. Document any FR/SC that landed differently than spec described (none expected). *spec.md Requirements, Success Criteria*

- [ ] T065 Add "SP-006 surface" section to root `CLAUDE.md` — mirror the "SP-005 surface" pattern with: (a) the new `corpus://failures` MCP read-only resource alongside SP-002's four (URI, query params, response shape, schema_version); (b) the kill-9 recovery scanner's daemon-startup hook + the resumability matrix table + the 9 recovery.* telemetry classes; (c) the Tier 1/2/3 fallthrough cascade behavior (min_results trigger, per-tier targets, aggregate budget, `tier_used` enum field on SearchHit); (d) the CATALOG.md generator (additive flat-file at `Paths.data() + '/CATALOG.md'`); (e) the 4 new search.tier_* telemetry classes; (f) sub-section "SP-006 is the FINAL substrate sprint — install-complete after merge". Keep prior SP-002 / SP-004 / SP-005 surface sections intact. Update the SPECKIT block to mark SP-006 active. *Project documentation*

- [ ] T066 Update `.specify/feature.json` to `{"feature_directory": "specs/006-hardening"}`. *Project state*

- [ ] T067 Final feature commit on branch `006-hardening` — single squashed commit `feat(sp-006): production hardening — kill-9 cross-stage recovery + corpus://failures MCP resource + tier 1/2/3 fallthrough cascade`; reference the spec/plan/research/data-model/contracts/tasks files; include "All 16 Constitution principles verified [x]" line; include "SP-006 is the FINAL substrate sprint — substrate ships install-complete" line. *Project commit convention*

**Checkpoint Phase 7**: Constitution Check 16/16 [x] re-verified; performance numbers measured + recorded honestly; quickstart walked end-to-end; CLAUDE.md "SP-006 surface" section documented; SP-006 ready for `/speckit-implement` → merge → substrate install-complete milestone.

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
