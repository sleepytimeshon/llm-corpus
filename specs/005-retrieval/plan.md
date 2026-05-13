# Implementation Plan: Hybrid Retrieval — BM25 + Dense + Graph + Confidence Fusion

**Branch**: `005-retrieval`
**Date**: 2026-05-13
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/005-retrieval/spec.md`

## Summary

Ship the **retrieval owner** for the `corpus.find` MCP tool. SP-001 registered the tool with a placeholder handler returning `{hits: [], query}` (per the `packages/transport/src/corpus-find-tool.ts` comment "Real implementation lands in SP-005"). SP-002 added the read-only resource layer. SP-003 produced sentinel rows. SP-004 populated the classifier columns + body-file frontmatter mirror + proposed-state taxonomy rows. SP-005 fills the ranking layer end-to-end: a local Ollama embedding adapter (default `nomic-embed-text`, 768-dim) produces per-document dense vectors; an FTS5 virtual table indexes the BM25 fields with field-weighted scoring; a sqlite-vec virtual table holds the dense vectors; an `edges` table materializes tag-overlap + summary-similarity + explicit-related edges; a fusion module combines the four signals via Reciprocal Rank Fusion (RRF, k=60 per ARCHITECTURE-FINAL §10.3) with confidence weights (§10.5) applied as a multiplicative post-fusion adjustment. The `corpus.find` MCP tool now returns a ranked SearchHit list with `query_hash` (NOT raw query text) in every `search.query` telemetry event. The four signals MUST ALL be inputs to ranking (FR-003 verbatim); no signal is silently disabled on partial failure — degradation is surfaced via `degraded_signals: [...]` in the response.

Four-layer delivery:

1. **Embedding adapter** — `packages/inference/src/embedding-adapter.ts` (NEW; extends SP-004's local-Ollama transport pattern). Posts to `http://localhost:11434/api/embeddings` via `undici` (AbortSignal-compatible; routes through SP-001 egress hook). Validates the response dimension matches the configured model's expected dimension (768 for nomic-embed-text).
2. **Index module** — `packages/index/src/index.ts` grows from the SP-001-era `export {};` stub (per its `// Real implementation lands in SP-005` comment) to functional. New files: `packages/index/src/fts5-adapter.ts` (BM25 retriever — field-weighted query rendering, top-K extraction), `packages/index/src/vec-adapter.ts` (dense retriever — query embedding + cosine top-K via `vec_distance_cosine`), `packages/index/src/graph-adapter.ts` (graph retriever — seed-document expansion via edges JOIN), `packages/index/src/confidence-adapter.ts` (confidence retriever — per-doc weight lookup + recency adjustment), `packages/index/src/fusion.ts` (RRF k=60 + confidence multipliers), `packages/index/src/search.ts` (orchestrator — runs four retrievers in parallel, fuses, validates output schema).
3. **Pipeline sub-stages + persistence** — `packages/pipeline/src/embed-stage.ts` (NEW; runs after classify-stage commits, posts the doc text to the embedding adapter), `packages/pipeline/src/index-stage.ts` (NEW; runs after embed-stage, inserts FTS5 + vec rows), `packages/pipeline/src/edges-build-stage.ts` (NEW; runs after index-stage, computes Jaccard + cosine + explicit-related edges, inserts edges rows). All three sub-stages share the SP-003/SP-004 drain-lock window. **Transaction scope:** SP-004's classify-persister is a self-contained committed transaction (merged in PR #13 with COMMIT-then-rename ordering). SP-005 opens a SEPARATE SQLite transaction AFTER classify-persister returns successfully, encompassing FTS5 INSERT + vec INSERT + edges INSERTs atomically — Constitution VIII binds these three index writes as the unit of atomicity, not the classify UPDATE. If embed/index/edges fail post-classify, the row has classified metadata but no index entry; recovery via `corpus reindex` re-runs the embed → index → edges chain (idempotent: same body + same model = same vector). `packages/storage/src/index-persister.ts` (NEW) is the write-side adapter; its `BEGIN IMMEDIATE` opens the SP-005 transaction, INSERTs run, then `COMMIT`. The SP-004 transaction is NOT reopened.
4. **Schema migration + tool wiring + CLI** — `packages/storage/src/sp005-migration.ts` (NEW) creates `documents_fts` + `documents_vec` + `edges` via `CREATE VIRTUAL/TABLE IF NOT EXISTS`. The SP-001 `packages/transport/src/corpus-find-tool.ts` placeholder is REPLACED with the real handler that delegates to `packages/index/src/search.ts`. `packages/cli/src/reindex-command.ts` (NEW) adds `corpus reindex [--dry-run]`. `packages/contracts/src/search-schemas.ts` (NEW) defines the SearchInput / SearchHit / SearchErrorEnvelope Zod schemas. `packages/contracts/src/telemetry.ts` extends additively with the ≥ 8 SP-005 event classes. `packages/daemon/src/index.ts` extends post-classify hook chain to embed → index → edges-build.

SP-005 is honest about what it produces (four-signal hybrid retrieval Tier 0 + the three new index tables + the real `corpus.find` ranking) and what it defers (Tier 1/2/3 fallthrough to SP-006, kill-9 cross-stage recovery to SP-006, retrieval-eval harness to v1.5+, chunked embeddings + ANN + cross-encoder re-ranking to future horizons).

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. Inherits SP-001/SP-002/SP-003/SP-004 toolchain unchanged.

**Primary Dependencies** (additive over SP-001 + SP-002 + SP-003 + SP-004):

- `sqlite-vec ^0.1.x` (existing in v1 native-addon allowlist; verified loadable via namespace import on pai-node01 2026-05-13). Loaded once per database connection via `sqliteVec.load(db)` at connection-open time. Provides `vec0` virtual table type and the `vec_distance_cosine` SQL function.
- `better-sqlite3 ^11.2.0` (existing) — FTS5 virtual tables work natively via `CREATE VIRTUAL TABLE ... USING fts5(...)`; no new dependency.
- `undici` (existing) — HTTP client for the Ollama `/api/embeddings` POST. AbortSignal-compatible by construction; routes through SP-001 egress hook (`http://localhost:11434` is allowlisted).
- `zod ^3.23.0` (existing) — `SearchInputZodSchema`, `SearchHitZodSchema`, `SearchErrorEnvelopeZodSchema` live in `packages/contracts/src/search-schemas.ts` (NEW file). SP-005 telemetry event classes added to the `TelemetryEvent` discriminated union additively.
- `js-yaml` (existing, SP-002) — frontmatter codec via `parseMarkdownWithFrontmatter` consumed by the index-stage to extract `summary` and `facet_topic` from body files.
- `node:crypto` (built-in) — SHA-256 query hashing for `search.query` telemetry events (FR-RETRIEVAL-023).
- `@iarna/toml` (existing) — config file parsing for `[embedding]`, `[confidence_weights]`, `[retrieval]` sections.

**Storage**: Reuses SP-002 SQLite index file at `Paths.indexDb()` (now containing `documents`, `taxonomy_terms`, plus the three new SP-005 tables: `documents_fts`, `documents_vec`, `edges`). SP-005 ADDS three tables; does NOT modify existing column shapes. Body files at `Paths.docs() + '/' + row.body_path` — SP-005 READS them at index-stage to extract frontmatter `summary` and `facet_topic`; SP-005 does NOT write body files (the classifier in SP-004 is the only body-file writer post-ingest). Telemetry JSONL at `Paths.telemetry()`. Drain lock at `Paths.drainLock()` (reused). Failure-lane sidecars at `Paths.failed() + '/<doc-id>.error.json'`.

**Testing**: vitest (inherits SP-001/SP-002/SP-003/SP-004). New SP-005 test surfaces:

