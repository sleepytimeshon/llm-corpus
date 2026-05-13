# Phase 1 — Data Model: Hybrid Retrieval

**Feature**: 005-retrieval
**Date**: 2026-05-13

This document formalizes the SP-005 entities, their fields, invariants, lifecycle, persistence paths, and their mapping into the existing SP-002 `documents` SQLite table + the NEW SP-005 `documents_fts`, `documents_vec`, and `edges` tables. It also enumerates the new telemetry event-class Zod schemas added to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (PREREQ-002).

SP-005 does NOT change the existing SQL schema (`documents`, `taxonomy_terms`); it ADDS three new tables.

---

## Schema migration delta (verbatim DDL)

### `documents_fts` (FTS5 virtual table)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  doc_id UNINDEXED,    -- foreign-key-like reference to documents.id (not indexed for FTS; used for JOIN)
  title,               -- weight 2 per ARCHITECTURE-FINAL §10.1; from documents.title (SP-003-owned)
  summary,             -- weight 5; extracted from body-file YAML frontmatter at index-stage
  tags,                -- weight 3; CSV-joined from documents.tags_json
  facet_topic,         -- weight 2; extracted from body-file YAML frontmatter (optional; empty string if absent)
  body_excerpt,        -- weight 1; first 500 words of the body-file Markdown body section (codepoint-safe)
  tokenize='porter unicode61'
);
```

**Invariants**:
- `doc_id` is the join key to `documents.id`. NOT indexed by FTS5 (the `UNINDEXED` keyword excludes it from BM25 scoring).
- At most one row per `doc_id`. Re-running the index-stage on an already-indexed `doc_id` is a no-op (FR-RETRIEVAL-012; SQL `WHERE NOT EXISTS` check before INSERT).
- Field weights per ARCHITECTURE-FINAL §10.1 are encoded in the FTS5 query syntax at retrieval time via `bm25(documents_fts, 5.0, 3.0, 2.0, 2.0, 1.0)` — the weights are applied at query time, NOT stored in the table.
- The `porter unicode61` tokenizer handles Latin script + basic Unicode normalization; non-BMP / CJK / RTL behavior is documented in plan.md R4.
- Body content (the `body_excerpt` column) is on-disk in the FTS5 table but NEVER appears in telemetry (Constitution I + SC-RETRIEVAL-016).

### `documents_vec` (sqlite-vec vec0 virtual table)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
  doc_id TEXT PRIMARY KEY,
  embedding float[768]
);
```

**Invariants**:
- `doc_id` is the primary key; one row per document.
- `embedding` is a fixed-dimension float vector. v1 hardcodes 768 (nomic-embed-text default). Schema-version bump required to change dimension (plan.md R3).
- Cosine distance via `vec_distance_cosine(embedding, ?)` at retrieval time.
- Per-document granularity (one embedding per doc; no chunking). Chunked-embedding is a future ADR per spec.md Out-of-Scope.
- The vec0 virtual table is created against a `Database` connection that has `sqliteVec.load(db)` called against it. The connection-open helper in `openIndexReadWrite()` is extended to load sqlite-vec by default for SP-005+.

### `edges` (plain table)

```sql
CREATE TABLE IF NOT EXISTS edges (
  src_id  TEXT NOT NULL,
  dst_id  TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('tag_overlap','summary_similarity','explicit_related')),
  weight  REAL NOT NULL,
  PRIMARY KEY (src_id, dst_id, kind),
  FOREIGN KEY (src_id) REFERENCES documents(id),
  FOREIGN KEY (dst_id) REFERENCES documents(id)
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
```

**Invariants**:
- Primary key `(src_id, dst_id, kind)` — same source / destination pair may have multiple edge kinds simultaneously (e.g., both tag_overlap and summary_similarity between the same two docs).
- Foreign keys to `documents.id` — orphan edges are FORBIDDEN (a deleted document's edges must be cascaded; v1 doesn't ship document deletion, so this is forward-compatibility).
- Edges are STORED in one direction only — `(D_new, D_existing)` — the edges-build sub-stage inserts only outbound edges from the newly-indexed doc. Queries traverse both directions via `WHERE src_id = ? OR dst_id = ?` JOINs.
- `weight` is the Jaccard coefficient for `tag_overlap`, the cosine similarity for `summary_similarity`, or `1.0` for `explicit_related`.
- `kind` enum is closed; the CHECK constraint is enforced by SQLite.

