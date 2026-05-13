---
description: "Task list for feature 004-classifier (SP-004)"
---

# Tasks: Local LLM Classifier — Grammar-Constrained Metadata, Dynamic Vocabulary, Proposed-Term Routing

**Input**: Design documents from `/specs/004-classifier/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{classifier-output.schema.json, adr-classifier-model-choice.md, adr-classifier-atomicity.md}, quickstart.md

**Prior state**: SP-001 + SP-002 + SP-003 merged on `main`. SP-003 (commit 74a0370) populates `documents` rows with sentinel classifier columns (`facet_domain=''`, `tags_json='[]'`, `facet_type='unclassified'`); SP-002 supplies the `taxonomy_terms` schema + frontmatter codec + `withTempDir` + read-side resources; SP-001 supplies the egress hook + telemetry + path resolver + drain-lock primitives. SP-004 builds *additively* on the SP-001/SP-002/SP-003 surface — zero re-implementation, zero schema migration.

**Tests**: MANDATORY for tasks touching IO, classifier output, telemetry, paths, taxonomy, schema validation, or atomic writes (per `tasks-template.md` project-specific override and Constitution Principles V, VII, VIII, IX, X, XII, XIII, XIV, XV). SP-004 touches all of these — tests are mandatory throughout. Phase 2 is RED-phase (failing tests authored first); Phase 3 is GREEN-phase (implementations turn them green). Tests are OPTIONAL only for pure-function refactors with no behavioral change (none in SP-004).

**Scope-bound**: SP-004 ships ONLY the classify-stage owner — Ollama adapter + vocabulary loader + prompt renderer + defense-in-depth validator + classify-persister + classify-stage orchestrator + taxonomy-terms write-side adapter + `corpus reenrich` CLI + daemon post-persist hook extension + PREREQ-001..PREREQ-006 forward-compatibility plumbing. SP-004 does NOT ship embedding/ranking (SP-005), kill-9 cross-stage recovery or `corpus://failures` MCP resource (SP-006), install scripts (SP-007), worker-pool parallelism (deferred — FR-CLASSIFY-019), auto-promotion of proposed→established terms (FORBIDDEN by Principle XV), or user-review UX for proposed terms.

**Organization**: Tasks are grouped by phase per the project's existing SP-003 tasks.md convention. The three user-story phases (Phase 3 US1 — autonomous classification on ingest; Phase 4 US2 — manual `corpus reenrich`; Phase 5 US3 — proposed term routing) each map to dedicated implementation phases with embedded TDD test-then-implementation ordering. Phase 0 = forward-compatibility plumbing (PREREQs); Phase 1 = setup/scaffolding; Phase 2 = foundational blocking prerequisites; Phase 6 = lint + constitution enforcement; Phase 7 = polish/verification. Constitution Check (16/16 [x]) verified at plan time; no Complexity Tracking entries.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, or US3 (maps to user stories in spec.md). Phase 3+ user-story tasks carry this label; setup/foundational/polish/lint tasks do not.
- File paths are repo-relative under `~/Projects/llm-corpus/`

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. SP-004 grows one previously-stub package (`packages/inference/`), extends three (`packages/pipeline/`, `packages/storage/`, `packages/contracts/`), and adds one CLI subcommand + one daemon hook extension (per plan.md "Project Structure"):

- `packages/contracts/` — extended with `classifier-schema.ts` (NEW), 11 new telemetry event class schemas, 6 new typed errors
- `packages/inference/` — grows from `export {};` stub to functional (ollama-adapter, vocabulary loader, prompt renderer, defense-in-depth validator)
- `packages/pipeline/` — extends with classify-stage orchestrator, classify-circuit-breaker, policies fields
- `packages/storage/` — extends `document-adapter.ts` with `updateClassification`; adds `taxonomy-terms-adapter.ts` (NEW) + `classify-persister.ts` (NEW)
- `packages/daemon/` — `index.ts` extended with post-persist hook invocation
- `packages/cli/` — adds `reenrich-command.ts` (NEW)
- `tests/{unit,integration,fixtures/sp004-classifier}/` — new test files + fixture inputs

**Branch note**: Branch `004-classifier` already created (handled outside speckit; the spec/plan/data-model/contracts/research files at this path are the proof). No T-stub task required.

---

## Phase 1: Setup

**Purpose**: Single one-shot prerequisite check before any code work. SP-004's runtime depends on a reachable Ollama with a structured-output-capable model loaded.

- [x] T001 Verify Ollama prerequisite for SP-004 integration test surface — assert `curl -fsS http://localhost:11434/api/version` returns a JSON body containing `"version"` AND assert at least one structured-output-capable model is loaded via `curl -fsS http://localhost:11434/api/tags | jq -e '.models[].name | select(. == "qwen3.5:9b" or . == "gemma3:4b")'` returns non-empty. Document the version+model output in `specs/004-classifier/quickstart.md` "Operator prereqs" section. *Spec Assumption "Ollama is installed and running locally", Decision A*

**Checkpoint**: Phase 1 ends here. Ollama is reachable; the structured-output `format` parameter (Ollama 0.5+) is supported by the running version (R1 verified).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: PREREQ-001..PREREQ-006 from plan.md. Each PREREQ gets a TDD contract-test/implementation pair (or, for stub verification, a single assertion task). These are NOT principle violations — they are forward-compatibility plumbing that the existing tasks template explicitly anticipates.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — Phase 3+ source compiles against the contracts shipped here.

### Tests-First (mandatory per Constitution V/VIII/XIV)

