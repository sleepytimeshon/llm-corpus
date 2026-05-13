// SP-005 US1 (T043) — sqlite-vec dense-cosine retriever adapter.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-002, FR-RETRIEVAL-005
//   - specs/005-retrieval/research.md Decision B
//   - Constitution Principles V, VII
//
// Queries `documents_vec` for documents whose embedding has the smallest
// cosine distance to the query embedding. Filter pushdown via JOIN on
// `documents` when filters are non-empty.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  IndexUnavailableError,
  type SearchFilters,
} from '@llm-corpus/contracts';
import { encodeEmbeddingForVec0 } from '@llm-corpus/storage';
import type { RankingSignal, RankingSignalResult } from './fts5-adapter.js';

export interface VecSearchInput {
  queryEmbedding: Float32Array;
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

export class VecAdapter {
  constructor(private readonly db: DatabaseType) {}

  async search(
    input: VecSearchInput,
  ): Promise<Result<RankingSignal, IndexUnavailableError>> {
    input.signal.throwIfAborted();
    const filterParts = buildFilterClause(input.filters);
    const filterClause =
      filterParts.clause.length > 0 ? ` AND ${filterParts.clause}` : '';
    const sql = `
      SELECT v.doc_id AS doc_id,
             vec_distance_cosine(v.embedding, ?) AS dist
        FROM documents_vec AS v
        JOIN documents AS d ON d.id = v.doc_id
       WHERE d.status = 'success'${filterClause}
       ORDER BY dist ASC
       LIMIT ?
    `;
    try {
      const stmt = this.db.prepare(sql);
      const encoded = encodeEmbeddingForVec0(input.queryEmbedding);
      const rows = stmt.all(encoded, ...filterParts.params, input.topK) as Array<{
        doc_id: string;
        dist: number;
      }>;
      const results: RankingSignalResult[] = rows.map((r, i) => ({
        doc_id: r.doc_id,
        rank: i + 1,
        // Convert distance to similarity-ish score: 1 - dist. RRF only uses
        // rank, but the score is exposed for debug / observability.
        score: 1 - r.dist,
      }));
      return ok({ kind: 'dense', results, succeeded: true });
    } catch (caught) {
      return err(
        new IndexUnavailableError(
          {
            signal_kind: 'dense',
            message: `vec0 query failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }
  }
}
