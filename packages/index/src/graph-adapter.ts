// SP-005 US1 (T044) — Graph-traversal retriever adapter.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-002, FR-RETRIEVAL-008
//   - specs/005-retrieval/research.md Decision E
//   - Constitution Principles V, VII
//
// Given a set of seed doc_ids (typically the union of FTS5 + vec top-K),
// returns documents reachable via the `edges` table in either direction —
// edges are stored one-way but queries traverse both via UNION.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  IndexUnavailableError,
  type SearchFilters,
} from '@llm-corpus/contracts';
import type { RankingSignal, RankingSignalResult } from './fts5-adapter.js';

export interface GraphSearchInput {
  seedDocIds: readonly string[];
  topK: number;
  filters?: SearchFilters;
  signal: AbortSignal;
}

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

export class GraphAdapter {
  constructor(private readonly db: DatabaseType) {}

  async search(
    input: GraphSearchInput,
  ): Promise<Result<RankingSignal, IndexUnavailableError>> {
    input.signal.throwIfAborted();
    if (input.seedDocIds.length === 0) {
      return ok({ kind: 'graph', results: [], succeeded: true });
    }
    const filterParts = buildFilterClause(input.filters);
    const filterClause =
      filterParts.clause.length > 0 ? ` AND ${filterParts.clause}` : '';
    const placeholders = input.seedDocIds.map(() => '?').join(', ');
    // Bidirectional: edges are stored one-way (src=new, dst=existing) but
    // queries traverse both directions. Group by reached_id and take the
    // max edge weight per (reached_id) pair as the score.
    const sql = `
      WITH reached AS (
        SELECT e.dst_id AS reached_id, e.weight AS w
          FROM edges AS e
         WHERE e.src_id IN (${placeholders})
        UNION ALL
        SELECT e.src_id AS reached_id, e.weight AS w
          FROM edges AS e
         WHERE e.dst_id IN (${placeholders})
      )
      SELECT r.reached_id AS doc_id,
             MAX(r.w) AS score
        FROM reached AS r
        JOIN documents AS d ON d.id = r.reached_id
       WHERE d.status = 'success'${filterClause}
       GROUP BY r.reached_id
       ORDER BY score DESC
       LIMIT ?
    `;
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(
        ...input.seedDocIds,
        ...input.seedDocIds,
        ...filterParts.params,
        input.topK,
      ) as Array<{ doc_id: string; score: number }>;
      const results: RankingSignalResult[] = rows.map((r, i) => ({
        doc_id: r.doc_id,
        rank: i + 1,
        score: r.score,
      }));
      return ok({ kind: 'graph', results, succeeded: true });
    } catch (caught) {
      return err(
        new IndexUnavailableError(
          {
            signal_kind: 'graph',
            message: `graph query failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }
  }
}