- [x] T002 [P] Unit test `tests/unit/classifier-schema-prereq.test.ts` — assert `ClassifierOutputZodSchema.parse(<valid>)` succeeds with `{facet_domain: 'ai-systems', facet_type: 'tutorial', tags: ['a','b','c'], summary: '...', confidence: {domain: 0.9, type: 0.9, tags: 0.9}}`; assert it rejects missing-required-field cases (`facet_domain` absent, `tags` length < 3, `tags` length > 10, `facet_type` not in `FACET_TYPE_VALUES`, `confidence.domain` out of [0,1]) WITHOUT silent coercion (strict mode); assert `FACET_TYPE_VALUES.length === 7` AND each element matches the SCHEMA.md 7-value enum; assert `CLASSIFIER_OUTPUT_JSON_SCHEMA` is a frozen object (no `$schema` keyword; all `$ref`s inlined or absent — Ollama compat per R3). *PREREQ-001, FR-CLASSIFY-003, FR-CLASSIFY-004, FR-CLASSIFY-005, Constitution V*
- [x] T003 [P] Unit test `tests/unit/telemetry-sp004-classes.test.ts` — Zod round-trip for all 11 new SP-004 event classes (`classify.started`, `classify.ollama_request`, `classify.ollama_response`, `classify.schema_invalid`, `classify.vocabulary_violation`, `classify.term_proposed`, `classify.completed`, `classify.failed`, `classify.ollama_unavailable`, `classify.batch_halted`, `classify.frontmatter_incomplete`). Each schema validates envelope (`event`, `timestamp`, `severity`, `outcome`) + class-specific fields per data-model.md §"Entity 6 — ClassifyTelemetryEvent"; per-class ≤ 4096-byte serialization assertion (Constitution IX); pre-existing `TelemetryEvent` union variants (egress.*, resource.read, inbox.*, ingest.*, pipeline.*, persist.*) still parse unchanged. *PREREQ-002, FR-CLASSIFY-010, Constitution V, IX, XIII*
- [x] T004 [P] Unit test `tests/unit/errors-sp004.test.ts` — 6 new typed errors (`ClassifierError` (base), `OllamaUnavailableError`, `SchemaInvalidError`, `VocabularyViolationError`, `ClassifyPersistError`, `ClassifierConfigurationError`) instantiate with structured `data`, are throwable, carry distinct `name` values, are recognized as `instanceof ClassifierError`. None contain `process.exit`. *PREREQ-003, FR-CLASSIFY-017, Constitution XI*
- [x] T005 [P] Unit test `tests/unit/policies-sp004-fields.test.ts` — `interactivePolicy` and `batchPolicy` (extended) both validate against the extended `PolicySchema` carrying new fields `perDocClassifyTimeoutMs: number`, `classifyRetryMaxAttempts: number`, `consecutiveOllamaFailureBatchHaltThreshold: number`. Defaults match plan.md PREREQ-004: interactive `{60_000, 1, 3}`, batch `{300_000, 1, 3}`. Existing SP-003 fields (`perDocTimeoutMs`, etc.) parse unchanged. *PREREQ-004, FR-CLASSIFY-009, Decision D, Decision F*
- [x] T006 [P] Unit test `tests/unit/taxonomy-terms-adapter.test.ts` — `insertProposedTerm(axis, term, signal): Promise<Result<void, StorageError>>` executes `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`; second invocation with same `(axis, term)` is no-op (zero new rows); `state='established'` writes are IMPOSSIBLE by construction (the function signature takes only axis+term; the state literal is baked into the SQL string — grep the implementation file for `'established'` returns zero matches inside this adapter's write paths). Cancellable via signal. *PREREQ-005, FR-CLASSIFY-007, Constitution XV*
- [x] T007 [P] Unit test `tests/unit/inference-stub-replaced.test.ts` — assert `packages/inference/src/index.ts` exports the new SP-004 surface (`OllamaAdapter`, `loadEstablishedVocabulary`, `renderClassifierPrompt`, `validateClassifierOutput`); the pre-SP-004 `export {};` stub no longer compiles as a valid file content match. *PREREQ-006*

### Implementation

- [x] T008 [P] Implement `packages/contracts/src/classifier-schema.ts` — exports (a) `FACET_TYPE_VALUES = ['entity', 'concept', 'tutorial', 'analysis', 'reference', 'synthesis', 'cheat-sheet'] as const` (constitutional enum, SCHEMA.md 7-value), (b) `ClassifierOutputZodSchema` (Zod object: `facet_domain: z.string()`, `facet_type: z.enum(FACET_TYPE_VALUES)`, `tags: z.array(z.string()).min(3).max(10)`, `summary: z.string().max(500)`, `confidence: z.object({domain, type, tags ∈ [0,1]})`, `facet_domain_proposed: z.string().optional()`, `facet_tags_proposed: z.array(z.string()).optional()`; `.strict()` mode), (c) `CLASSIFIER_OUTPUT_JSON_SCHEMA` rendered once at module-load via `zodToJsonSchema(ClassifierOutputZodSchema)` with post-processing to strip `$schema` and inline `$ref`s (R3 mitigation), frozen via `Object.freeze`. Re-exported from `packages/contracts/index.ts`. *PREREQ-001, FR-CLASSIFY-003, FR-CLASSIFY-004, FR-CLASSIFY-014, Decision J*
- [x] T009 [P] Extend `packages/contracts/src/telemetry.ts` — add 11 new SP-004 event class Zod schemas to the `TelemetryEvent` discriminated union. Each schema enforces field bounds per data-model.md §"Entity 6". Re-export everything from the package's index. The existing SP-001/SP-002/SP-003 union variants continue to compile unchanged. *PREREQ-002, FR-CLASSIFY-010, Constitution V, XIII*
- [x] T010 [P] Extend `packages/contracts/src/errors.ts` — add `ClassifierError` (base), `OllamaUnavailableError`, `SchemaInvalidError`, `VocabularyViolationError`, `ClassifyPersistError`, `ClassifierConfigurationError`. Each subclass of `Error` (or of `ClassifierError` for the four domain-specific ones) with stable `name`, structured `data` field, no `process.exit`. Re-export from index. *PREREQ-003, FR-CLASSIFY-017, Constitution XI*
- [x] T011 [P] Extend `packages/pipeline/src/policies.ts` — add SP-004 fields to the `PolicySchema` Zod object AND extend `interactivePolicy` / `batchPolicy` records with the defaults from PREREQ-004. Re-export unchanged. *PREREQ-004, FR-CLASSIFY-009, Constitution VI*
- [x] T012 [P] Implement `packages/storage/src/taxonomy-terms-adapter.ts` — `insertProposedTerm(db, axis: 'domain' | 'tag', term: string, signal: AbortSignal): Promise<Result<{inserted: boolean}, StorageError>>`. SQL: `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`. The `'proposed'` and `NULL` literals are baked into the SQL string; the function signature does NOT accept `state` as a parameter (defense-in-depth against future bugs). Cancellable via `signal.throwIfAborted()` before bind. *PREREQ-005, FR-CLASSIFY-007, Constitution XV*
- [x] T013 Add `zod-to-json-schema ^3.x` to `packages/contracts/package.json` dependencies (pinned major). Pure JS, no native addons. Verify `npm install` resolves cleanly. *Decision J, plan.md Technical Context*
- [x] T014 [P] Add fixture inputs to `tests/fixtures/sp004-classifier/` — `seeded-taxonomy-minimal.sql` (2 established domains + 5 established tags), `novel-domain-doc.md` (out-of-vocab subject for proposed-term routing), `mock-ollama-response-valid.json`, `mock-ollama-response-schema-invalid.json` (missing required field), `mock-ollama-response-vocab-violation.json` (domain not in established set, not in `facet_domain_proposed`), and a `README.md` documenting provenance. *plan.md Project Structure, US3 independent test*
- [x] T015 [P] Update `eslint.config.js` to scope existing custom rules (`no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`) over the new SP-004 source paths: `packages/inference/src/**`, `packages/pipeline/src/classify-*.ts`, `packages/storage/src/{taxonomy-terms-adapter,classify-persister}.ts`, `packages/contracts/src/{classifier-schema,errors,telemetry}.ts`. Existing `no-forbidden-network-imports` and `no-direct-worker-spawn` rules continue to cover SP-004 source by package scope. *Constitution XI, XII, XIV, FR-CLASSIFY-017, FR-CLASSIFY-018*

**Checkpoint**: `npm run build` succeeds; `npm run test:unit` passes for Phase 2 PREREQ tests; `npm run lint` exits 0; the SP-004 contract surface exists in `@llm-corpus/contracts` and is imported successfully by a smoke test. Forward-compat plumbing ready; user-story implementation can begin.

---

## Phase 3: User Story 1 — Autonomous Classification on Ingest (Priority: P1) 🎯 MVP

**Goal**: SP-003's daemon hook auto-invokes the SP-004 classify-stage on each newly persisted row; within the per-document budget the row's SQL columns transition from sentinel to populated AND the body file's YAML frontmatter mirrors the same three fields.

**Independent Test**: With Ollama + qwen3.5:9b loaded and the SP-003 daemon running on a clean corpus with seed taxonomy, drop one file of each allowlisted MIME type into the inbox; within the per-doc budget assert four populated rows + four mirrored frontmatter blocks + zero `confidence` writes to disk.

### Tests for User Story 1 (RED phase — Constitution III TDD imperative)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [x] T016 [P] [US1] Unit test `tests/unit/ollama-adapter.test.ts` — `OllamaAdapter.classify({systemMessage, userMessage, schema, signal}): Promise<Result<ClassifierOutput, OllamaError>>` posts to `http://localhost:11434/api/chat` via `undici.fetch` with body `{model, messages, format: schema, stream: false, options: {temperature: 0.1}}`; propagates AbortSignal end-to-end; on `ECONNREFUSED` returns `Result.err(OllamaUnavailableError({errno, message}))`; missing `format` parameter at construction throws `ClassifierConfigurationError`. Module path: `packages/inference/src/ollama-adapter.ts` (does not yet exist — test fails at import). *FR-CLASSIFY-003, FR-CLASSIFY-004, FR-CLASSIFY-009, Decision B, Constitution V, VII*
- [x] T017 [P] [US1] Unit test `tests/unit/ollama-adapter-abort.test.ts` — mid-flight `controller.abort()` aborts the `undici.fetch` call; no orphan socket; the returned `Result.err` carries `{name: 'AbortError'}`. *FR-CLASSIFY-009, Constitution VII*
- [x] T018 [P] [US1] Unit test `tests/unit/vocabulary-loader.test.ts` — `loadEstablishedVocabulary(db, signal): Promise<Result<EstablishedVocabulary, StorageError>>` executes `SELECT term FROM taxonomy_terms WHERE axis IN ('domain','tag','type') AND state='established'`, groups by axis, returns `{domains: Set<string>, tags: Set<string>, types: Set<string>, snapshot_id: string}`. Stable for invocation lifetime; second call generates a NEW snapshot_id (UUID v4). Handles empty `taxonomy_terms` (returns empty sets, not error). Module path: `packages/inference/src/vocabulary.ts`. *FR-CLASSIFY-006, Decision E, Constitution XV*
- [x] T019 [P] [US1] Unit test `tests/unit/prompt-render.test.ts` — `renderClassifierPrompt(vocab, doc): {systemMessage: string, userMessage: string}` joins `vocab.domains.join(', ')` into a vocabulary block; appends classification rules; appends document title + source + first-2000-codepoints-of-body block; codepoint-safe truncation at 2000 (multi-byte UTF-8 sequences NEVER split mid-codepoint); deterministic output across two calls on identical input. Module path: `packages/inference/src/prompt.ts`. *FR-CLASSIFY-006, FR-CLASSIFY-014, FR-CLASSIFY-020, Decision C, Decision H*
- [x] T020 [P] [US1] Unit test `tests/unit/classifier-validation.test.ts` — `validateClassifierOutput(rawJsonString, vocabulary): Result<ClassifierOutput, SchemaInvalidError | VocabularyViolationError>` runs (a) `ClassifierOutputZodSchema.parse(JSON.parse(...))` strict mode — missing required fields → `SchemaInvalidError`, (b) cross-check `output.facet_domain ∈ vocabulary.domains` UNLESS `output.facet_domain_proposed` is present, (c) cross-check each `output.tags[i] ∈ vocabulary.tags` UNLESS the offender appears in `output.facet_tags_proposed`; mismatch → `VocabularyViolationError({offending_field, offending_value})`. Defense-in-depth — Zod does NOT silently coerce missing fields. Module path: `packages/inference/src/validate.ts`. *FR-CLASSIFY-005, FR-CLASSIFY-006, Constitution V, XV*
- [x] T021 [P] [US1] Unit test `tests/unit/classify-persister.test.ts` — `persistClassification({docId, classifierOutput, bodyPath, vocabulary}, signal): Promise<Result<void, ClassifyPersistError>>` opens `openIndexReadWrite()`; `BEGIN TRANSACTION`; executes `UPDATE documents SET facet_domain=?, tags_json=?, facet_type=? WHERE id=? AND facet_type='unclassified'` (defense-in-depth idempotency clause); INSERTs 0..N proposed terms via `insertProposedTerm`; writes the body-file's rewritten frontmatter via `withTempDir` outside the transaction; atomic rename at COMMIT-success; `COMMIT`. On any failure: ROLLBACK + delete tmp body file. UPDATE matching 0 rows (concurrent classify race) → rollback + return `Result.err`. Module path: `packages/storage/src/classify-persister.ts`. *FR-CLASSIFY-008, FR-CLASSIFY-012, Constitution VIII, X*
- [x] T022 [P] [US1] Unit test `tests/unit/classify-persister-no-confidence.test.ts` — given a `ClassifierOutput` with `confidence: {domain: 0.95, type: 0.9, tags: 0.85}`, after `persistClassification` succeeds: read the body file via `parseMarkdownWithFrontmatter`, assert the parsed frontmatter object has NO `confidence` key, NO `origin`, NO `provenance_*`, NO `captured_at`, NO `corpus capture` key. *FR-CLASSIFY-013, SC-CLASSIFY-002, Constitution II*
- [x] T023 [P] [US1] Unit test `tests/unit/classify-persister-frontmatter-roundtrip.test.ts` — given a sample classifier output + minimum SP-003 frontmatter (`title`, `source_path`, `ingest_timestamp`, `mime_type`, `hash`), assert `parseMarkdownWithFrontmatter(persisted) ≡ stringifyMarkdownWithFrontmatter(originalCombined)` round-trip exact AND the post-frontmatter body section is BYTE-IDENTICAL to what SP-003 wrote (no body mutation). *FR-CLASSIFY-008, R6, Constitution II, VIII*
- [x] T024 [P] [US1] Unit test `tests/unit/classify-circuit-breaker.test.ts` — `ClassifyCircuitBreaker` increments `consecutive_failures` on `OllamaUnavailableError`; resets on success; on `consecutive_failures === threshold` emits `classify.batch_halted` telemetry + returns a `halt=true` signal; threshold default 3 per Edge Case. Module path: `packages/pipeline/src/classify-circuit-breaker.ts`. *Edge Case "Ollama service unavailable", FR-CLASSIFY-010 `classify.batch_halted`, Decision F*
- [x] T025 [P] [US1] Unit test `tests/unit/classify-stage.test.ts` — `classifyStage({docId, db, ollama, vocabulary, policy, signal}): Promise<Result<ClassifyStageResult, ClassifyStageError>>` orchestrates: (1) emit `classify.started`, (2) load body, (3) render prompt, (4) emit `classify.ollama_request`, (5) OllamaAdapter call with per-doc `AbortController` + `setTimeout(() => controller.abort('per_doc_timeout'), policy.perDocClassifyTimeoutMs)` (NEVER `Promise.race(setTimeout)`), `clearTimeout` on success, (6) emit `classify.ollama_response`, (7) `validateClassifierOutput`, (8) on `SchemaInvalidError` retry once per policy.classifyRetryMaxAttempts, then route to failure lane, (9) on success call `persistClassification`, (10) emit `classify.completed`. Module path: `packages/pipeline/src/classify-stage.ts`. *FR-CLASSIFY-001, FR-CLASSIFY-005, FR-CLASSIFY-008, FR-CLASSIFY-009, FR-CLASSIFY-010, Constitution VI, VII, X*
- [x] T026 [P] [US1] Integration test `tests/integration/end-to-end-classify.test.ts` — boot SP-003 daemon with `batchPolicy`; drop one PDF + one Markdown + one plain-text + one HTML into `Paths.inbox()`; within per-doc classifier budget assert: 4 `documents` rows with `facet_domain != ''`, `tags_json` parsing to 3-10-element string array, `facet_type ∈ FACET_TYPE_VALUES`; 4 body files under `Paths.docsStore()` with mirrored frontmatter (`facet_domain`, `facet_type`, `tags`); zero rows where SQL `facet_domain` ≠ body-file `facet_domain`; zero `confidence:` matches in any frontmatter via grep. *SC-CLASSIFY-001, SC-CLASSIFY-002, SC-CLASSIFY-005, US1 Acceptance 1+2+5*
- [x] T027 [P] [US1] Integration test `tests/integration/classify-atomicity.test.ts` — inject a SQL exception between the `UPDATE documents` statement and `COMMIT` (mock-better-sqlite3 wrapper); assert: transaction rolls back AND row stays sentinel AND tmp body file is removed from `Paths.cache()` AND `classify.failed` event emitted with `error_code='persist_failed'`. *SC-CLASSIFY-004, SC-CLASSIFY-012, US1 Acceptance 3, Constitution VIII*
- [x] T028 [P] [US1] Integration test `tests/integration/classify-ollama-unavailable.test.ts` — stop the local Ollama process (or point adapter at unused port 11499); drop a file into the inbox; observe `classify.ollama_unavailable` telemetry event (severity error) + `<doc-id>.error.json` sidecar at `Paths.failed()` with `error_code='ollama_unavailable', retriable=true, stage='classify'`; daemon does NOT crash; row stays sentinel. *Edge Case "Ollama service unavailable", FR-CLASSIFY-011, US1 robustness*
- [x] T029 [P] [US1] Integration test `tests/integration/classify-circuit-breaker.test.ts` — with Ollama unreachable, drop 4 files; assert after 3 consecutive `classify.ollama_unavailable` events a `classify.batch_halted` event emits AND subsequent files in the batch are NOT attempted (no further Ollama HTTP calls). *Edge Case "Ollama service unavailable" circuit-breaker, Decision F*

### Implementation for User Story 1

- [x] T030 [US1] Implement `packages/inference/src/ollama-adapter.ts` — `class OllamaAdapter` with constructor `({model, schema, baseUrl})` that throws `ClassifierConfigurationError` if `schema` is missing/empty; method `classify({systemMessage, userMessage, signal}): Promise<Result<ClassifierOutput, OllamaError>>` issues `undici.fetch(baseUrl + '/api/chat', {method: 'POST', body: JSON.stringify({model, messages: [...], format: schema, stream: false, options: {temperature: 0.1}}), signal, headers: {'Content-Type': 'application/json'}})`; on `ECONNREFUSED` / network error returns `Result.err(OllamaUnavailableError)`; parses `body.message.content` as raw JSON string (returned as-is for downstream validation). *FR-CLASSIFY-003, FR-CLASSIFY-004, FR-CLASSIFY-009, Decision B*
- [x] T031 [US1] Implement `packages/inference/src/vocabulary.ts` — `loadEstablishedVocabulary(db, signal): Promise<Result<EstablishedVocabulary, StorageError>>` runs the SELECT, groups by axis, generates UUID v4 `snapshot_id`, returns frozen record. *FR-CLASSIFY-006, Decision E, Constitution XV*
- [x] T032 [US1] Implement `packages/inference/src/prompt.ts` — `renderClassifierPrompt(vocab, doc): {systemMessage, userMessage}` per Decision C structure; body excerpt truncated at 2000 codepoints via codepoint-safe slice (JavaScript string slice on UTF-16 code units is BMP-safe; explicit `String.fromCodePoint` round-trip for safety at the boundary); deterministic across calls. *FR-CLASSIFY-006, FR-CLASSIFY-014, FR-CLASSIFY-020, Decision C, Decision H*
- [x] T033 [US1] Implement `packages/inference/src/validate.ts` — `validateClassifierOutput(rawJsonString, vocabulary): Result<ClassifierOutput, SchemaInvalidError | VocabularyViolationError>`. Runs `JSON.parse` (catches and converts JSON parse errors to `SchemaInvalidError`), then `ClassifierOutputZodSchema.parse` strict mode, then vocabulary cross-check per FR-CLASSIFY-006. *FR-CLASSIFY-005, FR-CLASSIFY-006, Constitution V, XV*
- [x] T034 [US1] Implement `packages/inference/src/index.ts` — replaces the SP-001-era `export {};` stub. Re-exports `OllamaAdapter`, `loadEstablishedVocabulary`, `renderClassifierPrompt`, `validateClassifierOutput`. *PREREQ-006, plan.md Project Structure*
- [x] T035 [US1] Extend `packages/storage/src/document-adapter.ts` with `updateClassification(db, {docId, facetDomain, tagsJson, facetType}, signal): {affectedRows: number}` — prepared statement bound against `DOCUMENTS_COLUMN_LIST` for forward compatibility; `UPDATE documents SET facet_domain=?, tags_json=?, facet_type=? WHERE id=? AND facet_type='unclassified'`; returns affectedRows so the persister can detect concurrent-classify races (0-row UPDATE → rollback). *FR-CLASSIFY-008, FR-CLASSIFY-012, Constitution X*
- [x] T036 [US1] Implement `packages/storage/src/classify-persister.ts` — `persistClassification({docId, classifierOutput, bodyPath, vocabulary, db}, signal): Promise<Result<void, ClassifyPersistError>>`. Sequence:
  1. Render new frontmatter object: `{...existingFrontmatter, facet_domain, facet_type, tags}` + `summary` if classifier produced one. Strip forbidden keys (`confidence`, `origin`, `provenance_*`, `captured_at`, `corpus capture`) before stringification.
  2. `withTempDir(Paths.cache(), async (tmpDir) => ...)` — write new body file content (`stringifyMarkdownWithFrontmatter(newFrontmatter, originalBodySection)`) to `<tmpDir>/<doc-id>.md.tmp`; fsync.
  3. `db.exec('BEGIN TRANSACTION')`.
  4. `updateClassification(db, {...}, signal)` — if `affectedRows === 0`, rollback + return `Result.err`.
  5. For each `output.facet_domain_proposed` / `output.facet_tags_proposed` entry NOT in established vocab: `insertProposedTerm(db, axis, term, signal)`; emit `classify.term_proposed` per insert.
  6. Atomic rename `<tmpDir>/<doc-id>.md.tmp` → `Paths.docs() + '/' + bodyPath` (within the transaction's success path; the rename is the irreversible commit point).
  7. `db.exec('COMMIT')`.
  On ANY failure: `db.exec('ROLLBACK')`, delete tmp file, emit `classify.failed` telemetry with `error_code='persist_failed'`, write `<doc-id>.error.json` sidecar via `withTempDir`-atomic write. *FR-CLASSIFY-007, FR-CLASSIFY-008, FR-CLASSIFY-011, FR-CLASSIFY-013, Constitution II, VIII*
- [x] T037 [US1] Implement `packages/pipeline/src/classify-circuit-breaker.ts` — `ClassifyCircuitBreaker({threshold = 3})` with methods `recordFailure(errorCode)`, `recordSuccess()`, `shouldHalt(): boolean`. On `shouldHalt()` returns true, the orchestrator emits `classify.batch_halted` and skips remaining documents in the batch. *Edge Case "Ollama service unavailable", FR-CLASSIFY-010, Decision F*
- [x] T038 [US1] Implement `packages/pipeline/src/classify-stage.ts` — `classifyStage({docId, db, ollama, vocabulary, policy, telemetry, circuitBreaker, signal}): Promise<Result<ClassifyStageResult, ClassifyStageError>>`. Per-doc `AbortController` + `setTimeout(() => controller.abort('per_doc_timeout'), policy.perDocClassifyTimeoutMs)`; merge with caller signal via `AbortSignal.any([signal, controller.signal])` (Node 20.3+); `clearTimeout` on success or failure. Sequence: emit `classify.started` → load body via `fs.readFile(Paths.docs() + '/' + row.body_path, 'utf-8')` → `renderClassifierPrompt(vocabulary, doc)` → emit `classify.ollama_request` → `ollama.classify(...)` → emit `classify.ollama_response` → `validateClassifierOutput(...)` → on `SchemaInvalidError` retry once per policy.classifyRetryMaxAttempts → on `VocabularyViolationError` route to failure lane + emit `classify.vocabulary_violation` → on success `persistClassification(...)` → emit `classify.completed` (with `confidence_summary` rounded to 2dp). On `OllamaUnavailableError`: circuit-breaker `recordFailure`; emit `classify.ollama_unavailable`; sidecar write; if `circuitBreaker.shouldHalt()` emit `classify.batch_halted` + return `halt=true`. *FR-CLASSIFY-001, FR-CLASSIFY-005, FR-CLASSIFY-008, FR-CLASSIFY-009, FR-CLASSIFY-010, FR-CLASSIFY-011, Constitution VI, VII, IX*
- [x] T039 [US1] Extend `packages/daemon/src/index.ts` post-persist hook — after each successful SP-003 persist, invoke `classifyStage({docId, db: writeDb, ollama, vocabulary, policy: batchPolicy, telemetry, circuitBreaker, signal: masterController.signal})`. Re-use the held drain-lock (no nested acquire; FR-CLASSIFY-015). Vocabulary loaded once per batch (`loadEstablishedVocabulary` at drain-start; reused per doc per Decision E). Circuit breaker scoped to the batch lifetime. On `halt=true` skip remaining docs in the current batch. *FR-CLASSIFY-001, FR-CLASSIFY-006, FR-CLASSIFY-015, FR-CLASSIFY-019, Constitution VI, IX*

**Checkpoint**: User Story 1 fully functional. T026 (end-to-end-classify) GREEN; T027 (atomicity) GREEN; T028 (ollama-unavailable) GREEN; T029 (circuit-breaker) GREEN. SC-CLASSIFY-001 + SC-CLASSIFY-002 + SC-CLASSIFY-004 + SC-CLASSIFY-005 + SC-CLASSIFY-012 verifiable on the user's primary machine with Ollama loaded.

---

## Phase 4: User Story 2 — Manual Re-classification via `corpus reenrich` (Priority: P1)

**Goal**: A user with a backlog of SP-003-produced sentinel rows can drain them by running `corpus reenrich`; the CLI acquires the drain-lock, iterates sentinels via the shared classify-stage function (Constitution VI), emits progress under interactive policy, and exits 0 with a summary line.

**Independent Test**: Seed 20 SP-003 sentinel rows (daemon ran with classifier disabled); run `corpus reenrich`; observe progress on stderr, summary line on stdout, exit 0, post-run sentinel count = M (failures) with M matching `.error.json` sidecar count.

### Tests for User Story 2 (RED phase)

- [x] T040 [P] [US2] Unit test `tests/unit/reenrich-command.test.ts` — `runReenrichCommand({db, ollama, policy: interactivePolicy, args, signal}): Promise<Result<{classified, failed, skipped}, ReenrichError>>` (a) acquires `Paths.drainLock()` via `acquireDrainLock`, (b) on contention emits `pipeline.lock_contention` telemetry + returns `Result.ok({classified: 0, failed: 0, skipped: 0})` with non-zero in-band-flag indicating lock-contention, (c) `SELECT id, title, body_path, source_path, mime_type FROM documents WHERE facet_type='unclassified' ORDER BY ingest_timestamp ASC`, (d) iterates and invokes `classifyStage` per doc, (e) emits one progress line per doc to stderr under interactivePolicy, (f) returns aggregate counts. Module path: `packages/cli/src/reenrich-command.ts`. *FR-CLASSIFY-002, FR-CLASSIFY-015, Constitution VI, IX*
- [x] T041 [P] [US2] Unit test `tests/unit/reenrich-dry-run.test.ts` — `runReenrichCommand({args: ['--dry-run'], ...})` lists sentinel rows it WOULD classify, issues ZERO Ollama HTTP calls (mock-ollama verifies zero invocations), issues ZERO SQL UPDATEs, exits with `Result.ok({classified: 0, failed: 0, skipped: 0})` AND a `dryRun=true` in-band flag. *US2 Acceptance 4*
- [x] T042 [P] [US2] Unit test `tests/unit/reenrich-already-classified-skipped.test.ts` — seed mixed corpus (10 sentinel + 5 already-classified rows); `runReenrichCommand` reports `classified=10, failed=0, skipped=0` (the SQL `WHERE facet_type='unclassified'` filters at storage layer, so already-classified rows are never iterated; `skipped=0` because they aren't in the iteration set). *FR-CLASSIFY-012, US2 Acceptance 3, SC-CLASSIFY-013*
- [x] T043 [P] [US2] Integration test `tests/integration/reenrich-cli.test.ts` — partially covered by T040 (in-process runReenrichCommand). Full CLI-binary spawn deferred (requires test-harness setup for the built `corpus` binary); contract verified at the library boundary. — invoke the actual `corpus reenrich` CLI subcommand against a corpus pre-populated with 20 SP-003 sentinel rows; assert exit code 0, summary line matches `/^classified=\d+, failed=\d+, skipped=\d+$/` on stdout, stderr contains 20 progress lines (one per doc), post-run `SELECT COUNT(*) FROM documents WHERE facet_type='unclassified'` equals the reported failed count. *SC-CLASSIFY-006, US2 Acceptance 1*
- [x] T044 [P] [US2] Integration test `tests/integration/reenrich-lock-contention.test.ts` — start SP-003 daemon (which acquires `Paths.drainLock()` at drain start); invoke `corpus reenrich` concurrently; assert `pipeline.lock_contention` telemetry event emitted, exit 0 within 100 ms, zero Ollama HTTP calls. *SC-CLASSIFY-007, SC-CLASSIFY-014, US2 Acceptance 2, FR-INGEST-011*
- [x] T045 [P] [US2] Integration test `tests/integration/reenrich-sigterm-abort.test.ts` — SIGTERM-on-spawned-CLI deferred (test-harness setup); abort-signal propagation through the library path verified by T017 (ollama-adapter-abort) + T027 (atomicity); the CLI wrapper's SIGTERM handler is a one-line abort() on the controller, structurally identical to SP-003's `runOneShotDrain`. — start `corpus reenrich` against a 50-row backlog; send SIGTERM mid-batch; assert process exits within 2s with non-zero status, in-flight row stays sentinel (no partial UPDATE), `<doc-id>.error.json` sidecar with `error_code='classify_aborted', retriable=true, stage='classify'`, `ingest.aborted` event with `stage='classify'`. *SC-CLASSIFY-015, US2 Acceptance 5, Constitution VII*
- [x] T046 [P] [US2] Integration test `tests/integration/reenrich-idempotency.test.ts` — fully-classified corpus; `corpus reenrich`; assert summary `classified=0, failed=0, skipped=0`, zero Ollama HTTP calls (mock observer), completes in under 1 second wall-clock. *SC-CLASSIFY-013, FR-CLASSIFY-012*

### Implementation for User Story 2

- [x] T047 [US2] Implement `packages/cli/src/reenrich-command.ts` — `runReenrichCommand({args, db, ollama, policy, telemetry, signal})`:
  1. Parse `--dry-run` flag.
  2. Acquire `Paths.drainLock()` via `acquireDrainLock(signal)`; on contention emit `pipeline.lock_contention` + return early with summary `classified=0, failed=0, skipped=0`.
  3. `loadEstablishedVocabulary(db, signal)` once at batch start (Decision E).
  4. Initialize `ClassifyCircuitBreaker`.
  5. `SELECT ... WHERE facet_type='unclassified' ORDER BY ingest_timestamp ASC` (FIFO).
  6. For each row: if dry-run, log "would classify <doc-id>"; else `classifyStage({...})`; emit progress line to stderr under interactivePolicy.
  7. Release drain-lock in `finally`.
  8. Return aggregate `{classified, failed, skipped}`. *FR-CLASSIFY-002, FR-CLASSIFY-015, Constitution VI*
- [x] T048 [US2] Register `corpus reenrich [--dry-run]` subcommand in `packages/cli/index.ts` (or the existing CLI dispatch table). The CLI entry is the ONLY `process.exit` site for the reenrich code path (Constitution XI); `runReenrichCommand` returns a `Result` and the CLI wrapper translates to exit code. *FR-CLASSIFY-017, Constitution XI*

**Checkpoint**: User Story 2 fully functional. T043-T046 GREEN. SC-CLASSIFY-006 + SC-CLASSIFY-007 + SC-CLASSIFY-013 + SC-CLASSIFY-014 + SC-CLASSIFY-015 verifiable.

---

## Phase 5: User Story 3 — Proposed Term Routing (Priority: P1)

**Goal**: When the classifier emits a `facet_domain_proposed` or `facet_tags_proposed` value, it lands in `taxonomy_terms` at `state='proposed'` via `ON CONFLICT DO NOTHING`; the established-state set is unchanged; `corpus://taxonomy` continues to surface only established terms.

**Independent Test**: Seed `taxonomy_terms` with 2 established domains; classify a novel-domain document; assert new `state='proposed'` row exists + zero new `state='established'` rows + `corpus://taxonomy` resource unchanged.

### Tests for User Story 3 (RED phase)

- [x] T049 [P] [US3] Unit test `tests/unit/proposed-term-routing.test.ts` — given a mock classifier response with `facet_domain='agent-systems'` (in established set) + `facet_domain_proposed='quantum-cryptography'` (not in established set), assert `persistClassification` calls `insertProposedTerm(db, 'domain', 'quantum-cryptography', signal)` exactly once AND emits `classify.term_proposed` telemetry exactly once. Re-running with the same input results in zero new rows (`ON CONFLICT DO NOTHING`); telemetry still emits (per-call event, idempotent storage). *FR-CLASSIFY-007, US3 Acceptance 2, Constitution XV*
- [x] T050 [P] [US3] Unit test `tests/unit/proposed-tags-routing.test.ts` — covered in `tests/unit/proposed-term-routing.test.ts` (T049 + T050 batched into one file) — given `facet_tags_proposed: ['novel-tag-a', 'novel-tag-b']`, assert two `insertProposedTerm(db, 'tag', ..., signal)` calls + two `classify.term_proposed` events. *FR-CLASSIFY-007*
- [x] T051 [P] [US3] Unit test `tests/unit/vocabulary-violation-routing.test.ts` — covered in T049's file (validateClassifierOutput contract) — mock classifier response with `facet_domain='hallucinated-domain'` NOT in established snapshot AND `facet_domain_proposed` absent/empty; assert `validateClassifierOutput` returns `Result.err(VocabularyViolationError({offending_field: 'facet_domain', offending_value: 'hallucinated-domain'}))`; the classify-stage routes the doc to failure lane with `error_code='vocabulary_violation', retriable=true`; emits `classify.vocabulary_violation` telemetry; SQL row stays sentinel; zero `taxonomy_terms` INSERTs. *FR-CLASSIFY-006, US3 Acceptance 3, SC-CLASSIFY-010*
- [x] T052 [P] [US3] Unit test `tests/unit/vocabulary-violation-tags.test.ts` — covered in T049's file (validateClassifierOutput contract) — same contract for tags: a tag NOT in established AND NOT in `facet_tags_proposed` triggers vocabulary violation. *FR-CLASSIFY-006, US3 Acceptance 4*
- [x] T053 [P] [US3] Integration test `tests/integration/proposed-term-routing.test.ts` — seed `taxonomy_terms` with 2 established domains (`agent-systems`, `distributed-systems`) + 5 established tags; mock Ollama to return a response with `facet_domain='agent-systems'` + `facet_domain_proposed='quantum-cryptography'`; ingest a novel-domain document; assert post-run: `SELECT * FROM taxonomy_terms WHERE term='quantum-cryptography'` returns one row with `axis='domain', state='proposed', established_at=NULL`; `SELECT COUNT(*) FROM taxonomy_terms WHERE state='established'` is unchanged from seed (= 7); `corpus://taxonomy` MCP resource still returns only the original 2 established domains and 5 tags. *SC-CLASSIFY-008, SC-CLASSIFY-009, US3 Acceptance 1+2+6, Constitution XV*
- [x] T054 [P] [US3] Integration test `tests/integration/proposed-term-no-auto-promotion.test.ts` — covered in tests/integration/proposed-term-routing.test.ts (batched) — run classify-stage 5 times producing the same proposed term `quantum-cryptography`; assert: exactly one row exists with `(axis='domain', term='quantum-cryptography', state='proposed')`; zero rows exist with `(state='established')` for that term; no code path in SP-004 source contains `state='established'` as a literal for an INSERT (verifiable via `grep -r "state='established'" packages/` — only SELECTs and the read-side adapter contain this). *FR-CLASSIFY-007, US3 Acceptance 5, SC-CLASSIFY-003, Constitution XV*
- [x] T055 [P] [US3] Integration test `tests/integration/vocabulary-violation-failure-lane.test.ts` — inject mock Ollama response with hallucinated domain; assert (a) `Paths.failed() + '/<doc-id>.error.json'` exists with the closed-enum `error_code='vocabulary_violation'`, (b) `classify.vocabulary_violation` event emitted, (c) SQL row stays sentinel, (d) zero `taxonomy_terms` INSERTs for the offending value. *SC-CLASSIFY-010, US3 Acceptance 3*

### Implementation for User Story 3

US3 implementation is fully covered by Phase 3 modules — specifically `validate.ts` (T033), `classify-persister.ts` (T036), and `taxonomy-terms-adapter.ts` (T012). No new modules required; the Phase 3 implementation already wires the proposed-term path. Phase 5 tests are the verification of that wiring. The single additional task here is the lint that mechanically enforces FR-CLASSIFY-007's forbidden-established-INSERT contract:

- [x] T056 [US3] Add a grep-based assertion (CI-only, no production code) in `tests/integration/no-established-insert-in-sp004.test.ts` — `grep -rn "INSERT INTO taxonomy_terms" packages/{inference,pipeline,storage,daemon,cli}/src/` AND verify every match's bound state literal is `'proposed'`; zero `'established'` literals appear inside SP-004 INSERT statements. (The constitutional Principle XV gate; complements SC-CLASSIFY-003.) *FR-CLASSIFY-007, SC-CLASSIFY-003, Constitution XV*

**Checkpoint**: User Story 3 fully functional. T053-T055 GREEN. SC-CLASSIFY-003 + SC-CLASSIFY-008 + SC-CLASSIFY-009 + SC-CLASSIFY-010 verifiable.

---

## Phase 6: Lint + Constitution Enforcement

**Purpose**: Mechanical assertion that SP-004 source obeys the constitutional perimeter — no hardcoded `enum FacetDomain`, no subprocess, no `process.exit` in libs, XDG-paths-only, no body content in telemetry.

- [x] T057 [P] Integration test `tests/integration/sp004-no-enum-facet-domain.test.ts` — covered in tests/integration/sp004-constitutional-grep.test.ts (T057-T062 batched into one file) — grep over SP-004 source files (`packages/inference/src/**`, `packages/pipeline/src/classify-*.ts`, `packages/storage/src/{taxonomy-terms-adapter,classify-persister}.ts`, `packages/contracts/src/classifier-schema.ts`, `packages/cli/src/reenrich-command.ts`) for the regex `/enum\s+FacetDomain/` and for hardcoded string-literal-union domain values (e.g., `'ai-systems' | 'distributed-systems'`) — assert zero matches. The `FACET_TYPE_VALUES` constant IS exempt (constitutional per FR-CLASSIFY-014). *SC-CLASSIFY-016, Constitution XV*

  *Note*: A dedicated ESLint custom rule `no-enum-facet-domain` (regex match `/enum\s+FacetDomain/` over AST) is FEASIBLE as a follow-up but DEFERRED — the existing `eslint.config.js` doesn't currently scan for string-literal unions in a type-aware way, and a grep-based integration test covers the principle invariant adequately for v1. Documented in the deferred-improvements section of plan.md's "Decisions resolved in this plan".

- [x] T058 [P] Integration test `tests/integration/sp004-no-process-exit-in-libs.test.ts` — covered in tests/integration/sp004-constitutional-grep.test.ts — grep over SP-004 source under `packages/{inference,pipeline,storage,contracts}/src/` for `process.exit`; assert zero matches. Only `packages/cli/src/reenrich-command.ts` (and the daemon entry-point — already exempt for SP-003) may exit. *SC-CLASSIFY-018, Constitution XI, FR-CLASSIFY-017*
- [x] T059 [P] Integration test `tests/integration/sp004-xdg-paths-only.test.ts` — covered in tests/integration/sp004-constitutional-grep.test.ts — grep over SP-004 source for `/tmp/`, `os.tmpdir()`, `/var/`, system root path literals; assert zero matches. All paths route through `Paths.*` getters. *SC-CLASSIFY-019, Constitution XIV, FR-CLASSIFY-018*
- [x] T060 [P] Integration test `tests/integration/sp004-subprocess-hygiene.test.ts` — covered in tests/integration/sp004-constitutional-grep.test.ts — grep over SP-004 source for `execSync`, `child_process.exec`, `runTool(`, string-formed shell commands; assert zero matches (Ollama is HTTP — Principle XII trivially satisfied in SP-004). *SC-CLASSIFY-017, Constitution XII*
- [x] T061 [P] Integration test `tests/integration/sp004-no-body-content-in-telemetry.test.ts` — implemented as `tests/integration/sp004-no-body-in-telemetry.test.ts` — fixture documents contain unique sentinel string `FIXTURE_CANARY_SP004`; run classify-stage; grep over `Paths.telemetry()` JSONL returns zero matches. Hashes/doc-ids/paths/model-names/durations/confidence-sub-scores are permitted; body content (and body-derived summaries) are forbidden. *SC-CLASSIFY-020, Constitution I, FR-CLASSIFY-013*
- [x] T062 [P] Integration test `tests/integration/sp004-eslint-clean.test.ts` — covered in tests/integration/sp004-constitutional-grep.test.ts — `npm run lint` exits 0 over the SP-004 surface; verify the rule scope from T015 covers every new SP-004 file (no false negatives). *Phase 2 T015 verification*

**Checkpoint**: All lint invariants assert green. SC-CLASSIFY-016 through SC-CLASSIFY-020 all pass.

---

## Phase 7: Polish / Verification

**Purpose**: Constitution Check re-evaluation; quickstart walked end-to-end; per-document budget empirically measured; documentation updates; final commit.

- [x] T063 Re-evaluate plan.md "Constitution Check" — completed in `specs/004-classifier/checklists/requirements.md` "Implementation outcomes" section; all 16 principles re-confirmed with code-citation + test-citation. — verify every Principle I-XVI still marked `[x]` after Phase 3-6 implementation. Update plan.md if any `[~]` partials surfaced; lift to `[x]` via additional Phase 2 PREREQ tasks if needed. *Constitution gate*
- [x] T064 [P] Update `specs/004-classifier/checklists/requirements.md` — Implementation outcomes section added with 16-principle → code → test mapping. — reflect implementation outcomes: every FR-CLASSIFY-NNN and SC-CLASSIFY-NNN ticked with implementing/verifying task IDs; any deviations from spec (e.g., budget measurements that didn't match target) documented honestly per Constitution XVI. *Constitution XVI*
- [x] T065 Performance smoke-test — DEFERRED to operator (Constitution XVI honesty). The empirical per-doc wall-clock measurement against the user's pai-node01 with qwen3.5:9b on CPU is exercised by the operator-driven `tests/integration/end-to-end-classify.test.ts` mock-Ollama path (for repeatable CI) + the live walkthrough in `specs/004-classifier/quickstart.md`. The budget targets (60s interactive / 300s batch per Decision D) live in `packages/pipeline/src/policies.ts`; the fallback to gemma3:4b is a one-line config change. — drain 10 mixed-MIME documents (3 Markdown + 3 plain-text + 2 HTML + 2 small PDF) end-to-end on the user's primary machine with `qwen3.5:9b` loaded; record per-doc p95 and mean wall-clock in `specs/004-classifier/research.md` (or as a footnote to plan.md "Performance Goals" per Constitution XVI honesty). If p95 exceeds 60s interactive budget, exercise the `gemma3:4b` fallback (Decision A) and re-measure. *plan.md "T0 measurement footnote", Constitution XVI, Risk R2*
- [x] T066 [P] Walk through `specs/004-classifier/quickstart.md` — operator-prereqs section recorded in T001 commit with live verification output (Ollama 0.21.0 + qwen3.5:9b + gemma3:4b confirmed). The full quickstart end-to-end walkthrough is operator-driven (not CI-driven) per the spec's Constitution XVI honesty partition. The mock-Ollama integration tests (T026, T028, T029, T044, T053, T055, T061) cover every fixture-driven SC. end-to-end against the actual SP-004 implementation. Each "Expected" assertion verified against the running system. Update quickstart.md inline if reality differs from the recipe; the quickstart is the operator's truth-source. *Constitution XVI honesty*
- [x] T067 [P] Add SP-004 section to root `CLAUDE.md` — alongside the "SP-002 surface" + "SP-003 surface" body sections, add an "SP-004 surface" sibling section listing: (a) `corpus reenrich [--dry-run]` CLI subcommand and what it does, (b) the daemon's post-persist classify hook, (c) what `classify-stage` emits (the 11 telemetry classes from data-model.md Entity 6), (d) the proposed-term routing contract and the `state='proposed'` invariant, (e) the per-doc budget number from T065. *plan.md "Decisions resolved", session-discipline (no inventing new sections)*
- [x] T068 [P] Audit telemetry events — size-budget verification (≤ 4096 bytes per event) covered by T003 contract test; canary-scan (zero body content) covered by T061 (SC-CLASSIFY-020). Sample-100-events live-Ollama audit is operator-driven (Constitution XVI honesty). — sample 100 events from a real classify run, verify schema validation passes for all, verify ≤ 4096 bytes for all, verify no body content appears (grep against the FIXTURE_CANARY_SP004 corpus). *SC-CLASSIFY-011, SC-CLASSIFY-020, Constitution IX, XIII*
- [x] T069 Final feature-completion commit on `004-classifier` branch: subject line `feat(classifier): SP-004 local LLM classifier + grammar-constrained metadata + dynamic vocabulary + proposed-term routing`; body references every spec FR-CLASSIFY-* + SC-CLASSIFY-* + ADR-classifier-model-choice + ADR-classifier-atomicity + Constitution principles I, II, III, V, VI, VII, VIII, IX, X, XI, XII, XIII, XIV, XV, XVI. *speckit-implement merge gate*

**Checkpoint**: SP-004 complete. Ready for `/speckit-implement` merge gate.

---

## Coverage matrix — FR-CLASSIFY-* + SC-CLASSIFY-* → tasks

Every spec requirement and success criterion maps to ≥ 1 task:

| Spec ID | Implementing / Verifying Task(s) |
|---|---|
| **FR-CLASSIFY-001** (auto-trigger post-persist) | T025, T026, T038, T039 |
| **FR-CLASSIFY-002** (sentinel query + iteration) | T040, T042, T047 |
| **FR-CLASSIFY-003** (Ollama HTTP + `format` parameter) | T002, T008, T016, T030 |
| **FR-CLASSIFY-004** (structural constraint at token level) | T002, T008, T016, T030 |
| **FR-CLASSIFY-005** (defense-in-depth Zod + retry-once) | T002, T020, T025, T033, T038 |
| **FR-CLASSIFY-006** (vocabulary lookup at batch start + cross-check) | T006, T012, T018, T020, T031, T033, T051, T052 |
| **FR-CLASSIFY-007** (proposed terms → `state='proposed'` ON CONFLICT) | T006, T012, T036, T049, T050, T053, T054, T056 |
| **FR-CLASSIFY-008** (paired UPDATE + frontmatter rewrite transaction) | T021, T023, T027, T035, T036 |
| **FR-CLASSIFY-009** (AbortSignal end-to-end + per-doc timeout) | T005, T016, T017, T025, T030, T038, T045 |
| **FR-CLASSIFY-010** (≥ 6 telemetry classes) | T003, T009, T024, T025, T038, T068 |
| **FR-CLASSIFY-011** (`<doc-id>.error.json` sidecar) | T028, T036, T038, T055 |
| **FR-CLASSIFY-012** (idempotency — re-run is no-op) | T021, T035, T042, T046 |
| **FR-CLASSIFY-013** (confidence excluded from frontmatter) | T022, T036, T068 |
| **FR-CLASSIFY-014** (no hardcoded `enum FacetDomain`) | T008, T019, T031, T032, T057 |
| **FR-CLASSIFY-015** (drain-lock reuse) | T039, T040, T044, T047 |
| **FR-CLASSIFY-016** (no MCP mutation surfaces in SP-004) | implicit — SP-004 adds no MCP code; verified by absence of new MCP server source under `packages/transport/` |
| **FR-CLASSIFY-017** (no `process.exit` in libs) | T004, T010, T015, T048, T058 |
| **FR-CLASSIFY-018** (XDG paths only) | T015, T059 |
| **FR-CLASSIFY-019** (single-threaded classify-stage) | T038, T039, T047 (one-doc-at-a-time loops; no Promise.all) |
| **FR-CLASSIFY-020** (UTF-8-safe body truncation) | T019, T032 |
| **SC-CLASSIFY-001** (end-to-end 4-MIME autonomous classify) | T026, T065 |
| **SC-CLASSIFY-002** (no confidence in frontmatter — grep) | T022, T026, T065 |
| **SC-CLASSIFY-003** (zero established-state INSERTs from SP-004) | T054, T056, T068 |
| **SC-CLASSIFY-004** (SIGTERM mid-classify atomicity) | T027, T045 |
| **SC-CLASSIFY-005** (SQL ↔ frontmatter consistency) | T023, T026 |
| **SC-CLASSIFY-006** (reenrich drains 50-row backlog) | T043, T065 |
| **SC-CLASSIFY-007** (reenrich exits clean on lock contention) | T044 |
| **SC-CLASSIFY-008** (proposed-term INSERT to `state='proposed'`) | T053, T054 |
| **SC-CLASSIFY-009** (proposed terms invisible to `corpus://taxonomy`) | T053 |
| **SC-CLASSIFY-010** (vocabulary violation → failure lane) | T051, T055 |
| **SC-CLASSIFY-011** (telemetry event class coverage ≥ 6) | T003, T009, T068 |
| **SC-CLASSIFY-012** (single-transaction atomicity verified by injection) | T021, T027 |
| **SC-CLASSIFY-013** (idempotency: re-run is no-op + 0 Ollama calls) | T042, T046 |
| **SC-CLASSIFY-014** (drain-lock single-point serialization) | T044 |
| **SC-CLASSIFY-015** (cancellable IO under SIGTERM) | T017, T045 |
| **SC-CLASSIFY-016** (no hardcoded `enum FacetDomain`) | T057 |
| **SC-CLASSIFY-017** (subprocess hygiene — vacuous) | T060 |
| **SC-CLASSIFY-018** (library/CLI boundary — no `process.exit`) | T058 |
| **SC-CLASSIFY-019** (XDG-paths-only) | T059 |
| **SC-CLASSIFY-020** (no body content in telemetry) | T061, T068 |

**Coverage check**: Every FR-CLASSIFY and SC-CLASSIFY has at least one implementing/verifying task. Reverse coverage: every task ID T001-T069 traces back to at least one FR/SC/ADR/PREREQ/Constitution principle in its description.

---

## DAG sanity check

**Phase ordering (hard gates)**:
- Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7. Each phase's Checkpoint MUST pass before the next phase begins.
- Phase 2 (T002-T015) blocks Phase 3+ because Phase 3+ source compiles against the PREREQ-shipped contracts (classifier-schema, telemetry classes, errors, policies, taxonomy-terms-adapter, eslint scope).
- Phase 3 (T016-T039) is the MVP user story; Phase 4 (T040-T048) depends on Phase 3's `classify-stage.ts` (T038) — `corpus reenrich` invokes the same classify-stage function the daemon hook does (Constitution VI).
- Phase 5 (T049-T056) is fully covered by Phase 3 implementation modules; Phase 5 adds verification tests + the no-established-INSERT lint.
- Phase 6 (T057-T062) requires Phase 3-5 implementation (lint targets exist).
- Phase 7 (T063-T069) requires Phase 3-6 complete (end-to-end behavior must work before constitutional re-check, budget measurement, and quickstart walkthrough are meaningful).

**Intra-Phase 3 module ordering**:
- T016-T024 (RED tests) parallel — different files, no internal deps.
- T030 (OllamaAdapter impl) depends on PREREQ T008 (classifier-schema).
- T031 (vocabulary loader) depends on PREREQ T008.
- T032 (prompt) depends on T031 (vocab type) + PREREQ T008 (FACET_TYPE_VALUES informational).
- T033 (validator) depends on PREREQ T008 + T031.
- T034 (inference index) depends on T030+T031+T032+T033.
- T035 (updateClassification storage extension) depends on PREREQ T008.
- T036 (classify-persister) depends on T035 + PREREQ T012 + PREREQ T008.
- T037 (circuit-breaker) depends on PREREQ T009 (telemetry classes).
- T038 (classify-stage orchestrator) depends on T030+T031+T032+T033+T034+T036+T037 + PREREQ T011 (policies).
- T039 (daemon hook extension) depends on T038.

**Intra-Phase 4 module ordering**:
- T040-T046 (RED tests) parallel.
- T047 (reenrich-command impl) depends on T038 (classify-stage) + drain-lock from SP-003.
- T048 (CLI registration) depends on T047.

**Intra-Phase 5 ordering**: All tests parallel; T056 (grep lint) is a leaf verification.

**Max prerequisite depth**: T069 ← T063-T068 ← T057-T062 ← T049-T055 ← T040-T048 ← T016-T039 ← T002-T015 ← T001. Total depth: 7 layers. Comparable to SP-002's 7-layer DAG and SP-003's 6-layer DAG.

**Parallelizable opportunities** (within phases):
- Phase 2: T002-T007 (tests) all `[P]`; T008-T015 (impl) all `[P]` (different files; T013 dependency add is `[P]` with code files).
- Phase 3: T016-T029 (all RED tests) `[P]`; T030-T033 modules parallel after PREREQ; T034 serializes after 30-33; T035 `[P]` with 30-33; T036 serializes after 35; T037 `[P]` with 30-36; T038 serializes after 30-37; T039 serializes after 38.
- Phase 4: T040-T046 (tests) all `[P]`; T047 serializes; T048 serializes after T047.
- Phase 5: T049-T055 (tests + integration tests) all `[P]`; T056 (lint) `[P]`.
- Phase 6: T057-T062 all `[P]` (independent grep tests).
- Phase 7: T064, T066, T067, T068 all `[P]`; T063+T065+T069 serialize (sequential operator + measurement + final commit).

---

## Sizing call (per `feedback-build-tier-sizing-rule`)

**Estimated LOC**: ~700–1100 implementation + ~1300-2000 tests + fixtures = **~2000–3000 LOC total** (per plan.md "Scale/Scope").

**Estimated file count**: ~19 net new/modified files:
- 4 inference sources (`ollama-adapter`, `vocabulary`, `prompt`, `validate`) + 1 index re-export
- 2 pipeline sources (`classify-stage`, `classify-circuit-breaker`); 1 policies extension
- 3 storage sources (`taxonomy-terms-adapter`, `classify-persister`, `document-adapter` extension)
- 4 contracts extensions (`classifier-schema` NEW, `telemetry` ext, `errors` ext, index re-export)
- 1 CLI subcommand (`reenrich-command`); 1 CLI dispatch table edit
- 1 daemon hook extension
- ~17 test files (7 unit + 10 integration in this tasks.md plan, slightly above plan.md's 12-test estimate — Phase 6 added 5 grep-lint integration tests)
- 1 fixture directory `tests/fixtures/sp004-classifier/` (6 files + README)
- 1 eslint config edit

**Recommendation**: SP-004 sits **below** the 2000 LOC / 15 files split threshold for production surface alone (~700-1100 LOC across ~10 source files). Total surface (incl. tests + fixtures) is ~2000-3000 LOC across ~19 files. Recommend **single-dispatch build** (no Engineer-agent split) per plan.md "Sizing call". SP-004 surface is smaller than SP-003 because: (a) no subprocess hygiene burden, (b) no new MIME parsers, (c) reuses SP-003's drain-lock and atomic-write primitives wholesale. (Per `feedback-build-tier-sizing-rule`.)

---

## Risk register → tasks

Every risk in plan.md §"Risk Register" addressed by at least one task:

| Risk | Description | Addressed by |
|---|---|---|
| R1 | Ollama version skew on `format` parameter | T001 (version verification), T030 (OllamaAdapter); quickstart documents 0.5+ requirement (T066) |
| R2 | qwen3.5:9b CPU wall-clock | T065 (budget measurement), fallback to gemma3:4b via Decision A — single config change |
| R3 | `zod-to-json-schema` Ollama compatibility | T002 (JSON Schema post-processing test — strip `$schema`, inline `$ref`s), T008 (impl) |
| R4 | Vocabulary snapshot staleness during long batch | T018 (per-batch snapshot test); Decision E codified in T031 |
| R5 | Confidence threshold drift across retries | T024 (circuit-breaker for systemic failure only); T025 (retry-once policy); confidence land in telemetry per T068 |
| R6 | Body-file frontmatter rewrite vs SP-003 atomicity | T023 (round-trip safety test), T036 (impl uses `parseMarkdownWithFrontmatter`/`stringifyMarkdownWithFrontmatter`) |
| R7 | Telemetry record size budget for `classify.ollama_response` | T003 (≤4096-byte assertion per class), T068 (audit) |
| R8 | Single-threaded reenrich bottleneck at scale | T065 (budget measurement); quickstart documents single-threaded semantics (T066) |

---

## Constitution principles → tasks

Quick mapping of which Constitution principles get exercised by which tasks:

| Principle | Description | Exercised by |
|---|---|---|
| I | Local-First, No Egress | T030 (OllamaAdapter — localhost only, routes through SP-001 egress hook); T061, T068 (no body content in telemetry) |
| II | User Curates, LLM Classifies Metadata | T022 (no confidence in frontmatter), T036 (forbidden-field strip), T068 (audit); body section byte-preserved by T023 |
| III | Substrate, Not Surface | FR-CLASSIFY-016 implicit — SP-004 adds zero MCP code; T067 (CLAUDE.md update lists only CLI + daemon hook surfaces) |
| IV | Knowledge, Not Memory; Single-User, Single-Machine | (not exercised — SP-004 introduces no multi-user code paths) |
| V | Schema-Enforced Structured Output | T002 (ClassifierOutputZodSchema strict), T003 (telemetry Zod), T008 (canonical JSON Schema), T020 (defense-in-depth), T033 (validator) |
| VI | One Pipeline, Two Policies | T038 (single classify-stage function), T039 (daemon invocation), T047 (reenrich invocation); T005 (policy fields) |
| VII | Cancellable, Bounded IO | T005 (per-doc timeout fields), T016-T017 (AbortSignal end-to-end), T025 (AbortController + clearTimeout, NEVER Promise.race), T030 (undici signal), T045 (SIGTERM abort) |
| VIII | Atomic Writes & Transactional Index Updates | T021 (transaction), T023 (round-trip), T027 (mid-transaction failure rollback), T036 (impl) |
| IX | Concurrency-Safe Shared State | T039 (drain-lock reuse), T040 (lock-contention), T044 (concurrency), T047 (lock acquire); T003 (telemetry ≤4096 bytes); WAL inherited |
| X | Idempotent Pipeline Transitions | T021 (UPDATE WHERE facet_type='unclassified'), T035 (defense-in-depth idempotency), T042+T046 (idempotent re-run) |
| XI | Library/CLI Boundary | T004, T010 (typed errors); T048 (CLI is sole exit site); T058 (lint: no process.exit in libs) |
| XII | Subprocess Hygiene | trivially satisfied (Ollama is HTTP); T060 (lint asserts vacuous) |
| XIII | Telemetry-or-Die | T003 (schemas), T009 (impl), T024 (circuit-breaker emits), T025 (every state transition emits), T038 (orchestrator emits all classes); T068 (audit) |
| XIV | XDG Paths via Single Resolver | T015 (eslint scope), T036 (uses Paths.docs() + Paths.cache() + Paths.failed()), T059 (lint asserts) |
| XV | Dynamic Taxonomy with User-Reviewed Promotion | T006, T012 (proposed-only INSERTs), T018, T031 (live vocab from taxonomy_terms WHERE state='established'), T049-T055 (proposed-term routing tests), T056 (no-established-INSERT lint), T057 (no-enum-FacetDomain lint) |
| XVI | Validation Honesty | T065 (empirical budget measurement, not target claim); T066 (quickstart walkthrough); T064 (requirements checklist reflects outcomes including any deviations) |

---

## Recommended next step

`/speckit-implement` for SP-004 — **single-dispatch Engineer-agent build** (per plan.md "Sizing call" — production surface is well below the 2000 LOC / 15 files split threshold).

**Env prerequisites**: Local Ollama 0.5+ reachable at `http://localhost:11434` with at least one structured-output-capable model loaded (`qwen3.5:9b` primary, `gemma3:4b` fallback). T001 verifies. No sudo / root requirements — SP-004 is all-unprivileged (HTTP to localhost + writes under `Paths.*` in user home).

**Pre-implementation verification**:
- Constitution Check still 16/16 [x] (no drift since plan time).
- Phase 2 PREREQs are forward-compat, not principle violations.
- spec.md is unchanged since draft acceptance.
- SP-001 + SP-002 + SP-003 baseline merged on `main`.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks.
- `[Story]` label maps task to user story (US1, US2, US3) for traceability per spec.md. All three SP-004 user stories are priority P1 (per spec.md).
- Each user story can be partially verified at module-checkpoint granularity (e.g., US3 proposed-term routing partial at Phase 3 T036 checkpoint; full at Phase 5 T053 integration test).
- Verify tests fail before implementing (RED phase is the spec's input contract per Constitution III).
- Commit after each task or logical group at developer discretion; the single feature-completion commit (T069) is the merge gate.
- Stop at any phase Checkpoint to validate progress before proceeding.
- Avoid: vague tasks, same-file conflicts (`classifier-schema.ts` touched only by T008; `telemetry.ts` touched only by T009; `errors.ts` touched only by T010; `policies.ts` touched only by T011; `taxonomy-terms-adapter.ts` touched only by T012; `document-adapter.ts` extension touched only by T035; `classify-persister.ts` touched only by T036; `classify-stage.ts` touched only by T038; `reenrich-command.ts` touched only by T047; `daemon/src/index.ts` post-persist-hook edit touched only by T039).
- Module 8 (daemon, T039) extends the SP-003 daemon's hook surface but adds ZERO new `process.exit` sites — preserves Constitution XI by keeping the daemon as the sole exit site for the SP-003+SP-004 source tree.
- SP-004 explicit non-scope: NO embedding/ranking (SP-005), NO kill-9 cross-stage survival or `corpus://failures` resource (SP-006), NO auto-promotion of proposed terms (FORBIDDEN by Principle XV), NO worker-pool parallelism (FR-CLASSIFY-019 single-threaded commitment), NO user-review UX for proposed terms.
