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

const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * Open the canonical index DB in read-write mode with WAL + busy_timeout.
 * Used exclusively by the SP-003 persister (and any future write-side
 * adapter). The read-only adapters MUST continue to use openIndexReadOnly.
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
  // Ensure schema is present (idempotent).
  runSchemaMigration(db);
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
