# ADR — Edges materialization: post-classify + post-embed, inside same transaction; thresholds Jaccard 0.3 / cosine 0.7 / explicit-related unconditional; O(N) per new doc with O(N²) cumulative bound

**Feature**: 005-retrieval
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

SP-005's graph retriever (one of the four hybrid-retrieval signals per FR-003) traverses an `edges` table that materializes pairwise relationships between documents. Per ARCHITECTURE-FINAL §10.4:

```
Knowledge-Graph Edges:
  edges(src_id, dst_id, kind, weight) table
  kind in {tag_overlap, summary_similarity, explicit_related}
  - Tag overlap: Jaccard coefficient between `tags` arrays
  - Summary-embedding cosine similarity (uses same vector index)
  - Explicit `related` array in frontmatter
```

The architecture mandates the edge kinds and the broad construction rules; this ADR codifies the open variables:

- **When are edges materialized?** Per ingest (eagerly), per query (lazily), or via a separate background job?
- **What thresholds gate edge insertion?** Below what Jaccard / cosine value is the edge irrelevant?
- **What's the scaling bound?** O(N) per new doc means O(N²) cumulative as the corpus grows. At what corpus size does this become problematic?
- **Where in the per-doc sub-stage chain does edges-build run?** Before, during, or after the index-stage SQL transaction?
- **Idempotency**: Re-running edges-build on a doc that already has edges — what happens?

## Decision

**Materialization timing**: Edges-build runs as a sub-stage AFTER classify + embed sub-stages commit, INSIDE the same drain-lock window and INSIDE the same SQL transaction that the index-stage commits FTS5 + vec rows. The sub-stage chain is:

```
classify → embed → index → edges-build
```

All four sub-stages run inside one `BEGIN IMMEDIATE ... COMMIT` block. The classify-stage's SQL UPDATE + taxonomy_terms INSERTs (SP-004) + the index-stage's FTS5 + vec INSERTs (SP-005) + the edges-build's edges INSERTs commit together per Constitution VIII verbatim ("FTS5 row + docs row + sqlite-vec row for the same document MUST commit together in a single transaction or not at all; partial index state is a forbidden permitted state").

**Edge thresholds**:

