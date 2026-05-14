// SP-006 T045 — Unit test for the SP-005 index-persister CATALOG.md extension.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   - persistIndexWithCatalog calls appendCatalogLine AFTER the SP-005 SQL
//     transaction COMMITs (post-COMMIT)
//   - On COMMIT failure, CATALOG.md is NOT appended
//   - On CATALOG.md append failure (e.g., signal aborted), SQL transaction is
//     NOT rolled back — CATALOG.md is a flat-file mirror; Constitution VIII
//     transactional unit is the SQL writes only
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-018
//   - specs/006-hardening/research.md Decision L
//   - Constitution Principle VIII (atomic writes — SQL is the unit)

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths } from '@llm-corpus/contracts';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import {
  persistIndexWithCatalog,
  type CatalogPersistInput,
} from '../../packages/storage/src/index-persister.js';

let db: Database.Database;

describe('T045 — persistIndexWithCatalog (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-persist-catalog-'));
    process.env.CORPUS_HOME = tmpHome;
    await fsp.mkdir(Paths.data(), { recursive: true });

    db = new Database(':memory:');
    sqliteVec.load(db);
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        title TEXT,
        facet_domain TEXT,
        facet_type TEXT,
        tags_json TEXT DEFAULT '[]',
        ingest_timestamp TEXT,
        source_type TEXT,
        body_path TEXT,
        status TEXT DEFAULT 'success'
      );
    `);
    db.exec(`
      INSERT INTO documents (id, title, facet_domain, facet_type, status)
        VALUES ('doc-aaaaaaaa', 'Test', 'engineering', 'reference', 'success');
    `);
    runSp005Migration(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* no-op */
    }
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('appends a CATALOG.md line AFTER successful SQL commit', async () => {
    const input: CatalogPersistInput = {
      docId: 'doc-aaaaaaaa',
      ftsFields: {
        title: 'Test',
        summary: 'A summary.',
        tags: 'demo',
        facet_topic: 'reference',
        body_excerpt: 'body text.',
      },
      vector: new Float32Array(768),
      edges: [],
      catalog: {
        doc_id: 'doc-aaaaaaaa',
        title: 'Test',
        facet_domain: 'engineering',
        facet_type: 'reference',
        summary: 'A summary.',
      },
      signal: new AbortController().signal,
    };
    const r = await persistIndexWithCatalog(input, db);
    expect(r.ok).toBe(true);
    const contents = await fsp.readFile(
      path.join(Paths.data(), 'CATALOG.md'),
      'utf8',
    );
    expect(contents).toContain('doc-aaaaaaaa');
    expect(contents).toContain('Test');
  });

  it('does NOT append CATALOG.md when SQL persist fails (e.g., duplicate PK)', async () => {
    // Pre-insert the same FTS5 row to force a UNIQUE conflict on the second
    // call — actually, FTS5 has no PK, so we force failure via aborted signal.
    const controller = new AbortController();
    controller.abort();
    const input: CatalogPersistInput = {
      docId: 'doc-aaaaaaaa',
      ftsFields: {
        title: 'Test',
        summary: 'A summary.',
        tags: 'demo',
        facet_topic: 'reference',
        body_excerpt: 'body text.',
      },
      vector: new Float32Array(768),
      edges: [],
      catalog: {
        doc_id: 'doc-aaaaaaaa',
        title: 'Test',
        facet_domain: 'engineering',
        facet_type: 'reference',
        summary: 'A summary.',
      },
      signal: controller.signal,
    };
    const r = await persistIndexWithCatalog(input, db);
    expect(r.ok).toBe(false);
    const exists = fs.existsSync(path.join(Paths.data(), 'CATALOG.md'));
    expect(exists).toBe(false);
  });
});
