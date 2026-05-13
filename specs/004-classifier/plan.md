# Implementation Plan: Local LLM Classifier — Grammar-Constrained Metadata, Dynamic Vocabulary, Proposed-Term Routing

**Branch**: `004-classifier`
**Date**: 2026-05-13
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/004-classifier/spec.md`

## Summary

Ship the **deferred semantic-classification owner** for SP-003. SP-003 (just merged at commit 74a0370) populates `documents` rows with sentinel classifier-owned columns (`facet_domain=''`, `tags_json='[]'`, `facet_type='unclassified'`). SP-004 reads those sentinel rows, invokes the local Ollama LLM (`qwen3.5:9b` primary, `gemma3:4b` fallback) with token-grammar-constrained generation against a canonical Zod-derived JSON Schema, validates the response defense-in-depth, and writes the classifier output to BOTH the SQL row AND the body-file YAML frontmatter inside a single SQLite transaction. Proposed terms (never-seen domains / tags) route to `taxonomy_terms` at `state='proposed'` via `ON CONFLICT DO NOTHING` — established-state INSERTs are FORBIDDEN (Principle XV gate, not auto-trigger). Confidence scores are emitted by the classifier but NEVER persisted to disk (Principle II); they live in telemetry payloads and in-memory retry-decision logic only.

Three-layer delivery:

1. **Inference adapter + structured-output transport** — `packages/inference/src/ollama-adapter.ts` (NEW; the SP-001-era `packages/inference/src/index.ts` is `export {};` per its `// Real implementation lands in SP-004` comment). Posts to `http://localhost:11434/api/chat` via `undici` (existing SP-001 transport dependency; AbortSignal-compatible) with the `format` parameter set to the canonical JSON Schema rendered from `ClassifierOutputZodSchema` via `zod-to-json-schema ^3.x`. The schema is generated once at module-load time and frozen as a module constant.
2. **Vocabulary-aware prompt + defense-in-depth validation** — `packages/inference/src/vocabulary.ts` (NEW; loads `EstablishedVocabulary` from `taxonomy_terms WHERE state='established'` once per classify-stage invocation) feeds `packages/inference/src/prompt.ts` (NEW; renders the system message + the single user-turn block: vocabulary block + classification rules + document title/source/first-2000-codepoints-of-body). Post-Ollama, `packages/inference/src/validate.ts` (NEW) runs Zod parse + vocabulary cross-check; failures route to `Paths.failed() + '/<doc-id>.error.json'`.
3. **Atomic dual-write persistence + drain-lock reuse + telemetry** — `packages/pipeline/src/classify-stage.ts` (NEW) wires the daemon's post-persist hook and the `corpus reenrich` CLI command to a single classify-stage function (Constitution VI — one pipeline, two policies; the SP-003 `interactivePolicy` / `batchPolicy` records gain SP-004 fields). `packages/storage/src/classify-persister.ts` (NEW) commits the SQL UPDATE + the taxonomy_terms proposed-state INSERTs + the body-file frontmatter rewrite in a single `BEGIN TRANSACTION ... COMMIT` block (body-file write via `withTempDir` outside the transaction; the rename happens atomically with the COMMIT via try/catch + rollback). `packages/contracts/src/telemetry.ts` extends additively with the SP-004 event classes; `Paths.drainLock()` is the SINGLE write-serialization point across SP-003 + SP-004.

SP-004 is honest about what it produces (three SQL columns + body-file frontmatter mirror + proposed-state taxonomy_terms rows) and what it defers (embedding/ranking to SP-005, kill-9 cross-stage survival and `corpus://failures` to SP-006, user-review promotion of proposed terms to a future-horizon sprint).

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. Inherits SP-001/SP-002/SP-003 toolchain unchanged.

**Primary Dependencies** (additive over SP-001 + SP-002 + SP-003):

- `zod-to-json-schema ^3.x` (NEW dependency) — pure-JS Zod → JSON Schema emitter. Used at module-load time to render the canonical JSON Schema for the Ollama `format` parameter from `ClassifierOutputZodSchema`. Decision J in `research.md`. Pure JS; zero native-addon footprint; no allowlist impact.
- `undici` (existing — SP-001 transport dependency) — HTTP client for the Ollama `/api/chat` POST. AbortSignal-compatible by construction; routes through the SP-001 egress hook which permits localhost-only destinations (Principle I satisfied by construction — `http://localhost:11434` is allowlisted).
- `zod ^3.23.0` (existing) — `ClassifierOutputZodSchema` lives in `packages/contracts/src/classifier-schema.ts` (NEW file). SP-004 telemetry event classes added to the `TelemetryEvent` discriminated union additively.
- `better-sqlite3 ^11.2.0` (existing) — write-side connection for the SQL UPDATE + taxonomy_terms INSERTs. SP-003's `openIndexReadWrite()` opener reused.
- `js-yaml` (existing, SP-002) — frontmatter YAML codec via `parseMarkdownWithFrontmatter` / `stringifyMarkdownWithFrontmatter`. Single YAML routing point per Principle V.

