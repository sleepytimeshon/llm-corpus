// SP-005 T065-T066 — Contract tests for filter pushdown.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-004,
//     FR-RETRIEVAL-020, SC-RETRIEVAL-008, SC-RETRIEVAL-009

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import { persistIndex } from '../../packages/storage/src/index-persister.js';
import { Fts5Adapter } from '../../packages/index/src/fts5-adapter.js';
import { VecAdapter } from '../../packages/index/src/vec-adapter.js';
import { GraphAdapter } from '../../packages/index/src/graph-adapter.js';
import { SearchInputZodSchema } from '../../packages/contracts/src/search-schemas.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  sqliteVec.load(db);
  runSchemaMigration(db);
  runSp005Migration(db);
});

afterEach(() => {
  db.close();
});

async function seedDoc(
  id: string,
  title: string,
  tags: string[],
  facetType: string,
  facetDomain: string = 'agents',
): Promise<void> {
  db.prepare(
    `INSERT INTO documents (id, title, body_path, source_path, facet_domain,
                            tags_json, facet_type, source_type, mime_type,
                            hash, ingest_timestamp, status)
     VALUES (?, ?, '?', '?', ?, ?, ?, 'article', 'text/markdown', ?,
             ?, 'success')`,
  ).run(
    id,
    title,
    facetDomain,
    JSON.stringify(tags),
    facetType,
    `${id}hash`,
    new Date().toISOString(),
  );
  db.exec('BEGIN IMMEDIATE');
  await persistIndex(
    {
      docId: id,
      ftsFields: {
        title,
        summary: title,
        tags: tags.join(', '),
        facet_topic: '',
        body_excerpt: title,
      },
      vector: new Float32Array(768),
      edges: [],
      signal: new AbortController().signal,
    },
    db,
  );
  db.exec('COMMIT');
}

describe('SearchInput Zod strict-mode rejects unknown filter keys', () => {
  it('rejects unknown filter keys (FR-RETRIEVAL-004)', () => {
    const r = SearchInputZodSchema.safeParse({
      query: 'x',
      filters: { zzz_unknown: 'foo' } as never,
    });
    expect(r.success).toBe(false);
  });
  it('accepts the closed filter vocabulary', () => {
    const r = SearchInputZodSchema.safeParse({
      query: 'x',
      filters: {
        facet_domain: 'd',
        facet_type: 'tutorial',
        tags: ['a'],
        since: '2026-01-01',
        until: '2026-12-31',
        source_type: 'article',
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('Fts5Adapter filter pushdown', () => {
  it('narrows FTS5 results by facet_type', async () => {
    await seedDoc('doc-aaaaaaaa', 'memory tutorial', ['a'], 'tutorial');
    await seedDoc('doc-bbbbbbbb', 'memory reference', ['a'], 'reference');

    const fts = new Fts5Adapter(db);
    const r = await fts.search({
      query: 'memory',
      topK: 10,
      filters: { facet_type: ['tutorial'] },
      signal: new AbortController().signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.results.length).toBe(1);
    expect(r.value.results[0].doc_id).toBe('doc-aaaaaaaa');
  });

  it('narrows by facet_domain', async () => {
    await seedDoc('doc-aaaaaaaa', 'agent memory', ['a'], 'tutorial', 'agents');
    await seedDoc(
      'doc-bbbbbbbb',
      'agent memory',
      ['a'],
      'tutorial',
      'other-domain',
    );

    const fts = new Fts5Adapter(db);
    const r = await fts.search({
      query: 'agent',
      topK: 10,
      filters: { facet_domain: 'agents' },
      signal: new AbortController().signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.results.length).toBe(1);
    expect(r.value.results[0].doc_id).toBe('doc-aaaaaaaa');
  });
});

describe('VecAdapter filter pushdown', () => {
  it('narrows dense results by facet_type', async () => {
    await seedDoc('doc-aaaaaaaa', 'memory', ['a'], 'tutorial');
    await seedDoc('doc-bbbbbbbb', 'memory', ['a'], 'reference');

    const vec = new VecAdapter(db);
    const r = await vec.search({
      queryEmbedding: new Float32Array(768),
      topK: 10,
      filters: { facet_type: ['tutorial'] },
      signal: new AbortController().signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.results.length).toBe(1);
    expect(r.value.results[0].doc_id).toBe('doc-aaaaaaaa');
  });
});

describe('GraphAdapter filter pushdown', () => {
  it('returns empty when seedDocIds is empty (no error)', async () => {
    const g = new GraphAdapter(db);
    const r = await g.search({
      seedDocIds: [],
      topK: 10,
      signal: new AbortController().signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.results).toEqual([]);
  });
});
