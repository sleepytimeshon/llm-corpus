// SP-003 T067 — Write-side document adapter.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-008
//   - specs/003-ingest-pipeline/data-model.md §"Entity 9 — documents Row"
//   - Constitution V (schema-enforced output), VIII (transactional index)
//
// Separate file from the read-only document-adapter.ts (which is governed by
// the SC-010 read-only lint rule) — the write-side helpers MUST NOT be
// callable from the MCP resource-handler call graph.
//
// openIndexReadWrite() opens the same SQLite file as openIndexReadOnly() but
// in read-write mode for use by the SP-003 persister.

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import {
  Paths,
  PersistError,
  ok,
  err,
  type Result,
} from '@llm-corpus/contracts';
import {
  runSchemaMigration,
  DOCUMENTS_COLUMN_LIST,
} from './schema-migration.js';
import { runSp005Migration } from './sp005-migration.js';

const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * Load the sqlite-vec extension against a better-sqlite3 connection. Per
 * SP-005 Decision B + ADR-embedding-model: namespace import, NOT default
 * import. Idempotent — calling twice on the same connection is harmless
 * (the second load is a no-op).
 */
export function loadSqliteVec(db: DatabaseType): void {
  sqliteVec.load(db);
}

/**
 * Open the canonical index DB in read-write mode with WAL + busy_timeout.
 * Used by the SP-003 persister, SP-004 classify-persister, and the SP-005
 * retrieval orchestrator. The read-only adapters MUST continue to use
 * openIndexReadOnly.
 *
 * SP-005: loads the sqlite-vec extension at connection-open time so the
 * vec0 virtual table type is available for the migration and subsequent
 * queries (Decision B).
 */
export function openIndexReadWrite(): DatabaseType {
  const dbPath = Paths.indexDb();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.pragma('journal_mode = WAL');
  // SP-005: load sqlite-vec BEFORE migration (vec0 virtual table type
  // is only available after extension load).
  loadSqliteVec(db);
  // Ensure schema is present (idempotent). SP-002 baseline + SP-005 tables.
  runSchemaMigration(db);
  runSp005Migration(db);
  return db;
}

export interface InsertDocumentInput {
  id: string;
  title: string;
  body_path: string;
  source_path: string;
  facet_domain: string;
  tags_json: string;
  facet_type: string;
  source_type: string;
  mime_type: string;
  hash: string;
  ingest_timestamp: string;
  status: 'success' | 'failed' | 'trashed';
}

/**
 * Insert one row into `documents`. Caller is responsible for transaction
 * boundaries — this helper does NOT BEGIN/COMMIT.
 *
 * Returns Result.err(PersistError) on:
 *   - UNIQUE constraint violation (duplicate hash) → 'persist_failed'
 *   - CHECK constraint violation → 'persist_failed'
 *   - Any other SQLite error → 'persist_failed'
 */
export function insertDocument(
  db: DatabaseType,
  input: InsertDocumentInput,
): Result<{ docId: string }, PersistError> {
  const placeholders = DOCUMENTS_COLUMN_LIST.map(() => '?').join(', ');
  const columns = DOCUMENTS_COLUMN_LIST.join(', ');
  const stmt = db.prepare(
    `INSERT INTO documents (${columns}) VALUES (${placeholders})`,
  );
  const values = DOCUMENTS_COLUMN_LIST.map(
    (c) => (input as unknown as Record<string, string>)[c],
  );
  try {
    stmt.run(...values);
    return ok({ docId: input.id });
  } catch (caught) {
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: `SQLite INSERT failed: ${(caught as Error).message}`,
        retriable: false,
      }),
    );
  }
}

/**
 * SELECT id FROM documents WHERE hash = ? — used by the dedup short-circuit.
 * Returns the existing doc_id if found, or null.
 */
export function findDocumentByHash(
  db: DatabaseType,
  hash: string,
): string | null {
  const row = db
    .prepare(
      `SELECT id FROM documents WHERE hash = ? AND status = 'success' LIMIT 1`,
    )
    .get(hash) as { id: string } | undefined;
  return row ? row.id : null;
}

// ============================================================================
// SP-004 (T035) — Classify-stage write-side adapter.
//
// Note: tasks.md describes this as extending document-adapter.ts; the
// document-adapter.ts file is governed by the SC-010 read-only lint rule
// (no-writes-from-resource-handlers) and only hosts the MCP-read-path
// adapter. Per the established convention (SP-003 insertDocument lives
// here in document-writer.ts), the SP-004 write extension also lives in
// document-writer.ts. The functional contract from tasks.md is preserved.
// ============================================================================

export interface UpdateClassificationInput {
  docId: string;
  facetDomain: string;
  tagsJson: string;
  facetType: string;
}

export interface UpdateClassificationResult {
  /** Rows actually changed by the UPDATE (0 if the row was already classified). */
  affectedRows: number;
}

/**
 * UPDATE documents SET facet_domain=?, tags_json=?, facet_type=?
 *   WHERE id=? AND facet_type='unclassified';
 *
 * The `AND facet_type='unclassified'` clause is defense-in-depth idempotency
 * per FR-CLASSIFY-012 — a concurrent classify of the same row results in
 * `affectedRows === 0` so the caller can rollback the transaction.
 *
 * The caller is responsible for opening and closing the SQLite transaction;
 * this helper does NOT BEGIN/COMMIT.
 */
export function updateClassification(
  db: DatabaseType,
  input: UpdateClassificationInput,
): UpdateClassificationResult {
  const stmt = db.prepare(
    `UPDATE documents
        SET facet_domain = ?,
            tags_json    = ?,
            facet_type   = ?
      WHERE id = ?
        AND facet_type = 'unclassified'`,
  );
  const info = stmt.run(
    input.facetDomain,
    input.tagsJson,
    input.facetType,
    input.docId,
  );
  return { affectedRows: info.changes };
}
