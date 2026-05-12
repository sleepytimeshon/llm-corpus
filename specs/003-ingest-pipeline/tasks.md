---
description: "Task list for feature 003-ingest-pipeline (SP-003)"
---

# Tasks: Inbox Watcher + Ingest Pipeline (Validation, Normalization, Content-Hash Idempotency)

**Input**: Design documents from `/specs/003-ingest-pipeline/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{inbox-watcher,validation-gate,normalize,idempotency,failure-lane,telemetry}.feature, quickstart.md

**Prior state**: SP-001 merged on `main` (egress hook + MCP server stdio transport + `corpus.find` empty stub + telemetry sink at `Paths.telemetry()`). SP-002 merged on `main` (4 read-only MCP resources, schema migration creating empty `documents` + `taxonomy_terms` tables, frontmatter codec helpers, fixture harness). SP-003 builds *additively* on the SP-001 + SP-002 surface — zero re-implementation of either.

**Tests**: MANDATORY for tasks touching IO, telemetry, paths, schema, subprocess, or atomic writes (per `tasks-template.md` project-specific override and Constitution Principles V, VII, VIII, IX, X, XII, XIII, XIV). SP-003 touches all of these — tests are mandatory throughout. Phase 2 is RED-phase (failing tests authored first); Phase 3 is GREEN-phase (implementations turn them green).

**Scope-bound**: SP-003 ships ONLY the producer pipeline (watcher + validation + hash + normalize + persist + telemetry + drain coordination) plus PREREQ-001..PREREQ-005 forward-compatibility plumbing. SP-003 does NOT ship classification (SP-004), embedding/ranking (SP-005), kill-9 cross-stage recovery or `corpus://failures` MCP resource (SP-006), install scripts (SP-007), or any retrieval prompt template.

**Organization**: Tasks are grouped by phase. User-story phases inherited from the spec map to Phase 3 modules (Phase 3 has implicit US labels — US1 happy-path, US2 dedup, US3 validation rejection, US4 telemetry — interleaved into the modules they touch rather than separate phases, because the modules share state and the user stories share modules). Constitution Check (16/16 [x]) verified at plan time; no Complexity Tracking entries. Phase 0 (Prerequisites) lifts forward-compatibility plumbing to ready-state.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3, or US4 (maps to user stories in spec.md). Phase 3+ tasks carry this label; setup/foundational/polish tasks do not.
- File paths are repo-relative under `~/Projects/llm-corpus/`

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. SP-003 grows three existing packages and extends two (per plan.md "Project Structure"):

- `packages/contracts/` — extended with `Paths.docsStore()`, 14 new telemetry event class schemas, 6 new typed errors
- `packages/pipeline/` — grows from pilot-harness-only to functional (watcher, drain orchestrator, validation gate, hasher, persister, drain lock, policies)
- `packages/extract/` — grows from empty stub to functional (per-MIME normalizers + dispatcher)
- `packages/storage/` — extends `document-adapter.ts` with write-side `insertDocument`; adds `unique-hash-migration.ts`
- `packages/daemon/` — SP-001 stub → SP-003 functional entry point
- `packages/cli/` — extended with `corpus drain` and `corpus daemon start|stop` subcommands
- `tools/pdf-extractor/` — NEW vendored CLI shim (Constitution XII)
- `tests/{unit,integration,fixtures/sp003-ingest}/` — new test files + fixture inputs

---

## Phase 0: Prerequisites (lift forward-compat plumbing to ready-state)

**Purpose**: SP-001/SP-002 era touches that SP-003 needs before any user-story implementation can begin. Each PREREQ gets a TDD contract-test/implementation pair. These are NOT principle violations — they are forward-compatibility plumbing that the existing tasks template explicitly anticipates.

### Tests-First (mandatory per Constitution V/VIII/XIV)

- [ ] T001 [P] Unit test `tests/unit/paths-docs-store.test.ts` — assert `Paths.docsStore()` returns `path.join(Paths.docs(), 'store')`, composes from `Paths.docs()`, and honors `CORPUS_HOME` override. Idempotent across calls; no IO side effects. *Constitution XIV, PREREQ-001*
- [ ] T002 [P] Unit test `tests/unit/unique-hash-migration.test.ts` — `runUniqueHashMigration(db)` adds `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash_unique ON documents(hash)`; idempotent on second invocation; on a fresh schema-migration the index exists post-migration; on a pre-existing DB with duplicate-hash rows the migration tolerates via documented cleanup path (or fails honestly with `IntegrityLossError` if cleanup is rejected). *PREREQ-002, FR-INGEST-004*
- [ ] T003 [P] Unit test `tests/unit/telemetry-sp003-classes.test.ts` — Zod round-trip for all 14 new SP-003 event classes (`inbox.allowlist_hit`, `inbox.allowlist_miss`, `inbox.mime_mismatch`, `inbox.size_exceeded`, `inbox.filename_sanity_failed`, `inbox.watcher_resource_exhausted`, `ingest.dedup_hit`, `ingest.dedup_miss`, `ingest.normalized`, `ingest.completed`, `ingest.file_unstable`, `ingest.aborted`, `pipeline.lock_contention`, `persist.failed`). Each schema validates envelope (event, timestamp, severity, outcome) + class-specific fields per data-model.md §"Telemetry Event"; ≤4096-byte serialization assertion (Constitution IX); pre-existing `TelemetryEvent` union variants (egress.*, resource.read, nfr_008_pilot) still parse unchanged. *PREREQ-003, FR-INGEST-009, Constitution V, IX*
- [ ] T004 [P] Unit test `tests/unit/errors-sp003.test.ts` — 6 new typed errors (`IngestError`, `ValidationError` with `error_code` enum field, `NormalizeError`, `PersistError`, `WatcherError`, `LockContentionError`) instantiate with structured `data`, are throwable, carry distinct `name` values, are recognized by their constructor as instanceof their parent error. *PREREQ-004, Constitution XI*
- [ ] T005 [P] Unit test `tests/unit/with-temp-dir-reexport.test.ts` — `withTempDir` is exported from `packages/contracts/`'s index; creates a tmp dir under `Paths.cache()` (NEVER `os.tmpdir()`); cleans up on success, exception, AND SIGTERM (via test-harness simulated SIGTERM through AbortController); tmp suffix matches `.tmp.<pid>.<rand4hex>` pattern. *PREREQ-005, Constitution VIII, XIV*

### Implementation

