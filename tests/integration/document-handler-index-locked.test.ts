// T051 — Integration test: corpus://docs/{id} index_locked error envelope.
//
// References: FR-008, US4 AS4, SC-008 part 2 (-32011), edge case
// "Index lock contention".
//
// In WAL mode, normal readers don't block on writers. The realistic
// SQLITE_BUSY surface for SP-002 reads is the openIndexReadOnly() path's
// internal `ensureIndexInitialized` writer-mode pragma calls, which can
// surface SQLITE_BUSY when an external SP-003+ writer holds an exclusive
// transaction. Our refined sqlite-open.ts catches that case and treats the
// file as already initialized, then the read-only connection's prepared
// SELECT will hit SQLITE_BUSY too (because the EXCLUSIVE transaction
// blocks reads in non-WAL mode).
//
// To deterministically exercise the IndexLockedError path, this test:
//   1. Creates a fresh DB in DEFAULT journal mode (NOT WAL — so EXCLUSIVE
//      locks block readers).
//   2. Holds a BEGIN EXCLUSIVE transaction on a writer connection.
//   3. Calls fetchDocument; the read-side prepare() hits SQLITE_BUSY after
//      the busy_timeout window.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';

import { fetchDocument } from '../../packages/storage/src/document-adapter.js';
import {
  runSchemaMigration,
  DOCUMENTS_COLUMN_LIST,
} from '../../packages/storage/src/schema-migration.js';
import { IndexLockedError, Paths } from '@llm-corpus/contracts';

describe('corpus://docs index_locked (T051 / SC-008 part 2)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-doc-locked-'));
    process.env.CORPUS_HOME = osTmpDir;
    // Pre-create data dir + index.db at Paths.indexDb() in DEFAULT (delete)
    // journal mode and apply the schema migration. EXCLUSIVE transactions
    // in delete mode block reads, which is what we want for this test.
    fs.mkdirSync(path.dirname(Paths.indexDb()), { recursive: true });
    const init = new Database(Paths.indexDb());
    runSchemaMigration(init);
    // Insert one fixture row so SELECT returns a row when the lock clears
    // — but the SELECT MUST hit SQLITE_BUSY first if the lock holds.
    init
      .prepare(
        `INSERT INTO documents (${DOCUMENTS_COLUMN_LIST.join(',')})
         VALUES (@id,@title,@body_path,@source_path,@facet_domain,@tags_json,
                 @facet_type,@source_type,@mime_type,@hash,@ingest_timestamp,@status)`,
      )
      .run({
        id: 'doc-ab12cd34',
        title: 'Locked',
        body_path: 'doc-ab12cd34.md',
        source_path: '/inbox/locked.md',
        facet_domain: 'devops',
        tags_json: '[]',
        facet_type: 'tutorial',
        source_type: 'article',
        mime_type: 'text/markdown',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ingest_timestamp: '2026-05-15T14:00:00Z',
        status: 'success',
      });
    init.close();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it(
    'returns IndexLockedError when an exclusive writer transaction blocks reads past busy_timeout',
    async () => {
      const dbPath = Paths.indexDb();
      // Open a writer in default (delete) mode and hold BEGIN EXCLUSIVE.
      // In delete-mode SQLite, EXCLUSIVE transactions block ALL readers
      // (including readonly:true opens) until commit/rollback.
      const writer = new Database(dbPath);
      writer.pragma('busy_timeout = 100');
      writer.exec('BEGIN EXCLUSIVE');
      try {
        // The lock is now held; calling fetchDocument should hit the read
        // connection's busy_timeout (5000ms in production) and surface
        // IndexLockedError. We accept the ~5s wait for a real verification.
        const ac = new AbortController();
        const result = await fetchDocument('doc-ab12cd34', ac.signal);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBeInstanceOf(IndexLockedError);
        const e = result.error as IndexLockedError;
        expect(e.data.uri).toBe('corpus://docs/doc-ab12cd34');
      } finally {
        try {
          writer.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        writer.close();
      }
    },
    20000,
  );
});
