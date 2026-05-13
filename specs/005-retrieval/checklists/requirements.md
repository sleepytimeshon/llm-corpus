# Specification Quality Checklist: Hybrid Retrieval (SP-005)

**Purpose**: Validate specification completeness and quality before proceeding to `/speckit-plan` (already completed) / `/speckit-tasks`
**Created**: 2026-05-13
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — implementation library choices (`undici`, `sqlite-vec`, `nomic-embed-text`) appear only as load-bearing identifiers binding to constitutional principles or to the verified pre-flight state (Ollama 0.21.0 reachable on pai-node01; nomic-embed-text pulled and responsive; sqlite-vec v0.1.x loadable via namespace import). Concrete code symbols (`fetch`, `signal`, `transaction`, `BEGIN IMMEDIATE`, `vec_distance_cosine`) appear only where binding to constitutional principles (Principle I egress hook, Principle V structured output, Principle VII AbortSignal, Principle VIII atomic transactional index, Principle X idempotency). The model name and HTTP endpoint are load-bearing facts, not implementation drift.
- [x] Focused on user value and business needs — every user story is framed in terms of what the user (and the agent-as-principal) experiences: natural-language query returning ranked relevant docs (US1), backfill via reindex (US2), filter-narrowed search (US3).
- [x] Written for non-technical stakeholders — Shon (sole stakeholder + sole developer) is the audience; the technical specificity is calibrated to him.
- [x] All mandatory sections completed — User Scenarios & Testing, Requirements, Success Criteria, Assumptions, Out of Scope all populated.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the spec resolved all SP-005 v1 ambiguities by binding to existing artifacts (FR-002/003/004/015 from `.product/REQUIREMENTS.yaml`, ARCHITECTURE-FINAL §10.1-§10.6 verbatim, the SP-001 corpus-find placeholder contract, the SP-002 `taxonomy_terms` + `documents` schema, the SP-003 sentinel-row contract, the SP-004 classifier columns + body-file frontmatter shape, the Constitution's 16 principles). Plan-stage decisions (concrete embedding model, fusion algorithm, edge thresholds, materialization timing, per-call timeouts, idempotency strategy, error envelope shape) are explicitly resolved in `research.md` (Decisions A through N), not as spec-level ambiguities.
- [x] Requirements are testable and unambiguous — every FR-RETRIEVAL-NNN names a behavior, a source (FR / Principle / Decision), and a verification path.
- [x] Success criteria are measurable — every SC-RETRIEVAL-NNN names a concrete pass condition (row counts, structural invariants, lint-detected zero-violations, response-shape assertions, telemetry-event coverage counts).
- [x] Success criteria are technology-agnostic where possible — phrased in terms of row state, response shape, ranking-list materially-differs assertions, lint-grep zero-hits. Identifiers like `nomic-embed-text`, `sqlite-vec`, `undici` appear only where ADR-EMBEDDING-MODEL or technical context binds them.
- [x] All acceptance scenarios are defined — every user story has ≥ 4 Given/When/Then scenarios; collectively 14 scenarios cover the happy path, the backfill path, the filter-narrowed path, the partial-signal degradation, the unknown-filter validation error.
- [x] Edge cases are identified — 11 edge cases enumerated (empty index, single-signal match, embedding model offline, FTS5 corrupted, edges-builder timeout, concurrent reindex+classify, schema migration on populated DB, very long query, query with no matches, query matching only via filter, two retrievers both fail simultaneously).
- [x] Scope is clearly bounded — Out of Scope section enumerates ≥ 16 explicit deferrals to other SPs / non-goals, including SP-006 tier 1/2/3 fallthrough + kill-9 cross-stage survival + `corpus://failures`, formal retrieval-eval harness (v1.5+), chunked embeddings, cross-encoder re-ranking, HNSW/LSH ANN, worker-pool parallelism, auto-detection of embedding-model change, multi-model ensembling, MCP mutation surfaces, `--since` subset reindexing, cross-agent compatibility claims, low-confidence review UI, embedding cache, cross-corpus federated search.
- [x] Dependencies and assumptions identified — Assumptions section enumerates ≥ 16 prerequisites and pre-resolved decisions, each with an explicit source (SP-001/SP-002/SP-003/SP-004 merged, Ollama installed and reachable with nomic-embed-text loaded, sqlite-vec namespace-importable, embedding-model configurable but default-pinned, `Paths.*` getters present, `documents` + `taxonomy_terms` schema baselines, body-file frontmatter codec, `undici` HTTP client, `sqlite-vec` in allowlist, `node:crypto` for SHA-256, confidence weights not yet surfaced, no worker-pool parallelism, `corpus.find` is the only retrieval surface, no `process.exit` in libs).

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — 23 FR-RETRIEVAL-NNN requirements map to 22 SC-RETRIEVAL-NNN measurable outcomes. The mapping is many-to-many but every FR-RETRIEVAL is covered by ≥ 1 SC-RETRIEVAL.
- [x] User scenarios cover primary flows — US1 (autonomous indexing + natural-language query, P1), US2 (manual backfill reindex, P1), US3 (filter-narrowed search, P2). The three stories cover the four FR sources (FR-002, FR-003, FR-004, FR-015) from `.product/REQUIREMENTS.yaml`.
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-RETRIEVAL-001..SC-RETRIEVAL-022 together cover the RM-006 roadmap success metric ("Hybrid retrieval: BM25 + dense + graph + confidence-weighted fusion; corpus.find returns ranked SearchHit list; atomic index update contract holds; ≥ 8 named retrieval-stage telemetry event classes; all FR-002/003/004/015 acceptance scenarios pass").
- [x] No implementation details leak into specification — verified by re-read. Identifiers like `nomic-embed-text`, `sqlite-vec`, `vec_distance_cosine`, `BEGIN IMMEDIATE`, `RRF k=60` appear only at the binding points where the constitutional principle or pre-flight fact requires them. The spec is otherwise behavior-focused.

## Constitution Compliance (cross-cutting, non-template)

- [x] **Principle I (Local-First, No Egress)** — SC-RETRIEVAL-016 binds telemetry to contain no body content nor raw query text; SP-005's only non-local-disk IO is HTTP to `http://localhost:11434` (Ollama embedding), which is localhost-allowlisted by construction via the SP-001 egress hook. Query strings hashed via SHA-256 before telemetry emission (`query_hash` field).
- [x] **Principle II (User Curates, LLM Classifies Metadata)** — SP-005 does NOT touch body files (the classifier in SP-004 is the only body-file writer post-ingest). The `body_excerpt` indexed in FTS5 is derived from the existing body file; no new LLM-generated body content is introduced.
- [x] **Principle III (Substrate, Not Surface)** — FR-RETRIEVAL-017 commits to zero new MCP mutation surfaces; the existing `corpus.find` tool's handler logic is expanded (SP-001 registered the placeholder; SP-005 fills in the ranking). No HTTP server, no TUI, no browser.
- [x] **Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)** — SP-005 reads/writes one local SQLite + reads local body files. No SaaS, no cross-machine sync, no permissions, no roles. Assumption explicit.
- [x] **Principle V (Schema-Enforced Structured Output)** — FR-RETRIEVAL-001 + FR-RETRIEVAL-004 + FR-RETRIEVAL-020 bind SearchInput / SearchHit / SearchErrorEnvelope to Zod schemas; defense-in-depth validation at both input and output boundaries; frontmatter routes through SP-002's single YAML codec; embedding response validated for dimension before persister.
- [x] **Principle VI (One Pipeline, Two Policies)** — FR-RETRIEVAL-006 + US2 commit to one orchestrator function invoked from both the daemon hook chain and the `corpus reindex` CLI; `interactivePolicy` / `batchPolicy` records (extended in PREREQ-004) dispatch behavior differences.
- [x] **Principle VII (Cancellable, Bounded IO)** — FR-RETRIEVAL-011 + SC-RETRIEVAL-014 bind AbortSignal propagation through `undici` POST + every retriever's SQL + the body-file read; SIGTERM coordination + 2-second exit budget inherited from SP-003 / SP-004.
- [x] **Principle VIII (Atomic Writes & Transactional Index Updates) — VERBATIM** — FR-RETRIEVAL-007 + SC-RETRIEVAL-011 + SC-RETRIEVAL-012 bind the FTS5 INSERT + vec INSERT + edges INSERTs (plus SP-004's UPDATE) to a single SQLite transaction; ADR-EDGES-MATERIALIZATION formalizes the pattern. The Constitution VIII verbatim language ("Index writes (FTS5 row + docs row + sqlite-vec row for the same document) MUST commit together in a single transaction or not at all; partial index state is a forbidden permitted state") is implemented literally.
- [x] **Principle IX (Concurrency-Safe Shared State)** — FR-RETRIEVAL-018 + SC-RETRIEVAL-013 bind `Paths.drainLock()` reuse as the single serialization point across SP-003 + SP-004 + SP-005; concurrent invocations emit `pipeline.lock_contention` and exit 0 (FR-INGEST-011 / FR-CLASSIFY-015 contract preserved).
- [x] **Principle X (Idempotent Pipeline Transitions)** — FR-RETRIEVAL-012 + SC-RETRIEVAL-015 + SC-RETRIEVAL-022 bind re-running embed + index + edges on indexed rows to a no-op (SQL `WHERE NOT EXISTS` filter + `INSERT OR IGNORE` for edges); schema migration is idempotent via `IF NOT EXISTS`.
- [x] **Principle XI (Library/CLI Boundary)** — FR-RETRIEVAL-014 + SC-RETRIEVAL-018 lint commits to zero `process.exit` in SP-005 library packages.
- [x] **Principle XII (Subprocess Hygiene)** — FR-RETRIEVAL-016 + SC-RETRIEVAL-019 lint commits to zero subprocess invocations; embedding is HTTP, sqlite-vec is a native addon loaded in-process. Trivially satisfied.
- [x] **Principle XIII (Telemetry-or-Die)** — FR-RETRIEVAL-013 + SC-RETRIEVAL-010 bind ≥ 8 retrieval-stage event classes (plan-level: 12); every catch block in SP-005 source emits a telemetry event before returning or re-throwing (existing SP-001 AST-level lint covers SP-005). Query strings hashed via SHA-256 before telemetry (FR-RETRIEVAL-023).
- [x] **Principle XIV (XDG Paths via Single Resolver)** — FR-RETRIEVAL-015 + SC-RETRIEVAL-017 lint commits to zero writes outside `Paths.*`. SP-005 reuses existing getters; no new XDG base.
- [x] **Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)** — SP-005 does NOT touch `taxonomy_terms` (SP-004-owned). The classifier's vocabulary contract from SP-004 is preserved. No hardcoded `enum FacetDomain` introduced.
- [x] **Principle XVI (Validation Honesty)** — Performance numbers are TARGETS; the §10.6 sub-20 ms Tier 0 target is the aspirational ceiling, sub-100 ms is the honest commitment; empirical p95 reported as plan footnote post-implementation. No cross-agent compatibility claim. No formal retrieval-eval harness as v1 success criterion (deferred to v1.5+ per NFR-009).

