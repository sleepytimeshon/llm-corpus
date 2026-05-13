// SP-005 US1 (T045) — Confidence-weight retriever adapter.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-002, FR-RETRIEVAL-009
//   - specs/005-retrieval/research.md Decision G
//   - ARCHITECTURE-FINAL §10.5 (confidence-weight defaults + recency adj)
//   - Constitution Principles V, VII
//
// Computes the per-document confidence weight × recency adjustment for a
// set of candidate doc_ids. The fourth fusion input per FR-003 verbatim:
// a ranked list ordered by `confidence_weight × recency_adjustment`
// descending. The same numeric value is also applied as a post-fusion
// multiplier in the fuse module (per ARCHITECTURE-FINAL §10.5).

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  IndexUnavailableError,
  type SearchFilters,
} from '@llm-corpus/contracts';
import type { FacetType } from '@llm-corpus/contracts';
import type { RankingSignal, RankingSignalResult } from './fts5-adapter.js';

export interface ConfidenceWeights {
  /** Per-facet_type multiplier. Unknown facet_types default to 1.0. */
  readonly weights: Readonly<Record<string, number>>;
  /** Recency boost window in days. Default 90. */
  readonly recencyBoostDays: number;
  /** Recency boost weight (added to multiplier when in window). Default 0.05. */
  readonly recencyBoostWeight: number;
  /** Schema-version-bump penalty (added to multiplier when older). Default -0.10. */
  readonly schemaBumpPenaltyWeight: number;
}

/**
 * SP-005 v1 default confidence-weight map. Maps the SCHEMA.md 7-value
 * facet_type enum onto §10.5's broader vocabulary per data-model.md
 * §"Entity 6 — ConfidenceWeights — Mapping (v1)".
 */
export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = Object.freeze({
  weights: Object.freeze({
    entity: 1.0,
    concept: 1.0,
    tutorial: 1.1,
    analysis: 1.05,
    reference: 1.1,
    synthesis: 1.05,
    'cheat-sheet': 1.0,
  }) as Readonly<Record<FacetType, number>>,
  recencyBoostDays: 90,
  recencyBoostWeight: 0.05,
  schemaBumpPenaltyWeight: -0.1,
});

export function confidenceWeightFor(
  facetType: string,
  ingestTimestamp: string,
  weightsConfig: ConfidenceWeights,
  nowMs: number = Date.now(),
): number {
  const base = weightsConfig.weights[facetType] ?? 1.0;
  let adjustment = 1.0;
  const ingestMs = Date.parse(ingestTimestamp);
  if (Number.isFinite(ingestMs)) {
    const ageDays = (nowMs - ingestMs) / (24 * 60 * 60 * 1000);
    if (ageDays <= weightsConfig.recencyBoostDays) {
      adjustment += weightsConfig.recencyBoostWeight;
    }
    // schema-version-bump penalty is v1-disabled (no schema_version
    // column exists yet); the field is parameterized in the config so a
    // future migration can flip it on without code changes.
  }
  return base * adjustment;
}

export interface ConfidenceScoreInput {
  docIds: readonly string[];
  weightsConfig: ConfidenceWeights;
  signal: AbortSignal;
}

export class ConfidenceAdapter {
  constructor(private readonly db: DatabaseType) {}

  /**
   * Score the candidate doc_ids by confidence_weight × recency_adjustment.
   * Returns a RankingSignal ordered descending by score. Used as the
   * fourth fusion input (per FR-003) — the same weight value is applied
   * as a post-fusion multiplier in fuse.ts.
   */
  async score(
    input: ConfidenceScoreInput,
  ): Promise<Result<RankingSignal, IndexUnavailableError>> {
    input.signal.throwIfAborted();
    if (input.docIds.length === 0) {
      return ok({ kind: 'confidence', results: [], succeeded: true });
    }
    const placeholders = input.docIds.map(() => '?').join(', ');
    try {
      const rows = this.db
        .prepare(
          `SELECT id AS doc_id, facet_type, ingest_timestamp
             FROM documents
            WHERE id IN (${placeholders}) AND status = 'success'`,
        )
        .all(...input.docIds) as Array<{
          doc_id: string;
          facet_type: string;
          ingest_timestamp: string;
        }>;
      const scored = rows.map((r) => ({
        doc_id: r.doc_id,
        score: confidenceWeightFor(
          r.facet_type,
          r.ingest_timestamp,
          input.weightsConfig,
        ),
      }));
      scored.sort((a, b) => b.score - a.score);
      const results: RankingSignalResult[] = scored.map((r, i) => ({
        doc_id: r.doc_id,
        rank: i + 1,
        score: r.score,
      }));
      return ok({ kind: 'confidence', results, succeeded: true });
    } catch (caught) {
      return err(
        new IndexUnavailableError(
          {
            signal_kind: 'confidence',
            message: `confidence query failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }
  }
}

// Re-export the SearchFilters type for convenience (callers building
// confidence adapters often want to apply the same filter set).
export type { SearchFilters };