**Storage**: Reuses SP-002 SQLite index file at `Paths.indexDb()` (populated by SP-003). SP-004 mutates only the `facet_domain`, `tags_json`, `facet_type` columns of `documents` (Principle X — sentinel-only-overwrite) and INSERTs into `taxonomy_terms` (state='proposed' only). Body files at `Paths.docs() + '/' + row.body_path` (SP-003's Decision I layout — `'store/<id-prefix>/<doc-id>.md'`); SP-004 rewrites the frontmatter section only, byte-preserving the Markdown body. Telemetry JSONL at `Paths.telemetry()`. Drain lock at `Paths.drainLock()` (reused, single serialization point). Failure-lane sidecars at `Paths.failed() + '/<doc-id>.error.json'` (SP-003 pattern; doc-id-keyed for classify failures vs filename-keyed for ingest failures).

**Testing**: vitest (inherits SP-001/SP-002/SP-003). New SP-004 test surfaces:
- (a) `tests/unit/classifier-output-schema.test.ts` — Zod schema parses valid + rejects invalid output (FR-CLASSIFY-005);
- (b) `tests/unit/vocabulary-loader.test.ts` — vocabulary snapshot loads correctly + handles empty `taxonomy_terms`;
- (c) `tests/unit/prompt-render.test.ts` — prompt rendering against fixture vocab + body excerpts; codepoint-safe truncation at 2000 chars (FR-CLASSIFY-020);
- (d) `tests/unit/classifier-validation.test.ts` — defense-in-depth checks: schema-invalid response → failure lane; vocabulary-violation → failure lane;
- (e) `tests/unit/classify-persister.test.ts` — paired SQL UPDATE + body-file rewrite atomicity; injected mid-transaction failure rolls back both;
- (f) `tests/unit/ollama-adapter.test.ts` — undici POST with AbortSignal; `ECONNREFUSED` → `OllamaUnavailableError`;
- (g) `tests/integration/end-to-end-classify.test.ts` — SP-003 ingest → SP-004 classify against a live local Ollama; row populated + frontmatter mirrored;
- (h) `tests/integration/proposed-term-routing.test.ts` — seed minimal established vocab; ingest a novel-domain doc; assert proposed-state INSERT + `corpus://taxonomy` unchanged;
- (i) `tests/integration/classify-failure-lane.test.ts` — every error_code class produces a sidecar; SQL row stays sentinel;
- (j) `tests/integration/reenrich-cli.test.ts` — backlog drain + summary line + dry-run mode + SIGTERM abort;
- (k) `tests/integration/classify-concurrency.test.ts` — drain-lock contention with SP-003 daemon + concurrent reenrich;
- (l) `tests/integration/idempotency.test.ts` — re-running on classified rows is a 0-call no-op.

**Target Platform**: Linux (Fedora 43+) and macOS. Windows out of scope for v1. Ollama 0.5+ required for structured-output `format` parameter support; user's pai-node01 runs Ollama 0.21.0 (verified).

**Project Type**: TypeScript monorepo (npm workspaces). SP-004 grows two packages and extends three:

- `packages/inference/` — grows from `export {};` stub to functional (OllamaAdapter, prompt renderer, vocabulary loader, defense-in-depth validator, schema constants).
- `packages/pipeline/` — extends with the classify-stage orchestrator (`classify-stage.ts`); inherits SP-003's drain-lock + abort coordination patterns.
- `packages/storage/` — extends `document-adapter.ts` with `updateClassification(row, signal)` write-side adapter; adds `taxonomy-terms-adapter.ts` for the `INSERT ... ON CONFLICT DO NOTHING` proposed-term writer.
- `packages/contracts/` — extends `telemetry.ts` with the new SP-004 event classes; adds `classifier-schema.ts` for the canonical Zod schema + the `FACET_TYPE_VALUES` constitutional enum (SCHEMA.md 7-value); extends `errors.ts` with SP-004 typed errors.
- `packages/cli/` — adds `reenrich-command.ts` for `corpus reenrich` (inherits SP-003's CLI patterns).
- `packages/daemon/` — extends `index.ts` post-persist hook to invoke the SP-004 classify-stage on each SP-003-produced row.

**Performance Goals**:

- Per-document classify wall-clock under interactive policy: target 60 s p95 on the user's primary machine with `qwen3.5:9b` loaded (CPU inference). Reported as "documented, measured, within budget" per Constitution XVI — specific p95 is empirically measured and recorded in this plan's footnote after `tests/integration/end-to-end-classify.test.ts` runs.
- Ollama HTTP request → first-byte latency: under 100 ms on a warm Ollama process (model already loaded). Under 30 s on cold start (model loads on first request). Cold-start is one-time per Ollama process lifetime; subsequent calls are warm.
- SQL UPDATE + body-file rewrite transaction wall-clock: under 50 ms p95 (small payload; single-row UPDATE + atomic-rename + 0-2 taxonomy_terms INSERTs).
- Drain-lock acquisition: under 50 ms warm; under 200 ms cold (inherits SP-003's flock semantics).
- SIGTERM → process exit: under 2 s wall-clock (Constitution VII bounded abort).
- Telemetry emission per event: under 1 ms (inherits SP-003's append-only JSONL discipline).

All numbers are TARGETS not guarantees per Constitution XVI; CI benchmark on the primary user's hardware establishes whether they're met. The SP-004 per-document classifier budget is the dominant share of the overall NFR-014 per-document envelope; if `qwen3.5:9b` proves too slow for batch comfort, the fallback to `gemma3:4b` (Decision A) is a single-line config change. SP-004 commits to *documented, measured, within budget* — not to a specific p95 number.

**Constraints**:

- Zero outbound non-loopback packets during any classify stage (Constitution I, hard — inherited from SP-001 egress hook). The `http://localhost:11434` destination is allowlisted by construction; any accidental non-localhost call hard-fails with `EgressBlockedError`.
- Zero writes outside `Paths.*` (Constitution XIV, hard — `paths-from-resolver-only` lint covers SP-004 source).
- Every IO call accepts `AbortSignal` and propagates it (Constitution VII, hard — `no-promise-race-settimeout` lint covers SP-004 source).
- Body-file rewrites atomic via `withTempDir` (Constitution VIII, hard).
- Documents-row UPDATE + body-file rename + taxonomy_terms INSERTs commit in one SQLite transaction or all fail (Constitution VIII transactional contract).
- Every state transition emits a Zod-validated telemetry event (Constitution XIII, hard).
- Zero subprocesses in SP-004 (Ollama is HTTP; Principle XII trivially satisfied — no `runTool` invocations needed).
- No `process.exit` in `packages/inference/`, `packages/pipeline/`, `packages/storage/`, `packages/contracts/` (Constitution XI, hard).
- Telemetry records ≤ 4096 bytes (Constitution IX, hard — same per-class size budgets as SP-003).
- Document body content MUST NOT appear in telemetry payloads (Constitution I + SC-CLASSIFY-020); summaries land in frontmatter only.
- No hardcoded `enum FacetDomain` (Constitution XV, hard — SC-CLASSIFY-016 lint).
- Confidence MUST NOT appear in persisted frontmatter (Constitution II — SC-CLASSIFY-002 grep-asserts).

**Scale/Scope**:

- Single user, single machine (Constitution IV).
- Net new code: ~700–1100 LOC implementation, ~1200–1800 LOC tests + fixtures.
- Net new files: 1 OllamaAdapter source, 1 vocabulary loader, 1 prompt renderer, 1 validator, 1 classify-stage orchestrator, 1 classify-persister, 1 taxonomy-terms adapter, 1 reenrich CLI command, 1 classifier-schema contracts module (Zod schema + FACET_TYPE_VALUES constant), ~3 contracts extensions (telemetry classes, errors, prompts), ~10 test files.
- Per-feature contract files: 4 (one Gherkin feature per spec area: structured-output, vocabulary-validation, atomicity, reenrich-cli) + 2 ADRs (model choice, atomicity).

**Sizing call**: SP-004 sits **below** the 2000 LOC / 15 files split threshold. Production surface alone (~700–1100 LOC across ~9 source files) is well under. Total surface (incl. tests + fixtures) is ~2000–3000 LOC across ~19 files. Recommend **single-dispatch build** (no Engineer-agent split). The SP-004 surface is smaller than SP-003 because (a) no subprocess hygiene burden, (b) no new MIME parsers, (c) reuses SP-003's drain-lock and atomic-write primitives wholesale. (Per `feedback-build-tier-sizing-rule`.)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — SP-004's only non-local-disk IO is HTTP POST to `http://localhost:11434/api/chat`. The SP-001 egress hook permits localhost-only destinations and rejects all others; any accidental non-localhost call hard-fails with `EgressBlockedError`. The `undici` client routes through this hook by construction. Telemetry records hashes, paths, doc-ids, model names, durations, confidence sub-scores — never body content (SC-CLASSIFY-020). No cloud-fallback inference adapter; the OllamaAdapter is hardcoded against localhost (no env override permitted at v1 — future v2 amendment scope).
- [x] **II. User Curates, LLM Classifies Metadata** — Classifier output is frontmatter metadata only. The body section of the body file is byte-preserved from what SP-003 wrote (the rewrite touches only the YAML frontmatter delimited by the `---` lines). FR-CLASSIFY-013 explicitly forbids persisting `confidence` to disk; SC-CLASSIFY-002 grep-asserts. The forbidden-field list (`origin`, `provenance_*`, `confidence`, `captured_at`, `corpus capture`) is enforced at the persister layer — `stringifyMarkdownWithFrontmatter` is given an object with ONLY the allowed keys.
- [x] **III. Substrate, Not Surface** — SP-004 introduces ZERO new MCP tools, resources, prompts, or mutation surfaces (FR-CLASSIFY-016). User-facing trigger surfaces are the SP-003 daemon's auto-hook + the new `corpus reenrich` CLI subcommand. No HTTP server, no TUI, no browser. The MCP server remains read-only.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — SP-004 reads / writes one local SQLite + local body files. No conversation memory, no per-session preferences, no SaaS connector, no cross-machine sync. Single-user, single-machine.
- [x] **V. Schema-Enforced Structured Output** — Ollama's `format` parameter renders the token sampler against the canonical Zod-derived JSON Schema (FR-CLASSIFY-003, FR-CLASSIFY-004). The schema is rendered once at module-load time via `zodToJsonSchema(ClassifierOutputZodSchema)` and frozen as a module constant. Defense-in-depth Zod validation (FR-CLASSIFY-005) is the safety net for degenerate Ollama responses, NOT the primary surface. Frontmatter routes through SP-002's single YAML codec helper. NO regex extraction from free-form LLM output anywhere in SP-004 source.
- [x] **VI. One Pipeline, Two Policies** — The classify-stage function in `packages/pipeline/src/classify-stage.ts` is invoked by BOTH the SP-003 daemon's post-persist hook AND the `corpus reenrich` CLI command. The two surfaces differ only via `interactivePolicy` vs `batchPolicy` (extended additively with SP-004 fields: `perDocClassifyTimeoutMs`, `circuit_breaker_consecutive_failures`). No forked code path; one classify-stage function with policy-record dispatch.
- [x] **VII. Cancellable, Bounded IO** — Every IO call in SP-004 accepts `AbortSignal` and propagates it: `undici.fetch(url, { signal })` for Ollama POST; SQLite prepared-statement steps check `signal.throwIfAborted()`; `withTempDir` accepts signal; the SP-003 abort coordination flows through. SIGTERM → master controller `abort()` → in-flight classify aborts → row stays sentinel → tmp file cleaned up → process exit within 2 s. Per-document timeout via `AbortController` + `setTimeout(() => controller.abort('per_doc_timeout'), perDocClassifyTimeoutMs)` with `clearTimeout` on success. NO `Promise.race(setTimeout)`; SP-001's `no-promise-race-settimeout` lint covers SP-004 source.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — Body-file rewrites go through `withTempDir` (tmp + fsync + rename + dirsync with PID+entropy temp suffix). The classify-persister opens a `BEGIN TRANSACTION` on the better-sqlite3 connection, executes the documents UPDATE + 0..N taxonomy_terms INSERTs, then performs the atomic rename of the tmp body-file into the canonical path, then COMMIT. On any failure (SQL exception, body-file rename failure): rollback + delete tmp file. The row stays sentinel; no orphan tmp file. The sidecar `<doc-id>.error.json` write is independently atomic via `withTempDir`.
- [x] **IX. Concurrency-Safe Shared State** — `Paths.drainLock()` is the SINGLE write-serialization point across SP-003 + SP-004 (FR-CLASSIFY-015). The SP-003 daemon's hook reuses the held lock; `corpus reenrich` acquires independently; concurrent invocations emit `pipeline.lock_contention` and exit 0 (FR-INGEST-011 contract preserved). SQLite remains in WAL mode. Telemetry records ≤ 4096 bytes (per-class budgets in data-model.md). Lock release covers normal exit, exception, SIGTERM.
- [x] **X. Idempotent Pipeline Transitions** — Re-running classify on a classified row is structurally a no-op (FR-CLASSIFY-012): the sentinel query `WHERE facet_type='unclassified'` filters at SQL level; the UPDATE statement's `AND facet_type='unclassified'` clause is defense-in-depth idempotency for the rare concurrent-classify race. `corpus reenrich` on a fully-classified corpus produces `classified=0, failed=0, skipped=0` and issues zero Ollama HTTP calls (SC-CLASSIFY-013). Three-folder routing invariants from SP-003 are preserved (`pending/` empty post-drain; classify failures don't touch `pending/`).
- [x] **XI. Library/CLI Boundary** — Zero `process.exit` in `packages/inference/`, `packages/pipeline/`, `packages/storage/`, `packages/contracts/` SP-004 source files (FR-CLASSIFY-017). All library functions return `Result<T, E>` or throw typed errors (`ClassifierError`, `OllamaUnavailableError`, `SchemaInvalidError`, `VocabularyViolationError`, `ClassifyPersistError`). Only `packages/cli/src/reenrich-command.ts` (CLI wrapper) and `packages/daemon/src/index.ts` (extended) may exit the process. SP-001's `no-process-exit-in-libs` ESLint rule covers SP-004 source.
- [x] **XII. Subprocess Hygiene** — SP-004 has ZERO subprocesses (Ollama is HTTP; no extractors, no extractor shims). The principle is trivially satisfied. No `runTool` invocations in SP-004 source. The `no-shell-string-exec` lint covers SP-004 source vacuously.
- [x] **XIII. Telemetry-or-Die** — Every SP-004 state transition emits a Zod-validated event (FR-CLASSIFY-010 — ≥ 6 event classes plus 4-5 additional classes for completeness). Every catch block in SP-004 source emits a telemetry event at severity matching the actual error severity BEFORE re-throwing or converting to `Result.err`. The SP-001 AST-level lint covers SP-004 source. The telemetry-write-failure honesty path (inherited from SP-003 SC-INGEST-013) generalizes: if `emitTelemetry` itself throws during a classify stage, the in-flight row routes to `<doc-id>.error.json` with `error_code='telemetry_write_failed'` and the exception surfaces to the caller — NO silent swallow.
- [x] **XIV. XDG Paths via Single Resolver** — All SP-004 paths route through existing `Paths.*` getters (FR-CLASSIFY-018): `Paths.indexDb()`, `Paths.docs()` (mirroring SP-003's body_path resolution), `Paths.failed()`, `Paths.telemetry()`, `Paths.drainLock()`, `Paths.cache()` (for `withTempDir` tmp). NO new XDG base; SP-004 introduces zero new derived getters. NO writes to `/tmp/`, `/var/`, `os.tmpdir()`, or any non-`Paths.*` literal. SP-001's `paths-from-resolver-only` lint covers SP-004 source.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — SP-004 source files contain ZERO `enum FacetDomain` declarations (SC-CLASSIFY-016 lint). The classifier prompt is rendered at call time from `EstablishedVocabulary` loaded via `SELECT term FROM taxonomy_terms WHERE axis IN ('domain','tag') AND state='established'` (FR-CLASSIFY-006). Never-seen terms route via `facet_domain_proposed` / `facet_tags_proposed` to `taxonomy_terms` at `state='proposed'` (FR-CLASSIFY-007). NO auto-promotion: SP-004 NEVER INSERTs `state='established'`. The N≥3 in 30 days threshold from Principle XV is a gate, not an auto-trigger; SP-004 doesn't reach the gate evaluation surface at all (future user-review sprint). The `facet_type` enum IS hardcoded (FR-CLASSIFY-014) because it's a structural taxonomy axis with constitutional stability — Principle XV applies to open vocabularies (domain, tag) only.
- [x] **XVI. Validation Honesty** — Performance numbers in this plan are TARGETS, not guarantees. The per-document classifier budget is empirically measured at implementation time and reported as a footnote here, per Constitution XVI. The fixture-driven SCs (vocabulary-violation injection, mid-transaction failure injection, drain-lock contention) are honestly partitioned from the live-against-primary-machine SCs (end-to-end ingest+classify, proposed-term routing observation) in `quickstart.md`. NO cross-agent compatibility claim. NO formal classifier evaluation harness as v1 success criterion. The model choice (qwen3.5:9b) is documented in `research.md` Decision A; the fallback (gemma3:4b) is documented; no marketing claims of accuracy or quality.

**Result: 16/16 [x]. Complexity Tracking empty.** No principle violations.

## Phase 0 Prerequisites (must complete before `/speckit-implement` begins)

These are SP-001/SP-002/SP-003-era code touches that SP-004 needs before the user-story implementation can begin. They are NOT principle violations — they are forward-compatibility plumbing.

- **PREREQ-001 — `ClassifierOutputZodSchema` + `FACET_TYPE_VALUES` constant**: Add `packages/contracts/src/classifier-schema.ts` containing (a) the `FACET_TYPE_VALUES = ['entity', 'concept', 'tutorial', 'analysis', 'reference', 'synthesis', 'cheat-sheet'] as const` constitutional enum (SCHEMA.md 7-value), (b) the `ClassifierOutputZodSchema` Zod object covering `facet_domain: string`, `facet_type: z.enum(FACET_TYPE_VALUES)`, `tags: z.array(z.string()).min(3).max(10)`, `summary: z.string()`, `confidence: z.object({domain: z.number().min(0).max(1), type: z.number().min(0).max(1), tags: z.number().min(0).max(1)})`, `facet_domain_proposed: z.string().optional()`, `facet_tags_proposed: z.array(z.string()).optional()`. The JSON Schema rendering happens at module-load time via `zod-to-json-schema` (Decision J) — the rendered schema is exported as `CLASSIFIER_OUTPUT_JSON_SCHEMA`. Strict mode (no defaults, no coercion) per FR-CLASSIFY-005.
- **PREREQ-002 — Register SP-004 telemetry event classes**: Extend the `TelemetryEvent` Zod discriminated union in `packages/contracts/src/telemetry.ts` with the SP-004 event classes (≥ 10 new variants per FR-CLASSIFY-010): `classify.started`, `classify.ollama_request`, `classify.ollama_response`, `classify.schema_invalid`, `classify.vocabulary_violation`, `classify.term_proposed`, `classify.completed`, `classify.failed`, `classify.ollama_unavailable`, `classify.batch_halted`, `classify.frontmatter_incomplete`. Each schema validates ISO-8601 timestamp, severity enum, outcome enum, and class-appropriate fields. Additive — existing SP-001/SP-002/SP-003 event variants continue to compile and parse without change.
- **PREREQ-003 — Extend `errors.ts` with SP-004 typed errors**: `ClassifierError` (base), `OllamaUnavailableError`, `SchemaInvalidError`, `VocabularyViolationError`, `ClassifyPersistError`, `ClassifierConfigurationError` (thrown at module-load if `format` parameter is missing or `ClassifierOutputZodSchema` is malformed). Each carries `name`, structured `data`, and the library-package contract (no `process.exit`).
- **PREREQ-004 — Extend `policies.ts` with classify-stage fields**: The SP-003 `interactivePolicy` / `batchPolicy` records gain `perDocClassifyTimeoutMs: number`, `classifyRetryMaxAttempts: number`, `consecutiveOllamaFailureBatchHaltThreshold: number`. Defaults: interactive `{perDocClassifyTimeoutMs: 60_000, classifyRetryMaxAttempts: 1, consecutiveOllamaFailureBatchHaltThreshold: 3}`, batch `{perDocClassifyTimeoutMs: 300_000, classifyRetryMaxAttempts: 1, consecutiveOllamaFailureBatchHaltThreshold: 3}`. Per Decision D + Decision F in `research.md`.
- **PREREQ-005 — `taxonomy-terms-adapter.ts` write-side adapter**: Add `packages/storage/src/taxonomy-terms-adapter.ts` with `insertProposedTerm(axis, term, signal): Promise<Result<void, StorageError>>` using `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`. The adapter does NOT permit `state='established'` writes — the function signature literally takes only the axis and term; the state literal is baked into the SQL string. Defense-in-depth against future bugs that might attempt established-state INSERTs.
- **PREREQ-006 — Verify `packages/inference/src/index.ts` is `export {};` stub**: Confirmed pre-flight that the existing file is `export {};` with a `// Real implementation lands in SP-004` comment. SP-004 grows this package from scratch.

Each PREREQ gets a TDD contract-test/implementation task pair in `/speckit-tasks`'s Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/004-classifier/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification
├── research.md          # Phase 0 — Decisions A through J + technology choice notes
├── data-model.md        # Phase 1 — ClassifierOutput entity + EstablishedVocabulary + ProposedTerm + telemetry event class schemas + documents-row mapping
├── quickstart.md        # Phase 1 — operator walkthrough (init → daemon → ingest → observe classify → reenrich backlog) with honest "what's NOT working yet" partition
├── contracts/
│   ├── classifier-output.schema.json     # Phase 1 — Canonical JSON Schema rendered from ClassifierOutputZodSchema (auditor-readable)
│   ├── adr-classifier-model-choice.md    # Phase 1 — ADR: qwen3.5:9b primary + gemma3:4b fallback
│   └── adr-classifier-atomicity.md       # Phase 1 — ADR: paired SQL UPDATE + body-file frontmatter rewrite transaction
└── checklists/
    └── requirements.md  # Spec quality checklist (16-principle pass/fail + anti-scope verification)
```

### Source Code (repository root)

```text
packages/
├── contracts/                            # Pure types — zero IO
│   └── src/
│       ├── paths.ts                      # SP-001/SP-002/SP-003 — unchanged (SP-004 uses existing getters)
│       ├── telemetry.ts                  # SP-001/SP-002/SP-003 — extended with SP-004 event classes (PREREQ-002)
│       ├── errors.ts                     # SP-001/SP-002/SP-003 — extended with 6 new SP-004 typed errors (PREREQ-003)
│       ├── classifier-schema.ts          # NEW — ClassifierOutputZodSchema + CLASSIFIER_OUTPUT_JSON_SCHEMA + FACET_TYPE_VALUES (PREREQ-001)
│       ├── markdown-frontmatter.ts       # SP-002 — unchanged (SP-004 consumes parseMarkdownWithFrontmatter / stringifyMarkdownWithFrontmatter)
│       └── (existing modules retained)
├── inference/                            # Grows from `export {};` stub to functional
│   └── src/
│       ├── ollama-adapter.ts             # NEW — undici POST to /api/chat with format parameter; AbortSignal propagation; ECONNREFUSED → OllamaUnavailableError
│       ├── vocabulary.ts                 # NEW — loadEstablishedVocabulary(db, signal) returns {domains, tags, types} from taxonomy_terms WHERE state='established'
│       ├── prompt.ts                     # NEW — renderClassifierPrompt(vocab, doc) returns {systemMessage, userMessage}; codepoint-safe 2000-char body excerpt
│       ├── validate.ts                   # NEW — defense-in-depth: Zod parse + vocabulary cross-check; routes mismatches to failure-lane
│       └── index.ts                      # Exports
├── pipeline/                             # Extends with SP-004 classify-stage
│   └── src/
│       ├── classify-stage.ts             # NEW — single classify-stage function invoked by daemon hook + reenrich CLI; policy-record dispatch (Constitution VI)
│       ├── classify-circuit-breaker.ts   # NEW — tracks consecutive Ollama failures; emits classify.batch_halted on threshold breach
│       ├── policies.ts                   # SP-003 — extended with SP-004 fields (PREREQ-004)
│       ├── (existing SP-003 modules retained)
│       └── index.ts                      # Exports
├── storage/                              # Extends with SP-004 write-side adapters
│   └── src/
│       ├── document-adapter.ts           # SP-002/SP-003 — extended with updateClassification(row, signal) write-side adapter
│       ├── taxonomy-terms-adapter.ts     # NEW — insertProposedTerm(axis, term, signal); ON CONFLICT DO NOTHING; state='proposed' baked into SQL (PREREQ-005)
│       ├── classify-persister.ts         # NEW — paired SQL UPDATE + body-file rewrite in single transaction; rollback on either failure
│       └── (existing SP-002/SP-003 modules retained)
├── daemon/                               # SP-003 functional entry point — SP-004 extends post-persist hook
│   └── src/
│       └── index.ts                      # SP-003 — extended to invoke classify-stage on each successful SP-003 persist (FR-CLASSIFY-001)
├── cli/                                  # SP-001/SP-002/SP-003 — extended with `corpus reenrich`
│   └── src/
│       ├── reenrich-command.ts           # NEW — `corpus reenrich [--dry-run]` command; acquires drain-lock; iterates sentinel rows; emits progress under interactivePolicy
│       └── (existing CLI commands retained)
└── transport/                            # SP-001/SP-002/SP-003 — unchanged (SP-004 reuses egress hook for Ollama HTTP path)

tests/
├── unit/
│   ├── classifier-output-schema.test.ts        # NEW — Zod parse + reject; FACET_TYPE_VALUES enum coverage
│   ├── vocabulary-loader.test.ts               # NEW — loads snapshot; handles empty taxonomy_terms
│   ├── prompt-render.test.ts                   # NEW — codepoint-safe truncation; vocabulary block rendering
│   ├── classifier-validation.test.ts           # NEW — defense-in-depth: schema-invalid + vocabulary-violation routing
│   ├── classify-persister.test.ts              # NEW — paired transaction atomicity; mid-transaction failure rollback
│   ├── ollama-adapter.test.ts                  # NEW — undici POST + AbortSignal; ECONNREFUSED handling
│   ├── classify-circuit-breaker.test.ts        # NEW — consecutive-failure counting + batch_halted emission
│   └── (SP-001/SP-002/SP-003 unit tests retained)
├── integration/
│   ├── end-to-end-classify.test.ts             # NEW — SP-003 ingest → SP-004 classify against live local Ollama
│   ├── proposed-term-routing.test.ts           # NEW — seed minimal vocab; novel-domain doc → proposed-state INSERT
│   ├── classify-failure-lane.test.ts           # NEW — every error_code class produces a sidecar; SQL row stays sentinel
│   ├── reenrich-cli.test.ts                    # NEW — backlog drain + summary line + dry-run mode + SIGTERM abort
│   ├── classify-concurrency.test.ts            # NEW — drain-lock contention with SP-003 daemon + concurrent reenrich
│   ├── classify-idempotency.test.ts            # NEW — re-running on classified rows is 0-call no-op
│   ├── classify-atomicity.test.ts              # NEW — SC-CLASSIFY-012 SQL exception mid-transaction → rollback both sides
│   └── (SP-001/SP-002/SP-003 integration tests retained)
└── fixtures/
    └── sp004-classifier/                       # NEW — fixture inputs for SP-004 integration tests
        ├── seeded-taxonomy-minimal.sql         # 2 established domains + 5 established tags
        ├── novel-domain-doc.md                 # Document outside seeded vocab (proposed-term routing)
        ├── mock-ollama-response-valid.json     # Schema-valid happy path
        ├── mock-ollama-response-schema-invalid.json  # Missing required field
        ├── mock-ollama-response-vocab-violation.json # Domain not in established set, not in proposed
        └── README.md                           # Fixture provenance
```

**Structure Decision**: TypeScript monorepo with npm workspaces (inherited from SP-001/SP-002/SP-003). SP-004 grows one previously-stub package (`packages/inference/`), extends three (`packages/pipeline/`, `packages/storage/`, `packages/contracts/`), and adds one CLI subcommand (`packages/cli/`) + one daemon hook extension (`packages/daemon/`). Zero new packages. Strict dependency direction from SP-001 preserved: `packages/contracts/` imports nothing; `packages/storage/` imports `packages/contracts/`; `packages/inference/` imports `packages/contracts/` + `packages/storage/` (for `loadEstablishedVocabulary`); `packages/pipeline/` imports `packages/contracts/` + `packages/storage/` + `packages/inference/`; `packages/daemon/` imports `packages/pipeline/`; `packages/cli/` imports `packages/pipeline/`. No subprocess shims (Ollama is HTTP); no out-of-package vendored code.

## Phase Breakdown (driver for `/speckit-tasks`)

This section maps spec requirements to implementation phases.

| Phase | Name | Spec coverage | Output |
|---|---|---|---|
| 0 | Prerequisites | PREREQ-001..PREREQ-006 | TDD contract-test/impl pairs for: ClassifierOutputZodSchema + FACET_TYPE_VALUES, SP-004 telemetry event class registration, SP-004 typed errors, policy-record SP-004 fields, taxonomy-terms-adapter write-side function, verification that packages/inference/src/index.ts is still the stub. |
| 1 | Setup | — | Add `zod-to-json-schema` dependency; scaffold the fixture directory `tests/fixtures/sp004-classifier/`; verify local Ollama 0.21.0 is reachable and `qwen3.5:9b` is loaded for the integration-test surface; lint config update to scope new files. |
| 2 | Tests-First (RED phase) | All FR-CLASSIFY-* + SC-CLASSIFY-* | Author every test file under `tests/unit/` and `tests/integration/` as failing tests. Each Gherkin scenario in `contracts/` maps to ≥ 1 test. Phase 2 exit gate: every spec area's RED suite compiles and runs (all failing). |
| 3 | Core Implementation (GREEN phase) | FR-CLASSIFY-001..FR-CLASSIFY-008, FR-CLASSIFY-012, FR-CLASSIFY-014, FR-CLASSIFY-017, FR-CLASSIFY-018, FR-CLASSIFY-020 | Turn Phase 2 tests green per-module: OllamaAdapter, vocabulary loader, prompt renderer, defense-in-depth validator, classify-persister, classify-stage orchestrator, taxonomy-terms-adapter write path. Each module's RED suite goes green before the next. |
| 4 | Integration | FR-CLASSIFY-009, FR-CLASSIFY-010, FR-CLASSIFY-011, FR-CLASSIFY-015, FR-CLASSIFY-016, FR-CLASSIFY-019 | Wire daemon's post-persist hook to classify-stage; build the `corpus reenrich` CLI command with progress emission + dry-run + lock-contention exit-0; end-to-end live-Ollama integration test passes; failure-lane integration test passes (every error_code class); drain-lock concurrency test passes; SIGTERM-abort test passes. |
| 5 | Polish | Cross-cutting Constitution Check re-evaluation + quickstart validation | (a) Re-evaluate Constitution Check — confirm all 16 remain [x]; (b) SC-CLASSIFY-016 / SC-CLASSIFY-017 / SC-CLASSIFY-018 / SC-CLASSIFY-019 / SC-CLASSIFY-020 lints assert; (c) per-document budget number empirically measured + recorded in plan.md "Performance Goals" footnote; (d) quickstart.md walked end-to-end against actual SP-004 behavior; (e) final feature-completion commit. |

**Phase sequencing rationale**: Phase 0 is hard-gated — none of SP-004 source compiles until the telemetry event classes are registered in the Zod union AND the classifier-schema module exists. Phase 1 is dependency + scaffolding; can run in parallel with Phase 0's test-authoring. Phase 2 is the project's TDD-strict gate — every IO/schema/telemetry/paths-touching task gets a failing test first. Phase 3 turns those tests green per-module. Phase 4 wires daemon + CLI + end-to-end paths. Phase 5 closes the constitutional re-check + validates the operator walkthrough.

**Test strategy summary**: RED-phase tests written for every FR-CLASSIFY and SC-CLASSIFY in Phase 2 BEFORE any implementation. GREEN-phase implementation in Phase 3 turns them green per-module. End-to-end integration in Phase 4 verifies the cross-module wiring against a live local Ollama. Per Constitution XVI: SC-CLASSIFY-001 / SC-CLASSIFY-005 / SC-CLASSIFY-006 / SC-CLASSIFY-008 / SC-CLASSIFY-009 verify LIVE against the primary user's machine with Ollama loaded; SC-CLASSIFY-010 / SC-CLASSIFY-012 / SC-CLASSIFY-014 are fixture-driven (mock-Ollama for failure injection); SC-CLASSIFY-002 / SC-CLASSIFY-003 / SC-CLASSIFY-016 / SC-CLASSIFY-017 / SC-CLASSIFY-018 / SC-CLASSIFY-019 are lint-grep assertions over the test surface. The honest partition is documented in `quickstart.md`.

## Dependencies on SP-001 + SP-002 + SP-003

Exhaustive list of imported types/exports/contracts SP-004 inherits:

**From `@llm-corpus/contracts`** (`packages/contracts/src/`):
- `Paths.indexDb()`, `Paths.docs()`, `Paths.failed()`, `Paths.telemetry()`, `Paths.drainLock()`, `Paths.cache()` — all existing.
- `Result<T, E>` type and constructors — return type of every storage / pipeline / inference adapter function.
- `TelemetryEvent` discriminated union — extended additively with SP-004 event classes (PREREQ-002).
- `emitTelemetry`, `emitTelemetrySync`, `TELEMETRY_MAX_BYTES = 4096`, `TelemetryValidationError`, `TelemetrySizeExceededError` — existing helpers SP-004 consumes.
- `parseMarkdownWithFrontmatter`, `stringifyMarkdownWithFrontmatter` — SP-002 codec helpers; SP-004 consumes for body-file frontmatter rewrites.
- `withTempDir` — atomic-write tmp-dir helper. SP-004 classify-persister consumes for body-file rewrites.

**From `@llm-corpus/storage`** (`packages/storage/src/`):
- `openIndexReadWrite()` — SP-003's write-side opener. SP-004 reuses.
- `runSchemaMigration(db)` — SP-002 + SP-003 idempotent schema creator. SP-004 does NOT extend the schema (no new columns, no new tables).
- `DOCUMENTS_COLUMN_LIST`, `TAXONOMY_TERMS_COLUMN_LIST` — existing constants. SP-004 binds UPDATE against `DOCUMENTS_COLUMN_LIST` for forward compatibility.
- `fetchDocument(docId, signal)` — SP-002's read-side document adapter. SP-004 may consume to fetch body content (alternative: read `body_path` directly via fs.readFile).
- `insertDocument(row, signal)` — SP-003's write-side adapter. NOT used by SP-004 (SP-004 UPDATEs existing rows; doesn't INSERT).

**From `@llm-corpus/pipeline`** (`packages/pipeline/src/`):
- `interactivePolicy`, `batchPolicy`, `Policy` type — SP-003's named-policy records. SP-004 extends with classify-stage fields (PREREQ-004).
- The drain-lock acquisition pattern from `drain-lock.ts` — SP-004 reuses `Paths.drainLock()` flock semantics (no new lock).
- The `withDrainLock(signal, fn)` helper (or equivalent) — SP-004's classify-stage acquires the lock or observes contention via this helper.

**From `@llm-corpus/daemon`** (`packages/daemon/src/`):
- The daemon's master `AbortController` and SIGTERM handler — SP-004's post-persist hook inherits the signal.
- The post-persist hook surface — SP-004 extends `packages/daemon/src/index.ts` to invoke classify-stage after each successful SP-003 persist.

**From SP-001 transport** (`packages/transport/src/`):
- Egress hook (transitively bootstrapped via `egress-hook-bootstrap.ts`) — SP-004 inherits the egress envelope. The Ollama HTTP POST to `http://localhost:11434/api/chat` is localhost-allowlisted by construction; any accidental non-localhost call hard-fails with `EgressBlockedError`.

**Explicit non-dependencies** (what SP-004 does NOT depend on):
- SP-005 (embedding/ranking) — NOT required. SP-004 produces the classified row that SP-005 will consume for embedding generation.
- SP-006 (kill-9 survival + `corpus://failures` resource) — NOT required. SP-004 ships single-stage atomicity (paired UPDATE + frontmatter rewrite transaction) and `<doc-id>.error.json` sidecars; SP-006 adds the kill-9 cross-stage survival and the MCP resource surface.
- SP-007 (install/uninstall) — NOT required. SP-004 adds no install steps beyond `npm install zod-to-json-schema` and the user-side prerequisite of a running local Ollama with at least one structured-output-capable model loaded.

## Decisions resolved in this plan

(Full rationale + alternatives in `research.md`. Summary here.)

- **Decision A — Classifier model choice**: `qwen3.5:9b` primary, `gemma3:4b` fallback. Both already loaded on the user's pai-node01. Decision codified in `contracts/adr-classifier-model-choice.md`.
- **Decision B — Inference transport**: HTTP POST to `http://localhost:11434/api/chat` (Ollama 0.5+ structured-outputs endpoint) via `undici` (existing SP-001 transport dependency). AbortSignal-compatible by construction; routes through SP-001 egress hook.
- **Decision C — Prompt template architecture**: Single-turn user message containing (a) live established-vocabulary block, (b) classification-rules block, (c) document title + source + first-2000-codepoints-of-body excerpt. System message names the structured-output contract.
- **Decision D — Retry policy**: 1 retry on schema-validation failure, then route to failure lane with `<doc-id>.error.json` sidecar.
- **Decision E — Vocabulary refresh cadence**: per-batch snapshot — vocabulary loaded once per classify-stage invocation; stable for invocation lifetime.
- **Decision F — Atomicity strategy**: paired SQL transaction + `withTempDir`-mediated body-file rewrite. Body-file tmp-write happens outside the transaction; the atomic rename happens at COMMIT time inside the transaction's success path. On any failure: SQL rollback + tmp-file delete.
- **Decision G — Drain-lock reuse**: SP-004 reuses SP-003's `Paths.drainLock()` — single serialization point across ingest and classify. No separate classify-lock.
- **Decision H — Body excerpt truncation**: first 2000 codepoints (UTF-8-safe boundary).
- **Decision I — Proposed term ON CONFLICT handling**: `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`. Duplicates collapse; no auto-promotion (Principle XV).
- **Decision J — Schema-emitter library choice**: `zod-to-json-schema ^3.x` for canonical JSON Schema rendering at module-load time.

## Risk Register

Anything that could surprise downstream `/speckit-tasks` or `/speckit-implement`:

- **R1 — Ollama version skew on structured-outputs `format` parameter**: Ollama 0.5+ supports the `format` parameter as JSON Schema; earlier versions don't. User's pai-node01 runs 0.21.0 (verified). If a user runs SP-004 against an older Ollama, the `format` parameter is ignored silently and the response is free-form JSON-string text → defense-in-depth Zod validation catches it as `schema_invalid`, but the failure rate spikes. Mitigation: the OllamaAdapter records the Ollama version string at boot (via GET `http://localhost:11434/api/version`) and emits a `classify.ollama_version` event; quickstart.md documents the 0.5+ requirement.
- **R2 — `qwen3.5:9b` wall-clock on CPU**: qwen3.5:9b at Q4_K_M on CPU may exceed the 60s interactive budget for large prompts. Mitigation: prompt body excerpt capped at 2000 codepoints (FR-CLASSIFY-020); fallback model is `gemma3:4b` (Decision A) which is ~3x faster at acceptable quality for SCHEMA.md's 7-value facet_type classification.
- **R3 — `zod-to-json-schema` Ollama compatibility**: Ollama's `format` parameter expects a specific JSON Schema dialect; `zod-to-json-schema`'s default output may include unsupported keywords (e.g., `$schema`, `$ref` to external definitions). Mitigation: at module-load time, the rendered schema is post-processed to strip `$schema` and inline all `$ref`s; a `tests/unit/classifier-output-schema.test.ts` test asserts the rendered schema parses through Ollama's schema validator (validated offline once during Phase 0).
- **R4 — Vocabulary snapshot staleness during long batch**: A `corpus reenrich` batch may take minutes; concurrent classify-stage invocations from the daemon's post-persist hook (same process, same drain-lock, no concurrency issue) MAY insert new proposed terms mid-batch. The CURRENT batch's snapshot is stable, so those mid-batch proposed terms are not visible to the rest of the batch — correct per Decision E (per-batch refresh). Established-vocabulary changes only via future user-review promotion, so the snapshot is sufficient.
- **R5 — Confidence threshold drift across retries**: FR-CLASSIFY-005's retry-once policy doesn't gate on confidence. A low-confidence classification is persisted same as high-confidence. Mitigation: confidence sub-scores land in telemetry (`classify.completed.confidence_summary`); a future low-confidence-review surface can read telemetry to surface for re-review.
- **R6 — Body-file frontmatter rewrite vs SP-003 atomicity**: SP-003 wrote the body file with FR-008 minimum frontmatter; SP-004 rewrites with the same fields + classifier output. The rewrite is atomic via `withTempDir`. Risk: if the rewrite produces a body file whose frontmatter is malformed YAML (regression in `stringifyMarkdownWithFrontmatter`), SP-002 readers fail. Mitigation: a unit test asserts round-trip safety (`parseMarkdownWithFrontmatter(stringifyMarkdownWithFrontmatter(x)) ≡ x`) against fixture classifier outputs.
- **R7 — Telemetry record size budget for `classify.ollama_response`**: The response may contain long tag arrays + summary text. Per-event size budget verified in `data-model.md`; longest plausible payload (10 tags × 30 chars + 200-char summary + envelope) is ~1.5 KB. Well under 4 KB. Defense-in-depth: `confidence_summary` is rounded to 2 decimal places before telemetry serialization.
- **R8 — Single-threaded classify-stage may bottleneck `corpus reenrich` at scale**: A 1000-doc backlog at 30s/doc (qwen3.5:9b warm) is 8+ hours. Acceptable for v1 (single-user, single-machine). Mitigation: documented in quickstart.md ("reenrich is single-threaded; large backlogs take time"). Worker-pool parallelism deferred to SP-005 + benchmark evidence.

---

> **T0 measurement footnote (TBD post-implementation, pai-node01)**: Empirical per-document classify wall-clock will be measured by `tests/integration/end-to-end-classify.test.ts` against a fixture set of 10 mixed-MIME documents (3× Markdown + 3× plain-text + 2× HTML + 2× small PDF, each <100 KB). p95 and mean wall-clock recorded here at Phase 5 completion. If qwen3.5:9b p95 exceeds 60 s comfort threshold, the model fallback to gemma3:4b is exercised and re-measured.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*Empty — all 16 principles pass without justification. Phase 0 prerequisites are forward-compatibility plumbing, not principle drift.*
