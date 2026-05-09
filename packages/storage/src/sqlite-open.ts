// T025 — Read-only SQLite open with WAL + busy_timeout.
//
// References: contracts/mcp-resources-api.md §"Read-only enforcement",
// Constitution VII (Cancellable, Bounded IO), IX (Concurrency-safe).
//
// Every resource adapter (manifest, taxonomy, recent, document) opens the
// index file via this helper. The handle is read-only at the SQLite level
// (additional defense-in-depth alongside the SC-010 lint rule).
//
// Concurrency model (per plan.md R8):
//   - WAL allows multiple concurrent readers + one writer
//   - busy_timeout = 5000 ms covers contention with future SP-003 daemon
//   - When a write lock is held past the window, the read fails with
//     SQLITE_BUSY which the adapter maps to IndexLockedError

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { Paths } from '@llm-corpus/contracts';
import { runSchemaMigration } from './schema-migration.js';

const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * Ensure the index file exists, with the SP-002 baseline schema applied.
 * Idempotent: safe to call on every boot. Called by `openIndexReadOnly`
 * (and would be called explicitly by SP-003+ daemon boot).
 *
 * Constitution VII: bounded IO. The migration is idempotent (CREATE TABLE
 * IF NOT EXISTS) so concurrent callers don't race. If the file already has
 * the SP-002 baseline tables (most common case after first init), the
 * write-mode open is skipped — this preserves SP-003+ daemon writer locks
 * (they hold the WAL writer exclusively during ingest commits) without
 * surfacing a spurious "database is locked" error from a read-side caller.
 */
export function ensureIndexInitialized(): void {
  const dbPath = Paths.indexDb();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Open in writer mode to ensure the file exists, has the baseline schema
  // applied, and is in WAL journal mode. WAL mode is a persistent DB
  // attribute — setting it once makes it active for all subsequent
  // (including read-only) connections.
  //
  // If a concurrent SP-003+ writer holds an exclusive transaction on the
  // existing file, the pragma calls below will surface SQLITE_BUSY. We
  // catch that case and treat it as "already initialized" — the file
  // exists, an external writer is using it, and SP-002 read-only callers
  // will surface IndexLockedError downstream when they try to read.
  //
  // Constitution VII: bounded IO. The migration is idempotent so concurrent
  // callers don't race.
  let writeDb: DatabaseType | null = null;
  try {
    writeDb = new Database(dbPath);
    writeDb.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    writeDb.pragma('journal_mode = WAL');
    runSchemaMigration(writeDb);
  } catch (err) {
    if (isSqliteBusyError(err) && fs.existsSync(dbPath)) {
      // File exists and an external writer is holding it. Trust that the
      // schema is already in place; openIndexReadOnly() will surface
      // contention via its own busy_timeout window.
      return;
    }
    throw err;
  } finally {
    if (writeDb !== null) {
      try {
        writeDb.close();
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Open the canonical index file at `Paths.indexDb()` in read-only mode.
 *
 * Behavior:
 * - First ensures the file + baseline schema exist (calls ensureIndexInitialized).
 *   The fast path skips the writer open when the schema is already present,
 *   so a concurrent SP-003+ writer holding the WAL lock does not surface as
 *   a spurious busy error here. This means SP-002 callers always see a
 *   queryable file even on the empty SP-001 baseline.
 * - Opens with `readonly: true` — defense in depth alongside SC-010 lint rule.
 * - Sets `PRAGMA busy_timeout = 5000` on the connection — covers WAL writer
 *   contention from a concurrent SP-003+ writer.
 *
 * WAL is a persistent DB attribute; ensureIndexInitialized() set it via the
 * writer connection. Read-only connections inherit it.
 */
export function openIndexReadOnly(): DatabaseType {
  ensureIndexInitialized();
  const dbPath = Paths.indexDb();
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  return db;
}

/**
 * Predicate identifying SQLite busy errors (SQLITE_BUSY / SQLITE_BUSY_TIMEOUT).
 * Adapters call this in their catch blocks to map busy contention to
 * IndexLockedError without misclassifying other failures.
 */
export function isSqliteBusyError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_TIMEOUT';
}
