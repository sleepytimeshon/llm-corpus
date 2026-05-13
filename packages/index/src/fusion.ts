// SP-005 US1 (T047) — RRF fusion + post-fusion confidence multiplier.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-002, FR-RETRIEVAL-009
//   - specs/005-retrieval/contracts/adr-rrf-fusion.md
//   - ARCHITECTURE-FINAL §10.3 (RRF k=60) + §10.5 (confidence as post-mult)
//   - Constitution Principle V
//
// Reciprocal Rank Fusion verbatim:
//
//   rrf_score(doc) = sum over r in {bm25, dense, graph, confidence} of
//                       1 / (k + rank_r(doc))
//
// Then per ARCHITECTURE-FINAL §10.5:
//
//   final_score(doc) = rrf_score(doc) × confidence_weight(doc.facet_type)
//                                       × recency_adjustment(doc.ingest_ts)
//
// Confidence is DUAL-APPLIED (fusion input + post-fusion multiplier) to
// satisfy both FR-003 ("four signals MUST all be inputs") and §10.5
// ("Applied AFTER RRF fusion"). See adr-rrf-fusion.md "Rationale".

import type { RankingSignal } from './fts5-adapter.js';

export interface FuseRrfInput {
  signals: readonly RankingSignal[];
  k: number;
  /**
   * Map of doc_id → post-fusion confidence multiplier. Computed by the
   * ConfidenceAdapter (and reused — same value as the confidence signal's
   * scoring per ADR adr-rrf-fusion §"Rationale" dual-application).
   */
  confidenceWeights: ReadonlyMap<string, number>;
  /** Cap the returned list to this many entries (caller's `limit`). */
  limit: number;
}

export interface FusedHit {
  doc_id: string;
  /** RRF + confidence-multiplied final score. */
  score: number;
  /** Map from signal kind → rank (1-indexed) contributing to the RRF sum. */
  contributingRanks: Partial<Record<RankingSignal['kind'], number>>;
}

/**
 * Run RRF + confidence multiplier. Returns the top-N fused hits ordered
 * by final_score descending.
 *
 * Implementation detail: documents NOT in retriever r's top-K contribute
 * 0 to the sum (correct per the RRF formula). The `contributingRanks`
 * field surfaces which retrievers contributed for observability.
 */
export function fuseRrf(input: FuseRrfInput): FusedHit[] {
  const { signals, k, confidenceWeights, limit } = input;

  // doc_id → { rrf_sum: number; contributingRanks: Record<kind, number> }
  const scoreMap = new Map<
    string,
    { rrf: number; contrib: Partial<Record<RankingSignal['kind'], number>> }
  >();

  for (const signal of signals) {
    if (!signal.succeeded) continue;
    for (const r of signal.results) {
      const entry = scoreMap.get(r.doc_id) ?? {
        rrf: 0,
        contrib: {},
      };
      entry.rrf += 1 / (k + r.rank);
      entry.contrib[signal.kind] = r.rank;
      scoreMap.set(r.doc_id, entry);
    }
  }

  const fused: FusedHit[] = [];
  for (const [docId, entry] of scoreMap.entries()) {
    const cw = confidenceWeights.get(docId) ?? 1.0;
    fused.push({
      doc_id: docId,
      score: entry.rrf * cw,
      contributingRanks: entry.contrib,
    });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit);
}