- [ ] T006 [P] Extend `packages/contracts/src/paths.ts` — add `docsStore: (): string => path.join(Paths.docs(), 'store')` to the frozen `Paths` object alongside the existing getters. Export unchanged; no breaking change to SP-001/SP-002 callers. *PREREQ-001, Constitution XIV*
- [ ] T007 [P] Implement `packages/storage/src/unique-hash-migration.ts` — `runUniqueHashMigration(db)` executes `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash_unique ON documents(hash)`. Idempotent. If a duplicate-hash row already exists, attempts cleanup via `INSERT OR IGNORE` pass; on irrecoverable failure, throws `IntegrityLossError` with structured data. Called from `runSchemaMigration` (existing SP-002 helper) so fresh-init paths include the constraint automatically. *PREREQ-002, FR-INGEST-004*
- [ ] T008 Wire `runUniqueHashMigration` into `runSchemaMigration` in `packages/storage/src/schema-migration.ts`. Single call at the end of the existing migration; idempotency preserved (`CREATE UNIQUE INDEX IF NOT EXISTS`). No change to the existing `DOCUMENTS_COLUMN_LIST` constant. *PREREQ-002*
- [ ] T009 Extend `packages/contracts/src/telemetry.ts` — add 14 new SP-003 event class Zod schemas to the `TelemetryEvent` discriminated union. Each schema enforces field bounds per data-model.md §"Telemetry Event class size budget". Re-export everything from the package's index. The existing `EgressEvent` alias and SP-002 `resource.read` variant continue to compile unchanged. *PREREQ-003, FR-INGEST-009, Constitution V*
- [ ] T010 [P] Extend `packages/contracts/src/errors.ts` — add `IngestError`, `ValidationError` (with `error_code: ErrorCode`, where `ErrorCode` enum matches FR-INGEST-007 sidecar enum), `NormalizeError`, `PersistError`, `WatcherError`, `LockContentionError`. Each subclass of `Error` with stable `name`, structured `data` field, no `process.exit`. Re-export from index. *PREREQ-004, Constitution XI*
- [ ] T011 [P] Confirm `withTempDir` lives in `packages/contracts/src/` and is exported via the package's index; if it lives in a different location, relocate to `packages/contracts/` so SP-003 (and future SPs) inherit a single source. Implementation MUST satisfy: tmp dir under `Paths.cache()`, suffix `.tmp.<pid>.<rand4hex>`, cleanup on success/exception/SIGTERM. *PREREQ-005, Constitution VIII, XIV*

**Checkpoint**: `npm run build` succeeds; `npm run test:unit` passes for Phase 0 tests; `npm run lint` exits 0 (existing `no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`, `no-promise-race-settimeout` rules cover SP-003 source from this point on). Forward-compat plumbing ready.

---

## Phase 1: Setup (workspace plumbing)

**Purpose**: Dependency installation, scaffolding, fixture-input generation, eslint scope updates.

- [ ] T012 [P] Add `chokidar ^3.6.0` to `packages/pipeline/package.json` dependencies. Pure JS on Linux; optional `fsevents` peer auto-resolved on macOS. Verify native-addon allowlist policy (`fsevents` is pre-allowlisted as a macOS-only optional peer, OR add an allowlist exception with documented justification). *plan.md Decision E*
- [ ] T013 [P] Add `turndown ^7.2.0` to `packages/extract/package.json` dependencies. Pure JS (no native addon). *plan.md Decision G*
- [ ] T014 [P] Add `file-type ^19.0.0` to `packages/pipeline/package.json` dependencies (for MIME-sniff in validation gate). Pure JS. *FR-INGEST-002, ADR-007*
- [ ] T015 [P] Add `pdf-parse ^1.1.1` (pinned exactly, no `^` semver range) to `tools/pdf-extractor/package.json` (NOT the workspace dependencies — vendored shim has its own package.json). Pure JS. *plan.md Decision F*
- [ ] T016 Scaffold `tools/pdf-extractor/extract.mjs` — single-file ESM script that imports pdf-parse, accepts `--in <path>` and `--out <path>` CLI flags, reads the input, calls pdf-parse, writes output text via atomic write. Spawn-with-args contract documented in the file header. *plan.md Decision F, Constitution XII*
- [ ] T017 Scaffold `tools/pdf-extractor/package.json` — `"private": true`, `"type": "module"`, pinned dependencies, NO `dependencies` overlap with the monorepo's workspaces graph. Document in `tools/pdf-extractor/README.md` why this is out-of-workspaces. *plan.md Decision F*
- [ ] T018 Create `tests/fixtures/sp003-ingest/` directory and the fixture-generation `README.md` documenting provenance and the deterministic generation steps for: `valid-small.pdf` (5-page PDF), `valid-md.md` (50-KB Markdown), `valid-txt.txt` (5-KB text), `valid-html.html` (single-page article), `adversary-60mb-identical-prefix-A.bin` + `B.bin` (ADR-002 F-10), `disallowed-docx.docx`, `mismatch-md-with-pdf-bytes.md`, `oversize-by-one-byte.txt`. Fixtures generated via `tests/fixtures/sp003-ingest/generate.sh` (deterministic). *plan.md Decision B reference, data-model.md*
- [ ] T019 [P] Update `eslint.config.js` to scope existing custom rules (`no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`, `no-promise-race-settimeout`, `catch-block-must-emit-telemetry`) to cover SP-003 source files: `packages/pipeline/src/**`, `packages/extract/src/**`, `packages/daemon/src/**`. *Constitution VII, XI, XII, XIII, XIV*
- [ ] T020 [P] Add `[ingest]` section to `config.toml` default + extend `packages/storage/src/config-loader.ts` with `loadIngestConfig()` returning `{maxFileSizeMb: number, perDocTimeoutMs: number, batchPerDocTimeoutMs: number}`. Defaults: 100 MB / 60_000 / 300_000. Range validation: `maxFileSizeMb ∈ [1, 1024]`; timeouts ≥ 1000. *data-model.md §"Validation Gate Config"*

**Checkpoint**: `npm install` succeeds (chokidar/turndown/file-type/pdf-parse resolve); `tools/pdf-extractor/extract.mjs` is invokable via `node tools/pdf-extractor/extract.mjs --help`; fixture inputs generated; `npm run lint` exits 0.

---

## Phase 2: Tests-First (RED phase — Constitution III TDD imperative)

**Purpose**: Author every test file under `tests/unit/` and `tests/integration/` as failing tests against the contracted behavior. Each Gherkin scenario in `contracts/*.feature` maps to ≥1 test. **Phase 2 exit gate**: every spec area's RED suite compiles and runs (all failing). This is the input contract for Phase 3 GREEN.

**⚠️ CRITICAL**: No production-code implementation in Phase 2. Tests reference modules / types that will be implemented in Phase 3 — they MUST fail at the import or assertion level.

### RED suite — Watcher (contracts/inbox-watcher.feature)

