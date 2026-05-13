// SP-005 T008 — Contract test for SP-005 schema migration.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-019, SC-RETRIEVAL-022
//   - specs/005-retrieval/data-model.md §"Schema migration delta"
//   - Constitution Principle X (Idempotent Pipeline Transitions)

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  sqliteVec.load(db);
  // Minimal documents table for FK satisfaction (vec0 doesn't need it).
  db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY)`);
  // Seed two doc rows so edges FK constraints have referents.
  db.exec(`INSERT INTO documents (id) VALUES ('doc-aaaaaaaa'), ('doc-bbbbbbbb')`);
  return db;
}

describe('PREREQ-005 — runSp005Migration', () => {
  it('creates documents_fts, documents_vec, edges on empty DB', () => {
    const db = freshDb();
    try {
      runSp005Migration(db);
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('table','virtual')
           OR (type='table' AND sql LIKE '%CREATE VIRTUAL%')`,
        )
        .all() as Array<{ name: string }>;
      const names = new Set(
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
          .all()
          .map((r) => (r as { name: string }).name),
      );
      expect(names.has('documents_fts')).toBe(true);
      expect(names.has('documents_vec')).toBe(true);
      expect(names.has('edges')).toBe(true);
      void tables;
    } finally {
      db.close();
    }
  });

  it('is idempotent — second invocation produces zero side effects', () => {
    const db = freshDb();
    try {
      runSp005Migration(db);
      // Insert a marker row to verify it survives the re-run.
      db.exec(
        `INSERT INTO edges (src_id, dst_id, kind, weight) VALUES ('doc-aaaaaaaa', 'doc-bbbbbbbb', 'tag_overlap', 0.5)`,
      );
      const t0 = Date.now();
      runSp005Migration(db);
      const elapsed = Date.now() - t0;
      const count = (
        db.prepare(`SELECT COUNT(*) AS n FROM edges`).get() as { n: number }
      ).n;
      expect(count).toBe(1);
      // Idempotent re-run must be fast (<50ms).
      expect(elapsed).toBeLessThan(50);
    } finally {
      db.close();
    }
  });

  it('edges table enforces CHECK on kind', () => {
    const db = freshDb();
    try {
      runSp005Migration(db);
      expect(() =>
        db.exec(
          `INSERT INTO edges (src_id, dst_id, kind, weight) VALUES ('doc-aaaaaaaa', 'doc-bbbbbbbb', 'invalid_kind', 0.5)`,
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('edges table indexes exist (idx_edges_src, idx_edges_dst)', () => {
    const db = freshDb();
    try {
      runSp005Migration(db);
      const indexes = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='edges'`,
        )
        .all() as Array<{ name: string }>;
      const idxNames = new Set(indexes.map((i) => i.name));
      expect(idxNames.has('idx_edges_src')).toBe(true);
      expect(idxNames.has('idx_edges_dst')).toBe(true);
    } finally {
      db.close();
    }
  });
});