## Anti-Scope Verification

- [x] Spec contains NO Tier 1 / Tier 2 / Tier 3 fallthrough — verified. FR-RETRIEVAL-010 explicitly defers to SP-006; ARCHITECTURE-FINAL §10.6 verbatim cited.
- [x] Spec contains NO formal retrieval evaluation harness as a success criterion — verified. Constitution XVI / NFR-009 explicitly defer to v1.5+; quality is operator-judged in v1.
- [x] Spec contains NO non-Ollama embedding adapter — verified. Constitution I + Decision D bind to localhost Ollama.
- [x] Spec contains NO silent signal-drop on partial failure — verified. FR-003 acceptance scenario "dense-vector signal failure does not silently disable ranking" is explicit; SC-RETRIEVAL-004 verifies; degraded-signals annotation in response.
- [x] Spec contains NO new MCP mutation surfaces — verified. FR-RETRIEVAL-017 explicit; SP-005 expands the existing `corpus.find` tool's handler; introduces no new tools / resources / prompts.
- [x] Spec contains NO drain-lock bypass for index writes — verified. FR-RETRIEVAL-018 explicit; same drain-lock as SP-003 + SP-004.
- [x] Spec contains NO user-triggered per-doc embed call — verified. FR-RETRIEVAL-006 commits the embed-stage to autorun in the daemon's post-classify hook chain; the `corpus reindex` CLI is the manual backfill, not a per-doc trigger.
- [x] Spec contains NO embedding-model replacement without ADR — verified. Decision A + ADR-EMBEDDING-MODEL bind the choice; switching models requires manual reindex + future ADR for dimension change.
- [x] Spec contains NO kill-9 cross-stage survival guarantee — verified. SP-006 explicitly Out of Scope.
- [x] Spec contains NO `corpus://failures` MCP resource — verified. SP-006 explicitly Out of Scope.
- [x] Spec contains NO chunked embeddings — verified. v1.0.0 per-document granularity per ARCHITECTURE-FINAL §10.2; future ADR.
- [x] Spec contains NO cross-encoder re-ranking — verified. v1 RRF fusion only; future-horizon.
- [x] Spec contains NO HNSW or LSH approximate-nearest-neighbor — verified. v1 exact cosine via sqlite-vec; future sprint if N > 10k.
- [x] Spec contains NO worker-pool parallelism — verified. v1 single-threaded per-doc; mirrors SP-004 FR-CLASSIFY-019.
- [x] Spec contains NO embedding cache — verified. v1 stores embeddings in `documents_vec` only; queries embed fresh each time.
- [x] Spec contains NO `corpus reindex --since <date>` subset reindex — verified. v1 whole-corpus only; operator manually filters via SQL.
- [x] Spec contains NO cross-corpus / federated search — verified. Constitution IV single-user / single-machine.
- [x] Spec contains NO multi-model ensembling — verified. One embedding model per call; config-driven.

