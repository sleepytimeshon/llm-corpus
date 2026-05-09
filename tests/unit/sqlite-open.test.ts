// T012 — Unit test: openIndexReadOnly() + isSqliteBusyError predicate.
//
// References: contracts/mcp-resources-api.md §"Read-only enforcement",
// Constitution VII (Cancellable, Bounded IO), IX (Concurrency-safe),
// plan.md §"Performance Goals", §"Constraints".
//
// Coverage:
//   - Returns a better-sqlite3 Database with readonly: true
//   - PRAGMA journal_mode = WAL
//   - PRAGMA busy_timeout = 5000
//   - INSERT/UPDATE on the read handle throws SQLITE_READONLY
//   - isSqliteBusyError(err) detects SQLITE_BUSY / SQLITE_BUSY_TIMEOUT

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  openIndexReadOnly,
  isSqliteBusyError,
} from '../../packages/storage/src/sqlite-open.js';

describe('openIndexReadOnly() (T012 / Constitution VII, IX)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-sqlite-open-'));
    process.env.CORPUS_HOME = tmpHome;
    // Pre-create the data directory so Paths.indexDb()'s parent exists.
    fs.mkdirSync(path.join(tmpHome, 'data'), { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('opens the index file in read-only mode', async () => {
    // Pre-create an empty SQLite file via a write connection so the read
    // open has something to attach to.
    const Database = (await import('better-sqlite3')).default;
    const dataDir = path.join(tmpHome, 'data');
    const dbPath = path.join(dataDir, 'index.db');
    const writeDb = new Database(dbPath);
    writeDb.exec('CREATE TABLE IF NOT EXISTS marker (id INTEGER PRIMARY KEY)');
    writeDb.close();

    const db = openIndexReadOnly();
    try {
      expect(db.readonly).toBe(true);
    } finally {
      db.close();
    }
  });

  it('sets PRAGMA journal_mode=WAL and busy_timeout=5000', async () => {
    const Database = (await import('better-sqlite3')).default;
    const dataDir = path.join(tmpHome, 'data');
    const dbPath = path.join(dataDir, 'index.db');
    const writeDb = new Database(dbPath);
    writeDb.exec('CREATE TABLE IF NOT EXISTS marker (id INTEGER PRIMARY KEY)');
    writeDb.close();

    const db = openIndexReadOnly();
    try {
      const journalMode = db.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');
      const busyTimeout = db.pragma('busy_timeout', { simple: true });
      expect(busyTimeout).toBe(5000);
    } finally {
      db.close();
    }
  });

  it('attempting INSERT on the read handle throws (SQLITE_READONLY)', async () => {
    const Database = (await import('better-sqlite3')).default;
    const dataDir = path.join(tmpHome, 'data');
    const dbPath = path.join(dataDir, 'index.db');
    const writeDb = new Database(dbPath);
    writeDb.exec('CREATE TABLE IF NOT EXISTS marker (id INTEGER PRIMARY KEY)');
    writeDb.close();

    const db = openIndexReadOnly();
    try {
      let caught: unknown = undefined;
      try {
        db.exec('INSERT INTO marker (id) VALUES (1)');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const msg = (caught as Error).message ?? String(caught);
      expect(msg).toMatch(/readonly/i);
    } finally {
      db.close();
    }
  });

  it('opens cleanly when the index file does NOT exist (fileMustExist:false)', () => {
    // Per contracts/mcp-resources-api.md and plan.md: SP-002 ships against
    // empty SP-001 baseline; index.db may not yet exist on first boot.
    // openIndexReadOnly must accept that gracefully.
    const db = openIndexReadOnly();
    try {
      expect(db.readonly).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('isSqliteBusyError() (T012)', () => {
  it('detects SQLITE_BUSY-coded errors', () => {
    const err = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY',
    });
    expect(isSqliteBusyError(err)).toBe(true);
  });

  it('detects SQLITE_BUSY_TIMEOUT-coded errors', () => {
    const err = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY_TIMEOUT',
    });
    expect(isSqliteBusyError(err)).toBe(true);
  });

  it('rejects non-busy errors', () => {
    const err = Object.assign(new Error('disk full'), {
      code: 'SQLITE_FULL',
    });
    expect(isSqliteBusyError(err)).toBe(false);
  });

  it('rejects plain errors with no code', () => {
    expect(isSqliteBusyError(new Error('plain'))).toBe(false);
  });

  it('rejects non-Error inputs', () => {
    expect(isSqliteBusyError(null)).toBe(false);
    expect(isSqliteBusyError(undefined)).toBe(false);
    expect(isSqliteBusyError('SQLITE_BUSY')).toBe(false);
    expect(isSqliteBusyError(42)).toBe(false);
  });
});