---

## Entity 1 — EmbeddingVector

The in-memory representation of a per-document or per-query embedding. Produced by `embedDocument(text, signal)` or `embedQuery(text, signal)` in `packages/inference/src/embedding-adapter.ts`.

**Type**:

```typescript
type EmbeddingVector = Float32Array;  // length = configured dimension (768 for nomic-embed-text)
```

**Field invariants**:
- Length MUST match the configured embedding-model dimension. v1 hardcodes 768. Mismatch → `EmbeddingDimensionMismatchError` raised by the adapter BEFORE the vector reaches the persister.
- All entries MUST be finite numbers (`Number.isFinite(v[i])` for every i). NaN / Infinity → `EmbeddingValidationError`.
- The vector is NOT normalized at production time — sqlite-vec's `vec_distance_cosine` handles normalization at query time.

**Lifecycle**:
- Produced by the embedding adapter from a text input.
- For documents: derived from `(title + '\n' + summary + '\n' + facet_topic + '\n' + tags-joined + '\n' + body_excerpt)` (ARCHITECTURE-FINAL §10.2).
- For queries: derived from the raw query string.
- Lifetime: the in-memory vector lives until INSERT into `documents_vec` (for docs) or until cosine top-K query completes (for queries).
- NOT persisted to disk except via the `documents_vec` virtual table.

**Persistence target**:
- `documents_vec.embedding` column (for documents).
- Queries are ephemeral — no persistence.

---

## Entity 2 — FTS5Row

The conceptual shape of a row in the `documents_fts` virtual table. Inserted by the index-stage.

**Source mapping**:

| FTS5 column | Source | Notes |
|---|---|---|
| `doc_id` | `documents.id` (SP-003 doc-id) | UNINDEXED; JOIN key only. |
| `title` | `documents.title` (SP-003-owned) | Weight 2 per §10.1. |
| `summary` | Body-file YAML frontmatter `summary` field (SP-004-written) | Weight 5 per §10.1. Empty string if frontmatter lacks the field. |
| `tags` | `JSON.parse(documents.tags_json).join(', ')` | Weight 3. CSV format keeps FTS5 tokenization sensible. |
| `facet_topic` | Body-file YAML frontmatter `facet_topic` field (OPTIONAL per SCHEMA.md) | Weight 2. Empty string if absent. |
| `body_excerpt` | First 500 words of the body file's Markdown body section (post-frontmatter) | Weight 1. Codepoint-safe truncation. |

