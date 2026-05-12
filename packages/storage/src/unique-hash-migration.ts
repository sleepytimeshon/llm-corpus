// SP-003 PREREQ-002 — Forward-compatible UNIQUE constraint migration.
//
// References: specs/003-ingest-pipeline/plan.md PREREQ-002,
// specs/003-ingest-pipeline/spec.md FR-INGEST-004,
// specs/003-ingest-pipeline/data-model.md §"Entity 9 — documents Row".
//
// SP-002 declared `hash TEXT NOT NULL` without UNIQUE. SP-003 adds the UNIQUE
// constraint as a separate index (`CREATE UNIQUE INDEX IF NOT EXISTS ...`)
// rather than ALTER TABLE — this is forward-compatible on existing DBs and
// idempotent on re-invocation.
//
// On a fresh schema-migration (called from runSchemaMigration), the index is
// created over an empty table. On an existing DB that already contains
// duplicate-hash rows (unlikely — SP-002 wrote zero rows), the CREATE UNIQUE
// INDEX statement fails with SQLITE_CONSTRAINT. This migration:
//
//   1. Probes for duplicate hashes BEFORE attempting the CREATE.
//   2. If duplicates exist, throws IntegrityLossError with structured data
//      describing the duplicate set; the operator must reconcile manually.
//   3. Otherwise creates the index (idempotent — IF NOT EXISTS).

import type { Database as DatabaseType } from 'better-sqlite3';
import { IntegrityLossError } from '@llm-corpus/contracts';

const UNIQUE_HASH_INDEX_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash_unique ON documents(hash);
`;

/**
 * Idempotently create the SP-003 UNIQUE index on documents(hash).
 *
 * Safe to call on:
 *   - Fresh schemas (creates the index over an empty table)
 *   - Schemas where the index already exists (no-op via IF NOT EXISTS)
 *   - Schemas with pre-existing duplicate-hash rows: throws IntegrityLossError
 *     with structured `data` listing the conflicting hash. The operator must
 *     reconcile before re-running.
 *
 * @throws IntegrityLossError if duplicate-hash rows exist that would violate
 *   the UNIQUE constraint on index creation.
 */
export function runUniqueHashMigration(db: DatabaseType): void {
  // Probe for duplicate hashes that would block index creation.
  const dup = db
    .prepare(
      `SELECT hash, COUNT(*) AS c FROM documents GROUP BY hash HAVING c > 1 LIMIT 1`,
    )
    .get() as { hash: string; c: number } | undefined;
  if (dup !== undefined) {
    throw new IntegrityLossError({
      requestedId: 'documents.hash UNIQUE migration',
      frontmatterFoundId: `duplicate hash="${dup.hash}" appears ${dup.c} times`,
    });
  }
  // Safe to create — either empty table or all hashes unique.
  db.exec(UNIQUE_HASH_INDEX_DDL);
}
