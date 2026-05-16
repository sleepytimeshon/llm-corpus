// SP-007 T067 — `corpus taxonomy promote` library helpers (drain-lock
// serialized, idempotent, Zod-validated argv).
//
// References:
//   - specs/007-install-first-run/tasks.md T062..T069
//   - specs/007-install-first-run/spec.md FR-INSTALL-014, SC-007-018..022
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)
//   - Constitution Principles V, VIII, IX (drain-lock), X (idempotent), XIII
//
// ============================================================================
// SCHEMA-GAP RESOLUTION (option 2 — query-time count from `documents`)
// ============================================================================
//
// The spec references a `proposed_count` column on `taxonomy_terms`, but the
// live schema at `packages/storage/src/schema-migration.ts` only defines
// `(axis, term, state, established_at)`. SP-007's `--from-proposed-with-count-ge=N`
// flag requires per-term occurrence counts.
//
// Rather than adding a migration (which would conflict with the spec's
// "ZERO new SQL tables" Out-of-Scope clause and require an ADR amendment),
// we compute the count at query time against the `documents` table.
//
// The classifier persister (packages/storage/src/classify-persister.ts) writes
// the proposed term into `documents.facet_domain` / `documents.tags_json` /
// etc. when the LLM emits a proposed term that the persister INSERTs into
// `taxonomy_terms` with state='proposed'. So:
//
//   - axis='domain'      → count = SELECT count(*) FROM documents
//                          WHERE facet_domain = ? AND status = 'success'
//   - axis='tag'         → count = SELECT count(*) FROM documents,
//                          json_each(documents.tags_json) je
//                          WHERE je.value = ? AND documents.status = 'success'
//   - axis='type'        → count = SELECT count(*) FROM documents
//                          WHERE facet_type = ? AND status = 'success'
//   - axis='source_type' → count = SELECT count(*) FROM documents
//                          WHERE source_type = ? AND status = 'success'
//
// This is lossless: the count IS the historical truth (number of successful
// documents the classifier wrote with this proposed term), not a
// denormalized cache. No migration, no ADR amendment, no schema drift.
// See engineer-report.md for the full resolution rationale.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  TaxonomyPromoteArgsZodSchema,
  TaxonomyPromoteArgsError,
  TaxonomyPromoteMissingTermError,
  TaxonomyPromoteLockContentionError,
  emitTelemetry,
  type TaxonomyPromoteArgs,
  type TaxonomyAxis,
} from '@llm-corpus/contracts';
import { acquireDrainLock } from '@llm-corpus/pipeline';
import { openIndexReadWrite } from '@llm-corpus/storage';

/* ------------------------- argv parsing ------------------------------ */

/**
 * Parse `corpus taxonomy promote` argv. Supports both `--axis=value` and
 * `--axis value` forms; `--term` is repeatable. Validated via Zod.
 */
export function parsePromoteArgs(argv: readonly string[]): TaxonomyPromoteArgs {
  let axis: string | undefined;
  const terms: string[] = [];
  let threshold: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--axis') {
      axis = argv[i + 1];
      i += 1;
    } else if (a.startsWith('--axis=')) {
      axis = a.slice('--axis='.length);
    } else if (a === '--term') {
      const v = argv[i + 1];
      if (v !== undefined) terms.push(v);
      i += 1;
    } else if (a.startsWith('--term=')) {
      terms.push(a.slice('--term='.length));
    } else if (a === '--from-proposed-with-count-ge') {
      const v = argv[i + 1];
      threshold = v !== undefined ? Number(v) : Number.NaN;
      i += 1;
    } else if (a.startsWith('--from-proposed-with-count-ge=')) {
      threshold = Number(a.slice('--from-proposed-with-count-ge='.length));
    }
  }

  const raw: Record<string, unknown> = {};
  if (axis !== undefined) raw.axis = axis;
  if (terms.length > 0) raw.terms = terms;
  if (threshold !== undefined) raw.from_proposed_with_count_ge = threshold;

  const result = TaxonomyPromoteArgsZodSchema.safeParse(raw);
  if (!result.success) {
    throw new TaxonomyPromoteArgsError({
      issues: result.error.issues.map((i) => i.message),
      message: result.error.issues.map((i) => i.message).join('; '),
    });
  }
  return result.data;
}

/* ------------------------- SQL helpers ------------------------------- */

interface PromoteTarget {
  axis: TaxonomyAxis;
  term: string;
  currentState: 'proposed' | 'established';
}

function resolvePerTermTargets(
  db: DatabaseType,
  axis: TaxonomyAxis,
  terms: readonly string[],
): PromoteTarget[] {
  const stmt = db.prepare(
    `SELECT axis, term, state FROM taxonomy_terms WHERE axis = ? AND term = ?`,
  );
  const out: PromoteTarget[] = [];
  for (const term of terms) {
    const row = stmt.get(axis, term) as
      | { axis: TaxonomyAxis; term: string; state: 'proposed' | 'established' }
      | undefined;
    if (row === undefined) {
      throw new TaxonomyPromoteMissingTermError({ axis, term });
    }
    out.push({ axis: row.axis, term: row.term, currentState: row.state });
  }
  return out;
}

/**
 * Query-time computation of `proposed_count` per (axis, term). See file-top
 * comment for the schema-gap resolution rationale.
 */
