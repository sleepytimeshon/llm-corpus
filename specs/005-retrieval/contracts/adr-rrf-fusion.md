# ADR — Fusion algorithm: Reciprocal Rank Fusion (RRF) with k=60, per-retriever top-K=64, confidence weights applied AFTER fusion

**Feature**: 005-retrieval
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

SP-005 must combine the four retrievers' result lists — BM25 (FTS5), dense cosine (sqlite-vec), graph traversal (edges), and confidence weighting — into a single ranked SearchHit list. Per FR-003 verbatim, "the four signals MUST all be inputs to ranking" — no signal may be silently disabled when partially unavailable; degradation MUST be transparent (FR-RETRIEVAL-004 `degraded_signals` annotation).

The four retrievers produce DIFFERENT score scales:

- BM25 scores: typically [0, ~30], unbounded above, sensitive to document length and query specificity.
- Cosine similarity: [0, 2] (sqlite-vec returns distance; 1 - distance = similarity in [-1, 1], thresholded to [0, 1]).
- Graph edge weights: variable per kind (Jaccard ∈ [0, 1], cosine ∈ [0, 1], explicit_related = 1.0).
- Confidence weights: [0.85, 1.25] per ARCHITECTURE-FINAL §10.5.

Combining these by weighted sum or any score-based fusion would require per-retriever normalization (min-max, z-score, etc.), which is sensitive to score-scale changes (a single high-BM25-scoring document could dominate).

ARCHITECTURE-FINAL §10.3 specifies:

```
Reciprocal Rank Fusion:
  score(doc) = sum over retrievers r of  1/(k + rank_r(doc))    where k = 60
  Each retriever returns its top-k
```

And §10.5:

```
Applied AFTER RRF fusion.
```

This ADR codifies the fusion-algorithm choice + the per-retriever top-K + the confidence-as-post-fusion-multiplier ordering.

## Decision

**Fusion algorithm**: Reciprocal Rank Fusion (RRF) with parameter k=60.

**Per-retriever top-K**: 64. Each of the four retrievers returns its top 64 documents.

**Fusion formula**:

```
rrf_score(doc) = sum over retrievers r in {bm25, dense, graph, confidence} of  1 / (60 + rank_r(doc))
```

where `rank_r(doc)` is the 1-indexed rank of `doc` in retriever `r`'s top-K (or undefined if `doc` is not in retriever `r`'s top-K, contributing 0 to the sum).

**Confidence as post-fusion multiplier** (per ARCHITECTURE-FINAL §10.5):

```
final_score(doc) = rrf_score(doc) × confidence_weight(doc.facet_type) × recency_adjustment(doc.ingest_timestamp)
```

