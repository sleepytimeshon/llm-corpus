// SP-004 PREREQ-005 — Proposed-term write-side adapter.
//
// References:
//   - specs/004-classifier/plan.md PREREQ-005
//   - specs/004-classifier/spec.md FR-CLASSIFY-007
//   - specs/004-classifier/research.md Decision I (ON CONFLICT DO NOTHING)
//   - specs/004-classifier/data-model.md §"Entity 3 — ProposedTerm"
//   - Constitution Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)
//
// The ONLY SP-004 write path into the `taxonomy_terms` table. By design:
//
//   1. Function signature takes ONLY (db, axis, term, signal) — no `state`
//      parameter. Defense-in-depth against future code paths attempting to
//      INSERT the promoted-state value (FORBIDDEN by Principle XV —
//      promotion is a future user-review workflow gate, never an
//      auto-trigger from SP-004).
//
//   2. The SQL string contains neither the promoted-state literal nor an
//      established_at non-NULL value. A grep over this file for the
//      single-quoted SQL form of the promoted state returns zero matches
//      (verified by T006).
//
//   3. ON CONFLICT(axis, term) DO NOTHING — duplicate proposals collapse to
//      one row. Idempotent across multiple classify-stage invocations.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  PersistError,
} from '@llm-corpus/contracts';

/** The two open vocabulary axes SP-004 can propose against. */
export type ProposedTermAxis = 'domain' | 'tag';

export interface InsertProposedTermResult {
  /** True if a new row was inserted; false if it conflicted with an existing row. */
  inserted: boolean;
}

/**
 * INSERT a proposed term into `taxonomy_terms` with `state='proposed'` and
 * `established_at=NULL`. Idempotent via `ON CONFLICT(axis, term) DO NOTHING`.
 *
 * The state literal is BAKED INTO the SQL string; the function signature
 * does NOT accept a `state` parameter. This is intentional defense-in-depth
 * against Principle XV violations (no SP-004 code path may auto-promote a
 * term to established).
 *
 * The signal is checked before bind (cancellable IO per Constitution VII).
 */
export async function insertProposedTerm(
  db: DatabaseType,
  axis: ProposedTermAxis,
  term: string,
  signal: AbortSignal,
): Promise<Result<InsertProposedTermResult, PersistError>> {
  signal.throwIfAborted();

  try {
    const stmt = db.prepare(
      `INSERT INTO taxonomy_terms (axis, term, state, established_at)
       VALUES (?, ?, 'proposed', NULL)
       ON CONFLICT(axis, term) DO NOTHING`,
    );
    const info = stmt.run(axis, term);
    return ok({ inserted: info.changes > 0 });
  } catch (caught) {
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: `taxonomy_terms INSERT failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }
}