function countDocumentsForTerm(
  db: DatabaseType,
  axis: TaxonomyAxis,
  term: string,
): number {
  let sql: string;
  switch (axis) {
    case 'domain':
      sql = `SELECT COUNT(*) AS c FROM documents
              WHERE facet_domain = ? AND status = 'success'`;
      break;
    case 'type':
      sql = `SELECT COUNT(*) AS c FROM documents
              WHERE facet_type = ? AND status = 'success'`;
      break;
    case 'source_type':
      sql = `SELECT COUNT(*) AS c FROM documents
              WHERE source_type = ? AND status = 'success'`;
      break;
    case 'tag':
      // SQLite JSON1: count documents whose tags_json array contains `term`.
      sql = `SELECT COUNT(DISTINCT documents.id) AS c
               FROM documents, json_each(documents.tags_json) je
              WHERE je.value = ? AND documents.status = 'success'`;
      break;
  }
  const row = db.prepare(sql).get(term) as { c: number };
  return row.c;
}

function resolveThresholdTargets(
  db: DatabaseType,
  threshold: number,
): PromoteTarget[] {
  const proposed = db
    .prepare(
      `SELECT axis, term FROM taxonomy_terms WHERE state = 'proposed' ORDER BY axis, term`,
    )
    .all() as { axis: TaxonomyAxis; term: string }[];

  const out: PromoteTarget[] = [];
  for (const p of proposed) {
    const count = countDocumentsForTerm(db, p.axis, p.term);
    if (count >= threshold) {
      out.push({ axis: p.axis, term: p.term, currentState: 'proposed' });
    }
  }
  return out;
}

/* ------------------------- core runner ------------------------------- */

export interface RunTaxonomyPromoteResult {
  promotedCount: number;
  alreadyEstablishedCount: number;
  promoted: { axis: TaxonomyAxis; term: string }[];
  alreadyEstablished: { axis: TaxonomyAxis; term: string }[];
}

/**
 * Acquire `Paths.drainLock()`, resolve targets, transactionally UPDATE
 * `state='proposed' → 'established'`, emit per-term telemetry, release lock.
 * Throws TaxonomyPromoteLockContentionError on contention, or
 * TaxonomyPromoteMissingTermError when --axis/--term resolves to a missing row.
 */
export async function runTaxonomyPromote(
  args: TaxonomyPromoteArgs,
  signal: AbortSignal,
): Promise<RunTaxonomyPromoteResult> {
  signal.throwIfAborted();

  const lockResult = acquireDrainLock({ signal });
  if (!lockResult.ok) {
    try {
      await emitTelemetry({
        event: 'taxonomy.promote_lock_contention',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failure',
        lock_holder_hint: (lockResult.error.data.message ?? '').slice(0, 256),
      });
    } catch {
      /* ignore */
    }
    throw new TaxonomyPromoteLockContentionError({
      lock_path: lockResult.error.data.lock_path,
      lock_holder_hint: lockResult.error.data.message,
    });
  }
  const lock = lockResult.value;

  const db = openIndexReadWrite();
  let resolveErr: unknown;
  const result: RunTaxonomyPromoteResult = {
    promotedCount: 0,
    alreadyEstablishedCount: 0,
    promoted: [],
    alreadyEstablished: [],
  };

  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      let targets: PromoteTarget[];
      if (args.from_proposed_with_count_ge !== undefined) {
        targets = resolveThresholdTargets(db, args.from_proposed_with_count_ge);
      } else if (args.axis !== undefined && args.terms !== undefined) {
        targets = resolvePerTermTargets(db, args.axis, args.terms);
      } else {
        // Should be unreachable per Zod refinement.
        targets = [];
      }

      const updateStmt = db.prepare(
        `UPDATE taxonomy_terms
            SET state = 'established',
                established_at = datetime('now')
          WHERE axis = ? AND term = ? AND state = 'proposed'`,
      );

      for (const t of targets) {
        if (t.currentState === 'established') {
          result.alreadyEstablishedCount += 1;
          result.alreadyEstablished.push({ axis: t.axis, term: t.term });
        } else {
          const info = updateStmt.run(t.axis, t.term);
          if (info.changes > 0) {
            result.promotedCount += 1;
            result.promoted.push({ axis: t.axis, term: t.term });
          } else {
            // Concurrent state-change between resolve and UPDATE; treat as
            // already-established for idempotency.
            result.alreadyEstablishedCount += 1;
            result.alreadyEstablished.push({ axis: t.axis, term: t.term });
          }
        }
      }
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      resolveErr = cause;
    }
  } finally {
    db.close();
    lock.release();
  }

  if (resolveErr !== undefined) {
    if (resolveErr instanceof TaxonomyPromoteMissingTermError) {
      try {
        await emitTelemetry({
          event: 'taxonomy.promote_missing_term',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failure',
          axis: resolveErr.data.axis as TaxonomyAxis,
          term: resolveErr.data.term,
        });
      } catch {
        /* ignore */
      }
    }
    throw resolveErr;
  }

  // Per-term completion telemetry (after the lock release, after COMMIT).
  for (const p of result.promoted) {
    try {
      await emitTelemetry({
        event: 'taxonomy.promote_completed',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        axis: p.axis,
        term: p.term,
        was_already_established: false,
      });
    } catch {
      /* ignore */
    }
  }
  for (const a of result.alreadyEstablished) {
    try {
      await emitTelemetry({
        event: 'taxonomy.promote_completed',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        axis: a.axis,
        term: a.term,
        was_already_established: true,
      });
    } catch {
      /* ignore */
    }
  }

  return result;
}