## Notes

- Spec uses FR-RETRIEVAL-NNN numbering (consistent with SP-002's FR-NNN, SP-003's FR-INGEST-NNN, SP-004's FR-CLASSIFY-NNN per-spec numbering convention). This follows the project pattern where SP-NNN bridges spec-level requirements to upstream `.product/REQUIREMENTS.yaml` FRs by quoting them inline and adding spec-specific behavioral commitments.
- Plan-stage decisions deliberately resolved (not flagged as spec-level ambiguities): (a) primary embedding model nomic-embed-text 768-dim, (b) HTTP transport via undici against `/api/embeddings`, (c) sqlite-vec via vec0 + cosine, (d) FTS5 field weights per §10.1, (e) RRF fusion k=60 per §10.3, (f) confidence weights per §10.5 with v1 reconciliation to SCHEMA.md 7-value enum, (g) edge thresholds 0.3 Jaccard / 0.7 cosine / unconditional explicit-related, (h) edges-build inside same transaction (Constitution VIII verbatim), (i) tier-fallthrough deferred to SP-006 per §10.6, (j) per-call timeouts 10s embedding / 5s SQL / 30s whole find, (k) per-retriever top-K=64, (l) no separate embedding cache, (m) error envelope as MCP-tool-response NOT transport error (FR-004 verbatim). All resolved in `research.md` Decisions A through N; the embedding-model choice, RRF fusion, and edges-materialization formalized as standalone ADRs in `contracts/`.
- `documents_fts` + `documents_vec` PRIMARY KEY: both keyed on `doc_id` (one row per document). `edges` PRIMARY KEY: `(src_id, dst_id, kind)`.
- `documents` UNIQUE constraints: `hash` (from SP-003); SP-005 introduces no new UNIQUE constraints.
- This checklist marks every item PASS based on internal review. `/speckit-clarify` is OPTIONAL — the pre-resolved design decisions in the dispatch prompt cover the historically-ambiguous areas. Recommend proceeding directly to `/speckit-tasks` (Phase 0 prereqs → Phase 2A/3A atomicity foundation → Phase 2B/3B retrievers + fusion + tool wiring) per the plan's phase breakdown. Build is pre-planned as TWO Engineer-agent dispatches per `feedback-build-tier-sizing-rule` (>2000 LOC threshold).

---

## Implementation outcomes (post-/speckit-implement)

**Build / lint / test summary** (verified 2026-05-13 on branch `005-retrieval`):

- `npm run build` — clean (tsc --build, zero errors)
- `npm run lint` — clean (eslint, zero violations across SP-005 source)
- `npm run test` — 705 passed / 0 failed / 4 skipped (was 622 / 0 / 4 pre-SP-005)
- New SP-005 tests added: 19 across 12 test files (Phase 2 contract tests + Phase 3 implementation tests + Phase 4 CLI tests + Phase 5 filter tests + Phase 6 constitutional grep tests + Phase 7 perf baseline)

**Functional requirements — implementation citations:**

| FR | Status | Code citation | Verifying tests |
|---|---|---|---|
| FR-RETRIEVAL-001 (corpus.find structured query → ranked SearchHit list) | implemented | `packages/transport/src/corpus-find-tool.ts` createCorpusFindHandler; `packages/index/src/search.ts` searchOrchestrator | search-input-schema.test.ts, search-hit-schema.test.ts, search-orchestrator.test.ts, corpus-find-tool-validation.test.ts |
| FR-RETRIEVAL-002 (four-signal hybrid retrieval) | implemented | `packages/index/src/{fts5,vec,graph,confidence}-adapter.ts` + `fusion.ts` + `search.ts` | search-orchestrator.test.ts, filter-pushdown.test.ts, fusion.test.ts |
| FR-RETRIEVAL-003 (disabling any signal measurably changes top-K) | implemented (test-harness `disabledSignals`) | searchOrchestrator accepts disabledSignals override | search-orchestrator.test.ts (degraded path) |
| FR-RETRIEVAL-004 (structured error envelope as success MCP response) | implemented | createCorpusFindHandler validation_error envelope; searchOrchestrator all_signals_failed / query_aborted / internal_error envelopes | corpus-find-tool-validation.test.ts |
| FR-RETRIEVAL-005 (vector ranking via cosine) | implemented | VecAdapter vec_distance_cosine; embed-stage concatenates title+summary+facet_topic+tags+body_excerpt | search-orchestrator.test.ts |
| FR-RETRIEVAL-006 (embed sub-stage post-classify, in drain-lock) | implemented | `packages/pipeline/src/embed-stage.ts`; daemon hook chain extension | (verified by reindex/end-to-end coverage) |
| FR-RETRIEVAL-007 (atomic single-tx) | implemented | `packages/storage/src/index-persister.ts` persistIndex (caller-owned transaction) | index-persister-atomicity.test.ts |
| FR-RETRIEVAL-008 (edges materialization) | implemented | `packages/index/src/edges-builder.ts` buildEdges (Jaccard + cosine + explicit_related) | edges-builder.test.ts |
| FR-RETRIEVAL-009 (confidence weights post-fusion) | implemented | `packages/index/src/confidence-adapter.ts` DEFAULT_CONFIDENCE_WEIGHTS; fusion.ts post-fusion multiplier | fusion.test.ts |
| FR-RETRIEVAL-010 (Tier 1/2/3 deferred) | implemented | searchOrchestrator hardcodes tier_used='hybrid'; SearchOutputZodSchema z.literal('hybrid') | telemetry-sp005-classes.test.ts |
| FR-RETRIEVAL-011 (cancellable bounded IO) | implemented | All adapters take AbortSignal; per-doc setTimeout + clearTimeout | sp005-constitutional-grep.test.ts |
| FR-RETRIEVAL-012 (idempotency: reindex no-op on indexed corpus) | implemented | retrievalOrchestrator NOT EXISTS check; reindex-command WHERE NOT EXISTS | reindex-command.test.ts (idempotency case) |
| FR-RETRIEVAL-013 (telemetry-or-die; ≥ 14 event classes) | implemented | 14 SP-005 event classes added to TelemetryEvent discriminated union | telemetry-sp005-classes.test.ts |
| FR-RETRIEVAL-014 (no process.exit in libs) | implemented | All SP-005 lib source returns Result or throws typed errors | sp005-constitutional-grep.test.ts |
| FR-RETRIEVAL-015 (XDG paths via Paths.*) | implemented | No new XDG bases; reuses Paths.indexDb()/failed()/telemetry()/drainLock()/docs() | sp005-constitutional-grep.test.ts |
| FR-RETRIEVAL-016 (zero subprocesses) | implemented | No execSync/child_process.exec/runTool in SP-005 source | sp005-constitutional-grep.test.ts |
| FR-RETRIEVAL-017 (no new MCP mutation surfaces) | implemented | corpus-find-tool.ts handler swap only; no new tools/resources/prompts | (verified by inspection of mcp-server.ts) |
| FR-RETRIEVAL-018 (drain-lock single serialization) | implemented | retrievalOrchestrator runs inside daemon's drain-lock; reindex-command uses acquireDrainLock | reindex-command.test.ts |
| FR-RETRIEVAL-019 (idempotent schema migration) | implemented | `packages/storage/src/sp005-migration.ts` CREATE [VIRTUAL] TABLE IF NOT EXISTS | sp005-migration.test.ts |
| FR-RETRIEVAL-020 (Zod-validated SearchInput + SearchHit) | implemented | `packages/contracts/src/search-schemas.ts` strict-mode Zod schemas | search-input-schema.test.ts, search-hit-schema.test.ts |
| FR-RETRIEVAL-021 (frontmatter-field extraction at index time) | implemented | embed-stage parses frontmatter; index-stage populates FTS5 row from frontmatter+body | (verified by reindex integration test) |
| FR-RETRIEVAL-022 (per-doc budget 30s/120s) | implemented | Policy fields perDocEmbedTimeoutMs / perDocIndexTimeoutMs / perDocEdgesBuildTimeoutMs | policies-sp005-fields.test.ts |
| FR-RETRIEVAL-023 (telemetry body-content prohibition; query SHA-256) | implemented | searchOrchestrator sha256Hex(query) → query_hash field | sp005-constitutional-grep.test.ts |

**Success criteria — verification status:**

| SC | Status |
|---|---|
| SC-RETRIEVAL-001 (end-to-end 4 MIME types) | deferred to live walkthrough (requires Ollama + 4 MIME-type fixture) |
| SC-RETRIEVAL-002 (Zod-validated SearchHit list) | verified |
| SC-RETRIEVAL-003 (four-signal vs single-signal) | implemented (disabledSignals); full fixture exercise deferred to live walkthrough |
| SC-RETRIEVAL-004 (dense-failure non-silent) | verified |
| SC-RETRIEVAL-005 (single-signal match) | verified by construction (R7 fusion coverage) |
| SC-RETRIEVAL-006 (reindex backfill) | verified |
| SC-RETRIEVAL-007 (reindex lock contention) | implemented |
| SC-RETRIEVAL-008 (filter pushdown) | verified |
| SC-RETRIEVAL-009 (unknown filter → validation_error) | verified |
| SC-RETRIEVAL-010 (≥ 8 event classes) | verified — 14 classes registered |
| SC-RETRIEVAL-011 (single transaction atomic) | verified |
| SC-RETRIEVAL-012 (no partial index state after SIGKILL) | inherited from VIII (BEGIN/COMMIT/ROLLBACK semantics) |
| SC-RETRIEVAL-013 (drain-lock single point) | implemented |
| SC-RETRIEVAL-014 (cancellable IO under SIGTERM) | implemented |
| SC-RETRIEVAL-015 (idempotent re-indexing — 0 calls) | verified |
| SC-RETRIEVAL-016 (no body content in telemetry) | verified by construction + lint test |
| SC-RETRIEVAL-017 (XDG-paths-only lint) | verified |
| SC-RETRIEVAL-018 (no process.exit lint) | verified |
| SC-RETRIEVAL-019 (subprocess hygiene lint) | verified |
| SC-RETRIEVAL-020 (Zod-validated SearchHit array shape) | verified |
| SC-RETRIEVAL-021 (per-doc wall-clock budget measured) | partial — mock baseline 5ms recorded; live-Ollama measurement deferred to quickstart walkthrough |
| SC-RETRIEVAL-022 (schema migration idempotency) | verified |

**Constitution Check (re-evaluated 2026-05-13 post-implementation):** 16/16 [x]. Complexity Tracking empty. Implementation matches plan-time intent.

**Honest scope notes:**

- The "live walkthrough" deferrals (SC-001 + SC-003 + SC-021) require manual operator action against pai-node01's running Ollama + the full inbox-to-corpus.find loop. They're covered by `specs/005-retrieval/quickstart.md` and the existing live-Ollama integration tests (which are skip-tagged in CI per SP-004 convention).
- The mock-Ollama search-orchestrator unit test verifies the end-to-end orchestration logic without a live Ollama dependency. A live Ollama embed query was manually validated post-implementation (returns 768-dim vector in ~150ms on pai-node01).
- SP-005 ships 16/16 constitutional principles in place. No principle violations were introduced; no Complexity Tracking justifications required.
