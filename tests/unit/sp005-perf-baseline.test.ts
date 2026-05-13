// SP-005 T080-T081 — Empirical performance baseline (Constitution XVI honesty).
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-022, SC-RETRIEVAL-021
//   - Constitution Principle XVI
//
// This test measures the in-process search orchestrator latency against
// a synthetic seeded corpus (mock embedder; deterministic data). The
// numbers are recorded honestly. They are NOT a guarantee — the
// aspirational §10.6 sub-20ms target requires real-world workload data
// that will only be available with live-Ollama integration tests against
// the user's pai-node01 (Phase 5 / T081 walkthrough).
//
// The numbers below represent baseline performance with a small corpus
// (20 docs) and mock embeddings — they bound the orchestration overhead.

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

beforeEach(() => {
  db = new Database(':memory:');
  sqliteVec.load(db);
  runSchemaMigration(db);
  runSp005Migration(db);
});

afterEach(() => {
  db.close();
});

function mockEmbedder(): EmbeddingAdapter {
  return {
    model: 'mock',
    endpoint: 'http://localhost:11434/api/embeddings',
    expectedDim: 768,
    async embedDocument(text: string): Promise<{ ok: true; value: Float32Array }> {
      const v = new Float32Array(768);
      for (let i = 0; i < Math.min(text.length, 768); i += 1) {
        v[i] = text.charCodeAt(i) / 256;
      }
      return ok(v);
    },
    async embedQuery(text: string): Promise<{ ok: true; value: Float32Array }> {
      const v = new Float32Array(768);
      for (let i = 0; i < Math.min(text.length, 768); i += 1) {
        v[i] = text.charCodeAt(i) / 256;
      }
      return ok(v);
    },
  } as unknown as EmbeddingAdapter;
}

async function seedDoc(id: string, title: string, tags: string[]): Promise<void> {
  db.prepare(
    `INSERT INTO documents (id, title, body_path, source_path, facet_domain,
                            tags_json, facet_type, source_type, mime_type, hash,
                            ingest_timestamp, status)
     VALUES (?, ?, 'p', 'p', 'd', ?, 'concept', 'article', 'text/markdown', ?,
             ?, 'success')`,
  ).run(id, title, JSON.stringify(tags), `${id}h`, new Date().toISOString());
  db.exec('BEGIN IMMEDIATE');
  const v = new Float32Array(768);
  for (let i = 0; i < Math.min(title.length, 768); i += 1) {
    v[i] = title.charCodeAt(i) / 256;
  }
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
      vector: v,
      edges: [],
      signal: new AbortController().signal,
    },
    db,
  );
  db.exec('COMMIT');
}

describe('SP-005 performance baseline (Constitution XVI honesty)', () => {
  it('search orchestration overhead on 20-doc seeded corpus', async () => {
    for (let i = 0; i < 20; i += 1) {
      const id = `doc-${i.toString(16).padStart(8, '0')}`;
      await seedDoc(id, `document ${i} about agents memory`, ['agents', 'memory']);
    }

    const start = Date.now();
    const out = await searchOrchestrator({
      input: { query: 'agents memory', limit: 10 },
      db,
      embeddingAdapter: mockEmbedder(),
      topKPerRetriever: 64,
      retrieverSqlTimeoutMs: 5_000,
      embeddingHttpTimeoutMs: 10_000,
      searchTotalTimeoutMs: 30_000,
      signal: new AbortController().signal,
    });
    const elapsed = Date.now() - start;
    expect(out.tier_used).toBe('hybrid');
    expect(out.result_count).toBeGreaterThan(0);
    // Mock-embedder + 20-doc corpus baseline: well under 100ms.
    expect(elapsed).toBeLessThan(500);
    // Record the actual elapsed for visibility (vitest prints it on
    // failure; we log it to make the honest measurement visible).
    process.stderr.write(
      `SP-005 perf baseline (20 docs, mock embedder): ${elapsed}ms\n`,
    );
  });
});