- [ ] T021 [P] [US1] Unit test `tests/unit/inbox-watcher.test.ts` — assert `InboxWatcher` accepts `{inboxPath, signal, policy, onDetected}`; emits via `onDetected(path)` on file `add`; honors `awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }`; `depth: 0` (subdirectory files do NOT trigger); on `inotify ENOSPC` emits `inbox.watcher_resource_exhausted` telemetry then throws `WatcherError`. Module path: `packages/pipeline/src/inbox-watcher.ts` (does not yet exist — test fails at import). *FR-INGEST-001, plan.md Decision E*
- [ ] T022 [P] [US1] Integration test `tests/integration/inbox-watcher-initial-scan.test.ts` — pre-populate `Paths.inbox()` with 2 files BEFORE starting the watcher; assert both files are detected on initial-scan within 5 seconds; no file is silently skipped. *FR-INGEST-001 "Drop-during-init"*
- [ ] T023 [P] [US1] Integration test `tests/integration/inbox-watcher-subdir-ignored.test.ts` — create `Paths.inbox() + '/subdir/'` and drop `buried.pdf` into it; assert NO `add` event fires; NO documents row created. *FR-INGEST-001 v1 scope*

### RED suite — Validation gate (contracts/validation-gate.feature)

- [ ] T024 [P] [US3] Unit test `tests/unit/validation-gate.test.ts` — `validateInboxFile(filePath, signal): Promise<Result<ValidatedFile, ValidationError>>` runs filename sanity → extension → MIME-sniff → size in fixed order; short-circuits on first failure; bounded IO (no content read past max-size cutoff); error_code matches gate that fired first; emits the matching `inbox.*` telemetry event. Module path: `packages/pipeline/src/validation-gate.ts`. *FR-INGEST-002, SC-INGEST-007/008/009*
- [ ] T025 [P] [US3] Unit test `tests/unit/validation-gate-mime-mismatch.test.ts` — `.md` extension with `%PDF` magic bytes → `error_code='mime_mismatch'`; sidecar records both `.md` extension and detected `application/pdf` MIME. *ADR-007, C-018 F-5*
- [ ] T026 [P] [US3] Unit test `tests/unit/validation-gate-size-boundary.test.ts` — file at exactly max size passes; file at max+1 bytes fails with `size_exceeded`; reads at most `max+1` bytes before rejection. *SC-INGEST-008, Constitution VII bounded IO*
- [ ] T027 [P] [US3] Unit test `tests/unit/validation-gate-filename-sanity.test.ts` — null-byte names, path-traversal sequences, control characters, and zero-length names all rejected BEFORE any content read; `error_code='filename_sanity_failed'`. *SC-INGEST-009*

### RED suite — Normalizers (contracts/normalize.feature)

- [ ] T028 [P] [US1] Unit test `tests/unit/normalizer-markdown.test.ts` — `normalizeMarkdown(pendingPath, signal): Promise<Result<NormalizedDoc, NormalizeError>>` passes body verbatim; preserves user frontmatter via passthrough; injects FR-008 minimum frontmatter; output frontmatter `id` matches the input doc_id. Module path: `packages/extract/src/normalize-markdown.ts`. *FR-INGEST-006, SC-INGEST-003*
- [ ] T029 [P] [US1] Unit test `tests/unit/normalizer-text.test.ts` — plain-text wraps in minimal Markdown structure; body bytes (post-frontmatter) are byte-identical to source. Module path: `packages/extract/src/normalize-text.ts`. *FR-INGEST-006*
- [ ] T030 [P] [US1] Unit test `tests/unit/normalizer-html.test.ts` — turndown invoked with frozen rule set (no plugins, no custom rules); deterministic output across two runs on the same input; in-process (no subprocess). Module path: `packages/extract/src/normalize-html.ts`. *FR-INGEST-006, plan.md Decision G*
- [ ] T031 [P] [US1] Unit test `tests/unit/normalizer-html-golden.test.ts` — golden test against fixture HTML → expected Markdown output (turndown rule-set drift detection). Pinned `turndown ^7.2.0`; any version bump that changes default rule output breaks this test. *plan.md R5*
- [ ] T032 [P] [US1] Unit test `tests/unit/normalizer-pdf.test.ts` — invokes `runTool('node', ['tools/pdf-extractor/extract.mjs', ...], opts)`; propagates `AbortSignal`; emits `tool_invoked` telemetry with binary "node" (NOT full args); on subprocess success reads stdout-written body file. Module path: `packages/extract/src/normalize-pdf.ts`. *FR-INGEST-006, Constitution XII, plan.md Decision F*
- [ ] T033 [P] [US1] Unit test `tests/unit/normalizer-pdf-timeout.test.ts` — malicious PDF that hangs → 60s timeout → subprocess SIGKILL → `Result.err(ToolInvocationError('TIMEOUT'))` → `error_code='extract_failed'`. *plan.md R2*
- [ ] T034 [P] [US1] Unit test `tests/unit/normalize-dispatcher.test.ts` — `normalize(pendingPath, mimeType, signal)` dispatches to the correct per-MIME normalizer based on `mimeType`. Module path: `packages/extract/src/normalize.ts`. *FR-INGEST-006*

### RED suite — Hashing (contracts/idempotency.feature)

- [ ] T035 [P] [US2] Unit test `tests/unit/hasher.test.ts` — `hashFile(path, signal): Promise<Result<HashResult, HashError>>` uses `crypto.createHash('sha256').update(stream).digest('hex')`; full-file (NOT partial); cancellable via AbortSignal mid-stream; reference openssl sha256 byte-match; lowercase hex output. Module path: `packages/pipeline/src/hasher.ts`. *FR-INGEST-004, ADR-002*
- [ ] T036 [P] [US2] Unit test `tests/unit/hasher-f10-adversary.test.ts` — two 60-MB files with identical first 1-MB but differing last byte produce DIFFERENT hashes. *SC-INGEST-006, ADR-002 F-10*
- [ ] T037 [P] [US2] Unit test `tests/unit/hasher-stability.test.ts` — file size changes between pre-hash and post-hash stat → `Result.err(IngestError('file_unstable'))`. *spec Edge Case "File modified during hash"*

### RED suite — Persistence (contracts/idempotency.feature + failure-lane.feature)

- [ ] T038 [P] [US1] Unit test `tests/unit/persister.test.ts` — `persist({docId, hash, mimeType, sourcePath, normalizedDoc}, signal): Promise<Result<PersistedDoc, PersistError>>` writes body file via `withTempDir` atomic-rename; INSERTs `documents` row + renames source to `processed/` in a single SQLite transaction; both succeed or both fail; partial-failure rollback verified. Module path: `packages/pipeline/src/persister.ts`. *FR-INGEST-008, Constitution VIII*
- [ ] T039 [P] [US1] Unit test `tests/unit/persister-sentinel-columns.test.ts` — `documents` row has `facet_domain=''`, `tags_json='[]'`, `facet_type='unclassified'`, `source_type='inbox-filesystem'`; row passes the schema-migration CHECK constraints. *FR-INGEST-008, data-model.md*
- [ ] T040 [P] [US1] Unit test `tests/unit/persister-body-layout.test.ts` — body file path is `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'`; `documents.body_path` stores relative path `'store/<id-prefix>/<doc-id>.md'`; SP-002's `fetchDocument` reader can dereference the row's `body_path` against `Paths.docs()` and recover the file. *plan.md Decision I, SP-002 reader contract*
- [ ] T041 [P] [US2] Unit test `tests/unit/persister-unique-hash.test.ts` — application-level dedup bypassed; UNIQUE constraint rejects duplicate-hash INSERT; `persist.failed` telemetry emitted with severity "error". *FR-INGEST-004 defense-in-depth*