where:
- `confidence_weight(facet_type)` is from the `ConfidenceWeights` map (Decision G in research.md; ARCHITECTURE-FINAL §10.5 defaults with v1 reconciliation for SCHEMA.md's 7-value enum).
- `recency_adjustment(ts)` is `1.05` if `ts` is within the last 90 days, `0.90` if `ts` is older than the schema-version-bump cutoff (v1.0.0 has no bump yet → adjustment is always 1.05 for recent or 1.0 for older), otherwise `1.0`.

**Caller `limit` projection**: After fusion + confidence multipliers, sort documents by `final_score` descending and return the top `limit` (default 20, max 100).

**Confidence "retriever"**: The fourth "signal" in FR-003 is the confidence weights. Per Decision C in research.md, confidence is NOT a fourth ranked-list retriever in the RRF sum; it's a per-document multiplicative weight applied AFTER RRF fusion. This is the §10.5 contract verbatim. The RRF formula above sums over `{bm25, dense, graph, confidence}` where `confidence`'s "rank list" is the candidate-union from the three other retrievers, ranked by `confidence_weight × recency_adjustment` — i.e., the confidence "retriever" surfaces the same candidate set with a confidence-only ordering. The post-fusion multiplier then amplifies the effect. This dual-application (rank-list + post-fusion-multiplier) ensures FR-003's "the four signals MUST all be inputs" verbatim contract is satisfied — confidence is both a fusion input AND a final adjustment.

## Rationale

**ARCHITECTURE-FINAL §10.3 verbatim**: The k=60 RRF formula is the architecture's named choice. SP-005 inherits without re-derivation.

**RRF is rank-based, not score-based**: Each retriever's ranks are normalized by the `1 / (k + rank)` transform. A document at rank 1 contributes `1/61 ≈ 0.0164`; at rank 64, contributes `1/124 ≈ 0.00806`; well outside top-K, contributes 0. The summation across retrievers is bounded `[0, 4/61] ≈ [0, 0.0656]` for a doc that ranks #1 in all four; a single retriever's score scale cannot dominate.

**k=60 is the canonical default**: The original RRF paper (Cormack, Clarke, Buettcher 2009) used k=60 in their TREC experiments; it's the standard default in modern hybrid-search implementations (Elasticsearch, Vespa, Weaviate, Pinecone). The k value controls the "rank-falloff sharpness" — smaller k bias more aggressively toward top-ranked docs; larger k blends ranks more evenly. k=60 is the empirically-tuned middle ground.

**Per-retriever top-K = 64**: Standard default. Large enough to provide diverse fusion candidates (4 × 64 = 256 union-candidates), small enough to keep SQL latency bounded (each retriever runs `LIMIT 64`). The union-candidate set is typically much smaller than 256 (high overlap between retrievers).

**Confidence as post-fusion multiplier (per §10.5)**: Applying confidence weights AFTER RRF preserves the rank-based fusion semantics while letting domain knowledge bias the final ordering. A research-paper at rank 5 (RRF-only) with weight 1.20 outranks an article at rank 4 (RRF-only) with weight 1.00. The multiplier effect is bounded: weights are in [0.85, 1.25], so the rank-reorder is modest — RRF still drives the gross ordering.

**Confidence as fourth-retriever-input (FR-003 verbatim)**: FR-003 requires "the four signals MUST all be inputs to ranking". If confidence were ONLY a post-fusion multiplier, it would not technically be a fusion INPUT — it would be a post-processing step. To satisfy FR-003 literally, confidence is included in the RRF sum as a fourth ranked list: the candidate-union sorted by `confidence_weight × recency_adjustment` descending, with the resulting rank fed into the RRF formula. The post-fusion multiplier amplifies the effect. This dual-application is defensible because the confidence signal is qualitatively different from BM25 / dense / graph (it's metadata, not query-relevance) — applying it in two places (fusion input + post-adjustment) is appropriate.

**The signal-disable test (SC-RETRIEVAL-003)**: With this fusion design, disabling any one of the four signals materially changes the top-K. Disabling BM25 removes one of the four `1/(k+rank)` terms per doc; disabling dense or graph likewise. Disabling confidence removes both the rank-list contribution AND the post-fusion multiplier. The test asserts: across four runs (each disabling one signal), the top-K result lists differ by ≥ 1 swap or ≥ 1 document presence/absence — verifying the fusion is genuinely four-signal.

## Alternatives considered

**Weighted sum of normalized scores**:

```
score(doc) = sum over r of w_r × normalize(score_r(doc))
```

where `normalize` is min-max or z-score per retriever, and `w_r` are tunable weights. Rejected:

- Sensitive to outlier scores in any retriever (a single high-BM25-scoring document distorts normalization).
- Requires tuning the `w_r` weights, which would need labeled training data (Constitution XVI: no eval harness in v1).
- RRF's rank-based semantic is more robust to score-scale changes (e.g., a future Ollama model update changing nomic-embed-text's score distribution).

**CombSUM / CombMNZ**:

CombSUM is the sum of (normalized) scores; CombMNZ multiplies by the count of retrievers that returned the document. Both are score-based; both are older fusion algorithms. RRF generally outperforms them empirically (per the original RRF paper + many subsequent papers). Rejected.

**Learned fusion (LambdaMART, LTR)**:

Trains a fusion model on labeled query-relevance data. Requires:

- A labeled training set (~ thousands of query-document-relevance triples).
- A training infrastructure.
- A model-update workflow.

Rejected for v1 — Constitution XVI explicitly defers the eval harness to v1.5+. Future ADR if user-review data accumulates and labels become available.

**k = 30 (sharper top-K bias)**:

Smaller k aggressively biases toward top-ranked docs in each retriever. A doc that ranks #1 in BM25 but doesn't appear in dense/graph/confidence's top-K would dominate. Rejected — k=60 per §10.3 verbatim.

**k = 120 (flatter rank falloff)**:

Larger k blends ranks more evenly across the top-K. Reduces top-1 bias. Rejected — k=60 per §10.3 verbatim.

**Per-retriever top-K = 32 (tighter)**:

Saves SQL time per retriever. Reduces fusion-candidate diversity. Rejected — 64 is the standard default; the SQL latency at K=64 is sub-millisecond.

**Per-retriever top-K = 128 (looser)**:

More diverse fusion. Marginal recall benefit. Rejected — 64 is the standard.

**Confidence applied BEFORE RRF (as per-retriever rank bias)**:

Would have each retriever's rank-list pre-multiplied by per-doc confidence. Conflates two different signal types (relevance vs. confidence). Rejected — §10.5 says AFTER.

**Confidence ONLY as post-fusion multiplier (NOT as fusion input)**:

Would violate FR-003 verbatim ("the four signals MUST all be inputs"). Rejected — the four-signal contract requires confidence to be a fusion input.

**Confidence ONLY as fusion input (NOT as post-multiplier)**:

Would violate §10.5 verbatim ("Applied AFTER RRF fusion"). Rejected.

## Consequences

**Positive**:

- ARCHITECTURE-FINAL §10.3 + §10.5 implemented verbatim.
- FR-003's four-signal contract satisfied literally (confidence is both a fusion input AND a post-adjustment).
- Rank-based fusion is robust to retriever score-scale changes.
- No training data required (Constitution XVI).
- SC-RETRIEVAL-003 (signal-disable materially changes top-K) is verifiable by construction.

**Negative / Risk**:

- **R7 (plan.md) — RRF with empty retriever results**: An empty retriever contributes 0 to the sum, which is correct but may produce surprising rankings if multiple retrievers are empty. Mitigation: unit test `tests/unit/fusion.test.ts` covers all retriever-result combinations (zero-empty, one-empty, ..., four-empty).
- **The confidence-as-dual-input design is unusual**: Most hybrid-retrieval implementations apply confidence either as a fusion input OR as a post-multiplier, not both. The dual application is necessary to satisfy FR-003 + §10.5 simultaneously. Documented here.
- **k=60 is a static constant**: A future ADR could make it configurable; v1 keeps it hardcoded per §10.3.

**Migration path to a different fusion algorithm**: A future ADR may supersede this one with a different algorithm (e.g., a learned fusion model after the v1.5+ eval harness lands). The change surface is contained to `packages/index/src/fusion.ts`; no other module would need to change. The `RankingSignal` interface (per-retriever output) is the abstraction boundary.

## References

- Constitution Principle XVI (Validation Honesty)
- FR-003 (corpus.find ranks via four-signal hybrid retrieval; "the four signals MUST all be inputs")
- ARCHITECTURE-FINAL §10.3 (Reciprocal Rank Fusion; verbatim formula + k=60)
- ARCHITECTURE-FINAL §10.5 (Confidence weights; "Applied AFTER RRF fusion")
- `specs/005-retrieval/research.md` Decisions C, G
- Cormack, Clarke, Buettcher (2009) "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods" (SIGIR)
- Elasticsearch hybrid-search documentation (RRF default k=60)
- Vespa.ai hybrid-search documentation (RRF default k=60)
