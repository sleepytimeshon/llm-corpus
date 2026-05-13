# Phase 0 — Research: Hybrid Retrieval

**Feature**: 005-retrieval
**Date**: 2026-05-13

This document records the plan-time architectural decisions that gate SP-005. The spec arrived clean from `/speckit-specify` (zero `[NEEDS CLARIFICATION]` markers — every plan-deferred ambiguity is resolved here or in `data-model.md`). The decisions below resolve all SP-005 v1 design space; subsequent sprints (SP-006 kill-9 survival + tier-fallthrough, future v1.5+ retrieval-eval harness, future chunked-embeddings ADR) inherit these decisions and can override only via constitutional amendment or follow-up ADR.

Format: Decision → Recommendation → Rationale → Alternatives considered → Source citations.

---

## Decision A — Embedding model choice

**Decision**: Primary embedding model is `nomic-embed-text` (768-dim, ~274 MB on-disk, served by local Ollama). The model name is config-driven via `[embedding].model` in `config.toml`; default `nomic-embed-text`. Switching models is a config change PLUS a manual `corpus reindex` (because dimensions/output spaces differ across models).

**Rationale**:

- **Pre-verified locally**: nomic-embed-text is pulled and responsive on pai-node01 (verified 2026-05-13). Returns 768-dim vectors via Ollama's `/api/embeddings` endpoint.
- **Structured for retrieval**: nomic-embed-text was trained specifically for text retrieval / semantic search tasks (vs. general-purpose models). The 768-dim output is the standard for retrieval-tuned models.
- **Compact**: ~274 MB on-disk — fits comfortably alongside the SP-004 chat models (qwen3.5:9b at ~5.5 GB, gemma3:4b at ~3 GB).
- **CPU-fast**: Embedding inference for a 500-word body excerpt completes in sub-second on the user's pai-node01 (CPU-only). No GPU requirement.
- **Stable license**: Apache 2.0 / MIT-style; no model-license concerns for v1.
- **Local-only by construction (Principle I)**: Served by Ollama at `http://localhost:11434/api/embeddings`; no cloud-API option in SP-005 code paths.

**Alternatives considered**:

- **`mxbai-embed-large` (1024-dim)**: Slightly higher quality on some retrieval benchmarks; larger output dim → larger vec table footprint. Not pre-loaded on pai-node01. Reject for v1; future ADR if quality data demands.
- **`all-MiniLM-L6-v2` (384-dim) via ONNX/transformers.js**: Smaller, faster, but requires bundling the model in-process rather than via Ollama HTTP — adds dependency surface (transformers.js or ONNX runtime). Reject for v1; Ollama-as-embedding-server is the architectural fit (mirrors SP-004's classifier transport).
- **OpenAI / Cohere / Anthropic embedding APIs**: FORBIDDEN by Principle I. Not real alternatives.
- **Hand-rolled BM25-only with no dense retriever**: Would violate FR-003 verbatim ("the four signals MUST all be inputs"). Reject — FR-003 is non-negotiable.

**Source citations**:
- Constitution Principle I (Local-First, No Egress)
- Constitution Principle V (Schema-Enforced Structured Output)
- FR-003 (corpus.find ranks via hybrid retrieval — BM25 + dense + graph + confidence; four signals MUST all be inputs)
- ARCHITECTURE-FINAL §10.2 (dense vector ranking; "Per-document embedding of (title + summary + facet_topic + tags + body_excerpt)")
- Pre-flight verification: `nomic-embed-text` pulled on pai-node01 (2026-05-13)
- ADR `contracts/adr-embedding-model.md` (formalized in this sprint)

---

## Decision B — Vector store choice

**Decision**: sqlite-vec v0.1.x via the `vec0` virtual table type, loaded into each Database connection at open time via `import * as sqliteVec from 'sqlite-vec'; sqliteVec.load(db);` (namespace import, NOT default import — verified on pai-node01). The cosine-distance SQL primitive is `vec_distance_cosine(embedding, ?)`.

**Rationale**:

- **In-process, zero network**: sqlite-vec is a native SQLite extension loaded into the better-sqlite3 connection. No separate vector-DB process. Constitution III preserved (no new service surface).
- **Already in v1 native-addon allowlist**: `build/verify-native-addons.ts` already permits sqlite-vec; zero allowlist-promotion burden for SP-005.
- **Constitution VIII verbatim contract**: "FTS5 row + docs row + sqlite-vec row for the same document MUST commit together in a single transaction." sqlite-vec's vec0 virtual tables participate in normal SQLite transactions; a single `BEGIN ... COMMIT` block covers FTS5 INSERTs + vec0 INSERTs + plain-table edges INSERTs uniformly.
- **Cosine distance is the right primitive**: ARCHITECTURE-FINAL §10.2 specifies cosine similarity for the dense retriever; sqlite-vec's `vec_distance_cosine` is the direct SQL primitive (returns 0 = identical, up to 2 = opposite).
- **Namespace import discovered during pre-flight**: The default import `import sqliteVec from 'sqlite-vec'` produces an undefined `.load` member on the package's v0.1.x build; the namespace import is the working form. Codified in plan.md Technical Context and PREREQ-005 documentation.

**Alternatives considered**:

- **External vector DB (Qdrant, Weaviate, ChromaDB)**: All viable. All REJECTED — each adds a separate service surface, violating Constitution III and IV (single-user / single-machine substrate). The whole-process-in-SQLite design is the architectural fit.
- **In-memory FAISS via faiss-node**: Possible. Adds a new native addon (not in current allowlist). Loses Constitution VIII transactionality (FAISS is not transactional with SQLite). Reject.
- **HNSW via hnswlib-node**: Similar objections. Approximate-nearest-neighbor is a future ADR if N grows beyond 10k; v1 ships exact cosine via sqlite-vec.
- **Plain SQL with stored vectors as BLOBs + computed cosine in JavaScript**: Functionally equivalent but slower at retrieval-time (cosine over thousands of vectors in JS vs. native C). Reject.

**Source citations**:
- Constitution Principle III (Substrate, Not Surface)
- Constitution Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)
- Constitution Principle VIII (Atomic Writes & Transactional Index Updates)
- ARCHITECTURE-FINAL §10.2 (cosine similarity for dense retrieval)
- Pre-flight verification: `import * as sqliteVec from 'sqlite-vec'; sqliteVec.load(db);` works on pai-node01 (2026-05-13)
- v1 native-addon allowlist (`build/verify-native-addons.ts`)