### RED suite — Drain lock + orchestrator (contracts/telemetry.feature + idempotency.feature)

- [ ] T042 [P] [US4] Unit test `tests/unit/drain-lock.test.ts` — `acquireDrainLock(): Result<DrainLockHandle, LockContentionError>` uses `flock(LOCK_EX | LOCK_NB)` on `Paths.drainLock()`; second concurrent acquisition returns `LockContentionError`; release on `handle.release()`; release on AbortSignal abort; release on `process.exit` (via handler). Module path: `packages/pipeline/src/drain-lock.ts`. *FR-INGEST-011, Constitution IX*
- [ ] T043 [P] [US4] Integration test `tests/integration/concurrency.test.ts` — two `corpus drain` processes launched concurrently; one acquires lock + processes; the other emits `pipeline.lock_contention` and exits 0; ZERO double-ingests. *SC-INGEST-015*
- [ ] T044 [P] [US1] Integration test `tests/integration/drain-orchestrator.test.ts` — `drain(input, policy, signal)` dispatches behavior off policy fields; ONE drain function shared by interactive and batch (Constitution VI); `interactivePolicy` and `batchPolicy` exist and validate against the `PolicySchema`. Module path: `packages/pipeline/src/drain-orchestrator.ts`, `packages/pipeline/src/policies.ts`. *Constitution VI, plan.md Decision H*

### RED suite — End-to-end ingest (contracts/inbox-watcher.feature + idempotency.feature + telemetry.feature)

- [ ] T045 [P] [US1] Integration test `tests/integration/end-to-end-ingest.test.ts` — boot the daemon with `batchPolicy`; drop 4 files (PDF, MD, TXT, HTML); within per-doc budget assert: 4 `documents` rows with `status='success'`, 4 body files in `Paths.docsStore()`, `Paths.pending()` empty, `Paths.processed()` has 4 forensics copies, ≥4 distinct telemetry classes. *SC-INGEST-001, SC-INGEST-002*
- [ ] T046 [P] [US2] Integration test `tests/integration/dedup-content-hash.test.ts` — drop a file, wait for ingest, drop the same content under a different filename; assert single `documents` row, `ingest.dedup_hit` telemetry, no orphan in `Paths.pending()`. Then run the ADR-002 F-10 60-MB adversary; assert two separate rows. *SC-INGEST-005, SC-INGEST-006*
- [ ] T047 [P] [US3] Integration test `tests/integration/failure-lane.test.ts` — drop one file per error_code in the FR-INGEST-007 enum; assert: each in `Paths.failed()`, each with a valid `.error.json` sidecar matching the schema, no `documents` row with status='success' for any. *SC-INGEST-010, SC-INGEST-011*
- [ ] T048 [P] [US3] Integration test `tests/integration/three-folder-routing.test.ts` — post-drain reconciliation: `Paths.pending()` is empty; every `Paths.processed()` file has a success row; every `Paths.failed()` file has a sidecar AND no success row matching source_path. *SC-INGEST-002*

### RED suite — Telemetry (contracts/telemetry.feature)

- [ ] T049 [P] [US4] Integration test `tests/integration/telemetry-coverage.test.ts` — mixed-workload run (10 valid + 5 disallowed + 5 mismatched + 3 oversize + 2 invalid-name + 5 duplicates); assert ≥6 distinct telemetry classes, every event validates against the canonical Zod schema, every event payload ≤ 4096 bytes. *SC-INGEST-012, FR-INGEST-009*
- [ ] T050 [P] [US4] Integration test `tests/integration/telemetry-write-failure.test.ts` — mid-test remount the JSONL parent directory read-only; in-flight ingest routes to `Paths.failed()` with `error_code='telemetry_write_failed', retriable=true`; exception observable to the caller (NOT silently swallowed). *SC-INGEST-013, Constitution XIII*
- [ ] T051 [P] [US4] Integration test `tests/integration/telemetry-no-body-content.test.ts` — fixture document contains unique sentinel string `FIXTURE_CANARY_PHRASE`; ingest; grep over `Paths.telemetry()` returns ZERO matches; hashes/ids/paths permitted. *SC-INGEST-014, Constitution I*
- [ ] T052 [P] [US4] Integration test `tests/integration/sigterm-abort.test.ts` — drop a large PDF; send SIGTERM mid-extract; assert daemon exits within 2s, in-flight doc in `Paths.failed()` with `error_code='aborted', retriable=true`, `ingest.aborted` telemetry. *SC-INGEST-016, FR-INGEST-010*

### RED suite — Lint invariants (cross-cutting)

- [ ] T053 [P] Integration test `tests/integration/sp003-no-process-exit-in-libs.test.ts` — grep over SP-003 source under `packages/{pipeline,extract,storage,contracts}/` for `process.exit`; assert ZERO matches. *SC-INGEST-017, Constitution XI*
- [ ] T054 [P] Integration test `tests/integration/sp003-xdg-paths-only.test.ts` — grep over SP-003 source for `/tmp/`, `os.tmpdir()`, `/var/`, system root path literals; assert ZERO matches. *SC-INGEST-018, Constitution XIV*
- [ ] T055 [P] Integration test `tests/integration/sp003-subprocess-hygiene.test.ts` — grep over SP-003 source for `execSync`, `child_process.exec`, string-formed shell commands; assert ZERO matches. *SC-INGEST-019, Constitution XII*

### RED suite — Daemon lifecycle

- [ ] T056 [P] Integration test `tests/integration/daemon-lifecycle.test.ts` — `corpus daemon start` launches; SIGTERM handler wires master AbortController; watcher + drain loop wired to the master controller; daemon is the ONLY `process.exit` site in the SP-003 source tree. Module path: `packages/daemon/src/index.ts`. *Constitution XI, FR-INGEST-013*
- [ ] T057 [P] Integration test `tests/integration/daemon-policy-selection.test.ts` — `corpus drain` (CLI one-shot) uses `interactivePolicy`; `corpus daemon start` uses `batchPolicy`; ONE drain orchestrator function (`drain(input, policy, signal)`) is invoked by both. *Constitution VI*

**Checkpoint**: `npm run test:unit` and `npm run test:integration` ALL FAIL (RED phase). Test code compiles (Phase 0 + Phase 1 plumbing is in place); modules under test do not yet exist or have stub implementations that fail assertions. Phase 3 GREEN can begin.