- (a) `tests/unit/search-input-schema.test.ts` — SearchInput Zod parses valid + rejects invalid + bounds query length;
- (b) `tests/unit/search-hit-schema.test.ts` — SearchHit Zod parses valid + rejects malformed responses;
- (c) `tests/unit/error-envelope-schema.test.ts` — SearchErrorEnvelope Zod;
- (d) `tests/unit/sp005-migration.test.ts` — idempotent CREATE VIRTUAL/TABLE IF NOT EXISTS;
- (e) `tests/unit/embedding-adapter.test.ts` — undici POST + AbortSignal; dimension validation; ECONNREFUSED handling;
- (f) `tests/unit/fts5-adapter.test.ts` — field-weighted BM25 query rendering; top-K extraction;
- (g) `tests/unit/vec-adapter.test.ts` — query embedding + cosine top-K via vec_distance_cosine;
- (h) `tests/unit/graph-adapter.test.ts` — edges JOIN traversal from seed candidates;
- (i) `tests/unit/confidence-adapter.test.ts` — per-doc weight lookup + recency adjustment;
- (j) `tests/unit/fusion.test.ts` — RRF k=60 correctness against fixture rankings; confidence multipliers applied AFTER fusion;
- (k) `tests/unit/edges-builder.test.ts` — Jaccard threshold + cosine threshold + explicit-related;
- (l) `tests/unit/index-persister.test.ts` — three-row INSERT atomicity within a single transaction; mid-tx failure rolls back all three;
- (m) `tests/unit/search-orchestrator.test.ts` — four retrievers in parallel + fusion + degraded-signals annotation;
- (n) `tests/integration/end-to-end-retrieval.test.ts` — full SP-003 → SP-004 → SP-005 chain against live local Ollama with nomic-embed-text;
- (o) `tests/integration/reindex-cli.test.ts` — backfill + summary line + dry-run + SIGTERM abort + lock contention;
- (p) `tests/integration/retrieval-atomicity.test.ts` — mid-transaction failure during embed → index → edges-build rolls back all four sub-stages including classify UPDATE;
- (q) `tests/integration/retrieval-degraded-signals.test.ts` — every signal-failure path produces a degraded response, not a transport error;
- (r) `tests/integration/retrieval-concurrency.test.ts` — drain-lock contention across drain + reenrich + reindex;
- (s) `tests/integration/retrieval-idempotency.test.ts` — re-running reindex on indexed corpus is 0-call no-op;
- (t) `tests/integration/retrieval-filter-pushdown.test.ts` — filter facets narrow candidate set before fusion.

**Target Platform**: Linux (Fedora 43+) and macOS. Windows out of scope for v1. Ollama 0.5+ required (already satisfied — pai-node01 runs 0.21.0). `nomic-embed-text` must be pulled (`ollama pull nomic-embed-text`).

**Project Type**: TypeScript monorepo (npm workspaces). SP-005 grows one previously-stub package (`packages/index/`), extends four (`packages/pipeline/`, `packages/storage/`, `packages/contracts/`, `packages/inference/`), replaces one tool handler (`packages/transport/`), and adds one CLI subcommand (`packages/cli/`) + one daemon hook extension (`packages/daemon/`):

- `packages/index/` — grows from `export {};` stub to functional (FTS5 / vec / graph / confidence adapters; RRF fusion; search orchestrator).
- `packages/pipeline/` — extends with three sub-stages (embed, index, edges-build) and the post-classify hook-chain extension.
- `packages/storage/` — extends with `index-persister.ts` (FTS5 + vec + edges atomic INSERT) and `sp005-migration.ts` (schema migration delta).
- `packages/contracts/` — extends `telemetry.ts` with the new SP-005 event classes; adds `search-schemas.ts` for SearchInput / SearchHit / SearchErrorEnvelope; extends `errors.ts` with SP-005 typed errors.
- `packages/inference/` — extends with `embedding-adapter.ts` (sibling of `ollama-adapter.ts`; same egress-hook + AbortSignal pattern).
- `packages/transport/` — `corpus-find-tool.ts` REPLACED with real handler that delegates to `packages/index/src/search.ts`.
- `packages/cli/` — adds `reindex-command.ts` for `corpus reindex`.
- `packages/daemon/` — extends `index.ts` post-classify hook to invoke embed → index → edges-build sub-stages.

**Performance Goals**:

- Per-document four-sub-stage wall-clock (embed + index + edges-build) under interactive policy: target 30s p95 on the user's primary machine with `nomic-embed-text` loaded. Reported as "documented, measured, within budget" per Constitution XVI — specific p95 is empirically measured and recorded in this plan's footnote after `tests/integration/end-to-end-retrieval.test.ts` runs.
- Embedding HTTP request → first-byte latency: under 100 ms on a warm Ollama process (model already loaded). Under 5 s on cold start.
- `corpus.find` end-to-end wall-clock (all four retrievers + fusion): target sub-100 ms p95 on a 1000-doc indexed corpus per ARCHITECTURE-FINAL §10.6's "Tier 0 <20ms target" honest re-framing — §10.6 is a target, not a guarantee per Constitution XVI; the SP-005 honest commitment is sub-100 ms for typical corpora, with the §10.6 sub-20 ms goal as an aspirational target measured at Phase 5.
- Schema-migration runtime on empty DB: under 100 ms (three CREATE VIRTUAL/TABLE statements + two indices).
- Schema-migration runtime on populated DB (idempotent re-run): under 50 ms (the `IF NOT EXISTS` clauses short-circuit).
- SQL transaction wall-clock for the four-sub-stage chain (classify UPDATE + taxonomy INSERTs + FTS5 INSERT + vec INSERT + edges INSERTs + COMMIT): under 200 ms p95 (small payload; vector is 768 floats; edges are typically < 10 per doc).
- Drain-lock acquisition: under 50 ms warm; under 200 ms cold (inherits SP-003 flock semantics).
- SIGTERM → process exit: under 2 s wall-clock (Constitution VII bounded abort).
- Telemetry emission per event: under 1 ms.

All numbers are TARGETS not guarantees per Constitution XVI. The §10.6 sub-20 ms target for Tier 0 is the aspirational ceiling; SP-005 honestly reports the empirical p95 in plan.md's Performance Goals footnote.

**Constraints**:

