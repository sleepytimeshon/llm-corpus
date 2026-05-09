// T044 — Read-only adapter for corpus://taxonomy (US2).
//
// References: FR-006, contracts/resource-taxonomy.md, Constitution V, XV
// (promoted-only), VIII (parameterized binding — no SQL injection).
//
// Returns the 4-axis envelope (domains/tags/types/source_types) of
// `state = 'established'` terms only. Per-term document_count uses:
//   - facet_domain  for axis='domain'
//   - json_each(d.tags_json) for axis='tag'
//   - facet_type    for axis='type'
//   - source_type   for axis='source_type'
// All count queries restrict to status='success'.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  err,
  ok,
  type Result,
  IndexLockedError,
  type TaxonomyPayloadType,
  type TaxonomyTermType,
} from '@llm-corpus/contracts';
import { openIndexReadOnly, isSqliteBusyError } from './sqlite-open.js';

type TaxonomyAxis = 'domain' | 'tag' | 'type' | 'source_type';

/**
 * Count documents whose `tags_json` array contains the given tag, restricted
 * to `status = 'success'`. Uses SQLite's json1 `json_each()` extension
 * (built into better-sqlite3 by default).
 *
 * Constitution VIII: parameterized binding only — the tag value is a bind
 * parameter, never interpolated into the SQL string.
 */
export function countDocsWithTag(db: DatabaseType, tag: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT d.id) AS n
         FROM documents d, json_each(d.tags_json) AS j
        WHERE d.status = 'success' AND j.value = ?`,
    )
    .get(tag) as { n: number };
  return row.n;
}

function countDocsForAxis(
  db: DatabaseType,
  axis: TaxonomyAxis,
  term: string,
): number {
  switch (axis) {
    case 'domain': {
      const r = db
        .prepare(
          `SELECT COUNT(*) AS n FROM documents WHERE status = 'success' AND facet_domain = ?`,
        )
        .get(term) as { n: number };
      return r.n;
    }
    case 'tag':
      return countDocsWithTag(db, term);
    case 'type': {
      const r = db
        .prepare(
          `SELECT COUNT(*) AS n FROM documents WHERE status = 'success' AND facet_type = ?`,
        )
        .get(term) as { n: number };
      return r.n;
    }
    case 'source_type': {
      const r = db
        .prepare(
          `SELECT COUNT(*) AS n FROM documents WHERE status = 'success' AND source_type = ?`,
        )
        .get(term) as { n: number };
      return r.n;
    }
  }
}

function buildAxis(db: DatabaseType, axis: TaxonomyAxis): TaxonomyTermType[] {
  // Established-only filter — Constitution XV.
  const rows = db
    .prepare(
      `SELECT term FROM taxonomy_terms WHERE axis = ? AND state = 'established' ORDER BY term ASC`,
    )
    .all(axis) as Array<{ term: string }>;
  return rows.map((r) => ({
    term: r.term,
    document_count: countDocsForAxis(db, axis, r.term),
  }));
}

/**
 * Compose the 4-axis taxonomy envelope.
 */
export async function buildTaxonomy(
  signal: AbortSignal,
): Promise<Result<TaxonomyPayloadType, IndexLockedError>> {
  signal.throwIfAborted();
  const db = openIndexReadOnly();
  try {
    const payload: TaxonomyPayloadType = {
      domains: buildAxis(db, 'domain'),
      tags: buildAxis(db, 'tag'),
      types: buildAxis(db, 'type'),
      source_types: buildAxis(db, 'source_type'),
    };
    return ok(payload);
  } catch (caught) {
    if (isSqliteBusyError(caught)) {
      return err(new IndexLockedError({ uri: 'corpus://taxonomy' }));
    }
    throw caught;
  } finally {
    db.close();
  }
}