---

## Phase 3: Core Implementation (GREEN phase — turn Phase 2 tests green)

**Purpose**: Implement each module in dependency order; each module's GREEN suite goes green before moving to the next.

### Module 1: Validation gate

- [ ] T058 [US3] Implement `packages/pipeline/src/validation-gate.ts` — `validateInboxFile(filePath, signal)` runs the four checks in fixed order; uses `file-type` for MIME-sniff; bounds the read to `max_file_size + 1` bytes; emits `inbox.*` telemetry on every outcome; returns `Result.ok(ValidatedFile)` or `Result.err(ValidationError)` with structured error_code + message. Reads `loadIngestConfig().maxFileSizeMb` at handler-init time. *FR-INGEST-002, ADR-007*
- [ ] T059 [US3] Implement the validation-gate-driven failure-lane move — on `Result.err(ValidationError)`, atomically move the file to `Paths.failed()` + write the `.error.json` sidecar atomically (via `withTempDir`); release the `pending/` lock if held. *FR-INGEST-007, Constitution VIII*

**Module 1 checkpoint**: tests T024-T027 + T047 (validation-related rejections) GREEN.

### Module 2: Hasher

- [ ] T060 [US2] Implement `packages/pipeline/src/hasher.ts` — `hashFile(path, signal)` opens `fs.createReadStream(path)`, pipes through `crypto.createHash('sha256')`, returns lowercase hex. Pre-hash + post-hash `fs.stat` size compare for stability; on mismatch returns `Result.err(IngestError('file_unstable'))`. Cancellable via the signal. *FR-INGEST-004, ADR-002, spec Edge Case "File modified during hash"*

**Module 2 checkpoint**: tests T035-T037 GREEN.

### Module 3: Normalizers

- [ ] T061 [US1] Implement `packages/extract/src/normalize-markdown.ts` — pure passthrough + frontmatter injection via existing `parseMarkdownWithFrontmatter` / `stringifyMarkdownWithFrontmatter` helpers. Frontmatter `.passthrough()` preserves user-supplied keys; FR-008 minimum surface overlaid. *FR-INGEST-006*
- [ ] T062 [US1] Implement `packages/extract/src/normalize-text.ts` — wrap UTF-8 plain text in `---\n<frontmatter>\n---\n<text body>\n` minimal Markdown. *FR-INGEST-006*
- [ ] T063 [US1] Implement `packages/extract/src/normalize-html.ts` — `new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })`; no `service.use(...)`; no `service.addRule(...)`. Deterministic output. *plan.md Decision G*
- [ ] T064 [US1] Implement `packages/extract/src/normalize-pdf.ts` — invokes `runTool('node', ['tools/pdf-extractor/extract.mjs', '--in', tmpPath, '--out', outPath, '--max-old-space-size=512'], { signal, timeoutMs })` per policy; reads stdout-written body file; on `ToolInvocationError` returns `Result.err(NormalizeError('extract_failed'))`. *plan.md Decision F, Constitution XII*
- [ ] T065 [US1] Implement `packages/extract/src/normalize.ts` — `normalize(pendingPath, mimeType, signal)` dispatches to the correct per-MIME normalizer; returns `Result<NormalizedDoc, NormalizeError>`. *FR-INGEST-006*
- [ ] T066 [US1] Implement `tools/pdf-extractor/extract.mjs` — single-file ESM CLI; arg parsing via `process.argv.slice(2)` (no `commander` etc.); `pdf-parse` imported via `import pdfParse from 'pdf-parse'`; writes output via atomic `fs.writeFile` + rename; exits non-zero on any error with structured stderr. *plan.md Decision F*

**Module 3 checkpoint**: tests T028-T034 GREEN.

### Module 4: Persister