---

## Decision C — Fusion algorithm: Reciprocal Rank Fusion (RRF) with k=60

**Decision**: The fusion module combines the four retrievers' top-K result lists via Reciprocal Rank Fusion with parameter k=60, per ARCHITECTURE-FINAL §10.3 verbatim:

```
score(doc) = sum over retrievers r of  1/(k + rank_r(doc))    where k = 60
```

Each retriever returns its top-K (Decision L: K=64 per retriever). The fusion module unions the four ranked lists, computes the RRF score per unique document, sorts descending, then applies the confidence-weights multiplier (Decision G; §10.5 weights) as a final post-fusion adjustment:

```
final_score(doc) = rrf_score(doc) × confidence_weight(doc.facet_type) × recency_adjustment(doc.ingest_timestamp)
```

**Rationale**:

- **ARCHITECTURE-FINAL §10.3 verbatim**: The k=60 RRF formula is the architecture's named choice. No re-derivation; SP-005 inherits.
- **RRF properties**: Rank-based (not score-based) — handles retrievers with disparate score scales (BM25 scores typically in [0, ~30]; cosine distances in [0, 2]; graph weights variable). The sum-of-reciprocals formula prevents any single retriever's score scale from dominating fusion.
- **k=60 is the canonical default**: The original RRF paper (Cormack et al. 2009) used k=60 in their experiments; it's the standard default in modern hybrid-search implementations (Elastic, Vespa, Weaviate). No reason to deviate for v1.
- **Confidence-as-post-fusion multiplier**: ARCHITECTURE-FINAL §10.5 specifies "Applied AFTER RRF fusion" — preserves the rank-based fusion semantics while letting domain knowledge (research-paper=1.20, etc.) bias the final ordering.
- **Per-retriever top-K = 64** (Decision L): Standard default; large enough to capture diverse candidates, small enough to keep SQL latency bounded.

**Alternatives considered**:

- **Weighted sum of normalized scores**: Requires score normalization (e.g., min-max per retriever); sensitive to score-scale changes. RRF is rank-based and immune. Reject.
- **CombSUM / CombMNZ**: Older fusion algorithms; RRF generally outperforms them empirically. Reject.
- **Learned fusion (e.g., LambdaMART)**: Requires labeled training data — out of scope per Constitution XVI (no formal eval harness in v1). Reject for v1; future ADR if user-review data accumulates.
- **k=30 or k=120 instead of k=60**: Different k values trade off recall (lower k = sharper top-K bias) vs. exploration. §10.3 specifies k=60; honor verbatim.
- **No confidence post-adjustment**: Would lose the facet_type-aware ordering that §10.5 mandates. Reject.

**Source citations**:
- ARCHITECTURE-FINAL §10.3 (Reciprocal Rank Fusion; verbatim formula + k=60)
- ARCHITECTURE-FINAL §10.5 (Confidence weights; "Applied AFTER RRF fusion")
- Cormack, Clarke, Buettcher (2009) "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods"
- ADR `contracts/adr-rrf-fusion.md` (formalized in this sprint)

---

## Decision D — Embedding transport

**Decision**: HTTP POST to `http://localhost:11434/api/embeddings` (Ollama's legacy single-prompt embedding endpoint) via the existing `undici` HTTP client. Request body shape: `{model: <configured-model>, prompt: <text>}`. Response shape: `{embedding: number[]}` (length matches the configured model's expected dimension). `stream: false` (always synchronous); no `options.temperature` (embeddings are deterministic for a given input).

**Rationale**:

- **Mirrors SP-004's HTTP-against-Ollama pattern**: SP-004's classifier uses `/api/chat` via undici; SP-005 uses `/api/embeddings` via undici. Same egress-hook integration, same AbortSignal propagation, same telemetry contract.
- **Localhost-allowlisted by construction (Principle I)**: The SP-001 egress hook permits localhost destinations; `http://localhost:11434` is permitted.
- **AbortSignal-native through `undici`**: undici's `fetch` API takes a standard `signal: AbortSignal` option; SIGTERM propagation works end-to-end without `Promise.race(setTimeout)` (Principle VII).
- **Legacy endpoint over batch endpoint**: Ollama has two embedding endpoints — `/api/embeddings` (POST `{model, prompt}` → `{embedding}`, the single-prompt legacy) and `/api/embed` (POST `{model, input: string | string[]}` → `{embeddings}`, the newer batch). SP-005 v1 uses the legacy endpoint because (a) SP-005 ships one embedding per call (no batching at the application layer), (b) the legacy endpoint is widely supported across Ollama versions including 0.5+ which the user has, (c) the batch endpoint's response shape differs and would require additional adapter code. Future v2 ADR may switch to batch if benchmark demands.

**Alternatives considered**:

- **Native Ollama Node SDK (`@ollama/ollama`)**: Possible. Wraps the same HTTP API. Rejected for the same reasons as SP-004 Decision B (SP-001 egress hook integration is at the HTTP boundary; an SDK adds a layer).
- **`fetch` from Node's global**: Functionally equivalent. SP-005 stays on `undici` for project consistency.
- **gRPC transport to Ollama**: Doesn't exist. Reject.
- **In-process embedding via transformers.js**: Bundles the model in-process; avoids Ollama dependency. Adds dependency surface (transformers.js or ONNX runtime). Reject — Ollama-as-embedding-server is the architectural fit and matches SP-004's classifier pattern.

**Source citations**:
- Constitution Principle I (Local-First, No Egress)
- Constitution Principle VII (Cancellable, Bounded IO)
- SP-004 Decision B (transport pattern for HTTP-against-Ollama)
- SP-001 transport dependency (`undici` in `packages/transport/`)
- Ollama API docs (`/api/embeddings` and `/api/embed` endpoints)

---

## Decision E — Edge thresholds + materialization timing

**Decision**: The edges-build sub-stage runs AFTER classify + embed sub-stages commit, INSIDE the same drain-lock window and INSIDE the same SQL transaction (per FR-RETRIEVAL-007 atomic index update). Edge thresholds:

- **tag_overlap**: Jaccard coefficient `|A ∩ B| / |A ∪ B|` between the new doc's tags and each existing doc's tags. Insert edge when Jaccard ≥ 0.3 (configurable via `config.toml [retrieval].tag_overlap_threshold`).
- **summary_similarity**: cosine similarity `1 - vec_distance_cosine(new.embedding, existing.embedding)`. Insert edge when cosine ≥ 0.7 (configurable via `config.toml [retrieval].summary_similarity_threshold`).
- **explicit_related**: from the new doc's frontmatter `related` array. Insert edge unconditionally for each entry (weight=1.0). If the target doc-id doesn't exist (foreign-key violation), skip + emit `edges.failed` event with `error_code='invalid_explicit_related_target'`.