- Zero outbound non-loopback packets during any embed / index / search stage (Constitution I, hard — inherited from SP-001 egress hook). The `http://localhost:11434` destination is allowlisted by construction.
- Zero writes outside `Paths.*` (Constitution XIV, hard — `paths-from-resolver-only` lint covers SP-005 source).
- Every IO call accepts `AbortSignal` and propagates it (Constitution VII, hard — `no-promise-race-settimeout` lint covers SP-005 source).
- Documents-FTS5 INSERT + documents-vec INSERT + edges INSERTs + (SP-004) documents UPDATE + (SP-004) taxonomy_terms INSERTs commit in one SQLite transaction or all fail (Constitution VIII transactional contract — VERBATIM literal SP-005 surface).
- Every state transition emits a Zod-validated telemetry event (Constitution XIII, hard).
- Zero subprocesses in SP-005 (embedding is HTTP; Principle XII trivially satisfied).
- No `process.exit` in `packages/index/`, `packages/inference/`, `packages/pipeline/`, `packages/storage/`, `packages/transport/`, `packages/contracts/` SP-005 source (Constitution XI, hard).
- Telemetry records ≤ 4096 bytes (Constitution IX, hard — same per-class size budgets as SP-003 / SP-004).
- Document body content MUST NOT appear in telemetry payloads (Constitution I + SC-RETRIEVAL-016). User query strings MUST be hashed (SHA-256) before appearing in `search.query` events.
- No hardcoded enum FacetDomain (Constitution XV, hard — inherited from SP-004; SP-005 doesn't add domain enums).
- No new MCP mutation surfaces (Constitution III, hard — SP-005 expands the existing `corpus.find` tool's handler; introduces no new tools / resources / prompts).

**Scale/Scope**:

- Single user, single machine (Constitution IV).
- Net new code: ~1500-2000 LOC implementation, ~1800-2400 LOC tests + fixtures.
- Net new files: 1 embedding adapter, 4 retriever adapters (FTS5, vec, graph, confidence), 1 fusion module, 1 search orchestrator, 3 pipeline sub-stages (embed, index, edges-build), 1 edges-builder helper, 1 index-persister, 1 schema-migration helper, 1 search-schemas contracts module, 1 reindex CLI command, ~3 contracts extensions (telemetry classes, errors, search-schemas), ~20 test files.
- Per-feature contract files: 3 ADRs (embedding model, RRF fusion, edges materialization timing) + 2 JSON Schemas (SearchHit, ErrorEnvelope).

**Sizing call**: SP-005 sits at or just over the 2000 LOC / 15 files split threshold. Production surface alone (~1500-2000 LOC across ~14 source files) is at the threshold; total surface with tests + fixtures is ~3500-4500 LOC across ~30+ files. Per `feedback-build-tier-sizing-rule` (>2000 LOC / >15 files MUST split into N≥2 pre-planned Engineer agent invocations), recommend **two-phase build** when `/speckit-implement` runs: Phase A — schema migration + embedding adapter + atomicity contract (FR-RETRIEVAL-005..009, FR-RETRIEVAL-019); Phase B — four retrievers + fusion + tool handler + CLI (FR-RETRIEVAL-001..004, FR-RETRIEVAL-010..023). The split is pre-planned in `tasks.md` (dispatched separately by `/speckit-tasks`); each phase ends with a Phase Gate (its own test suite must be green before Phase B starts).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — SP-005's only non-local-disk IO is HTTP POST to `http://localhost:11434/api/embeddings` (for both per-document embedding at index-stage and per-query embedding at search-time). The SP-001 egress hook permits localhost-only destinations and rejects all others; any accidental non-localhost call hard-fails with `EgressBlockedError`. The `undici` client routes through this hook by construction. Telemetry records hashes, dimensions, durations, signal-success flags — never body content nor raw query text (SC-RETRIEVAL-016; query strings hashed via SHA-256 per FR-RETRIEVAL-023). sqlite-vec runs in-process via native-addon — zero network surface.
- [x] **II. User Curates, LLM Classifies Metadata** — SP-005 does NOT touch body files (the classifier in SP-004 is the only body-file writer post-ingest). The `body_excerpt` indexed in FTS5 is derived from the body file at index-stage but is stored ONLY in the FTS5 virtual table's columns; no body content is generated by an LLM or written to the body file. Embeddings are derived from existing classified text (title + summary + facet_topic + tags + body_excerpt) — pure transformation of existing user-curated + LLM-classified content, no new LLM-generated body content introduced.
- [x] **III. Substrate, Not Surface** — SP-005 introduces ZERO new MCP tools, resources, prompts, or other agent-facing surfaces (FR-RETRIEVAL-017). The existing `corpus.find` MCP tool's handler logic is EXPANDED (SP-001 registered the empty-hits placeholder; SP-005 fills in the ranking). The retrieval mutation surfaces (FTS5 + vec + edges writes) are driven by the daemon's hook chain + the `corpus reindex` CLI — both library-level invocations, not MCP-exposed. No HTTP server, no TUI, no browser.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — SP-005 reads / writes one local SQLite + reads local body files. No conversation memory, no per-session preferences, no SaaS connector, no cross-machine sync. Single-user, single-machine. No federation, no permissions, no roles.
- [x] **V. Schema-Enforced Structured Output** — `SearchInputZodSchema` validates every `corpus.find` input at the tool boundary; invalid input returns the `validation_error` envelope (FR-RETRIEVAL-004). `SearchHitZodSchema` validates every output before serialization to the MCP transport; malformed-shape responses become `internal_error` envelopes instead of corrupt SearchHit arrays (FR-RETRIEVAL-020). The embedding-adapter validates the response dimension matches the configured model's expected dimension. The frontmatter codec is SP-002's `parseMarkdownWithFrontmatter` — single YAML routing point. NO regex extraction from free-form text; NO hand-rolled JSON parsing.
- [x] **VI. One Pipeline, Two Policies** — The three new sub-stages (embed, index, edges-build) are invoked by BOTH the SP-003 daemon's post-classify hook chain AND the `corpus reindex` CLI command. The two surfaces differ only via `interactivePolicy` vs `batchPolicy` (extended additively with SP-005 fields: `perDocEmbedTimeoutMs`, `perDocIndexTimeoutMs`, `perDocEdgesBuildTimeoutMs`, `embeddingHttpTimeoutMs`, `retrieverSqlTimeoutMs`). No forked code path; one orchestrator with policy-record dispatch.
- [x] **VII. Cancellable, Bounded IO** — Every IO call in SP-005 accepts `AbortSignal` and propagates it: `undici.fetch(url, { signal })` for the embedding POST; SQLite prepared-statement steps check `signal.throwIfAborted()` between rows; the body-file read for frontmatter extraction accepts signal. SIGTERM → master controller `abort()` → in-flight embed / index / edges-build / search aborts → row stays unindexed → tmp files cleaned up → process exit within 2 s. Per-call timeouts via `AbortController` + `setTimeout` + `clearTimeout` (FR-RETRIEVAL-011). NO `Promise.race(setTimeout)`; SP-001's `no-promise-race-settimeout` lint covers SP-005 source. Defaults per Decision I in research.md: 10s embedding HTTP; 5s per retriever SQL; 30s whole `corpus.find` p99.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — VERBATIM literal SP-005 surface for Constitution VIII: "Index writes (FTS5 row + docs row + sqlite-vec row for the same document) MUST commit together in a single transaction or not at all; partial index state is a forbidden permitted state." The orchestrator opens `BEGIN IMMEDIATE`; runs classify UPDATE + taxonomy INSERTs (SP-004) + FTS5 INSERT + vec INSERT + edges INSERTs (SP-005); on success COMMIT, then body-file frontmatter rewrite (SP-004's post-COMMIT atomic rename); on any failure between BEGIN and COMMIT, ROLLBACK + tmp body file cleanup + error sidecar. The atomic-rename-after-COMMIT ordering inherited from SP-004 ADR-CLASSIFIER-ATOMICITY (corrected during SP-004 code review) is preserved.
- [x] **IX. Concurrency-Safe Shared State** — `Paths.drainLock()` is the SINGLE write-serialization point across SP-003 + SP-004 + SP-005 (FR-RETRIEVAL-018). The daemon's hook chain reuses the held lock for all four sub-stages; `corpus reindex` acquires independently; concurrent invocations emit `pipeline.lock_contention` and exit 0 (FR-INGEST-011 / FR-CLASSIFY-015 contract preserved). SQLite remains in WAL mode. Telemetry records ≤ 4096 bytes (per-class budgets in data-model.md). Lock release covers normal exit, exception, SIGTERM.
- [x] **X. Idempotent Pipeline Transitions** — Re-running embed + index + edges-build on a row whose `documents_vec` entry already exists is structurally a no-op (FR-RETRIEVAL-012): the SQL `WHERE NOT EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = ?)` filter short-circuits the sub-stage; zero Ollama HTTP calls; zero SQL writes. `corpus reindex` on a fully-indexed corpus produces `indexed=0, failed=0, skipped=N` (SC-RETRIEVAL-015). Schema migration is idempotent (SC-RETRIEVAL-022). Three-folder routing invariants from SP-003 / SP-004 are preserved.
- [x] **XI. Library/CLI Boundary** — Zero `process.exit` in `packages/index/`, `packages/inference/`, `packages/pipeline/`, `packages/storage/`, `packages/transport/`, `packages/contracts/` SP-005 source files (FR-RETRIEVAL-014). All library functions return `Result<T, E>` or throw typed errors (`EmbeddingUnavailableError`, `IndexUnavailableError`, `EmbeddingDimensionMismatchError`, `EdgesBuildTimeoutError`, `RetrievalError` base, `SearchAbortedError`, `SearchValidationError`, `FusionError`). Only `packages/cli/src/reindex-command.ts` (CLI wrapper) and `packages/daemon/src/index.ts` (extended) may exit the process. SP-001's `no-process-exit-in-libs` ESLint rule covers SP-005 source.
- [x] **XII. Subprocess Hygiene** — SP-005 has ZERO subprocesses (embedding adapter is HTTP; no extractor shims). The principle is trivially satisfied. No `runTool` invocations in SP-005 source. The `no-shell-string-exec` lint covers SP-005 source vacuously. sqlite-vec is a native addon loaded in-process via `sqliteVec.load(db)` — addon, not subprocess.
- [x] **XIII. Telemetry-or-Die** — Every SP-005 state transition emits a Zod-validated event (FR-RETRIEVAL-013 — ≥ 8 event classes plus 4-6 additional classes for completeness — see data-model.md Entity 5). Every catch block in SP-005 source emits a telemetry event at severity matching the actual error severity BEFORE re-throwing or converting to `Result.err`. The SP-001 AST-level lint covers SP-005 source. The telemetry-write-failure honesty path (inherited from SP-003 SC-INGEST-013 / SP-004 generalization) generalizes: if `emitTelemetry` itself throws during an embed / index / edges / search stage, the in-flight row routes to `<doc-id>.error.json` with `error_code='telemetry_write_failed'`. Query strings in `search.query` events are SHA-256-hashed (`query_hash` field); the raw query text NEVER appears in telemetry.
- [x] **XIV. XDG Paths via Single Resolver** — All SP-005 paths route through existing `Paths.*` getters (FR-RETRIEVAL-015): `Paths.indexDb()` (the three new tables live in the same SQLite file), `Paths.failed()` (error sidecars), `Paths.telemetry()` (JSONL appends), `Paths.drainLock()` (single serialization point), `Paths.cache()` (`withTempDir` tmp if needed). NO new XDG base; SP-005 introduces zero new derived getters. NO writes to `/tmp/`, `/var/`, `os.tmpdir()`, or any non-`Paths.*` literal. SP-001's `paths-from-resolver-only` lint covers SP-005 source.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — SP-005 does NOT add taxonomy axes nor mutate `taxonomy_terms`. The classifier's vocabulary contract (Principle XV applied in SP-004) is preserved. SP-005's `confidence_weights` config-map is keyed by `facet_type` (the CONSTITUTIONAL 7-value enum from SCHEMA.md — not a dynamic vocabulary axis). The `facet_topic` field indexed in FTS5 is OPTIONAL frontmatter (per SCHEMA.md) — when present it's grep-able BM25 context; when absent the column is empty. NO hardcoded `enum FacetDomain` introduced in SP-005 source.
- [x] **XVI. Validation Honesty** — Performance numbers in this plan are TARGETS, not guarantees. The §10.6 sub-20 ms Tier 0 target is the aspirational ceiling; SP-005 honestly commits to sub-100 ms p95 for typical corpora and reports the empirical p95 as a plan footnote at Phase 5. The fixture-driven SCs (signal-disable, atomicity injection, drain-lock contention) are honestly partitioned from the live-against-primary-machine SCs (end-to-end index + retrieval, reindex backfill) in `quickstart.md`. NO cross-agent compatibility claim. NO formal retrieval-eval harness as v1 success criterion (deferred to v1.5+ per NFR-009). The embedding model choice (nomic-embed-text) is documented in `contracts/adr-embedding-model.md` with the dimension fingerprinting issue surfaced honestly. The edge-thresholds (Jaccard 0.3, cosine 0.7) are config-driven defaults; no marketing claims of "optimal".

**Result: 16/16 [x]. Complexity Tracking empty.** No principle violations.

## Phase 0 Prerequisites (must complete before `/speckit-implement` begins)

These are SP-001/SP-002/SP-003/SP-004-era code touches that SP-005 needs before the user-story implementation can begin. They are NOT principle violations — they are forward-compatibility plumbing.

- **PREREQ-001 — `SearchInputZodSchema` + `SearchHitZodSchema` + `SearchErrorEnvelopeZodSchema`**: Add `packages/contracts/src/search-schemas.ts` containing (a) `SearchInputZodSchema`: `z.object({query: z.string().max(2048), filters: SearchFiltersZodSchema.optional(), limit: z.number().int().min(1).max(100).default(20)}).strict()`; (b) `SearchFiltersZodSchema`: `z.object({facet_domain: z.string().optional(), facet_type: z.union([z.string(), z.array(z.string())]).optional(), tags: z.array(z.string()).optional(), since: z.string().regex(ISO8601_REGEX).optional(), until: z.string().regex(ISO8601_REGEX).optional(), source_type: z.string().optional()}).strict()`; (c) `SearchHitZodSchema`: `z.object({uri: z.string().regex(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/), score: z.number(), title: z.string(), facet_domain: z.string(), facet_type: z.enum(FACET_TYPE_VALUES), tags: z.array(z.string()), snippet: z.string().max(400)}).strict()`; (d) `SearchErrorEnvelopeZodSchema`: `z.object({error_code: z.enum(SEARCH_ERROR_CODES), message: z.string().max(1024), hint: z.string().max(1024)}).strict()`; (e) the union `SearchOutputZodSchema` for the full tool response shape (success or envelope).

- **PREREQ-002 — Register SP-005 telemetry event classes**: Extend the `TelemetryEvent` Zod discriminated union in `packages/contracts/src/telemetry.ts` with the SP-005 event classes (≥ 12 new variants per FR-RETRIEVAL-013): `embed.started`, `embed.completed`, `embed.failed`; `index.started`, `index.completed`, `index.failed`; `edges.started`, `edges.completed`, `edges.failed`; `search.started`, `search.query`, `search.completed`, `search.degraded`, `search.error`. Each schema validates ISO-8601 timestamp, severity enum, outcome enum, and class-appropriate fields. Additive — existing SP-001/SP-002/SP-003/SP-004 event variants continue to compile and parse without change. The `search.query` schema includes `query_hash: z.string().regex(/^[0-9a-f]{64}$/)` (SHA-256 hex) and `tier_used: z.literal('hybrid')` and `result_count: z.number().int().min(0)` and `signals_used: z.array(z.enum(['bm25','dense','graph','confidence']))` per FR-RETRIEVAL-023.

- **PREREQ-003 — Extend `errors.ts` with SP-005 typed errors**: `RetrievalError` (base), `EmbeddingUnavailableError`, `EmbeddingDimensionMismatchError`, `IndexUnavailableError`, `EdgesBuildTimeoutError`, `SearchAbortedError`, `SearchValidationError`, `FusionError`, `IndexPersistError`. Each carries `name`, structured `data`, and the library-package contract (no `process.exit`).

- **PREREQ-004 — Extend `policies.ts` with retrieval-stage fields**: The SP-003 / SP-004 `interactivePolicy` / `batchPolicy` records gain `perDocEmbedTimeoutMs: number`, `perDocIndexTimeoutMs: number`, `perDocEdgesBuildTimeoutMs: number`, `embeddingHttpTimeoutMs: number`, `retrieverSqlTimeoutMs: number`, `searchTotalTimeoutMs: number`, `topKPerRetriever: number`. Defaults: interactive `{perDocEmbedTimeoutMs: 10_000, perDocIndexTimeoutMs: 5_000, perDocEdgesBuildTimeoutMs: 15_000, embeddingHttpTimeoutMs: 10_000, retrieverSqlTimeoutMs: 5_000, searchTotalTimeoutMs: 30_000, topKPerRetriever: 64}`, batch `{perDocEmbedTimeoutMs: 30_000, perDocIndexTimeoutMs: 10_000, perDocEdgesBuildTimeoutMs: 60_000, embeddingHttpTimeoutMs: 30_000, retrieverSqlTimeoutMs: 10_000, searchTotalTimeoutMs: 60_000, topKPerRetriever: 64}`. Per Decisions I + L in `research.md`.

- **PREREQ-005 — `sp005-migration.ts` schema migration**: Add `packages/storage/src/sp005-migration.ts` with `runSp005Migration(db)` invoking the three `CREATE VIRTUAL/TABLE IF NOT EXISTS` statements (FR-RETRIEVAL-019) + two `CREATE INDEX IF NOT EXISTS`. Idempotent. Called from `runSchemaMigration(db)` (which already runs the SP-002 + SP-003 + SP-004 migrations). The function takes the same `Database` connection that `sqliteVec.load(db)` has been called on (the migration registers vec0 against that connection).

- **PREREQ-006 — `index-persister.ts` write-side adapter**: Add `packages/storage/src/index-persister.ts` with `persistIndex({docId, ftsFields, vector, edges, signal}): Promise<Result<void, IndexPersistError>>`. The function takes a Database + the inputs and executes within a caller-opened transaction (the orchestrator opens BEGIN IMMEDIATE; the persister adds the three SP-005 inserts; the orchestrator's COMMIT or ROLLBACK governs both SP-004 and SP-005 writes per FR-RETRIEVAL-007).

- **PREREQ-007 — `embedding-adapter.ts` HTTP client**: Add `packages/inference/src/embedding-adapter.ts` with `embedDocument(text, signal)` and `embedQuery(text, signal)` returning `Promise<Result<Float32Array, EmbeddingError>>`. Routes through SP-001 egress hook; validates the response dimension against the configured model's expected dimension; emits `embed.started` / `embed.completed` / `embed.failed` telemetry.

- **PREREQ-008 — Verify `packages/index/src/index.ts` is `export {};` stub**: Confirm pre-flight that the existing file is `export {};` with a `// Real implementation lands in SP-005` comment. SP-005 grows this package from scratch.

- **PREREQ-009 — Verify `packages/transport/src/corpus-find-tool.ts` is the SP-001 placeholder returning empty hits**: Confirm pre-flight that the existing handler returns `{hits: [], query: input.query}`. SP-005 replaces the handler body (preserving the registered tool name and input/output schema surface area registered by SP-001).

Each PREREQ gets a TDD contract-test/implementation task pair in `/speckit-tasks`'s Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/005-retrieval/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification
├── research.md          # Phase 0 — Decisions A through L + technology choice notes
├── data-model.md        # Phase 1 — Embedding / FTS5Row / VecRow / Edge / telemetry event class schemas + documents-row mapping
├── quickstart.md        # Phase 1 — operator walkthrough (pull nomic-embed-text → daemon → ingest → corpus.find) with honest "what's NOT working yet" partition
├── contracts/
│   ├── search-hit-schema.json             # Phase 1 — Canonical JSON Schema for SearchHit (auditor-readable)
│   ├── error-envelope-schema.json         # Phase 1 — Canonical JSON Schema for SearchErrorEnvelope
│   ├── adr-embedding-model.md             # Phase 1 — ADR: nomic-embed-text primary; 768-dim rationale
│   ├── adr-rrf-fusion.md                  # Phase 1 — ADR: RRF k=60 + per-retriever top-K = 64
│   └── adr-edges-materialization.md       # Phase 1 — ADR: when + thresholds + O(N²) bound
└── checklists/
    └── requirements.md  # Spec quality checklist (16-principle pass/fail + anti-scope verification)
```

### Source Code (repository root)

```text
packages/
├── contracts/                            # Pure types — zero IO
│   └── src/
│       ├── paths.ts                      # SP-001..SP-004 — unchanged (SP-005 uses existing getters)
│       ├── telemetry.ts                  # SP-001..SP-004 — extended with SP-005 event classes (PREREQ-002)
│       ├── errors.ts                     # SP-001..SP-004 — extended with 9 new SP-005 typed errors (PREREQ-003)
│       ├── search-schemas.ts             # NEW — SearchInputZodSchema + SearchHitZodSchema + SearchErrorEnvelopeZodSchema + SearchOutputZodSchema (PREREQ-001)
│       ├── classifier-schema.ts          # SP-004 — unchanged
│       ├── markdown-frontmatter.ts       # SP-002 — unchanged (SP-005 consumes parseMarkdownWithFrontmatter)
│       └── (existing modules retained)
├── index/                                # Grows from `export {};` stub to functional
│   └── src/
│       ├── fts5-adapter.ts               # NEW [P] — BM25 retriever with field weights (summary=5, tags=3, facet_topic=2, title=2, body_excerpt=1)
│       ├── vec-adapter.ts                # NEW [P] — dense retriever via sqlite-vec vec_distance_cosine
│       ├── graph-adapter.ts              # NEW [P] — graph retriever via edges JOIN
│       ├── confidence-adapter.ts         # NEW [P] — per-doc confidence weight + recency adjustment lookup
│       ├── fusion.ts                     # NEW — RRF k=60 + confidence multipliers applied AFTER fusion
│       ├── search.ts                     # NEW — orchestrator; runs four retrievers in parallel; fuses; validates output
│       ├── edges-builder.ts              # NEW — Jaccard threshold + cosine threshold + explicit-related (consumed by edges-build sub-stage)
│       └── index.ts                      # Exports
├── inference/                            # Extends with embedding adapter
│   └── src/
│       ├── ollama-adapter.ts             # SP-004 — unchanged
│       ├── vocabulary.ts                 # SP-004 — unchanged
│       ├── prompt.ts                     # SP-004 — unchanged
│       ├── validate.ts                   # SP-004 — unchanged
│       ├── embedding-adapter.ts          # NEW — undici POST to /api/embeddings with AbortSignal; dimension validation; ECONNREFUSED → EmbeddingUnavailableError (PREREQ-007)
│       └── index.ts                      # Exports
├── pipeline/                             # Extends with SP-005 sub-stages
│   └── src/
│       ├── classify-stage.ts             # SP-004 — unchanged
│       ├── classify-circuit-breaker.ts   # SP-004 — unchanged
│       ├── embed-stage.ts                # NEW — runs after classify-stage commits; posts (title+summary+facet_topic+tags+body_excerpt) to embedding adapter
│       ├── index-stage.ts                # NEW — runs after embed-stage; INSERTs documents_fts + documents_vec rows (consumed by orchestrator's transaction)
│       ├── edges-build-stage.ts          # NEW — runs after index-stage; computes + INSERTs edges rows
│       ├── retrieval-orchestrator.ts     # NEW — wraps the post-classify hook chain: embed → index → edges-build in single transaction
│       ├── policies.ts                   # SP-003/SP-004 — extended with SP-005 fields (PREREQ-004)
│       └── (existing modules retained)
├── storage/                              # Extends with SP-005 schema migration + index-persister
│   └── src/
│       ├── document-adapter.ts           # SP-002/SP-003/SP-004 — unchanged
│       ├── taxonomy-terms-adapter.ts     # SP-004 — unchanged
│       ├── classify-persister.ts         # SP-004 — extended to NOT commit until SP-005 orchestrator commits; transaction lifetime moved to orchestrator
│       ├── index-persister.ts            # NEW — persistIndex({docId, ftsFields, vector, edges, signal}); within caller-opened transaction (PREREQ-006)
│       ├── sp005-migration.ts            # NEW — runSp005Migration(db); idempotent CREATE VIRTUAL/TABLE IF NOT EXISTS for documents_fts + documents_vec + edges (PREREQ-005)
│       └── (existing modules retained)
├── daemon/                               # SP-003/SP-004 functional entry — SP-005 extends post-classify hook chain
│   └── src/
│       └── index.ts                      # SP-003/SP-004 — extended to invoke embed-stage → index-stage → edges-build-stage after each classify (FR-RETRIEVAL-006)
├── transport/                            # SP-001..SP-002 — corpus-find-tool.ts REPLACED with real handler
│   └── src/
│       ├── corpus-find-tool.ts           # REPLACED — delegates to packages/index/src/search.ts; preserves SP-001 tool registration + input/output schema surface (PREREQ-009)
│       └── (existing modules retained)
└── cli/                                  # SP-001..SP-004 — extended with `corpus reindex`
    └── src/
        ├── reindex-command.ts            # NEW — `corpus reindex [--dry-run]` command; acquires drain-lock; iterates classified-but-unindexed rows; emits progress under interactivePolicy
        └── (existing CLI commands retained)

tests/
├── unit/
│   ├── search-input-schema.test.ts       # NEW — SearchInput Zod parse + reject + bounds
│   ├── search-hit-schema.test.ts         # NEW — SearchHit Zod parse + reject
│   ├── error-envelope-schema.test.ts     # NEW — SearchErrorEnvelope Zod
│   ├── sp005-migration.test.ts           # NEW — idempotent migration
│   ├── embedding-adapter.test.ts         # NEW [P] — undici POST + dimension validation + ECONNREFUSED
│   ├── fts5-adapter.test.ts              # NEW [P] — field-weighted BM25
│   ├── vec-adapter.test.ts               # NEW [P] — cosine top-K
│   ├── graph-adapter.test.ts             # NEW [P] — edges JOIN traversal
│   ├── confidence-adapter.test.ts        # NEW [P] — weight + recency
│   ├── fusion.test.ts                    # NEW — RRF k=60 correctness
│   ├── edges-builder.test.ts             # NEW — Jaccard + cosine thresholds
│   ├── index-persister.test.ts           # NEW — three-row INSERT atomicity within caller-opened transaction
│   ├── search-orchestrator.test.ts       # NEW — four retrievers in parallel + fusion + degraded-signals annotation
│   └── (SP-001..SP-004 unit tests retained)
├── integration/
│   ├── end-to-end-retrieval.test.ts      # NEW — full SP-003 → SP-004 → SP-005 against live local Ollama + nomic-embed-text
│   ├── reindex-cli.test.ts               # NEW — backfill + summary + dry-run + SIGTERM + lock contention
│   ├── retrieval-atomicity.test.ts       # NEW — mid-transaction failure rolls back all four sub-stages
│   ├── retrieval-degraded-signals.test.ts # NEW — every signal-failure path produces degraded (not transport-error) response
│   ├── retrieval-concurrency.test.ts     # NEW — drain-lock contention across drain + reenrich + reindex
│   ├── retrieval-idempotency.test.ts     # NEW — re-running reindex on indexed corpus is 0-call no-op
│   ├── retrieval-filter-pushdown.test.ts # NEW — filter facets narrow before fusion
│   └── (SP-001..SP-004 integration tests retained)
└── fixtures/
    └── sp005-retrieval/                  # NEW — fixture inputs for SP-005 integration tests
        ├── seeded-classified-corpus.sql  # 20 classified docs across mixed facet_types + tags for fusion fixtures
        ├── mock-embedding-response.json  # 768-dim vector for the deterministic-test case
        ├── mock-embedding-bad-dim.json   # Wrong-dimension response for the failure-injection case
        ├── disable-signal-fixture.ts     # Per-signal test-harness override (toggle one retriever off)
        └── README.md                     # Fixture provenance
```

**Structure Decision**: TypeScript monorepo with npm workspaces (inherited). SP-005 grows one previously-stub package (`packages/index/`), extends four (`packages/pipeline/`, `packages/storage/`, `packages/contracts/`, `packages/inference/`), replaces one tool handler body (`packages/transport/src/corpus-find-tool.ts`), and adds one CLI subcommand + one daemon hook extension. Zero new packages. Strict dependency direction from SP-001 preserved: `packages/contracts/` imports nothing; `packages/storage/` imports `packages/contracts/`; `packages/inference/` imports `packages/contracts/`; `packages/index/` imports `packages/contracts/` + `packages/storage/` + `packages/inference/`; `packages/pipeline/` imports `packages/contracts/` + `packages/storage/` + `packages/inference/` + `packages/index/`; `packages/transport/` imports `packages/contracts/` + `packages/index/`; `packages/daemon/` imports `packages/pipeline/`; `packages/cli/` imports `packages/pipeline/`.

## Phase Breakdown (driver for `/speckit-tasks`)

This section maps spec requirements to implementation phases. Because SP-005 is at/over the build-tier sizing threshold, the implementation is pre-planned as TWO Engineer-agent invocations (Phase A + Phase B), each with its own Phase Gate.

| Phase | Name | Spec coverage | Output |
|---|---|---|---|
| 0 | Prerequisites | PREREQ-001..PREREQ-009 | TDD contract-test/impl pairs for: SearchInput/Hit/ErrorEnvelope schemas, SP-005 telemetry event class registration, SP-005 typed errors, policy-record SP-005 fields, sp005-migration helper, index-persister adapter, embedding-adapter HTTP client, verification that packages/index/src/index.ts is still the stub, verification that packages/transport/src/corpus-find-tool.ts is the SP-001 placeholder. |
| 1 | Setup | — | Pull nomic-embed-text on pai-node01 if not present (`ollama pull nomic-embed-text`); scaffold the fixture directory `tests/fixtures/sp005-retrieval/`; verify sqlite-vec namespace import works (`import * as sqliteVec from 'sqlite-vec'`); lint config update to scope new files. |
| 2A | Phase A — Atomicity foundation (RED phase) | FR-RETRIEVAL-005..009, FR-RETRIEVAL-019, FR-RETRIEVAL-006..008 | Author RED tests for: sp005-migration idempotency, embedding-adapter HTTP + AbortSignal + dimension, index-persister atomicity within caller-opened transaction, edges-builder thresholds. Tests fail (no impl yet). |
| 3A | Phase A — GREEN phase | (same FRs) | Implement sp005-migration, embedding-adapter, index-persister, edges-builder, embed-stage, index-stage, edges-build-stage, retrieval-orchestrator (the post-classify hook chain wrapper). Extend SP-004 classify-persister to coordinate with the orchestrator's transaction. RED tests turn green per-module. **Phase A Gate: every RED test green; live-Ollama embedding integration test passes; classify-stage tests still pass (no regression)**. |
| 2B | Phase B — Retrievers + fusion + tool wiring (RED phase) | FR-RETRIEVAL-001..004, FR-RETRIEVAL-010..023 | Author RED tests for: SearchInput/Hit/ErrorEnvelope schemas, fts5-adapter, vec-adapter, graph-adapter, confidence-adapter, fusion (RRF k=60), search-orchestrator (four retrievers in parallel + degraded-signals), corpus.find tool wiring, reindex CLI, end-to-end retrieval, filter pushdown, signal-failure degradation, idempotency, concurrency. Tests fail. |
| 3B | Phase B — GREEN phase | (same FRs) | Implement the four retriever adapters, the fusion module, the search orchestrator, replace the SP-001 corpus-find-tool.ts handler body, implement reindex-command.ts. RED tests turn green per-module. **Phase B Gate: every RED test green; live-Ollama end-to-end retrieval test passes; signal-disable test asserts top-K materially differs across runs**. |
| 4 | Integration | FR-RETRIEVAL-011, FR-RETRIEVAL-013, FR-RETRIEVAL-018 | Wire daemon's post-classify hook chain to embed → index → edges-build; build the `corpus reindex` CLI command with progress emission + dry-run + lock-contention exit-0; end-to-end live-Ollama integration test passes; degraded-signals integration test passes (every degradation path); drain-lock concurrency test passes; SIGTERM-abort test passes. |
| 5 | Polish | Cross-cutting Constitution Check re-evaluation + quickstart validation | (a) Re-evaluate Constitution Check — confirm all 16 remain [x]; (b) SC-RETRIEVAL-016..019 lints assert; (c) per-document four-sub-stage budget number empirically measured + recorded in plan.md "Performance Goals" footnote; (d) `corpus.find` p95 latency on the user's pai-node01 measured against a 1000-doc indexed corpus + recorded honestly (target sub-100ms; aspirational §10.6 sub-20ms); (e) quickstart.md walked end-to-end against actual SP-005 behavior; (f) final feature-completion commit. |

**Phase sequencing rationale**: Phase 0 is hard-gated — none of SP-005 source compiles until the telemetry event classes are registered in the Zod union AND the search-schemas module exists AND the policies records have the SP-005 fields. Phase 1 is dependency + scaffolding; can run in parallel with Phase 0's test-authoring. Phase 2A / 3A delivers the atomicity foundation (Constitution VIII — the load-bearing constitutional surface for SP-005). Phase 2B / 3B builds the four retrievers + fusion + tool wiring on top. Phase 4 wires daemon + CLI + end-to-end paths. Phase 5 closes the constitutional re-check + validates the operator walkthrough.

**Test strategy summary**: RED-phase tests written for every FR-RETRIEVAL and SC-RETRIEVAL in Phases 2A + 2B BEFORE any implementation. GREEN-phase implementation in 3A + 3B turns them green per-module. End-to-end integration in Phase 4 verifies the cross-module wiring against a live local Ollama + nomic-embed-text. Per Constitution XVI: SC-RETRIEVAL-001 / SC-RETRIEVAL-002 / SC-RETRIEVAL-006 / SC-RETRIEVAL-008 verify LIVE against the primary user's machine with Ollama loaded; SC-RETRIEVAL-003 / SC-RETRIEVAL-004 / SC-RETRIEVAL-011 / SC-RETRIEVAL-013 are fixture-driven (signal-disable harness, mock-embedding failure injection); SC-RETRIEVAL-016 / SC-RETRIEVAL-017 / SC-RETRIEVAL-018 / SC-RETRIEVAL-019 are lint-grep assertions over the test surface. The honest partition is documented in `quickstart.md`.

## Dependencies on SP-001 + SP-002 + SP-003 + SP-004

Exhaustive list of imported types/exports/contracts SP-005 inherits:

**From `@llm-corpus/contracts`** (`packages/contracts/src/`):
- `Paths.indexDb()`, `Paths.failed()`, `Paths.telemetry()`, `Paths.drainLock()`, `Paths.cache()` — all existing.
- `Result<T, E>` type and constructors — return type of every storage / pipeline / inference / index adapter function.
- `TelemetryEvent` discriminated union — extended additively with SP-005 event classes (PREREQ-002).
- `emitTelemetry`, `emitTelemetrySync`, `TELEMETRY_MAX_BYTES = 4096` — existing helpers SP-005 consumes.
- `parseMarkdownWithFrontmatter` — SP-002 codec helper; SP-005 consumes at index-stage to extract `summary` and `facet_topic` from body files.
- `FACET_TYPE_VALUES` — SP-004 constitutional enum imported by `search-schemas.ts` for `SearchHitZodSchema.facet_type` and by `confidence-adapter.ts` for the weight-map keys.
- `withTempDir` — atomic-write tmp-dir helper. SP-005 doesn't directly write body files (the classifier does), but the orchestrator uses `withTempDir` indirectly via SP-004's classify-persister.

**From `@llm-corpus/storage`** (`packages/storage/src/`):
- `openIndexReadWrite()` — SP-003's write-side opener. SP-005 reuses; the opener now ALSO calls `sqliteVec.load(db)` at connection-open time (added in PREREQ-005 migration setup).
- `runSchemaMigration(db)` — extended additively to invoke `runSp005Migration(db)`.
- `DOCUMENTS_COLUMN_LIST`, `TAXONOMY_TERMS_COLUMN_LIST` — existing constants; SP-005 doesn't extend them.
- `fetchDocument(docId, signal)` — SP-002's read-side document adapter. SP-005 may consume to fetch the doc for body_excerpt extraction.
- `updateClassification(...)` — SP-004's write-side adapter. SP-005's orchestrator opens the transaction; SP-004's adapter executes within it.
- `insertProposedTerm(...)` — SP-004's write-side adapter. SP-005's orchestrator opens the transaction; SP-004's adapter executes within it.

**From `@llm-corpus/inference`** (`packages/inference/src/`):
- `OllamaAdapter` (SP-004) — unchanged; SP-005 doesn't re-use the chat adapter, only adds a sibling embedding adapter.

**From `@llm-corpus/pipeline`** (`packages/pipeline/src/`):
- `interactivePolicy`, `batchPolicy`, `Policy` type — SP-003/SP-004's named-policy records. SP-005 extends with retrieval-stage fields (PREREQ-004).
- The drain-lock acquisition pattern from `drain-lock.ts` — SP-005 reuses `Paths.drainLock()` flock semantics (no new lock).
- `withDrainLock(signal, fn)` helper — SP-005's reindex command acquires the lock or observes contention via this helper.
- `classifyStage` — SP-004's classify-stage function. SP-005's `retrieval-orchestrator.ts` wraps it: orchestrator opens transaction → classifyStage internals (UPDATE + INSERTs) → SP-005 sub-stages (embed → index → edges-build) → COMMIT → SP-004 post-COMMIT body-file rename.

**From `@llm-corpus/daemon`** (`packages/daemon/src/`):
- The daemon's master `AbortController` and SIGTERM handler — SP-005's sub-stages inherit the signal.
- The post-classify hook surface — SP-005 extends `packages/daemon/src/index.ts` to invoke embed → index → edges-build after each successful classify.

**From SP-001 transport** (`packages/transport/src/`):
- The `corpus-find-tool` registration (tool name + input/output schema surface area). SP-005 REPLACES the handler body while preserving registration.
- Egress hook (transitively bootstrapped via `egress-hook-bootstrap.ts`) — SP-005's embedding HTTP POST goes through the hook (localhost-allowlisted).

**Explicit non-dependencies** (what SP-005 does NOT depend on):
- SP-006 (kill-9 survival + `corpus://failures` MCP resource + tier 1/2/3 fallthrough) — NOT required. SP-005 ships single-transaction atomicity for the embed → index → edges-build chain; SP-006 adds the kill-9 cross-stage survival, the MCP resource surface, AND the tier-fallthrough state machine.
- SP-007+ — NOT required.

## Decisions resolved in this plan

(Full rationale + alternatives in `research.md`. Summary here.)

- **Decision A — Embedding model choice**: `nomic-embed-text` primary (768-dim, ~274 MB on disk). Switchable via `config.toml [embedding].model`. Codified in `contracts/adr-embedding-model.md`.
- **Decision B — Vector storage**: sqlite-vec v0.1.x via `vec0` virtual table with cosine distance (`vec_distance_cosine`). Loaded via namespace import (`import * as sqliteVec from 'sqlite-vec'`) on each Database connection at open time.
- **Decision C — BM25 / FTS5 field weights**: `summary=5, tags=3, facet_topic=2, title=2, body_excerpt=1` per ARCHITECTURE-FINAL §10.1 verbatim.
- **Decision D — Embedding transport**: HTTP POST to `http://localhost:11434/api/embeddings` (Ollama's legacy single-prompt embedding endpoint) via `undici`. AbortSignal-compatible by construction; routes through SP-001 egress hook.
- **Decision E — Edge thresholds + materialization timing**: tag_overlap when Jaccard ≥ 0.3 (configurable); summary_similarity when cosine ≥ 0.7 (configurable); explicit_related unconditional from frontmatter array. Triggered AFTER classify + embed sub-stages commit, inside the same drain-lock window. O(N) per new doc; O(N²) cumulative; acceptable for N ≤ 10k.
- **Decision F — Schema migration shape**: `CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(doc_id UNINDEXED, title, summary, tags, facet_topic, body_excerpt, tokenize='porter unicode61')` + `CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(doc_id TEXT PRIMARY KEY, embedding float[768])` + `CREATE TABLE IF NOT EXISTS edges (src_id, dst_id, kind, weight, PRIMARY KEY (src_id, dst_id, kind), FOREIGN KEY (src_id) REFERENCES documents(id), FOREIGN KEY (dst_id) REFERENCES documents(id))` + indices. The `IF NOT EXISTS` clauses are idempotent on modern SQLite (verified in research.md).
- **Decision G — Confidence weights**: §10.5 defaults verbatim; overridable via `config.toml [confidence_weights]`. Applied AFTER RRF fusion as multiplicative post-adjustment.
- **Decision H — Tier-fallthrough scope**: Tier 0 (hybrid) only in SP-005; Tier 1/2/3 deferred to SP-006 per ARCHITECTURE-FINAL §10.6.
- **Decision I — Reindex CLI + drain-lock reuse**: `corpus reindex` reuses `Paths.drainLock()`; concurrent invocations emit `pipeline.lock_contention`.
- **Decision J — Per-doc latency budget**: 30s interactive / 120s batch (per Decision L below; codified in PREREQ-004).
- **Decision K — Telemetry classes**: ≥ 12 SP-005 event classes per FR-RETRIEVAL-013 (embed.started/completed/failed, index.started/completed/failed, edges.started/completed/failed, search.started/query/completed/degraded/error).
- **Decision L — Per-call timeouts**: 10s embedding HTTP (interactive) / 30s (batch); 5s per retriever SQL (interactive) / 10s (batch); 30s whole `corpus.find` (interactive) / 60s (batch); 64 top-K per retriever.
- **Decision M — Embedding caching**: NO separate embedding cache. Embeddings stored in `documents_vec` only. Rerun on schema-version bump (recency-penalty applied via confidence weights). Model swap requires manual `DELETE FROM documents_vec` + `corpus reindex`.
- **Decision N — Error envelope shape**: MCP-tool-response-shaped (`{error_code, message, hint}`) returned as a SUCCESSFUL MCP tool response, NOT a transport error (FR-004 verbatim).

## Risk Register

Anything that could surprise downstream `/speckit-tasks` or `/speckit-implement`:

- **R1 — sqlite-vec version compatibility**: sqlite-vec v0.1.x is still pre-1.0; API stability not guaranteed. Mitigation: the v1 native-addon allowlist pins the version; any upgrade requires an explicit allowlist promotion + ADR. Verified loadable via namespace import on pai-node01 2026-05-13.
- **R2 — Ollama `/api/embeddings` vs `/api/embed` endpoint divergence**: Ollama has two embedding endpoints — the legacy single-prompt `/api/embeddings` (POST `{model, prompt}` → `{embedding}`) and the newer batch `/api/embed` (POST `{model, input: string | string[]}` → `{embeddings}`). SP-005 uses the legacy endpoint for v1 (one prompt per call). Mitigation: the embedding adapter records the endpoint name in telemetry; future v2 ADR may switch to batch endpoint if benchmark demands.
- **R3 — `nomic-embed-text` dimension fingerprinting**: Embeddings are stored without a model-name fingerprint. Switching models (e.g., to `mxbai-embed-large` 1024-dim) without `corpus reindex` would produce dimension mismatches at INSERT time (caught by Zod validation) but ranking against pre-existing 768-dim entries would be silently wrong if the dimension happens to match. Mitigation: the `documents_vec` `float[768]` declaration is hardcoded; any dimension change requires schema-version bump + manual reindex. Documented in quickstart.md troubleshooting.
- **R4 — FTS5 unicode tokenizer behavior on multibyte content**: FTS5's `porter unicode61` tokenizer is well-tested but has documented quirks with CJK / RTL languages. The user's corpus is primarily English; mitigation deferred — future ADR if non-English content becomes significant.
- **R5 — Edges-build wall-clock at scale**: O(N) per new doc means O(N²) cumulative. For N=10k, that's 100M tag-Jaccard computations + 100M cosine computations on materialization completion. Mitigation: per-doc edges-build has a 15s interactive / 60s batch timeout (Decision L); thresholds are configurable so the user can tighten them; future sprint introduces HNSW/LSH if N approaches the bound.
- **R6 — Atomic transaction lifetime across SP-004 + SP-005 sub-stages**: The transaction wraps classify UPDATE + classify INSERTs + index INSERTs + edges INSERTs. The wall-clock for this transaction is the sum of all sub-stages' SQL work (typically < 200 ms). Mitigation: the body-file frontmatter rewrite is AFTER COMMIT per SP-004 ADR-CLASSIFIER-ATOMICITY; the embedding HTTP call is BEFORE BEGIN (the embedding is computed first, then the transaction opens for the SQL writes). The transaction wall-clock window is the SQL writes only.
- **R7 — RRF fusion correctness with empty retriever results**: An empty list from one retriever contributes nothing to the RRF sum. Per RRF formula `score(doc) = sum over r of 1/(k + rank_r(doc))`, a document that appears in only one retriever's top-K still gets a non-zero score from that retriever. Mitigation: unit test `tests/unit/fusion.test.ts` covers all retriever-result combinations (none-empty, one-empty, two-empty, three-empty, four-empty).
- **R8 — `corpus.find` p95 latency at scale**: §10.6 targets sub-20 ms for Tier 0; SP-005 honest commitment is sub-100 ms p95 for typical corpora. Mitigation: empirical measurement at Phase 5 against a 1000-doc fixture corpus on pai-node01; if numbers fall significantly short, the per-retriever top-K (64) can be tightened, or a future sprint introduces an HNSW-style approximate-nearest-neighbor index.
- **R9 — Concurrent search vs drain race for SQLite WAL**: SQLite WAL allows concurrent readers + one writer. `corpus.find` (read-only) runs without the drain-lock; drain operations hold the drain-lock + the SQLite WAL writer lock. The two are independent. Mitigation: `corpus.find` queries are SELECT-only and don't touch the drain-lock; WAL's snapshot-isolation guarantees readers see a consistent view of the database even during writer activity.
- **R10 — Test-harness for the signal-disable scenario (SC-RETRIEVAL-003)**: Toggling one retriever off requires a test-side override. Mitigation: the search-orchestrator accepts an optional `disabledSignals: Set<'bm25'|'dense'|'graph'|'confidence'>` parameter (production code never sets it); the test harness sets it for the signal-disable assertion; the unit test verifies the override path is dead code in production builds.

---

> **T0 measurement footnote (TBD post-implementation, pai-node01)**: Empirical per-document four-sub-stage wall-clock will be measured by `tests/integration/end-to-end-retrieval.test.ts` against a fixture set of 10 mixed-MIME documents. p95 and mean wall-clock recorded here at Phase 5 completion. The `corpus.find` p95 latency on a 1000-doc indexed corpus will also be measured and recorded; the §10.6 sub-20 ms aspirational target and the SP-005 honest sub-100 ms commitment are both reported.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*Empty — all 16 principles pass without justification. Phase 0 prerequisites are forward-compatibility plumbing, not principle drift. The two-phase build (Phase A + Phase B) is a sizing decision per `feedback-build-tier-sizing-rule`, not a principle violation — both phases obey the same 16 constitutional principles.*
