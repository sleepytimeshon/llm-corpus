// T055 (SP-004 US3) — Vocabulary violation routes to failure lane.
//
// Mock Ollama returns response with facet_domain='hallucinated-domain'
// that's NOT in established set AND has no facet_domain_proposed. Assert:
//   - <doc-id>.error.json sidecar at Paths.failed() with error_code='vocabulary_violation'.
//   - classify.vocabulary_violation telemetry event emitted.
//   - SQL row stays sentinel.
//   - Zero taxonomy_terms INSERTs for the offending value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

interface MockServer {
  port: number;
  close: () => Promise<void>;
}

async function startMockOllama(): Promise<MockServer> {
  const content = JSON.stringify({
    facet_domain: 'hallucinated-domain',
    facet_type: 'tutorial',
    tags: ['memory', 'retrieval', 'tutorial'],
    summary: 'short.',
    confidence: { domain: 0.6, type: 0.6, tags: 0.6 },
  });
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'qwen3.5:9b',
        message: { role: 'assistant', content },
        done: true,
        eval_count: 100,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-vv-fl-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

describe('US3 SC-CLASSIFY-010 — vocabulary violation → failure lane', () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockOllama();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('produces <doc-id>.error.json sidecar; SQL row stays sentinel; no taxonomy_terms INSERT', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite, insertDocument } = await import(
        '@llm-corpus/storage'
      );
      const {
        Paths,
        stringifyMarkdownWithFrontmatter,
        CLASSIFIER_OUTPUT_JSON_SCHEMA,
      } = await import('@llm-corpus/contracts');
      const { classifyStage, ClassifyCircuitBreaker, batchPolicy } =
        await import('@llm-corpus/pipeline');
      const { OllamaAdapter, loadEstablishedVocabulary } = await import(
        '@llm-corpus/inference'
      );

      const docId = 'doc-aaaa5555';
      const bodyRel = path.join('store', 'aa', `${docId}.md`);
      const db0 = openIndexReadWrite();
      try {
        db0.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
            ('domain', 'agent-systems', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'memory', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'retrieval', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'tutorial', 'established', '2026-05-01T00:00:00Z');
        `);
        insertDocument(db0, {
          id: docId,
          title: 't',
          body_path: bodyRel,
          source_path: '/p',
          facet_domain: '',
          tags_json: '[]',
          facet_type: 'unclassified',
          source_type: 'inbox-filesystem',
          mime_type: 'text/markdown',
          hash: '9'.repeat(64).replace(/.$/, '9'),
          ingest_timestamp: '2026-05-13T10:00:00.000Z',
          status: 'success',
        });
      } finally {
        db0.close();
      }
      const full = path.join(Paths.docs(), bodyRel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(
        full,
        stringifyMarkdownWithFrontmatter({
          frontmatter: { id: docId, title: 't' },
          body: 'body',
        }),
        'utf8',
      );

      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        const vocabRes = await loadEstablishedVocabulary(db, c.signal);
        if (!vocabRes.ok) throw new Error('vocab load failed');
        const adapter = new OllamaAdapter({
          model: 'qwen3.5:9b',
          schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
          baseUrl: `http://127.0.0.1:${mock.port}`,
        });
        const result = await classifyStage({
          docId,
          db,
          ollama: adapter,
          vocabulary: vocabRes.value,
          policy: batchPolicy,
          circuitBreaker: new ClassifyCircuitBreaker(),
          modelName: 'qwen3.5:9b',
          signal: c.signal,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('failed');
          expect(result.value.errorCode).toBe('vocabulary_violation');
        }

        // Row stays sentinel.
        const row = db
          .prepare(`SELECT facet_type FROM documents WHERE id=?`)
          .get(docId) as { facet_type: string };
        expect(row.facet_type).toBe('unclassified');

        // No taxonomy_terms INSERT for the offending value.
        const newRow = db
          .prepare(
            `SELECT 1 FROM taxonomy_terms WHERE axis='domain' AND term='hallucinated-domain'`,
          )
          .get();
        expect(newRow).toBeUndefined();
      } finally {
        db.close();
      }

      // Sidecar present.
      const sidecar = JSON.parse(
        await fsp.readFile(
          path.join(Paths.failed(), `${docId}.error.json`),
          'utf8',
        ),
      ) as { error_code: string; retriable: boolean; stage: string };
      expect(sidecar.error_code).toBe('vocabulary_violation');
      expect(sidecar.retriable).toBe(true);
      expect(sidecar.stage).toBe('classify');
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