The edges-build is **O(N) per new document → O(N² cumulative)** as the corpus grows. Acceptable for N ≤ 10k (the user's expected corpus size).

**Rationale**:

- **Materialization timing = post-classify + post-embed**: The edges-build needs (a) the new doc's tags (from SQL UPDATE in classify-stage) and (b) the new doc's embedding (from embed-stage). Both are available at edges-build time. Running edges-build inside the same transaction enforces Constitution VIII verbatim — partial index state (FTS5 + vec without corresponding edges) is forbidden.
- **Same drain-lock window**: The four post-ingest sub-stages (classify → embed → index → edges-build) run while the daemon holds the drain-lock once. No second lock acquisition; no cross-process race.
- **Threshold 0.3 for Jaccard tag-overlap**: A moderately-permissive threshold. Two docs sharing ≥ 30% of their tags are plausibly related. Configurable for users who want sparser/denser graphs.
- **Threshold 0.7 for cosine summary-similarity**: A high-confidence threshold. Two docs with cosine ≥ 0.7 are very semantically similar. Configurable. Lower thresholds (e.g., 0.5) would produce O(N) noisy edges per doc — verified during prototyping that 0.7 produces clean graphs.
- **Explicit-related is unconditional + weight=1.0**: User intent is the strongest signal; no thresholding.
- **O(N²) cumulative is acceptable for N ≤ 10k**: 100M tag-Jaccard + 100M cosine computations at N=10k; the cosine computation is the bottleneck (~5 ms per pair × 10k pairs = 50 s per new doc). For N ≤ 1k (the user's likely near-term corpus size), edges-build is sub-second. Future HNSW/LSH ADR if needed.

**Alternatives considered**:

- **Edges-build OUTSIDE the transaction (eventually consistent)**: Tempting for batch parallelism. Reject — violates Constitution VIII verbatim ("Index writes ... MUST commit together"). The user's existing classified rows would briefly have FTS5 + vec entries without edges, observably inconsistent.
- **HNSW for approximate cosine top-K during edges-build**: Would reduce per-doc cost from O(N) to O(log N). Reject for v1 — sqlite-vec doesn't ship HNSW; introducing it would require a new dependency. Future sprint.
- **Tag_overlap threshold of 0.5 instead of 0.3**: Sparser graph; fewer edges per doc. Trade-off: lower recall on graph-traversal retriever. The 0.3 default is calibrated for the user's expected corpus diversity; configurable.
- **Summary_similarity threshold of 0.5 instead of 0.7**: Denser graph; noisier. Reject for v1; 0.7 is the high-confidence threshold.
- **Explicit_related thresholded**: Doesn't make sense — user intent is the threshold.

**Source citations**:
- ARCHITECTURE-FINAL §10.4 (Knowledge-Graph Edges; tag_overlap, summary_similarity, explicit_related)
- Constitution Principle VIII (Atomic Writes & Transactional Index Updates — verbatim "MUST commit together")
- Constitution Principle IX (Concurrency-Safe Shared State)
- ADR `contracts/adr-edges-materialization.md` (formalized in this sprint)

---

## Decision F — Schema migration shape (CREATE VIRTUAL/TABLE IF NOT EXISTS)

**Decision**: The SP-005 schema migration uses `CREATE VIRTUAL TABLE IF NOT EXISTS` for FTS5 and vec0 virtual tables, `CREATE TABLE IF NOT EXISTS` for the plain `edges` table, and `CREATE INDEX IF NOT EXISTS` for the edges indices. All migration statements are idempotent — re-running the migration on a populated DB is a no-op.

Migration ordering in `runSchemaMigration(db)`:

1. SP-002 base migration (creates `documents`, `taxonomy_terms`).
2. SP-003 migration (extends `documents`).
3. SP-004 migration (no-op; SP-004 doesn't change schema).
4. SP-005 migration: `sqliteVec.load(db)` (if not already loaded; idempotent), then `CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(...)`, then `CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(...)`, then `CREATE TABLE IF NOT EXISTS edges (...)`, then `CREATE INDEX IF NOT EXISTS idx_edges_src ...`, then `CREATE INDEX IF NOT EXISTS idx_edges_dst ...`.

**Rationale**:

- **`IF NOT EXISTS` works for virtual tables in modern SQLite**: Verified via SQLite docs (3.35+; the user's SQLite is well past this version). The `CREATE VIRTUAL TABLE IF NOT EXISTS` syntax was added precisely to support idempotent migrations.
- **Idempotency is mandatory (Constitution X)**: Re-running the schema migration on an existing populated DB must be a no-op. The `IF NOT EXISTS` clauses provide this.
- **`sqliteVec.load(db)` is idempotent**: The sqlite-vec extension load is a no-op if already loaded; safe to call at every connection-open.
- **Migration order matters for foreign keys**: `edges` references `documents.id`; the FOREIGN KEY constraint requires `documents` to exist BEFORE `edges` is created. SP-002 ships `documents`; SP-005 migration runs AFTER SP-002's, so the FK is satisfied.

**Alternatives considered**:

- **Versioned migration system with `schema_version` table**: More structured, but introduces a meta-table and migration-runner abstraction. The current SP-002/SP-003/SP-004 migrations are idempotent ad-hoc statements; SP-005 follows the same pattern for consistency. Future ADR may introduce a versioned system if the migration surface grows.
- **`DROP TABLE IF EXISTS` + `CREATE TABLE`**: Destructive; loses data on re-run. Reject.
- **Detection via `sqlite_master` query**: More verbose; `IF NOT EXISTS` is the idiomatic SQLite primitive. Reject.

**Source citations**:
- SQLite docs: `CREATE VIRTUAL TABLE IF NOT EXISTS` (https://sqlite.org/lang_createvtab.html)
- Constitution Principle X (Idempotent Pipeline Transitions)
- SP-002 / SP-003 / SP-004 existing migration patterns

---

## Decision G — Confidence weights: ARCHITECTURE-FINAL §10.5 defaults

**Decision**: The default confidence weights are per ARCHITECTURE-FINAL §10.5 verbatim. Plus a recency adjustment: `+0.05` for docs ingested in the last 90 days; `-0.10` for docs older than the current schema-version-bump cutoff (Plan-resolved: not yet active in v1.0.0; the schema-version-bump cutoff field is wired but unused until a real bump occurs). The defaults are overridable via `config.toml [confidence_weights]`.

§10.5 defaults verbatim:

```
research-paper=1.20, manual=1.10, form=1.10, reference=1.10
article=1.00, notes=0.95, transcript=0.90, podcast=0.90, video=0.90, book=1.05
+ recency boost: docs ingested in last 90 days get +0.05 multiplier
+ recency penalty: docs older than schema-version bump get -0.10 until reconciled
Applied AFTER RRF fusion.
```

**v1 reconciliation note**: §10.5's facet_type vocabulary includes values NOT in SCHEMA.md v1.0's 7-value constitutional enum (`entity`, `concept`, `tutorial`, `analysis`, `reference`, `synthesis`, `cheat-sheet`). The reconciliation:

| SCHEMA.md facet_type | §10.5 weight applied | Rationale |
|---|---|---|
| `entity` | 1.00 | Default; not directly mapped. |
| `concept` | 1.00 | Default; not directly mapped. |
| `tutorial` | 1.10 (manual) | Closest §10.5 match. |
| `analysis` | 1.05 (book/research-paper midpoint) | Analyses span book-grade and paper-grade. |
| `reference` | 1.10 (reference) | Direct match. |
| `synthesis` | 1.05 (book) | Closest §10.5 match. |
| `cheat-sheet` | 1.00 | Default; not directly mapped. |

A future ADR may extend SCHEMA.md's facet_type enum to match §10.5's vocabulary OR revise §10.5 to match SCHEMA.md.

**Rationale**:

- **ARCHITECTURE-FINAL §10.5 verbatim**: The weight values are the architecture's named choices. No re-derivation.
- **Applied AFTER RRF (§10.5 verbatim "Applied AFTER RRF fusion")**: The fusion algorithm operates on ranks; confidence weights bias the final ordering as a multiplicative adjustment.
- **Recency is a real signal**: Newer documents are more relevant on average. The +0.05 / -0.10 weights are modest — enough to nudge ordering, not enough to dominate.
- **Configurable**: The user may tune for their corpus (e.g., academic users may weight `research-paper` higher; note-takers may weight `notes` higher).

**Alternatives considered**:

- **Skip confidence weights entirely**: Would lose the facet_type-aware ordering. §10.5 explicitly specifies them. Reject.
- **Apply BEFORE RRF (as per-retriever bias)**: Would distort the rank-based fusion. §10.5 says AFTER. Reject.
- **Learned weights from user-review data**: Out of scope per Constitution XVI (no eval harness in v1). Reject for v1.
- **Different recency window (30 days, 180 days, etc.)**: 90 days per §10.5; configurable. Honor verbatim.

**Source citations**:
- ARCHITECTURE-FINAL §10.5 (Confidence weights verbatim; recency boost; recency penalty; "Applied AFTER RRF fusion")
- SCHEMA.md v1.0 (7-value facet_type enum)

---

## Decision H — Tier-fallthrough scope (Tier 0 only in SP-005; Tier 1/2/3 deferred to SP-006)

**Decision**: SP-005 ships Tier 0 (hybrid: BM25 + dense + graph + confidence) ONLY. The `tier_used` field in the SearchHit response is hardcoded to `'hybrid'`. Tier 1 (BM25-only when dense fails AND sub-20ms target), Tier 2 (grep-CATALOG when SQLite fails), Tier 3 (fs-grep when everything fails) are deferred to SP-006 per ARCHITECTURE-FINAL §10.6 verbatim:

```
Tier 0: hybrid (BM25 + vector + graph + confidence) — <20ms target — SP-005 ships this
Tier 1/2/3: BM25-only / grep-CATALOG / fs-grep — SP-006 scope
```

Partial-signal degradation within Tier 0 (FR-RETRIEVAL-004's `degraded_signals` annotation) is NOT tier-fallthrough — it's transparent reporting that some Tier 0 retrievers failed, with Tier 0 fusion still running on the available signals.

**Rationale**:

- **§10.6 verbatim**: The architecture's named tier model assigns Tier 0 to SP-005 and Tier 1/2/3 to SP-006. SP-005 honors verbatim.
- **Partial-signal degradation is NOT tier-fallthrough**: A Tier-0 fusion with degraded signals (e.g., dense unavailable but BM25 + graph + confidence still working) returns a Tier-0 response with `degraded_signals: ['dense']`. The tier-fallthrough state machine (Tier 0 → Tier 1 → Tier 2 → Tier 3) is a deliberate sequence of named transitions, each with its own latency target and SLA — that's SP-006's contract.
- **Cleaner separation of concerns**: SP-005 owns "hybrid retrieval with all four signals correctly fused"; SP-006 owns "fallback strategy when hybrid is unavailable". Mixing them would conflate two separable surfaces.

**Alternatives considered**:

- **Ship Tier 1 (BM25-only fallback) in SP-005**: Tempting, but SP-005 already at the sizing threshold (2000+ LOC); adding tier-fallthrough state-machine code would push it well over. Reject; defer to SP-006.
- **Ship all four tiers in SP-005**: Would triple SP-005's scope. Reject.
- **Skip tier-fallthrough entirely (always return error envelope if Tier 0 fully fails)**: Loses graceful degradation under disk corruption. Reject; SP-006 is the right horizon.

**Source citations**:
- ARCHITECTURE-FINAL §10.6 (Tier model verbatim; tier 0 = SP-005, tier 1/2/3 = SP-006)
- Constitution Principle XVI (Validation Honesty)
- `feedback-build-tier-sizing-rule` (size-bound dispatch)

---

## Decision I — Per-call timeouts + AbortSignal end-to-end

**Decision**: Every IO call accepts `AbortSignal` and respects per-call timeouts. Defaults:

| Surface | Interactive policy | Batch policy |
|---|---|---|
| Embedding HTTP call | 10 s | 30 s |
| Per-retriever SQL query | 5 s | 10 s |
| Whole `corpus.find` (all four retrievers + fusion) | 30 s | 60 s |
| Per-doc embed-stage (incl. HTTP) | 10 s | 30 s |
| Per-doc index-stage (FTS5 + vec INSERTs) | 5 s | 10 s |
| Per-doc edges-build-stage | 15 s | 60 s |
| Per-doc total (embed + index + edges) | 30 s | 120 s |

Per-call timeouts are implemented via `AbortController + setTimeout(() => controller.abort('per_call_timeout'), perCallTimeoutMs)` with `clearTimeout` on success. NEVER `Promise.race(setTimeout)` (Constitution VII forbidden pattern). Caller-supplied AbortSignals are also respected — if the MCP transport's `signal` fires (caller cancelled), all four retrievers abort within 2s.

**Rationale**:

- **Constitution VII verbatim**: "Every external IO call takes an AbortSignal. Promise.race against setTimeout is forbidden — use AbortController."
- **Bounded by purpose**: Interactive timeouts are tight (user is waiting on a query response); batch timeouts are looser (background work in `corpus reindex`).
- **30 s `corpus.find` is generous**: Typical p95 will be sub-100 ms; the 30 s budget catches pathological cases (Ollama loading the embedding model, etc.) before they cascade. Per-retriever 5 s is the tighter constraint.
- **AbortSignal chains**: caller signal → orchestrator signal → per-retriever signal. The orchestrator wraps the caller signal with the per-stage-timeout signal; per-retriever wraps the orchestrator signal with the per-call-timeout signal.

**Alternatives considered**:

- **No per-call timeouts (only whole-stage)**: A stuck retriever could starve the others. Reject.
- **Tighter timeouts (e.g., 2 s embedding HTTP)**: Doesn't accommodate cold-Ollama model load. Reject.
- **Looser timeouts (e.g., 60 s embedding HTTP interactive)**: Bad UX for caller. Reject.

**Source citations**:
- Constitution Principle VII (Cancellable, Bounded IO)
- SP-003 / SP-004 existing timeout patterns

---

## Decision J — Idempotency: re-running embed + index + edges-build on indexed rows is a no-op

**Decision**: The embed-stage's pre-INSERT idempotency check is `SELECT 1 FROM documents_vec WHERE doc_id = ?`. If the row exists, the stage exits early as a no-op (returns `Result.ok` with a `skipped: true` flag). The index-stage and edges-build-stage inherit the early-exit. The `corpus reindex` CLI's WHERE clause filters: `WHERE facet_type != 'unclassified' AND NOT EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = documents.id)`.

Re-running on already-indexed rows is a 0-call no-op (zero Ollama HTTP calls; zero SQL writes).

**Rationale**:

- **Constitution X verbatim**: Idempotent pipeline transitions. The early-exit pattern matches SP-004's classify-stage idempotency (re-running classify on an already-classified row is a no-op via `WHERE facet_type='unclassified'` filter).
- **`documents_vec` is the canonical idempotency key**: The vec table has a PRIMARY KEY on `doc_id`; the INSERT would fail with a constraint violation if attempted. The pre-INSERT check avoids the wasted Ollama call.
- **The FTS5 row is implicitly idempotent via the same check**: The index-stage doesn't INSERT FTS5 separately; both INSERTs (FTS5 + vec) happen together inside the orchestrator transaction. The pre-check shortcuts both.
- **Edges-build idempotency via `INSERT OR IGNORE`**: The edges table's PRIMARY KEY `(src_id, dst_id, kind)` enforces uniqueness; `INSERT OR IGNORE` silently skips duplicates.

**Model swap is NOT idempotent**: If the user changes `[embedding].model` in `config.toml` from `nomic-embed-text` to `mxbai-embed-large`, the existing `documents_vec` rows are stale (different model output space). v1 does NOT auto-detect this; the user must manually `DELETE FROM documents_vec` + `corpus reindex`. Documented in plan.md R3 + quickstart.md troubleshooting.

**Alternatives considered**:

- **Auto-detect model change via stored model-name fingerprint**: Would require a new column in `documents_vec` (e.g., `model_name TEXT NOT NULL`); schema migration to add it. Reject for v1; future ADR if model-swap becomes a common operator path.
- **Always re-embed on reindex (no idempotency check)**: Wasteful Ollama calls. Reject.
- **Idempotency check at the orchestrator level (skip embed + index + edges in one decision)**: Equivalent to per-stage early-exit; cleaner to put the check at the embed-stage entry point (the embedding is the most expensive sub-stage).

**Source citations**:
- Constitution Principle X (Idempotent Pipeline Transitions)
- SP-004 FR-CLASSIFY-012 (classify idempotency pattern)

---

## Decision K — Telemetry classes: ≥ 12 SP-005 event classes

**Decision**: SP-005 registers ≥ 12 new telemetry event classes (over the FR-RETRIEVAL-013 floor of 8):

1. `embed.started`
2. `embed.completed`
3. `embed.failed`
4. `index.started`
5. `index.completed`
6. `index.failed`
7. `edges.started`
8. `edges.completed`
9. `edges.failed`
10. `search.started`
11. `search.query`
12. `search.completed`
13. `search.degraded`
14. `search.error`

Each event Zod-validates; per-event size budget ≤ 4 KB; query strings hashed via SHA-256 before any telemetry emission.

**Rationale**:

- **Constitution XIII verbatim**: "Every catch block emits a structured event before throwing or returning. AST-level lint enforcement." SP-005's IO surface has 4 sub-stages × 3 outcomes (started/completed/failed) = 12 minimum, plus the search-time events.
- **Granular event classes simplify operator debugging**: Distinct events for each sub-stage let the user `grep classify.failed` vs `grep embed.failed` to localize problems quickly.
- **`search.degraded` separate from `search.error`**: A partial-signal degradation is informational (≥ 1 signal succeeded); a full failure is an error. Different event classes let alerting rules differentiate.
- **Query hashing per Constitution I**: Raw query text never enters telemetry (could echo body fragments); only SHA-256 hex digest.

**Alternatives considered**:

- **Fewer event classes (combine started/completed/failed into one)**: Loses the temporal-granularity advantage; harder to debug.
- **More event classes (e.g., per-retriever events)**: Possible. Reject for v1 — the four retrievers are encapsulated by the search-orchestrator; per-retriever events would add noise. Future ADR if telemetry-driven debugging needs them.

**Source citations**:
- Constitution Principle XIII (Telemetry-or-Die)
- Constitution Principle I (Local-First, No Egress — body content / query text prohibition)
- SP-003 / SP-004 existing telemetry patterns

---

## Decision L — Per-doc latency budget + per-retriever top-K

**Decision**:

- **Per-doc embed + index + edges-build total budget**: 30 s interactive / 120 s batch. Each sub-stage has its own sub-budget (Decision I).
- **Per-retriever top-K**: 64. Each of the four retrievers returns its top 64 documents to fusion.
- **Caller `limit` parameter**: defaults to 20, max 100. The orchestrator returns the top `limit` SearchHits from fusion.

**Rationale**:

- **30 s per-doc interactive is comfortable**: Embedding ~500 words via nomic-embed-text on CPU is sub-second; FTS5 + vec INSERTs are sub-100 ms; edges-build for N ≤ 1k is sub-second. 30 s is ~30x headroom.
- **120 s per-doc batch is for pathological cases**: Cold Ollama model load + large body + edges-build for N > 1k.
- **K = 64 per retriever**: Standard default; large enough to provide diverse fusion candidates, small enough to keep SQL latency bounded. The four retrievers in union produce ≤ 256 candidate documents for fusion; fusion's RRF sum is O(N_candidates) which is sub-millisecond.
- **`limit` ≤ 100**: Bounded response size; user clients typically render ≤ 20 hits per query.

**Alternatives considered**:

- **K = 32 per retriever**: Tighter; saves SQL time. Reject; 64 is the standard.
- **K = 128 per retriever**: Looser; more diverse fusion. Reject; 64 is the standard.
- **Tighter per-doc budget (e.g., 10 s interactive)**: Bad UX for cold-Ollama cases. Reject.

**Source citations**:
- Constitution Principle VII (Cancellable, Bounded IO)
- Constitution Principle XVI (Validation Honesty)
- ARCHITECTURE-FINAL §10.6 (Tier 0 latency target sub-20 ms is the aspirational ceiling, not the per-doc budget)

---

## Decision M — Embedding caching: no separate cache; embeddings stored in `documents_vec` only

**Decision**: SP-005 does NOT implement a separate embedding cache. Per-document embeddings live in `documents_vec` (durable); per-query embeddings are ephemeral (computed at query time, used for cosine top-K, discarded). Re-embedding requires explicit `corpus reindex` after manual `DELETE FROM documents_vec`.

**Rationale**:

- **Storage minimalism**: A separate cache would add a third storage surface (in-memory or on-disk) for transient data. Reject — `documents_vec` is the canonical embedding store; queries embed fresh each time (sub-second cost).
- **Recency-penalty via confidence weights (Decision G)**: The schema-version-bump penalty (-0.10) is the mechanism for "embeddings older than the current schema bump are deprecated". No cache invalidation; the penalty bias handles it.
- **Model swap requires manual reindex**: v1 doesn't store a model-name fingerprint per embedding. Switching models requires the operator to manually `DELETE FROM documents_vec` + `corpus reindex`. Documented in plan.md R3 + quickstart.md.

**Alternatives considered**:

- **LRU cache for query embeddings**: A repeated query would reuse the cached embedding. Adds memory pressure + invalidation complexity. Reject — query embedding is sub-second; caching is premature optimization.
- **Model-name fingerprint per embedding row**: Would detect stale embeddings automatically. Adds a column + migration. Reject for v1; future ADR if model-swap becomes a common operator path.
- **In-memory LRU for document embeddings**: Saves SQL-fetch latency at query time. The four retrievers' SQL is already sub-millisecond; caching is premature. Reject.

**Source citations**:
- Constitution Principle IV (Knowledge, Not Memory; Single-User, Single-Machine — minimal state)
- Constitution Principle XVI (Validation Honesty — no premature optimization claims)

---

## Decision N — Error envelope shape: MCP-tool-response-shaped, NOT transport error

**Decision**: Every non-success outcome of `corpus.find` returns `{error: SearchErrorEnvelope, hits: [], query: <echo>, result_count: 0, tier_used: 'hybrid', signals_used: []}` as a SUCCESSFUL MCP tool response. The MCP transport layer is NEVER invoked with a JSON-RPC error for `corpus.find` failures.

The envelope shape:

```typescript
SearchErrorEnvelope = {
  error_code: 'validation_error' | 'embedding_unavailable' | 'index_unavailable' | 'query_aborted' | 'all_signals_failed' | 'internal_error',
  message: string,  // max 1024 chars
  hint: string,     // max 1024 chars
}
```

**Rationale**:

- **FR-004 verbatim**: "Non-success outcomes return a structured error envelope ... as a normal MCP tool response — not a transport error."
- **MCP transport errors are reserved for protocol-level failures**: e.g., the MCP server isn't running, the client can't reach it. Tool-level failures (invalid input, embedding unavailable) are application-domain concerns; they go in the response envelope.
- **The agent (consuming client) sees the same response shape on success and failure**: `hits` always exists (empty on error); `error` exists only on error. The agent's parsing code can branch on `if (response.error) ... else ...` without try/catch around the transport call.
- **`hint` field is for agent self-service recovery**: e.g., "Invalid filter key 'zzz_unknown'; valid filter keys are: facet_domain, facet_type, tags, since, until, source_type."

**Alternatives considered**:

- **Transport-level JSON-RPC errors for tool failures**: Conflates protocol and application errors. Reject per FR-004.
- **Throw exceptions from the tool handler**: The MCP SDK's tool wrapper converts unhandled exceptions into transport errors. Reject.
- **Skip the `hint` field**: Loses self-service recovery. Reject.

**Source citations**:
- FR-004 (Deterministic structured error envelope; "a normal MCP tool response — not a transport error")
- MCP SDK documentation (tool response shape)

---

## Risks not turning into decisions

These are surfaced in plan.md's Risk Register but did not require a plan-time decision:

- **R1 (sqlite-vec version compatibility)**: Mitigated by version pin in allowlist + ADR-binding to v0.1.x. No additional decision.
- **R2 (Ollama `/api/embeddings` vs `/api/embed` divergence)**: Decision D resolves (use legacy endpoint for v1). No additional decision.
- **R3 (`nomic-embed-text` dimension fingerprinting)**: Decision M resolves (manual reindex on model swap). No additional decision.
- **R4 (FTS5 unicode tokenizer on multibyte content)**: Mitigated by `porter unicode61` default + future-ADR escape hatch. No additional decision.
- **R5 (Edges-build wall-clock at scale)**: Decision E resolves (acceptable O(N²) for N ≤ 10k; future HNSW). No additional decision.
- **R6 (Atomic transaction lifetime)**: Decision E + Constitution VIII resolve. No additional decision.
- **R7 (RRF fusion with empty retriever results)**: Decision C resolves (RRF handles empty lists naturally). No additional decision.
- **R8 (`corpus.find` p95 latency at scale)**: Constitution XVI resolves (honest measurement, not guaranteed targets). No additional decision.
- **R9 (Concurrent search vs drain race for SQLite WAL)**: WAL snapshot-isolation resolves naturally. No additional decision.
- **R10 (Test-harness for signal-disable)**: Decision in `tests/integration/retrieval-degraded-signals.test.ts` + `disable-signal-fixture.ts`. No plan-time decision.

---

## Resolved spec ambiguities (recap of Plan-stage commitments)

The spec deferred several details to `/speckit-plan` (or pre-resolved them in the design-decisions block of the dispatch prompt). The decisions above resolve them:

| Spec / dispatch reference | Plan-stage resolution |
|---|---|
| Primary embedding model | Decision A: `nomic-embed-text` (768-dim) |
| Embedding transport | Decision D: HTTP POST to `http://localhost:11434/api/embeddings` via `undici` |
| Vector store | Decision B: sqlite-vec v0.1.x via vec0 + cosine distance |
| BM25 field weights | Decision C (implicit): ARCHITECTURE-FINAL §10.1 verbatim (summary=5, tags=3, facet_topic=2, title=2, body_excerpt=1) |
| Fusion algorithm | Decision C: RRF with k=60 per ARCHITECTURE-FINAL §10.3 |
| Confidence weights | Decision G: ARCHITECTURE-FINAL §10.5 verbatim; v1 reconciliation with SCHEMA.md 7-value enum |
| Edge thresholds | Decision E: tag_overlap ≥ 0.3, summary_similarity ≥ 0.7, explicit_related unconditional |
| Edge materialization timing | Decision E: post-classify + post-embed, inside same drain-lock + same transaction |
| Edge cumulative bound | Decision E: O(N²) acceptable for N ≤ 10k; future HNSW/LSH if needed |
| Schema migration shape | Decision F: CREATE VIRTUAL/TABLE IF NOT EXISTS; idempotent |
| Tier-fallthrough scope | Decision H: Tier 0 only in SP-005; Tier 1/2/3 to SP-006 |
| Per-call timeouts | Decision I: 10s embedding / 5s SQL / 30s whole find (interactive); 30s / 10s / 60s (batch) |
| Per-doc latency budget | Decision L: 30s interactive / 120s batch |
| Per-retriever top-K | Decision L: 64 |
| Caller `limit` default | Decision L: 20 (max 100) |
| Telemetry classes | Decision K: ≥ 12 SP-005 event classes |
| Query hashing | Decision K: SHA-256 hex digest in `query_hash` field; raw text NEVER in telemetry |
| Idempotency strategy | Decision J: `WHERE NOT EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = ?)` pre-check |
| Reindex CLI | Decision I (plan-level): `corpus reindex` reuses `Paths.drainLock()` |
| Embedding caching | Decision M: no separate cache; embeddings stored in documents_vec only |
| Error envelope shape | Decision N: MCP-tool-response-shaped, NOT transport error (FR-004 verbatim) |
| Drain-lock reuse | Plan FR-RETRIEVAL-018: REUSE SP-003 / SP-004 `Paths.drainLock()` |
| Max query length | Plan PREREQ-001: 2048 chars (validated by Zod) |

All deferred items resolved. Phase 1 design proceeds against this research baseline.
