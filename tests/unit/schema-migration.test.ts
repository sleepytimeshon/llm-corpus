// T013 — Unit test: runSchemaMigration(db) creates the empty SP-002 baseline.
//
// References: data-model.md §"Persistent state", plan.md R4 (column-shape
// contract), Constitution VIII (atomic + transactional index).
//
// Coverage:
//   - documents table with the contracted columns
//   - taxonomy_terms table with composite PK
//   - 3 indices created
//   - Idempotent (IF NOT EXISTS — second invocation is a no-op)
//   - CHECK constraints reject malformed id and bad status values
//   - Exports DOCUMENTS_COLUMN_LIST and TAXONOMY_TERMS_COLUMN_LIST as
//     canonical column lists for fixtures (R6)

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import {
  runSchemaMigration,
  DOCUMENTS_COLUMN_LIST,
  TAXONOMY_TERMS_COLUMN_LIST,
} from '../../packages/storage/src/schema-migration.js';

async function freshDb(): Promise<{
  db: import('better-sqlite3').Database;
  cleanup: () => void;
}> {
  const Database = (await import('better-sqlite3')).default;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-schema-migration-'));
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

describe('runSchemaMigration() — documents table (T013, plan.md R4)', () => {
  it('creates the documents table with all contracted columns', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const cols = db.pragma('table_info(documents)') as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      const colNames = cols.map((c) => c.name);
      // Per data-model.md "Persistent state":
      const required = [
        'id',
        'title',
        'body_path',
        'source_path',
        'facet_domain',
        'tags_json',
        'facet_type',
        'source_type',
        'mime_type',
        'hash',
        'ingest_timestamp',
        'status',
      ];
      for (const c of required) {
        expect(colNames).toContain(c);
      }
      // id is the PK
      const idCol = cols.find((c) => c.name === 'id');
      expect(idCol?.pk).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('creates documents indices', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const idxList = db.pragma('index_list(documents)') as Array<{
        name: string;
      }>;
      const names = idxList.map((i) => i.name);
      expect(names).toContain('idx_documents_status_ingest_ts');
      expect(names).toContain('idx_documents_facet_domain');
    } finally {
      cleanup();
    }
  });

  it('CHECK rejects malformed id', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      let caught: unknown = undefined;
      try {
        db.exec(`
          INSERT INTO documents
          (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
          VALUES ('NOT-A-VALID-DOC-ID', 't', 'b', 's', 'd', '[]', 'tutorial', 'article', 'text/markdown',
                  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                  '2026-05-15T14:30:00Z', 'success')
        `);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect((caught as Error).message).toMatch(/CHECK constraint/i);
    } finally {
      cleanup();
    }
  });

  it('CHECK rejects bad status value', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      let caught: unknown = undefined;
      try {
        db.exec(`
          INSERT INTO documents
          (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
          VALUES ('doc-ab12cd34', 't', 'b', 's', 'd', '[]', 'tutorial', 'article', 'text/markdown',
                  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                  '2026-05-15T14:30:00Z', 'pending')
        `);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect((caught as Error).message).toMatch(/CHECK constraint/i);
    } finally {
      cleanup();
    }
  });

  it('accepts valid id + valid status', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      // Should NOT throw:
      db.exec(`
        INSERT INTO documents
        (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-ab12cd34', 't', 'b', 's', 'd', '[]', 'tutorial', 'article', 'text/markdown',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                '2026-05-15T14:30:00Z', 'success')
      `);
      const row = db.prepare('SELECT id FROM documents').get() as { id: string };
      expect(row.id).toBe('doc-ab12cd34');
    } finally {
      cleanup();
    }
  });
});

describe('runSchemaMigration() — taxonomy_terms table (T013)', () => {
  it('creates taxonomy_terms with composite PK (axis, term)', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const cols = db.pragma('table_info(taxonomy_terms)') as Array<{
        name: string;
        pk: number;
      }>;
      const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
      expect(pkCols).toContain('axis');
      expect(pkCols).toContain('term');
    } finally {
      cleanup();
    }
  });

  it('creates idx_taxonomy_terms_state_axis index', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const idxList = db.pragma('index_list(taxonomy_terms)') as Array<{
        name: string;
      }>;
      const names = idxList.map((i) => i.name);
      expect(names).toContain('idx_taxonomy_terms_state_axis');
    } finally {
      cleanup();
    }
  });

  it('CHECK rejects bad axis or state', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      let caught: unknown = undefined;
      try {
        db.exec(
          `INSERT INTO taxonomy_terms (axis, term, state) VALUES ('NOT_AN_AXIS', 'x', 'established')`,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
    } finally {
      cleanup();
    }
  });
});

describe('runSchemaMigration() — idempotency (T013)', () => {
  it('second invocation is a no-op (IF NOT EXISTS)', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      runSchemaMigration(db); // must not throw
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('documents');
      expect(names).toContain('taxonomy_terms');
    } finally {
      cleanup();
    }
  });
});

describe('Canonical column lists (T013, plan.md R6)', () => {
  it('DOCUMENTS_COLUMN_LIST is exported and matches table_info', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const cols = db.pragma('table_info(documents)') as Array<{ name: string }>;
      const liveCols = cols.map((c) => c.name);
      // Every column in the canonical list MUST exist in the table.
      for (const c of DOCUMENTS_COLUMN_LIST) {
        expect(liveCols).toContain(c);
      }
      // The canonical list is the full set (no extras hidden from fixtures).
      expect(DOCUMENTS_COLUMN_LIST.length).toBe(liveCols.length);
    } finally {
      cleanup();
    }
  });

  it('TAXONOMY_TERMS_COLUMN_LIST is exported and matches table_info', async () => {
    const { db, cleanup } = await freshDb();
    try {
      runSchemaMigration(db);
      const cols = db.pragma('table_info(taxonomy_terms)') as Array<{
        name: string;
      }>;
      const liveCols = cols.map((c) => c.name);
      for (const c of TAXONOMY_TERMS_COLUMN_LIST) {
        expect(liveCols).toContain(c);
      }
      expect(TAXONOMY_TERMS_COLUMN_LIST.length).toBe(liveCols.length);
    } finally {
      cleanup();
    }
  });
});
