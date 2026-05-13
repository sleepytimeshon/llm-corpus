// SP-005 US1 (T042) — FTS5 BM25 retriever adapter.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-002, FR-RETRIEVAL-021
//   - specs/005-retrieval/research.md Decision C
//   - ARCHITECTURE-FINAL §10.1 (field weights: summary=5, tags=3,
//     facet_topic=2, title=2, body_excerpt=1)
//   - Constitution Principles V, VII
//
// Queries `documents_fts` (FTS5 virtual table) for BM25-ranked candidate
// doc_ids matching the query. Field weighting via the FTS5 `bm25()` ranking
// function with positional weights aligned to the table's column order:
// (doc_id_UNINDEXED, title, summary, tags, facet_topic, body_excerpt).
// bm25() ignores UNINDEXED columns; positional weights apply to the
// indexed columns only — title=2, summary=5, tags=3, facet_topic=2,
// body_excerpt=1.
//
// Filter pushdown via JOIN on `documents` when SearchFilters are non-empty.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  IndexUnavailableError,
  type SearchFilters,
} from '@llm-corpus/contracts';

export interface RankingSignalResult {
  doc_id: string;
  rank: number;
  score: number;
}

export interface RankingSignal {
  kind: 'bm25' | 'dense' | 'graph' | 'confidence';
  results: RankingSignalResult[];
  succeeded: boolean;
  error?: string;
}

export interface Fts5SearchInput {
  query: string;
  topK: number;
  filters?: SearchFilters;
  signal: AbortSignal;
}

/**
 * Escape a user-supplied query string so it can be safely embedded in an
 * FTS5 MATCH expression. FTS5 MATCH uses double-quoted phrases; we escape
 * every embedded `"` by doubling it (FTS5's own escape convention).
 */
function escapeFtsPhrase(s: string): string {
  return s.replace(/"/g, '""');
}

/**
 * Build the FTS5 MATCH expression from a user query. We tokenize on
 * whitespace and combine all tokens with the implicit AND operator —
 * FTS5's default. Empty queries produce an empty match (no rows).
 */
function buildMatchExpression(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return '';
  // Split into whitespace-delimited tokens; quote each as a phrase to
  // escape FTS5-special chars (parens, AND/OR/NOT, etc.) without
  // disabling the porter+unicode61 tokenizer's stemming.
  const tokens = trimmed.split(/\s+/u).slice(0, 32); // safety bound
  return tokens.map((t) => `"${escapeFtsPhrase(t)}"`).join(' ');
}

/**
 * Append filter clauses + bindings derived from SearchFilters. Returns the
 * additional WHERE-clause fragment (joined with `AND`) and the parameters
 * to bind in order.
 */
function buildFilterClause(
  filters: SearchFilters | undefined,
): { clause: string; params: unknown[] } {
  if (!filters) return { clause: '', params: [] };
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.facet_domain !== undefined) {
    clauses.push('d.facet_domain = ?');
    params.push(filters.facet_domain);
  }
  if (filters.facet_type !== undefined) {
    const types = Array.isArray(filters.facet_type)
      ? filters.facet_type
      : [filters.facet_type];
    if (types.length > 0) {
      const placeholders = types.map(() => '?').join(', ');
      clauses.push(`d.facet_type IN (${placeholders})`);
      params.push(...types);
    }
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    // Match any tag from the list via JSON LIKE substring — sufficient for
    // the documents.tags_json CSV-array shape SP-004 writes.
    const tagClauses = filters.tags.map(() => `d.tags_json LIKE ?`).join(' OR ');
    clauses.push(`(${tagClauses})`);
    for (const tag of filters.tags) {
      params.push(`%"${tag}"%`);
    }
  }
  if (filters.since !== undefined) {
    clauses.push('d.ingest_timestamp >= ?');
    params.push(filters.since);
  }
  if (filters.until !== undefined) {
    clauses.push('d.ingest_timestamp <= ?');
    params.push(filters.until);
  }
  if (filters.source_type !== undefined) {
    clauses.push('d.source_type = ?');
    params.push(filters.source_type);
  }
  return { clause: clauses.length === 0 ? '' : clauses.join(' AND '), params };
}

export class Fts5Adapter {
  constructor(private readonly db: DatabaseType) {}

  /**
   * Run a field-weighted BM25 query over `documents_fts`. Returns the top-K
   * results ordered by ascending BM25 score (FTS5 convention — lower BM25
   * = more relevant).
   */
  async search(
    input: Fts5SearchInput,
  ): Promise<Result<RankingSignal, IndexUnavailableError>> {
    input.signal.throwIfAborted();
    const match = buildMatchExpression(input.query);
    if (match.length === 0) {
      return ok({ kind: 'bm25', results: [], succeeded: true });
    }
    const filterParts = buildFilterClause(input.filters);
    const filterClause =
      filterParts.clause.length > 0 ? ` AND ${filterParts.clause}` : '';
    // Field weights: positional. FTS5 bm25() takes
    // (tableName, weight_for_col_0, weight_for_col_1, ...) but ignores
    // UNINDEXED columns. Our doc_id is UNINDEXED; the indexed columns in
    // order are: title, summary, tags, facet_topic, body_excerpt.
    // Per §10.1: title=2, summary=5, tags=3, facet_topic=2, body_excerpt=1.
    const sql = `
      SELECT f.doc_id AS doc_id,
             bm25(documents_fts, 2.0, 5.0, 3.0, 2.0, 1.0) AS score
        FROM documents_fts AS f
        JOIN documents AS d ON d.id = f.doc_id
       WHERE documents_fts MATCH ?
         AND d.status = 'success'${filterClause}
       ORDER BY score ASC
       LIMIT ?
    `;
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(match, ...filterParts.params, input.topK) as Array<{
        doc_id: string;
        score: number;
      }>;
      const results: RankingSignalResult[] = rows.map((r, i) => ({
        doc_id: r.doc_id,
        rank: i + 1,
        score: r.score,
      }));
      return ok({ kind: 'bm25', results, succeeded: true });
    } catch (caught) {
      return err(
        new IndexUnavailableError(
          {
            signal_kind: 'bm25',
            message: `FTS5 query failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }
  }
}
