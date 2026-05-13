// SP-005 T030 — Contract test for index-persister atomicity.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-007, SC-RETRIEVAL-011
//   - Constitution Principle VIII

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import { persistIndex } from '../../packages/storage/src/index-persister.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  sqliteVec.load(db);
  db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY)`);
  db.exec(`INSERT INTO documents (id) VALUES ('doc-aaaaaaaa'), ('doc-bbbbbbbb')`);
  runSp005Migration(db);
});

afterEach(() => {
  db.close();
});

describe('persistIndex — caller-owned transaction atomicity', () => {
  it('writes FTS5 + vec + edges within caller-opened transaction', async () => {
    db.exec('BEGIN IMMEDIATE');
    const r = await persistIndex(
      {
        docId: 'doc-aaaaaaaa',
        ftsFields: {
          title: 't',
          summary: 's',
          tags: 'a, b',
          facet_topic: 'topic',
          body_excerpt: 'body',
        },
        vector: new Float32Array(768),
        edges: [
          {
            src_id: 'doc-aaaaaaaa',
            dst_id: 'doc-bbbbbbbb',
            kind: 'tag_overlap',
            weight: 0.5,
          },
        ],
        signal: new AbortController().signal,
      },
      db,
    );
    expect(r.ok).toBe(true);
    db.exec('COMMIT');

    const fts = db
      .prepare(`SELECT COUNT(*) AS n FROM documents_fts WHERE doc_id = ?`)
      .get('doc-aaaaaaaa') as { n: number };
    expect(fts.n).toBe(1);
    const vec = db
      .prepare(`SELECT COUNT(*) AS n FROM documents_vec WHERE doc_id = ?`)
      .get('doc-aaaaaaaa') as { n: number };
    expect(vec.n).toBe(1);
    const edges = db
      .prepare(`SELECT COUNT(*) AS n FROM edges WHERE src_id = ?`)
      .get('doc-aaaaaaaa') as { n: number };
    expect(edges.n).toBe(1);
  });

  it('caller ROLLBACK removes all three INSERTs on failure', async () => {
    db.exec('BEGIN IMMEDIATE');
    const r = await persistIndex(
      {
        docId: 'doc-aaaaaaaa',
        ftsFields: {
          title: 't',
          summary: 's',
          tags: 'a, b',
          facet_topic: 'topic',
          body_excerpt: 'body',
        },
        vector: new Float32Array(768),
        edges: [],
        signal: new AbortController().signal,
      },
      db,
    );
    expect(r.ok).toBe(true);
    db.exec('ROLLBACK');

    const fts = db
      .prepare(`SELECT COUNT(*) AS n FROM documents_fts`)
      .get() as { n: number };
    expect(fts.n).toBe(0);
    const vec = db
      .prepare(`SELECT COUNT(*) AS n FROM documents_vec`)
      .get() as { n: number };
    expect(vec.n).toBe(0);
    const edges = db.prepare(`SELECT COUNT(*) AS n FROM edges`).get() as {
      n: number;
    };
    expect(edges.n).toBe(0);
  });

  it('FTS5 PRIMARY KEY violation surfaces as IndexPersistError', async () => {
    db.exec('BEGIN IMMEDIATE');
    await persistIndex(
      {
        docId: 'doc-aaaaaaaa',
        ftsFields: {
          title: 't',
          summary: 's',
          tags: '',
          facet_topic: '',
          body_excerpt: '',
        },
        vector: new Float32Array(768),
        edges: [],
        signal: new AbortController().signal,
      },
      db,
    );
    db.exec('COMMIT');

    // Second attempt — vec0 PK violation.
    db.exec('BEGIN IMMEDIATE');
    const r = await persistIndex(
      {
        docId: 'doc-aaaaaaaa',
        ftsFields: {
          title: 't',
          summary: 's',
          tags: '',
          facet_topic: '',
          body_excerpt: '',
        },
        vector: new Float32Array(768),
        edges: [],
        signal: new AbortController().signal,
      },
      db,
    );
    expect(r.ok).toBe(false);
    db.exec('ROLLBACK');
  });
});
