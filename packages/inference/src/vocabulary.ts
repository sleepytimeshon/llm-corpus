// SP-004 US1 (T031) — Established-vocabulary loader.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-006
//   - specs/004-classifier/research.md Decision E (per-batch refresh)
//   - specs/004-classifier/data-model.md §"Entity 2 — EstablishedVocabulary"
//   - Constitution Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)
//   - Constitution Principle VII (Cancellable, Bounded IO)
//
// Loads a snapshot of `taxonomy_terms WHERE state='established'` grouped by
// axis. The snapshot is stable for the lifetime of the invocation; the
// classifier reuses it across documents in the same batch (Decision E). A
// fresh UUID v4 snapshot_id is generated per invocation for observability.
//
// The function returns a Result<EstablishedVocabulary, PersistError>;
// SQL exceptions surface as Result.err for telemetry-or-die discipline.

import * as crypto from 'node:crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  PersistError,
} from '@llm-corpus/contracts';

export interface EstablishedVocabulary {
  /** Read-only — mutation forbidden per data-model.md §"Entity 2". */
  readonly domains: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
  readonly types: ReadonlySet<string>;
  /** UUID v4 generated at load time for telemetry observability. */
  readonly snapshot_id: string;
  /** ISO-8601 UTC at load time. */
  readonly loaded_at: string;
}

/**
 * Load the established-vocabulary snapshot. One SELECT covers all axes.
 *
 * Signal is checked before SQL access (Constitution VII). SQL exceptions
 * convert to Result.err(PersistError) for consistency with the rest of the
 * storage layer.
 */
export async function loadEstablishedVocabulary(
  db: DatabaseType,
  signal: AbortSignal,
): Promise<Result<EstablishedVocabulary, PersistError>> {
  signal.throwIfAborted();
  try {
    const rows = db
      .prepare(
        `SELECT axis, term
           FROM taxonomy_terms
          WHERE axis IN ('domain', 'tag', 'type')
            AND state = 'established'`,
      )
      .all() as Array<{ axis: string; term: string }>;

    const domains = new Set<string>();
    const tags = new Set<string>();
    const types = new Set<string>();
    for (const r of rows) {
      switch (r.axis) {
        case 'domain':
          domains.add(r.term);
          break;
        case 'tag':
          tags.add(r.term);
          break;
        case 'type':
          types.add(r.term);
          break;
        default:
          // Skip unknown axes (the schema CHECK constraint blocks insertion;
          // this is defensive).
          break;
      }
    }

    return ok({
      domains,
      tags,
      types,
      snapshot_id: crypto.randomUUID(),
      loaded_at: new Date().toISOString(),
    });
  } catch (caught) {
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: `loadEstablishedVocabulary failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }
}