- [ ] T067 [US1] Extend `packages/storage/src/document-adapter.ts` with `insertDocument(row, signal): Promise<Result<{docId}, PersistError>>` — INSERTs against the `documents` table using `DOCUMENTS_COLUMN_LIST` column order; validates `row` against `InsertDocumentInput` Zod schema before binding; returns `PersistError('persist_failed')` on UNIQUE violation or any SQLite error; cancellable. *FR-INGEST-008, Constitution V*
- [ ] T068 [US1] Implement `packages/pipeline/src/persister.ts` — `persist({docId, hash, mimeType, sourcePath, normalizedDoc, originalFilename}, signal)`:
  1. Open the write-side SQLite connection via `openIndexReadWrite()` (new helper alongside SP-002's `openIndexReadOnly`).
  2. `BEGIN TRANSACTION`.
  3. Write body file via `withTempDir` → atomic rename to `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'`.
  4. `insertDocument(row, signal)` against the same connection.
  5. Atomic rename source from `Paths.pending()` to `Paths.processed() + '/<doc-id>__<originalFilename>'`.
  6. `COMMIT`.
  7. Emit `ingest.normalized` + `ingest.completed` telemetry.
  On any step failure: ROLLBACK, route to `Paths.failed()` + sidecar, emit `persist.failed` telemetry. *FR-INGEST-008, Constitution VIII, plan.md Decision I*

**Module 4 checkpoint**: tests T038-T041 GREEN.

### Module 5: Drain lock

- [ ] T069 [US4] Implement `packages/pipeline/src/drain-lock.ts` — `acquireDrainLock(): Result<DrainLockHandle, LockContentionError>` opens `Paths.drainLock()`, calls `fcntl.flock(fd, LOCK_EX | LOCK_NB)`; on EWOULDBLOCK returns `LockContentionError`; on success returns handle with `release()` method; SIGTERM handler in the daemon (T077) calls `release()`. *FR-INGEST-011, Constitution IX, VII*

**Module 5 checkpoint**: tests T042-T043 GREEN.

### Module 6: Watcher

- [ ] T070 [US1] Implement `packages/pipeline/src/inbox-watcher.ts` — `InboxWatcher({inboxPath, signal, onDetected})` wraps `chokidar.watch(inboxPath, { awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }, depth: 0, ignoreInitial: false })`; on `add` event calls `onDetected(absolutePath)`; on `error` with `ENOSPC` emits `inbox.watcher_resource_exhausted` telemetry + throws `WatcherError`; closes on `signal.aborted`. *FR-INGEST-001, plan.md Decision E*

**Module 6 checkpoint**: tests T021-T023 GREEN.

### Module 7: Drain orchestrator + policies

- [ ] T071 [US1] Implement `packages/pipeline/src/policies.ts` — exports `interactivePolicy` and `batchPolicy` as Zod-validated `Policy` records per plan.md Decision H. *Constitution VI*
- [ ] T072 [US1] Implement `packages/pipeline/src/drain-orchestrator.ts` — `drain(input, policy, signal)` per-document loop:
  1. Acquire drain lock (Module 5); on contention emit `pipeline.lock_contention` + exit clean.
  2. For each Pending File (which may have been the just-detected file OR a leftover from a prior aborted drain):
     a. Hash (Module 2).
     b. Dedup query against `documents` WHERE `hash = ?`. Hit → emit `ingest.dedup_hit`, remove from `pending/`, continue.
     c. Normalize (Module 3 dispatcher).
     d. Persist (Module 4).
  3. On policy.retryOnRetriableError, retry once on `IngestError(retriable=true)`.
  4. Per-stage AbortController with `policy.perStageTimeoutMs`; per-doc AbortController with `policy.perDocTimeoutMs`; both `clearTimeout`'d on success.
  5. Release drain lock in `finally`. *FR-INGEST-005, FR-INGEST-010, FR-INGEST-011, Constitution VI/VII/IX/X*

**Module 7 checkpoint**: tests T044, T045, T046, T048 GREEN.

### Module 8: Daemon entry point

- [ ] T073 Implement `packages/daemon/src/index.ts` — single `main()` function:
  1. Wire SIGTERM + SIGINT to a master `AbortController`.
  2. Initialize schema migration (idempotent).
  3. Start `InboxWatcher` (Module 6) with master signal.
  4. On each detected file: enqueue into the drain queue.
  5. Periodic drain loop (or watcher-event-driven drain — single drain at a time per Module 5).
  6. On abort: stop watcher, await in-flight drain, release lock, emit `ingest.aborted` for any unfinished doc, `process.exit(0)` within 2s budget.
  7. ONLY `process.exit` site in the SP-003 source tree. *FR-INGEST-001, FR-INGEST-010, Constitution XI*

**Module 8 checkpoint**: tests T056-T057 GREEN.

---

## Phase 4: Integration (wire daemon lifecycle + end-to-end verification)

**Purpose**: Cross-module integration tests pass; daemon-managed lifecycle works end-to-end; telemetry coverage gate green.

- [ ] T074 [US1] Wire `corpus daemon start|stop` CLI subcommands in `packages/cli/` — `start` invokes daemon `main()`; `stop` sends SIGTERM to the daemon PID file. (`packages/cli/` is an entry-point package — `process.exit` allowed.) *Constitution XI*
- [ ] T075 [US1] Wire `corpus drain` CLI subcommand in `packages/cli/` — one-shot drain invocation via `drain(input, interactivePolicy, signal)`; exits 0 on success or `lock_contention`; exits non-zero on unrecoverable failure. *Constitution VI, FR-INGEST-011*
- [ ] T076 [US4] Run the mixed-workload telemetry-coverage suite end-to-end against a real fixture set; assert SC-INGEST-012 ≥6 distinct classes; SC-INGEST-013 honest-failure path; SC-INGEST-014 no-body-content invariant. *T049, T050, T051*
- [ ] T077 [US4] Run the SIGTERM-abort suite; assert SC-INGEST-016 (within 2s, file in `Paths.failed()` with `error_code='aborted'`). *T052*
- [ ] T078 [US4] Run the concurrency suite; assert SC-INGEST-015 (one drain process processes, the other emits `lock_contention` + exits 0). *T043*
- [ ] T079 [US1] Run the end-to-end ingest suite against the user's primary machine fixtures; verify SC-INGEST-001 + SC-INGEST-003 (`corpus://docs/{id}` returns SP-003-produced documents). *T045*
- [ ] T080 [US2] Run the dedup + F-10 adversary suite; assert SC-INGEST-005 + SC-INGEST-006. *T046*

**Checkpoint**: Phase 2's RED suites are all GREEN. End-to-end behavior validates against the spec's measurable outcomes.

---

## Phase 5: Polish (cross-cutting constitution re-check + quickstart validation)

**Purpose**: Constitutional re-evaluation; quickstart walked end-to-end; per-doc budget measured; final commit.

- [ ] T081 Re-evaluate plan.md "Constitution Check" — verify every Principle I-XVI still marked `[x]` after Phase 3+4 implementation. Update plan.md if any `[~]` partials surfaced; lift to `[x]` via Phase 0 PREREQ tasks. *Constitution gate*
- [ ] T082 [P] Run lint integration tests T053, T054, T055 — assert SC-INGEST-017 (no `process.exit` in libs), SC-INGEST-018 (XDG paths only), SC-INGEST-019 (subprocess hygiene). *Constitution XI, XII, XIV*
- [ ] T083 [P] Run SP-002 SC-010 read-only-resource lint over the SP-003 surface — assert SP-003 writers do NOT mutate via the SP-002 resource handler call graph (the resource handlers remain read-only; SP-003 writes only via the persister's own write-side connection). *SP-002 SC-010 invariant preserved*
- [ ] T084 Walk through `quickstart.md` end-to-end against the actual SP-003 implementation. Each "Expected" assertion verified against the running system. Update quickstart.md inline if reality differs from the recipe; the quickstart is the operator's truth-source. *Constitution XVI honesty*
- [ ] T085 Empirically measure the per-document ingest p95 budget on the primary user's machine across the 4-MIME fixture set. Record the measured numbers in plan.md's "Performance Goals" section as a footnote. Update SC-INGEST-001 verification recipe if the measured number requires a recipe change. *spec Edge Case "Per-document ingest wall-clock budget", Constitution XVI*
- [ ] T086 [P] Audit telemetry events — sample 100 events from a real run, verify schema validation passes for all, verify ≤4096 bytes for all, verify no body content appears (grep against a canary corpus). *SC-INGEST-012, SC-INGEST-014, Constitution IX*
- [ ] T087 Final feature-completion commit on `003-ingest-pipeline` branch: subject line `feat(ingest): SP-003 inbox watcher + ingest pipeline + content-hash idempotency`; body references every spec FR-INGEST-* + SC-INGEST-* + ADR-002 + ADR-007 + Constitution principles I-XVI. *speckit-implement merge gate*

**Checkpoint**: SP-003 complete. Ready for `/speckit-implement` merge gate.

---

## Coverage matrix — FR-INGEST-* + SC-INGEST-* → tasks

Every spec requirement and success criterion maps to ≥1 task:

| Spec ID | Implementing / Verifying Task(s) |
|---|---|
| **FR-INGEST-001** (Inbox watcher) | T021, T022, T023, T070, T073 |
| **FR-INGEST-002** (Validation gate order) | T024, T025, T026, T027, T058 |
| **FR-INGEST-003** (Three-folder routing primitive) | T038, T040, T048, T068 |
| **FR-INGEST-004** (Full-file SHA-256 hash + UNIQUE) | T002, T007, T035, T036, T041, T060 |
| **FR-INGEST-005** (Content-hash idempotency) | T035, T036, T046, T072 |
| **FR-INGEST-006** (Normalize to Markdown + YAML frontmatter) | T028-T034, T061-T066 |
| **FR-INGEST-007** (Failure-lane + `.error.json` sidecar) | T047, T059, T068 |
| **FR-INGEST-008** (`documents` row INSERT) | T038, T039, T040, T067, T068 |
| **FR-INGEST-009** (≥6 telemetry event classes) | T003, T009, T049, T076 |
| **FR-INGEST-010** (Cancellable IO) | T052, T060, T064, T072, T073 |
| **FR-INGEST-011** (Drain lock serialization) | T042, T043, T069, T072 |
| **FR-INGEST-012** (Read-only MCP surface preserved) | T083 (lint: SP-003 adds zero MCP mutation surfaces) |
| **FR-INGEST-013** (No `process.exit` in libs) | T053, T082 |
| **FR-INGEST-014** (XDG paths only) | T054, T082 |
| **SC-INGEST-001** (End-to-end 4-MIME happy path) | T045, T079 |
| **SC-INGEST-002** (Three-folder routing invariant) | T048, T072 |
| **SC-INGEST-003** (FR-008 minimum frontmatter via `corpus://docs/{id}`) | T028, T029, T030, T032, T061-T065, T079 |
| **SC-INGEST-004** (Body file atomicity) | T038, T068 |
| **SC-INGEST-005** (Content-hash dedup) | T046, T080 |
| **SC-INGEST-006** (ADR-002 F-10 adversary) | T036, T046, T080 |
| **SC-INGEST-007** (MIME allowlist correctness) | T024, T025, T047, T058 |
| **SC-INGEST-008** (Size-limit boundary) | T026, T058 |
| **SC-INGEST-009** (Filename sanity rejection) | T027, T058 |
| **SC-INGEST-010** (`.error.json` sidecar contract) | T047, T059 |
| **SC-INGEST-011** (No `documents` row for failed entries) | T047, T048 |
| **SC-INGEST-012** (≥6 distinct telemetry classes) | T003, T009, T049, T076 |
| **SC-INGEST-013** (Honest failure on telemetry-write failure) | T050, T076 |
| **SC-INGEST-014** (No body content in telemetry) | T051, T076, T086 |
| **SC-INGEST-015** (Drain lock serialization) | T043, T069, T078 |
| **SC-INGEST-016** (Cancellable IO under SIGTERM) | T052, T077 |
| **SC-INGEST-017** (Library/CLI boundary lint) | T053, T082 |
| **SC-INGEST-018** (XDG-paths-only lint) | T054, T082 |
| **SC-INGEST-019** (Subprocess hygiene lint) | T055, T082 |
| **SC-INGEST-020** (No agent-derived content in canonical store) | T028, T029, T030, T032, T061-T065 (every normalizer deterministic-only; no LLM call) |

**Coverage check**: Every FR-INGEST and SC-INGEST has at least one implementing/verifying task. Reverse coverage: every task ID T001-T087 traces back to at least one FR/SC/ADR/Constitution principle in its description.

---

## DAG sanity check

**Phase ordering (hard gates)**:
- Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5. Each phase's Checkpoint MUST pass before next phase begins.
- Phase 0 (T001-T011) blocks Phase 2 (T021-T057) and Phase 3 (T058-T073) because Phase 2+ tests reference modules under `packages/contracts/` that Phase 0 ships.
- Phase 1 (T012-T020) blocks Phase 2+3 because npm-installed dependencies (chokidar, turndown, file-type, pdf-parse) are imported by Phase 3 modules.
- Phase 2 (Tests-First, T021-T057) blocks Phase 3 (Core Implementation, T058-T073) per the Constitution III TDD imperative — RED tests MUST be authored before GREEN code.
- Phase 3 modules have **intra-phase ordering** because some modules depend on others' types:
  - Module 1 (validation gate) — depends only on Phase 0 (errors, telemetry, paths). Independent. Land first.
  - Module 2 (hasher) — depends only on Phase 0. Independent. `[P]` with Module 1.
  - Module 3 (normalizers) — depends on Phase 0 + the PDF shim from T016/T017. Independent. `[P]` with Modules 1+2.
  - Module 4 (persister) — depends on Modules 2+3 (their result types) + the SP-002 storage adapter extension. Lands AFTER 2+3.
  - Module 5 (drain lock) — independent of Modules 1-4. `[P]` with Modules 1-3.
  - Module 6 (watcher) — independent of Modules 1-5. `[P]` with Modules 1-5.
  - Module 7 (drain orchestrator + policies) — depends on Modules 1+2+3+4+5. Lands AFTER all.
  - Module 8 (daemon) — depends on Modules 6+7. Lands LAST.
- Phase 4 (T074-T080) requires Phase 3 complete (all modules merged into the drain loop).
- Phase 5 (T081-T087) requires Phase 4 complete (end-to-end behavior must work before constitutional re-check is meaningful).

**Terminal tasks**: T087 (final commit) is the merge gate. T084 (quickstart walkthrough) is the operator's truth-source; T085 (per-doc budget measurement) finalizes plan.md's Performance Goals.

**Max prerequisite depth**: T087 ← T081-T086 ← T074-T080 ← T058-T073 ← T021-T057 ← T012-T020 ← T001-T011. Total depth: 6 layers. Comparable to SP-002's 7-layer DAG.

**Parallelizable opportunities** (within phases):
- Phase 0: T001-T005 (tests) all `[P]`; T006, T007, T009, T010, T011 (impl) all `[P]`; T008 serializes after T007.
- Phase 1: T012, T013, T014, T015, T019, T020 all `[P]`; T016 + T017 serialize (same file family).
- Phase 2 (Tests-First): All tests are `[P]` since they live in different files and have no internal dependencies (they're authored failing-first).
- Phase 3: Modules 1, 2, 3, 5, 6 can run `[P]`; Module 4 serializes after 2+3; Module 7 serializes after 1-5; Module 8 serializes after 6+7.
- Phase 4: T074-T080 mostly `[P]` (different CLI subcommands + different end-to-end test suites).
- Phase 5: T082, T083, T086 `[P]`; T084-T085-T087 serialize (sequential operator + final commit).

---

## Sizing call (per `feedback-build-tier-sizing-rule`)

**Estimated LOC**: ~1500-2200 implementation + ~2800-4200 tests + fixtures = **~4500-6500 LOC total** (per plan.md "Scale/Scope").

**Estimated file count**: ~30-35 net new/modified files:
- 1 watcher + 1 drain orchestrator + 1 validation gate + 1 hasher + 1 persister + 1 drain lock + 1 policies + 4 normalizers + 1 normalizer dispatcher + 1 daemon entry-point + 1 unique-hash-migration = 14 production source files
- 3 contracts extensions (telemetry classes, errors, paths getter)
- 1 storage adapter extension (`document-adapter.ts` write-side)
- 2 CLI subcommands
- 1 vendored PDF extractor CLI shim (2 files: `extract.mjs` + `package.json`)
- ~22 test files (12 unit, 10 integration)
- ~10 fixture template files
- 1 README update under `tools/pdf-extractor/`

**Recommendation**: SP-003 sits **above** the 2000 LOC / 15 files split threshold. Recommend **2-dispatch split** per plan.md's "Sizing call":
- **Dispatch 1**: Phases 0-2 (Prerequisites + Setup + Tests-First). All RED tests authored failing. ~T001-T057. ~1600 LOC across ~25 files. Natural exit gate: every RED suite compiles and runs failing.
- **Dispatch 2**: Phases 3-5 (Core Implementation + Integration + Polish). All RED tests turned GREEN. ~T058-T087. ~3000-5000 LOC across ~25 files. Final feature-completion commit.

The split point is the Phase 2/3 boundary — Dispatch 1's failing-RED test suite is the input contract for Dispatch 2's GREEN implementation. Honest halt at Phase 2 exit gate; no temptation to start GREEN before all RED is authored. (Matches SP-002's recommended Phase 2 split point for multi-dispatch.)

---

## Risk register → tasks

Every risk in plan.md §"Risk Register" addressed by at least one task:

| Risk | Description | Addressed by |
|---|---|---|
| R1 | Watcher race conditions / fast write | T021 (awaitWriteFinish config), T037 (stability defense), T070 (impl) |
| R2 | pdf-parse security / memory footprint | T015 (pinned version), T033 (timeout test), T066 (heap cap flag) |
| R3 | SQLite WAL writer-lock contention with SP-002 readers | T067 (insertDocument), T068 (short transactions), T086 (telemetry duration_ms observability) |
| R4 | chokidar polling fallback on macOS without fsevents | T070 (chokidar config), T086 (boot warning event); documented in quickstart.md |
| R5 | turndown rule-set determinism across versions | T031 (golden test), T063 (frozen config), T013 (pinned ^7.2.0) |
| R6 | `documents.hash UNIQUE` migration on existing DBs | T002 (test), T007 (tolerant impl), T008 (wired into runSchemaMigration) |
| R7 | Telemetry record size budget (≤4096 bytes) | T003 (size assertion in schema tests), T009 (Zod bounds), T086 (audit) |
| R8 | Vendored CLI shim and the egress hook | T015 (pinned pdf-parse version), T032 (egress-hook OS-firewall fallback test), T066 (subprocess heap-cap flag) |

---

## Constitution principles → tasks

Quick mapping of which Constitution principles get exercised by which tasks:

| Principle | Description | Exercised by |
|---|---|---|
| I | Local-First, No Egress | T051, T086 (no body content in telemetry); T032 (subprocess egress detection via OS-firewall fallback); existing SP-001 egress hook envelope |
| II | User Curates, LLM Classifies Metadata | T028, T029, T030, T032, T061-T065 (every normalizer deterministic, no LLM); T039 (sentinel column values, no LLM-generated frontmatter) |
| III | Substrate, Not Surface | T083 (SP-003 adds zero MCP mutation surfaces); MCP server remains read-only per SP-002 |
| IV | Knowledge, Not Memory; Single-User, Single-Machine | (not exercised — SP-003 introduces no multi-user code paths; one inbox path) |
| V | Schema-Enforced Structured Output | T003, T009 (telemetry schemas), T067 (InsertDocumentInput Zod), T071 (Policy schema) |
| VI | One Pipeline, Two Policies | T044, T057, T071, T072 (single drain function; two named policies) |
| VII | Cancellable, Bounded IO | T026 (bounded read), T035 (signal mid-stream), T052 (SIGTERM abort), T060, T064, T072 (signal propagation); T069 (lock release on signal) |
| VIII | Atomic Writes & Transactional Index Updates | T011 (withTempDir), T038, T040, T068 (single transaction); T047, T059 (sidecar atomic write) |
| IX | Concurrency-Safe Shared State | T042, T043, T069 (flock); T003, T009, T086 (telemetry ≤4096 bytes); WAL mode inherited from SP-002 |
| X | Idempotent Pipeline Transitions; Three-Folder Routing | T046, T048, T072 (dedup + post-drain invariants) |
| XI | Library/CLI Boundary | T004, T010 (typed errors); T053, T082 (no `process.exit` in libs); T073 (daemon is only exit site) |
| XII | Subprocess Hygiene | T015, T016, T017, T032, T064, T066 (runTool for PDF); T055, T082 (no execSync lint) |
| XIII | Telemetry-or-Die | T003, T009 (schemas); T049, T050 (coverage + honest-failure); every catch block emits telemetry (lint covers SP-003 source per T019) |
| XIV | XDG Paths via Single Resolver | T001, T006 (Paths.docsStore); T054, T082 (no `/tmp/` lint); T011 (withTempDir under Paths.cache) |
| XV | Dynamic Taxonomy with User-Reviewed Promotion | T039 (sentinel values; classifier-owned columns remain observably-unclassified until SP-004) |
| XVI | Validation Honesty | T084 (quickstart walkthrough); T085 (per-doc budget measured, not guaranteed); T031 (turndown deterministic, but golden-tested not claimed) |

---

## Recommended next step

`/speckit-implement` for SP-003 — **2-dispatch Engineer-agent split**:

- **Dispatch 1**: T001-T057 (Phases 0-2; ~25 files; ~1600 LOC; exit at Phase 2 checkpoint).
- **Dispatch 2**: T058-T087 (Phases 3-5; ~25 files; ~3000-5000 LOC; final commit).

**Env prerequisites**: NONE beyond what SP-001/SP-002 established. SP-003 is all-unprivileged — no sudo / root requirements (chokidar reads inbox; pdf-parse subprocess runs as user; SQLite writes are in user's `Paths.data()`). The `LLM_CORPUS_ROOT_TESTS=1` gate from SP-001's privileged tests is not relevant to SP-003.

**Pre-implementation verification**:
- Constitution Check still 16/16 [x] (no drift since plan time).
- Phase 0 PREREQs are forward-compat, not principle violations.
- spec.md is unchanged (commit 64c3bf8 intact).

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks.
- `[Story]` label maps task to user story (US1, US2, US3, US4) for traceability per spec.md.
- Each user story can be partially verified at module-checkpoint granularity (e.g., US3 validation rejection partial at Module 1 checkpoint; full at Phase 4 integration).
- Verify tests fail before implementing (RED phase is the spec's input contract).
- Commit after each task or logical group at developer discretion; the single feature-completion commit (T087) is the merge gate.
- Stop at any phase Checkpoint to validate progress before proceeding.
- Avoid: vague tasks, same-file conflicts (`schema-migration.ts` touched by T007 + T008 — serialize; `paths.ts` touched only by T006; `telemetry.ts` touched only by T009; `errors.ts` touched only by T010).
- Module 8 (daemon, T073) is the ONLY task that adds `process.exit` to SP-003 source — preserves Constitution XI.
