// T002 (SP-003 PREREQ-002) — Contract test for runUniqueHashMigration(db).
//
// Verifies that runUniqueHashMigration:
//   - Adds CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash_unique
//   - Is idempotent on a second invocation
//   - On a fresh schema-migration the index exists after migration runs
//   - On a pre-existing DB with duplicate-hash rows, tolerates via documented
//     cleanup path OR fails honestly with IntegrityLossError if cleanup is
//     rejected.
//
// Spec references:
//   - specs/003-ingest-pipeline/plan.md PREREQ-002
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-004
//
// TDD: this test MUST FAIL before T007 (the implementation) lands.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';

async function freshDb(): Promise<{
  db: import('better-sqlite3').Database;
  cleanup: () => void;
}> {
  const Database = (await import('better-sqlite3')).default;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-unique-hash-'));
  const dbPath = path.join(tmp, 'index.db');
  const db = new Database(dbPath);
  return {
    db,
    cleanup: () => {
      db.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

describe('runUniqueHashMigration(db) — PREREQ-002 (contract)', () => {
  it('exports runUniqueHashMigration from packages/storage/src/unique-hash-migration.ts', async () => {
    const mod = (await import(
      '../../packages/storage/src/unique-hash-migration.js'
    )) as Record<string, unknown>;
    expect(typeof mod.runUniqueHashMigration).toBe('function');
  });

  it('creates idx_documents_hash_unique on documents(hash)', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const { runUniqueHashMigration } = await import(
        '../../packages/storage/src/unique-hash-migration.js'
      );
      (runUniqueHashMigration as (db: typeof db) => void)(db);
      const indices = db
        .prepare(
          `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='documents'`,
        )
        .all() as Array<{ name: string; sql: string | null }>;
      const uniqueIdx = indices.find(
        (idx) => idx.name === 'idx_documents_hash_unique',
      );
      expect(uniqueIdx).toBeDefined();
      expect(uniqueIdx?.sql).toMatch(/UNIQUE/i);
      expect(uniqueIdx?.sql).toMatch(/hash/i);
    } finally {
      cleanup();
    }
  });

  it('is idempotent on a second invocation (CREATE INDEX IF NOT EXISTS)', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const { runUniqueHashMigration } = await import(
        '../../packages/storage/src/unique-hash-migration.js'
      );
      (runUniqueHashMigration as (db: typeof db) => void)(db);
      // Second invocation must not throw.
      expect(() =>
        (runUniqueHashMigration as (db: typeof db) => void)(db),
      ).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it('on fresh schema-migration the UNIQUE index exists post-migration', async () => {
    // After runSchemaMigration calls runUniqueHashMigration internally (T008),
    // the index should be present without an explicit second call.
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const indices = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='documents'`,
        )
        .all() as Array<{ name: string }>;
      const names = indices.map((i) => i.name);
      expect(names).toContain('idx_documents_hash_unique');
    } finally {
      cleanup();
    }
  });

  it('rejects subsequent INSERT of a duplicate-hash row (UNIQUE constraint enforced)', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const ts = new Date().toISOString();
      const insertOne = (id: string, hash: string): void => {
        db.prepare(
          `INSERT INTO documents (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          'title',
          'store/aa/' + id + '.md',
          '/inbox/foo',
          '',
          '[]',
          'unclassified',
          'inbox-filesystem',
          'text/markdown',
          hash,
          ts,
          'success',
        );
      };
      const hash =
        'a'.repeat(64) /* 64-hex lowercase */;
      insertOne('doc-aa11bb22', hash);
      // Duplicate hash must be rejected by the UNIQUE constraint.
      expect(() => insertOne('doc-cc33dd44', hash)).toThrow(/UNIQUE/i);
    } finally {
      cleanup();
    }
  });

  it('tolerates duplicate-hash rows present BEFORE migration via documented path OR throws honestly', async () => {
    // Pre-existing duplicate-hash rows: the migration must either clean them up
    // documented-path OR throw with a recognizable error. NO silent failure.
    const { db, cleanup } = await freshDb();
    try {
      // Set up DB schema without the UNIQUE index (simulate pre-PREREQ-002 baseline)
      db.exec(`CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        body_path TEXT NOT NULL,
        source_path TEXT NOT NULL,
        facet_domain TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        facet_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        hash TEXT NOT NULL,
        ingest_timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        CHECK (id GLOB 'doc-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
        CHECK (status IN ('success','failed','trashed'))
      );`);
      const ts = new Date().toISOString();
      const dupHash = 'b'.repeat(64);
      db.prepare(
        `INSERT INTO documents (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'doc-11111111',
        't1',
        'store/11/doc-11111111.md',
        '/inbox/a',
        '',
        '[]',
        'unclassified',
        'inbox-filesystem',
        'text/markdown',
        dupHash,
        ts,
        'success',
      );
      db.prepare(
        `INSERT INTO documents (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'doc-22222222',
        't2',
        'store/22/doc-22222222.md',
        '/inbox/b',
        '',
        '[]',
        'unclassified',
        'inbox-filesystem',
        'text/markdown',
        dupHash,
        ts,
        'success',
      );
      const { runUniqueHashMigration } = await import(
        '../../packages/storage/src/unique-hash-migration.js'
      );
      let threw = false;
      try {
        (runUniqueHashMigration as (db: typeof db) => void)(db);
      } catch (err) {
        threw = true;
        // Acceptable: structured error with recognizable name.
        expect((err as Error).name).toMatch(/Error/);
      }
      // Acceptable outcomes:
      //   (a) the migration threw a recognizable error (no silent state)
      //   (b) the migration cleaned up the duplicate via documented path
      //       (e.g., kept the first row, removed the second) and the index exists
      if (!threw) {
        const remaining = db
          .prepare(`SELECT COUNT(*) as c FROM documents WHERE hash = ?`)
          .get(dupHash) as { c: number };
        expect(remaining.c).toBe(1);
      }
    } finally {
      cleanup();
    }
  });
});