**INSERT contract** (within the orchestrator's transaction):

```sql
INSERT INTO documents_fts (doc_id, title, summary, tags, facet_topic, body_excerpt)
VALUES (?, ?, ?, ?, ?, ?);
```

**Invariants**:
- One row per document. Re-INSERT on a doc_id that already exists in `documents_fts` would create a duplicate FTS5 entry — defense-in-depth `WHERE NOT EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = ?)` in the index-stage's pre-INSERT check (the vec table is the canonical idempotency key; the FTS5 table inherits the check).
- Body content (the `body_excerpt` column) is on-disk but NEVER in telemetry (SC-RETRIEVAL-016).
- The frontmatter codec is `parseMarkdownWithFrontmatter` (SP-002 single YAML routing); empty / malformed frontmatter produces `summary='' facet_topic=''`.

---

## Entity 3 — VecRow

The conceptual shape of a row in the `documents_vec` virtual table.

**Source mapping**:

| VecRow column | Source | Notes |
|---|---|---|
| `doc_id` | `documents.id` | PRIMARY KEY. |
| `embedding` | `EmbeddingVector` from the embed-stage | 768-dim float32 array. |

**INSERT contract** (within the orchestrator's transaction):

```sql
INSERT INTO documents_vec (doc_id, embedding) VALUES (?, ?);
-- The second placeholder is bound via sqlite-vec's helper: sqliteVec.serialize(Float32Array)
```

**Invariants**:
- One row per document. PRIMARY KEY violation → ROLLBACK (defense-in-depth idempotency; SQL `WHERE NOT EXISTS` precheck at the index-stage level).
- The vector is binary-encoded via sqlite-vec's `serialize` helper before INSERT.
- Dimension fixed at 768 by the table schema; mismatch → SQLite raises an error → ROLLBACK.

---

## Entity 4 — Edge

A row in the `edges` table. Inserted by the edges-build sub-stage.

**Schema** (repeated for proximity):

```sql
CREATE TABLE IF NOT EXISTS edges (
  src_id  TEXT NOT NULL,
  dst_id  TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('tag_overlap','summary_similarity','explicit_related')),
  weight  REAL NOT NULL,
  PRIMARY KEY (src_id, dst_id, kind),
  FOREIGN KEY (src_id) REFERENCES documents(id),
  FOREIGN KEY (dst_id) REFERENCES documents(id)
);
```

**INSERT contract**:

```sql
INSERT OR IGNORE INTO edges (src_id, dst_id, kind, weight) VALUES (?, ?, ?, ?);
```

**Materialization rules** (FR-RETRIEVAL-008):

For each newly-indexed document `D_new`:

1. **tag_overlap**: For every existing document `D_i` (excluding `D_new` itself):
   - Compute `jaccard = |D_new.tags ∩ D_i.tags| / |D_new.tags ∪ D_i.tags|`.
   - If `jaccard >= 0.3` (configurable via `config.toml [retrieval].tag_overlap_threshold`): INSERT `(D_new.id, D_i.id, 'tag_overlap', jaccard)`.

2. **summary_similarity**: For every existing document `D_i`:
   - Compute `cosine = 1 - vec_distance_cosine(D_new.embedding, D_i.embedding)`.
   - If `cosine >= 0.7` (configurable via `config.toml [retrieval].summary_similarity_threshold`): INSERT `(D_new.id, D_i.id, 'summary_similarity', cosine)`.

3. **explicit_related**: For every entry in `D_new.frontmatter.related` array (if present):
   - INSERT `(D_new.id, entry, 'explicit_related', 1.0)` unconditionally.
   - If `entry` is not a valid `doc-XXXXXXXX` id, the INSERT fails the foreign-key constraint → caught + skipped + `edges.failed` event with `error_code='invalid_explicit_related_target'`.

**Invariants**:
- Edges are stored ONE-WAY (src=new doc, dst=existing doc). Bidirectional queries JOIN both columns.
- Duplicate edges (`(src, dst, kind)` already exists) are silently ignored via `INSERT OR IGNORE` — idempotency property.
- Weight is bounded: Jaccard ∈ [0, 1]; cosine ∈ [0, 1] (negative cosine values floor to 0 by threshold filter); explicit_related = 1.0.
- O(N) edges generated per new document → O(N²) cumulative. Acceptable bound for N ≤ 10k per plan.md Decision E; future HNSW/LSH sprint if needed.

---

## Entity 5 — RetrievalTelemetryEvent (≥ 12 new SP-005 classes)

All SP-005 telemetry events extend the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (additive — no breaking change to SP-001/SP-002/SP-003/SP-004 events).

**Shared envelope fields**:
- `event: string` (z.literal-narrowed per class).
- `timestamp: ISO8601`.
- `severity: z.enum(['info', 'warn', 'error'])`.
- `outcome: z.enum(['success', 'rejected', 'deduplicated', 'failed', 'aborted'])`.

**Class-specific fields** (one Zod object per class; size-budget verified per Constitution IX ≤ 4096 bytes):

| Event class | `severity` | `outcome` | Extra fields | Size budget |
|---|---|---|---|---|
| `embed.started` | info | success | `doc_id: string`, `model_name: string`, `input_token_estimate: int` | ~250 B |
| `embed.completed` | info | success | `doc_id`, `model_name`, `dimension: int`, `duration_ms: int` | ~250 B |
| `embed.failed` | error | failed | `doc_id`, `model_name`, `error_code: enum`, `message: string (max 1024)` | ~1.5 KB |
| `index.started` | info | success | `doc_id`, `body_excerpt_word_count: int`, `frontmatter_fields_present: string[]` (max 6 entries) | ~400 B |
| `index.completed` | info | success | `doc_id`, `fts5_inserted: bool`, `vec_inserted: bool`, `duration_ms: int` | ~250 B |
| `index.failed` | error | failed | `doc_id`, `error_code: enum`, `message: string (max 1024)` | ~1.5 KB |
| `edges.started` | info | success | `doc_id`, `candidate_pool_size: int` | ~200 B |
| `edges.completed` | info | success | `doc_id`, `tag_overlap_count: int`, `summary_similarity_count: int`, `explicit_related_count: int`, `duration_ms: int` | ~300 B |
| `edges.failed` | error | failed | `doc_id`, `error_code: enum`, `message: string (max 1024)` | ~1.5 KB |
| `search.started` | info | success | `query_hash: string (64 hex)`, `has_filters: bool`, `limit: int` | ~250 B |
| `search.query` | info | success | `query_hash: string (64 hex)`, `tier_used: 'hybrid'`, `result_count: int`, `signals_used: string[]`, `duration_ms: int` | ~400 B |
| `search.completed` | info | success | `query_hash`, `result_count`, `duration_ms` | ~250 B |
| `search.degraded` | warn | success | `query_hash`, `degraded_signals: string[]`, `error_codes: string[]` (one per degraded signal, max 4 entries) | ~500 B |
| `search.error` | error | failed | `query_hash` (may be absent if input was malformed pre-hashing), `error_code: enum`, `message: string (max 1024)` | ~1.5 KB |

**Discriminator**: `event` (string-literal per class). Matches SP-001/SP-002/SP-003/SP-004 `event` discriminator convention.

**Size-budget verification**: The worst plausible payload (`embed.failed` or `index.failed` or `edges.failed` or `search.error` with 1024-char message + envelope) is ~1.5 KB. All SP-005 events sit comfortably under 4 KB. The Zod schemas enforce the bounds.

**Invariants**:
- One event per state transition per document or per query (FR-RETRIEVAL-013).
- Schema-validated before serialization (Constitution V).
- Append atomic to `Paths.telemetry()` (Constitution IX).
- NO body content in any payload (Principle I + SC-RETRIEVAL-016) — `body_excerpt_word_count` is permitted (an int, not body content); `body_excerpt` text is NOT permitted.
- NO raw query text in any payload — only `query_hash` (SHA-256 hex digest of the raw query) appears.

---

## Entity 6 — ConfidenceWeights

The configurable record loaded from `config.toml [confidence_weights]` at module-load time. Defaults per ARCHITECTURE-FINAL §10.5 verbatim.

**Type**:

```typescript
type ConfidenceWeights = {
  weights: Record<FacetType, number>;  // facet_type → multiplier
  recency_boost_days: number;          // default 90
  recency_boost_weight: number;        // default 0.05
  schema_bump_penalty_weight: number;  // default -0.10
};
```

**Defaults** (verbatim from ARCHITECTURE-FINAL §10.5):

| facet_type | weight |
|---|---|
| `research-paper` | 1.20 |
| `manual` | 1.10 |
| `form` | 1.10 |
| `reference` | 1.10 |
| `article` | 1.00 |
| `notes` | 0.95 |
| `transcript` | 0.90 |
| `podcast` | 0.90 |
| `video` | 0.90 |
| `book` | 1.05 |

**Note**: §10.5's facet_type vocabulary INCLUDES some values (`research-paper`, `manual`, `form`, `article`, `notes`, `transcript`, `podcast`, `video`, `book`) that are NOT in SCHEMA.md v1.0's 7-value constitutional enum (`entity`, `concept`, `tutorial`, `analysis`, `reference`, `synthesis`, `cheat-sheet`). The plan-level resolution: ConfidenceWeights uses the SCHEMA.md 7-value enum as its key space; the §10.5 weights are mapped to the closest 7-value match by the implementation, with explicit notes in `contracts/adr-rrf-fusion.md`. Unknown facet_type values default to weight 1.0. (This is a v1 reconciliation between two pieces of project documentation; a future ADR may extend the facet_type enum or revise §10.5.)

**Mapping (v1)**:

| SCHEMA.md facet_type | §10.5 weight applied | Rationale |
|---|---|---|
| `entity` | 1.00 (default) | Not directly mapped in §10.5; default neutral. |
| `concept` | 1.00 (default) | Not directly mapped. |
| `tutorial` | 1.10 (manual) | Tutorials map most closely to "manual" in §10.5. |
| `analysis` | 1.05 (research-paper/book midpoint) | Analyses sit between research-paper and book. |
| `reference` | 1.10 (reference) | Direct mapping. |
| `synthesis` | 1.05 (book) | Syntheses map to book-grade weight. |
| `cheat-sheet` | 1.00 (default) | Not directly mapped. |

The user may override per-facet_type via `config.toml [confidence_weights] entity=0.95 concept=0.95 tutorial=1.10 ...`. Recency boost / schema-bump penalty are likewise overridable.

**Lifecycle**:
- Loaded once at module-load time from `config.toml`.
- Stable for the process lifetime; reload requires restart.

**Persistence**: not persisted — purely in-memory + the config file.

---

## Entity 7 — SearchInput (Zod-typed input to corpus.find)

The shape of the input to the `corpus.find` MCP tool. Defined in `packages/contracts/src/search-schemas.ts` (PREREQ-001).

**Required + optional fields**:

```typescript
const SearchInputZodSchema = z.object({
  query: z.string().max(2048),
  filters: z.object({
    facet_domain: z.string().optional(),
    facet_type: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.array(z.string()).optional(),
    since: z.string().regex(ISO8601_REGEX).optional(),
    until: z.string().regex(ISO8601_REGEX).optional(),
    source_type: z.string().optional(),
  }).strict().optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
```

**Field invariants**:
- `query`: bounded to 2048 chars (Plan-resolved cap; longer queries → `validation_error` envelope per FR-RETRIEVAL-004). Empty string is permitted (degenerate ranking; see spec.md edge case "Query that matches only via filter").
- `filters`: strict mode; unknown filter keys → `validation_error`.
- `limit`: bounded [1, 100]; default 20.

**Pass-through to retrievers**: Each retriever's underlying SQL adds `AND` clauses for non-null filter values. The retrievers MUST share the same filter set; partial filter application would produce inconsistent rankings.

---

## Entity 8 — SearchHit (Zod-typed output entry)

The shape of each entry in the `corpus.find` response's `hits` array.

**Fields**:

```typescript
const SearchHitZodSchema = z.object({
  uri: z.string().regex(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/),
  score: z.number(),
  title: z.string(),
  facet_domain: z.string(),
  facet_type: z.enum(FACET_TYPE_VALUES),
  tags: z.array(z.string()),
  snippet: z.string().max(400),
}).strict();
```

**Field invariants**:
- `uri`: always `corpus://docs/<doc-id>`; resolvable via SP-002 read path.
- `score`: the fused + confidence-adjusted score. Positive number; not normalized to [0,1] (RRF scores are sum-of-reciprocals, naturally < 1 per doc-retriever pair, then multiplied by confidence weight).
- `title`: from `documents.title` (SP-003-owned).
- `facet_domain`, `facet_type`, `tags`: from `documents` SQL columns (SP-004-populated).
- `snippet`: BM25-derived; first 200 chars of the matched `body_excerpt` with `<mark>...</mark>` highlight markers (or empty string if no BM25 match). Bounded to 400 chars to keep response size manageable.

---

## Entity 9 — SearchErrorEnvelope

The structured error response shape per FR-RETRIEVAL-004. Returned as a SUCCESSFUL MCP tool response (NOT a transport error).

```typescript
const SearchErrorEnvelopeZodSchema = z.object({
  error_code: z.enum([
    'validation_error',
    'embedding_unavailable',
    'index_unavailable',
    'query_aborted',
    'all_signals_failed',
    'internal_error',
  ]),
  message: z.string().max(1024),
  hint: z.string().max(1024),
}).strict();
```

**Error code semantics**:

| error_code | When | Retriable |
|---|---|---|
| `validation_error` | Input failed Zod parse | Yes (caller can fix input). |
| `embedding_unavailable` | Embedding endpoint unreachable AND every other retriever also failed; degraded responses (≥ 1 signal succeeded) do NOT return this envelope. | Yes. |
| `index_unavailable` | SQLite file unreadable / corrupted. | Maybe (operator intervention). |
| `query_aborted` | Caller's AbortSignal fired before response was ready. | Yes (caller can retry). |
| `all_signals_failed` | All four retrievers errored. | Maybe. |
| `internal_error` | Uncaught exception. | Maybe. |

**Wrapper response shape**: The envelope is wrapped in the tool's normal response shape — i.e., a malformed input doesn't crash the MCP server; the response is `{hits: [], query: <echo>, error: SearchErrorEnvelope, result_count: 0, tier_used: 'hybrid', signals_used: []}`. This is the FR-004 verbatim contract.

---

## Entity 10 — `documents` Row (post-SP-005)

SP-005 does NOT change `documents` column shape. The post-SP-005 row state mirrors the post-SP-004 state plus the implicit "has corresponding entries in documents_fts + documents_vec + zero-or-more edges". The post-SP-005 view of a "fully-indexed" row:

```sql
-- Predicate for "row has been fully indexed by SP-005":
SELECT 1
FROM documents d
WHERE d.id = ?
  AND d.facet_type != 'unclassified'
  AND EXISTS (SELECT 1 FROM documents_fts WHERE doc_id = d.id)
  AND EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = d.id);
```

The `edges` table existence is NOT a hard precondition for "indexed" status (a doc may have zero outbound edges if no other doc has Jaccard ≥ 0.3 / cosine ≥ 0.7 / explicit-related to it).

---

## Type-state machine (SP-005-extended)

The end-to-end document lifecycle post-SP-005:

```
   File in inbox
       │
       ▼  SP-003 ingest
   [documents row, sentinel: facet_type='unclassified']
       │
       ▼  SP-004 classify-stage hook (post-persist)
   [documents row, classified: facet_type != 'unclassified']  + body-file frontmatter mirrored
       │
       ▼  SP-005 embed-stage (post-classify, same drain-lock)
   [in-memory EmbeddingVector]
       │
       ▼  SP-005 index-stage (within orchestrator transaction)
   [documents_fts row INSERTed + documents_vec row INSERTed]
       │
       ▼  SP-005 edges-build-stage (within orchestrator transaction)
   [zero-or-more edges rows INSERTed]
       │
       ▼  Orchestrator COMMIT
   [classified + indexed + edges materialized]
       │
       ▼  SP-004 post-COMMIT body-file frontmatter rename (atomic)
   [document is fully observable via corpus.find AND corpus://docs/{id}]
```

The classify + embed + index + edges-build sub-stages run inside ONE drain-lock acquisition and ONE SQL transaction (FR-RETRIEVAL-007 + Constitution VIII verbatim). On any failure between BEGIN and COMMIT: ROLLBACK; row reverts to its pre-stage state; error sidecar at `Paths.failed() + '/<doc-id>.error.json'`.

---

## Idempotency (cross-sub-stage)

**Embed-stage**:
- Pre-INSERT check: `SELECT 1 FROM documents_vec WHERE doc_id = ?`. If row exists → skip (FR-RETRIEVAL-012; SC-RETRIEVAL-015).

**Index-stage**:
- Inherits the same pre-check (the embed-stage's no-op shortcuts the index-stage too).
- Additional defense-in-depth: the orchestrator's `WHERE NOT EXISTS` check pre-BEGIN.

**Edges-build-stage**:
- `INSERT OR IGNORE` semantics on the `edges` PRIMARY KEY `(src_id, dst_id, kind)`. Duplicate edges collapse silently.

**Schema migration**:
- `CREATE VIRTUAL TABLE IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` — idempotent on re-run.

---

## Persistent state summary

What SP-005 writes (atomically, transactionally):

| Path | What | When |
|---|---|---|
| `Paths.indexDb()` (table `documents_fts`) | INSERT one row | Index-stage commit |
| `Paths.indexDb()` (table `documents_vec`) | INSERT one row | Index-stage commit |
| `Paths.indexDb()` (table `edges`) | INSERT zero-or-more rows | Edges-build-stage commit |
| `Paths.failed() + '/<doc-id>.error.json'` | Index / embed / edges failure sidecar | Sub-stage error handler |
| `Paths.telemetry()` (JSONL append) | SP-005 telemetry events | Every state transition |

What SP-005 does NOT write:
- `documents` columns — SP-004-owned; SP-005's orchestrator coordinates with SP-004's persister, but SP-005 itself doesn't UPDATE `documents`.
- `taxonomy_terms` — SP-004-owned.
- Body files (Markdown + frontmatter) — SP-004-owned; SP-005 reads them at index-stage for frontmatter extraction.
- Any file under `Paths.pending()` / `Paths.processed()` — SP-003-owned subtrees.
- Any `corpus://failures` resource state — SP-006 adds this.

---

## State transitions (cross-entity)

```
   SP-004 classify-stage in-flight; orchestrator has opened BEGIN IMMEDIATE
       │
       ▼  classify-stage UPDATE documents + INSERT taxonomy_terms (SP-004; inside transaction)
   [SQL transaction in-flight; classify writes committed in-memory but not durable]
       │
       ▼  SP-005 embed-stage: POST to /api/embeddings → EmbeddingVector validated
   [in-memory vector ready]
       │
       ┌───┴────────────────────────────┐
       │ embedding unavailable          │ embedding succeeded
       ▼                                ▼
   ROLLBACK transaction         SP-005 index-stage: render FTS5 row + INSERT documents_fts + INSERT documents_vec
   sidecar: embedding_unavailable        │
                                        │
                                        ▼  SP-005 edges-build-stage: compute Jaccard + cosine + explicit-related → INSERT edges rows
                                        │
                                        ┌───┴──────────────────┐
                                        │ edges-build timeout  │ edges-build succeeded
                                        ▼                      ▼
                                  ROLLBACK transaction    COMMIT transaction
                                  sidecar: edges_build_timeout    │
                                                                  ▼
                                                            SP-004 post-COMMIT atomic rename of body-file
                                                                  │
                                                                  ▼
                                                            [fully indexed; corpus.find returns this doc]
                                                                  │
                                                                  ▼ telemetry: embed.completed + index.completed + edges.completed
                                                                end
```

---

## Field-level mapping recap (SP-005 contract for downstream sprints)

SP-006 (kill-9 survival + `corpus://failures` + tier 1/2/3 fallthrough) will consume SP-005's tables and the existing telemetry events. The forward-compatible contract:

| Column | SP-005 writes | SP-006 reads? | SP-006 overwrites? |
|---|---|---|---|
| `documents_fts.doc_id` | populated | yes (Tier 1 BM25-only retriever) | no |
| `documents_fts.title` / `summary` / `tags` / `facet_topic` / `body_excerpt` | populated | yes (Tier 1) | no |
| `documents_vec.doc_id` | populated | maybe (Tier 0 reuse for non-fallthrough cases) | no |
| `documents_vec.embedding` | populated | maybe | no |
| `edges.src_id` / `dst_id` / `kind` / `weight` | populated | maybe (Tier 0 graph retriever; not relevant to fallthrough tiers) | no |

SP-006 will ADD: a tier-fallthrough state machine + the `corpus://failures` MCP resource + kill-9 cross-stage recovery checkpoints. SP-006 does NOT modify any SP-005 column shape; the SP-005 → SP-006 boundary is clean.
