// SP-006 T048 — Tier 1 BM25-only retriever.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-013
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Tier 1"
//   - specs/006-hardening/data-model.md §"Entity 3 — TierResult"
//   - Constitution Principles V, VII
//
// Wraps the SP-005 Fts5Adapter — invokes ONLY the BM25 retriever (no dense,
// graph, or confidence signals). Returns a TierResult with per-hit
// `tier_used='bm25-only'`. Honors AbortSignal; on Fts5 errors, outcome=
// 'failed' (does NOT throw — the tier orchestrator falls through).

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  SearchHitZodSchema,
  type SearchInput,
  type SearchHit,
  type FacetType,
} from '@llm-corpus/contracts';
import { Fts5Adapter } from './fts5-adapter.js';

export type TierName = 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep';
export type TierOutcome = 'completed' | 'skipped' | 'failed' | 'aborted';

export interface TierResult {
  tier: TierName;
  hits: SearchHit[];
  elapsed_ms: number;
  outcome: TierOutcome;
  error?: string;
}

export interface Bm25OnlyInput {
  input: SearchInput;
  db: DatabaseType;
  topK: number;
  signal: AbortSignal;
}

/**
 * Run Tier 1 — BM25-only over `documents_fts`. Returns the FTS5-ranked
 * SearchHit list with `tier_used='bm25-only'`. Errors are surfaced as
 * `outcome='failed'` rather than thrown (the orchestrator falls through).
 */
export async function runBm25OnlyTier(
  input: Bm25OnlyInput,
): Promise<TierResult> {
  const start = Date.now();
  if (input.signal.aborted) {
    return {
      tier: 'bm25-only',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'aborted',
    };
  }

  const fts5 = new Fts5Adapter(input.db);
  try {
    const r = await fts5.search({
      query: input.input.query,
      topK: input.topK,
      filters: input.input.filters,
      signal: input.signal,
    });
    if (!r.ok) {
      return {
        tier: 'bm25-only',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'failed',
        error: r.error.message.slice(0, 256),
      };
    }
    const ftsResults = r.value;
    // Promote FTS5 rows to SearchHit shape — pull title / facet_* / tags from
    // documents; snippet from documents_fts.body_excerpt.
    const docIds = ftsResults.results.map((rs) => rs.doc_id);
    const hits = buildBm25Hits(input.db, ftsResults.results, docIds, input.input.limit);
    return {
      tier: 'bm25-only',
      hits,
      elapsed_ms: Date.now() - start,
      outcome: 'completed',
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    // AbortError → outcome='aborted'; everything else → failed.
    if (input.signal.aborted) {
      return {
        tier: 'bm25-only',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'aborted',
      };
    }
    return {
      tier: 'bm25-only',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'failed',
      error: message.slice(0, 256),
    };
  }
}

function buildBm25Hits(
  db: DatabaseType,
  results: ReadonlyArray<{ doc_id: string; rank: number; score: number }>,
  docIds: readonly string[],
  limit: number,
): SearchHit[] {
  if (docIds.length === 0) return [];
  const placeholders = docIds.map(() => '?').join(', ');
  type DocRow = {
    id: string;
    title: string;
    facet_domain: string;
    facet_type: string;
    tags_json: string;
  };
  const rows = db
    .prepare(
      `SELECT id, title, facet_domain, facet_type, tags_json
         FROM documents
        WHERE id IN (${placeholders}) AND status = 'success'`,
    )
    .all(...docIds) as DocRow[];
  const docMap = new Map<string, DocRow>(rows.map((r) => [r.id, r]));

  // Snippet fetch — best-effort; failure → empty snippet.
  let snippetMap: Map<string, string>;
  try {
    const fts = db
      .prepare(
        `SELECT doc_id, body_excerpt
           FROM documents_fts
          WHERE doc_id IN (${placeholders})`,
      )
      .all(...docIds) as Array<{ doc_id: string; body_excerpt: string }>;
    snippetMap = new Map(
      fts.map((r) => [r.doc_id, (r.body_excerpt ?? '').slice(0, 200)]),
    );
  } catch {
    snippetMap = new Map();
  }

  const hits: SearchHit[] = [];
  for (const rs of results) {
    if (hits.length >= limit) break;
    const row = docMap.get(rs.doc_id);
    if (!row) continue;
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(row.tags_json) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      // empty tags
    }
    const candidate = {
      uri: `corpus://docs/${row.id}` as const,
      score: rs.score,
      title: row.title,
      facet_domain: row.facet_domain,
      facet_type: row.facet_type as FacetType,
      tags,
      snippet: snippetMap.get(row.id) ?? '',
      tier_used: 'bm25-only' as const,
    };
    const parsed = SearchHitZodSchema.safeParse(candidate);
    if (parsed.success) {
      hits.push(parsed.data);
    }
  }
  return hits;
}