| kind | Threshold | Configurable via |
|---|---|---|
| `tag_overlap` | Jaccard ≥ 0.3 | `config.toml [retrieval].tag_overlap_threshold` |
| `summary_similarity` | cosine ≥ 0.7 | `config.toml [retrieval].summary_similarity_threshold` |
| `explicit_related` | unconditional | — (frontmatter `related` array is the user's intent; no threshold) |

**Scaling bound**: O(N) edges per new doc → O(N²) cumulative as the corpus grows. Acceptable for N ≤ 10k (the user's expected corpus size). Above N=10k, the per-doc edges-build wall-clock approaches the 15s interactive / 60s batch budget; future ADR may introduce HNSW or LSH for approximate nearest-neighbor candidates.

**Materialization scope**: For each newly-indexed document `D_new`, the edges-build sub-stage iterates ALL existing classified documents `D_i` (where `D_i.facet_type != 'unclassified'` AND `D_i.id != D_new.id`) and computes:

1. `tag_jaccard(D_new.tags, D_i.tags)`; if ≥ tag_overlap_threshold → INSERT edge `(D_new.id, D_i.id, 'tag_overlap', tag_jaccard)`.
2. `cosine = 1 - vec_distance_cosine(D_new.embedding, D_i.embedding)`; if ≥ summary_similarity_threshold → INSERT edge `(D_new.id, D_i.id, 'summary_similarity', cosine)`.
3. For each entry in `D_new.frontmatter.related` array: INSERT edge `(D_new.id, entry, 'explicit_related', 1.0)`. If `entry` is not a valid `doc-XXXXXXXX` id (foreign-key violation), skip + emit `edges.failed` event with `error_code='invalid_explicit_related_target'`.

**Edge directionality**: Edges are inserted as `(D_new.id, D_i.id, ...)` only — the new doc is the source, the existing doc is the destination. For `tag_overlap` and `summary_similarity`, the relationship is symmetric; queries traverse both directions via `WHERE src_id = ? OR dst_id = ?` JOIN.

**Idempotency**: Re-running edges-build on a doc that already has edges uses `INSERT OR IGNORE INTO edges (...) VALUES (...)`. The PRIMARY KEY `(src_id, dst_id, kind)` enforces uniqueness; duplicates collapse silently.

## Rationale

**Materialization at index-time (eager) vs query-time (lazy)**:

- Eager (chosen): edges materialized once per new doc; query-time graph traversal is a cheap `SELECT ... FROM edges WHERE src_id IN (...) OR dst_id IN (...)` over a pre-built table.
- Lazy: edges computed at query time, against the candidate pool from BM25/dense retrievers. Saves storage; multiplies query latency.

Eager wins for the read-heavy hybrid retrieval pattern (one ingest, many queries). The storage cost (one row per edge, typically 50-100 bytes) is negligible — 10k docs × 10 edges per doc × 100 bytes = 10 MB.

**Same-transaction-as-classify+index (Constitution VIII verbatim)**:

Constitution VIII: "Index writes (FTS5 row + docs row + sqlite-vec row for the same document) MUST commit together in a single transaction or not at all; partial index state is a forbidden permitted state."

The edges-build is logically part of "index writes" — the graph signal is a retrieval input alongside FTS5 and vec. Committing edges in a separate transaction would create a brief window where FTS5 + vec are populated but edges are not — observably inconsistent (a query at that moment would see the doc in BM25 + dense but not in graph). The Constitution VIII verbatim language ("MUST commit together") covers FTS5 + vec; this ADR EXTENDS the contract to include edges from the same doc, on the same principle.

**Threshold 0.3 for tag-Jaccard**:

A moderately-permissive threshold. Two docs sharing ≥ 30% of their tag-union are plausibly related. With typical SP-004 tag arrays of 3-10 tags, Jaccard ≥ 0.3 means ~2 shared tags out of ~5-7 union — non-trivial overlap. Lower thresholds (0.1) produce O(N) noisy edges per doc; higher thresholds (0.5) produce too-sparse graphs. 0.3 is the calibrated default; user can tune.

**Threshold 0.7 for summary-cosine**:

A high-confidence threshold. Two docs with cosine ≥ 0.7 are very semantically similar (cosine 0.7 corresponds to a small angle between vectors). Empirically, cosine ≥ 0.7 captures pairs that a human reviewer would agree are "about the same thing"; cosine ≥ 0.5 captures looser semantic neighborhoods. 0.7 is the high-confidence default; user can tune downward for denser graphs.

**Explicit_related is unconditional**:

User intent is the strongest signal. If the document's frontmatter `related` array names doc-IDs, the user has explicitly asserted relatedness. No threshold; weight = 1.0.

**O(N²) cumulative bound at N ≤ 10k**:

- N=1k: each new doc computes 1k tag-Jaccard + 1k cosine = 2k pairwise computations. Sub-second on pai-node01.
- N=10k: each new doc computes 10k tag-Jaccard + 10k cosine = 20k pairwise computations. ~5 ms × 20k = ~100s if cosine is the bottleneck (sqlite-vec's `vec_distance_cosine` is C-native and sub-100µs per call) → realistic estimate ~2-5 seconds. Within the 15s interactive / 60s batch edges-build budget.
- N=100k: would exceed the budget. Future HNSW/LSH ADR.

The user's expected corpus size is ≤ 10k for the foreseeable future (single user, single machine, knowledge substrate not data lake).

**Edge directionality (one-way storage)**:

Inserting only `(D_new, D_i)` edges (not the reverse) halves storage. Query-time bidirectional traversal via `WHERE src_id = ? OR dst_id = ?` is cheap (the `idx_edges_src` + `idx_edges_dst` indices cover both directions).

**Idempotency via `INSERT OR IGNORE`**:

If `corpus reindex` re-runs on a doc that already has edges, the second INSERT collides with the PRIMARY KEY `(src_id, dst_id, kind)` and is silently ignored. No data loss; no error. Combined with the embed-stage's pre-INSERT check `WHERE NOT EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = ?)` (FR-RETRIEVAL-012), re-running embed + index + edges on indexed rows is a 0-call no-op.

## Alternatives considered

**Materialization at query-time (lazy)**:

Compute edges on-the-fly during retrieval, against the candidate pool from BM25/dense. Saves storage; multiplies query latency by O(K) per query (where K is the candidate pool size, typically 64-256). The §10.6 sub-20 ms Tier 0 target becomes harder. Rejected.

**Background-job materialization (eventually consistent)**:

A separate process scans for new docs and materializes edges asynchronously. Violates Constitution VIII verbatim — would leave a window of FTS5 + vec populated without edges. Rejected.

**HNSW or LSH for approximate-cosine candidates**:

Would reduce per-doc cost from O(N) to O(log N) for the cosine pair-search. sqlite-vec v0.1.x doesn't ship HNSW. Adding a separate ANN library (faiss-node, hnswlib-node) adds dependency + native-addon allowlist promotion. Rejected for v1; future ADR if N approaches 10k+ in practice.

**Higher tag-Jaccard threshold (0.5)**:

Sparser graph; misses some semantically-related pairs. Rejected; 0.3 is calibrated for the user's expected corpus diversity. Configurable.

**Lower summary-cosine threshold (0.5)**:

Denser graph; introduces noisy edges (semantic neighbors that aren't really "related"). Rejected for v1; 0.7 is the high-confidence threshold. Configurable.

**Thresholded explicit_related**:

Doesn't make sense semantically — user intent has no "below-threshold" state.

**Symmetric edge storage (insert both `(A,B)` and `(B,A)`)**:

Doubles storage. Marginal query-time benefit (single-direction JOIN). Rejected.

**Eventual edges-build via janitor**:

A periodic janitor scans for docs without edges and materializes. Adds a background-job surface (Constitution III ?). Rejected — the in-transaction materialization satisfies Constitution VIII and removes the janitor surface.

**Stored edges with TTL / expiry**:

Edges age out automatically. Adds a cleanup surface. Rejected for v1; edges are durable until the doc is deleted (and v1 doesn't ship doc deletion).

## Consequences

**Positive**:

- ARCHITECTURE-FINAL §10.4 implemented verbatim with named thresholds.
- Constitution VIII verbatim contract satisfied (FTS5 + vec + edges commit together).
- Query-time graph traversal is cheap (`SELECT ... FROM edges WHERE src_id = ? OR dst_id = ?` over indexed columns).
- Idempotent via `INSERT OR IGNORE` + PRIMARY KEY.
- Bidirectional storage halved (one-way INSERT + JOIN both columns).
- Configurable thresholds let the user tune density.

**Negative / Risk**:

- **R5 (plan.md) — O(N²) cumulative edges-build wall-clock at scale**: For N ≤ 10k, the per-doc edges-build is within budget (15s interactive / 60s batch). Above N=10k, the budget may be exceeded. Mitigation: per-doc edges-build has a timeout (caught by AbortController); thresholds are configurable so the user can tighten them to reduce edge count; future HNSW/LSH ADR. Documented in plan.md R5 + quickstart.md troubleshooting.
- **The edges-build sub-stage is the longest of the four sub-stages at scale**: For N=10k, ~2-5s vs sub-second for embed + index. Mitigation: the per-doc total budget (30s interactive / 120s batch) accommodates.
- **Foreign-key constraint failures for explicit_related**: A doc's frontmatter `related` array may reference a non-existent doc-id (user error). The INSERT fails the FK check; the edges-build catches + skips + emits `edges.failed` with `error_code='invalid_explicit_related_target'`. The other edge kinds for this doc still succeed (the failure is per-explicit-related-entry, not per-doc).
- **Edge density grows with corpus**: As N grows, the average number of edges per doc grows. Mitigation: configurable thresholds let the user adjust.

**Migration path to a different edge model**: A future ADR may supersede this one with (a) HNSW/LSH approximate candidates, (b) a different threshold strategy (e.g., top-K per source instead of threshold-based), (c) chunk-level edges for long documents. The change surface is contained to `packages/index/src/edges-builder.ts`; the `edges` table schema is stable.

## References

- Constitution Principle VIII (Atomic Writes & Transactional Index Updates — verbatim "MUST commit together")
- Constitution Principle IX (Concurrency-Safe Shared State — single drain-lock)
- Constitution Principle X (Idempotent Pipeline Transitions)
- Constitution Principle XVI (Validation Honesty — scale bound documented honestly)
- ARCHITECTURE-FINAL §10.4 (Knowledge-Graph Edges)
- `specs/005-retrieval/research.md` Decision E
- `specs/005-retrieval/plan.md` Risk Register R5
- sqlite-vec `vec_distance_cosine` SQL function documentation
