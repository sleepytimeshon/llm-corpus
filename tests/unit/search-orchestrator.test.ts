// SP-005 T031 — Contract test for searchOrchestrator.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-002,
//     FR-RETRIEVAL-003, FR-RETRIEVAL-013, FR-RETRIEVAL-020,
//     FR-RETRIEVAL-023, SC-RETRIEVAL-020
//   - Constitution Principles V, VII, XIII

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import { persistIndex } from '../../packages/storage/src/index-persister.js';
import { searchOrchestrator } from '../../packages/index/src/search.js';
import type { EmbeddingAdapter } from '../../packages/inference/src/embedding-adapter.js';
import { ok } from '../../packages/contracts/src/result.js';

let db: Database.Database;
const policyConfig = {
  topKPerRetriever: 64,
  retrieverSqlTimeoutMs: 5_000,
  embeddingHttpTimeoutMs: 10_000,
  searchTotalTimeoutMs: 30_000,
};

/**
 * Mock EmbeddingAdapter that returns a deterministic embedding derived
 * from the input text's first chars. Avoids the live Ollama dependency.
 */
function mockEmbedder(): EmbeddingAdapter {
  const fakeAdapter = {
    model: 'mock',
    endpoint: 'http://localhost:11434/api/embeddings',
    expectedDim: 768,
    async embedDocument(text: string): Promise<{ ok: true; value: Float32Array }> {
      return Promise.resolve(ok(fingerprint(text)));
    },
    async embedQuery(text: string): Promise<{ ok: true; value: Float32Array }> {
      return Promise.resolve(ok(fingerprint(text)));
    },
  } as unknown as EmbeddingAdapter;
  return fakeAdapter;
}

function fingerprint(s: string): Float32Array {
  const v = new Float32Array(768);
  for (let i = 0; i < Math.min(s.length, 768); i += 1) {
    v[i] = s.charCodeAt(i) / 256;
  }
  return v;
}

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
  summary: string,
  tags: string[],
  facetType: string,
): Promise<void> {
  db.prepare(
    `INSERT INTO documents
       (id, title, body_path, source_path, facet_domain, tags_json, facet_type,
        source_type, mime_type, hash, ingest_timestamp, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')`,
  ).run(
    id,
    title,
    `store/${id}.md`,
    `inbox/${id}.md`,
    'test-domain',
    JSON.stringify(tags),
    facetType,
    'article',
    'text/markdown',
    `${id}hash`,
    new Date().toISOString(),
  );
  db.exec('BEGIN IMMEDIATE');
  await persistIndex(
    {
      docId: id,
      ftsFields: {
        title,
        summary,
        tags: tags.join(', '),
        facet_topic: '',
        body_excerpt: `${title} ${summary} ${tags.join(' ')}`,
      },
      vector: fingerprint(`${title} ${summary} ${tags.join(' ')}`),
      edges: [],
      signal: new AbortController().signal,
    },
    db,
  );
  db.exec('COMMIT');
}

describe('searchOrchestrator', () => {
  it('returns SearchHit list for matching query (happy path)', async () => {
    await seedDoc('doc-aaaaaaaa', 'agent memory', 'vector retrieval', ['agents', 'retrieval'], 'tutorial');
    await seedDoc('doc-bbbbbbbb', 'kubernetes operators', 'controllers', ['k8s', 'ops'], 'reference');

    const out = await searchOrchestrator({
      input: { query: 'agent memory', limit: 10 },
      db,
      embeddingAdapter: mockEmbedder(),
      ...policyConfig,
      signal: new AbortController().signal,
    });
    expect(out.tier_used).toBe('hybrid');
    expect(out.signals_used).toContain('bm25');
    expect(out.signals_used).toContain('dense');
    expect(out.result_count).toBeGreaterThan(0);
    expect(out.hits[0].uri).toMatch(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/);
    expect(out.hits[0].facet_type).toBe('tutorial');
  });

  it('annotates degraded_signals when embedding adapter fails', async () => {
    await seedDoc('doc-aaaaaaaa', 'agent memory', 's', ['agents'], 'tutorial');

    const adapter = {
      async embedDocument(): Promise<unknown> {
        return { ok: false, error: new Error('unavail') };
      },
      async embedQuery(): Promise<unknown> {
        return { ok: false, error: new Error('unavail') };
      },
    } as unknown as EmbeddingAdapter;

    const out = await searchOrchestrator({
      input: { query: 'agent memory', limit: 10 },
      db,
      embeddingAdapter: adapter,
      ...policyConfig,
      signal: new AbortController().signal,
    });
    expect(out.degraded_signals).toContain('dense');
    expect(out.signals_used).not.toContain('dense');
    // BM25 + graph + confidence should still produce results.
    expect(out.result_count).toBeGreaterThan(0);
  });

  it('returns empty hits + signals_used set on a corpus with no documents', async () => {
    const out = await searchOrchestrator({
      input: { query: 'anything', limit: 10 },
      db,
      embeddingAdapter: mockEmbedder(),
      ...policyConfig,
      signal: new AbortController().signal,
    });
    expect(out.result_count).toBe(0);
    expect(out.hits).toEqual([]);
    expect(out.tier_used).toBe('hybrid');
    // BM25 finds nothing → succeeded but empty. Same for the rest.
    // signals_used reflects retrievers that ran successfully.
    expect(out.signals_used.length).toBeGreaterThanOrEqual(1);
  });

  it('passes the filters through to retrievers (filter narrowing)', async () => {
    await seedDoc('doc-aaaaaaaa', 'agent memory', 'tutorial topic', ['a'], 'tutorial');
    await seedDoc('doc-bbbbbbbb', 'agent memory', 'reference topic', ['a'], 'reference');

    const out = await searchOrchestrator({
      input: {
        query: 'agent',
        limit: 10,
        filters: { facet_type: ['tutorial'] },
      },
      db,
      embeddingAdapter: mockEmbedder(),
      ...policyConfig,
      signal: new AbortController().signal,
    });
    for (const hit of out.hits) {
      expect(hit.facet_type).toBe('tutorial');
    }
    expect(out.filters_applied).toEqual({ facet_type: ['tutorial'] });
  });
});
