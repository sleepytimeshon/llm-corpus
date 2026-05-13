// T026 (SP-004 US1) — End-to-end classify integration test.
//
// Mock-Ollama-server-driven: starts an HTTP server that mimics Ollama 0.5+
// `/api/chat` returning a schema-valid response, drives classifyStage
// against a seeded sentinel row + body file, asserts:
//   - documents.facet_domain / tags_json / facet_type populated.
//   - body file's frontmatter mirrors the SQL.
//   - No `confidence:` substring anywhere in the persisted body file.
//
// Live verification against the user's actual Ollama (Decision A primary
// model) is exercised separately by the operator walkthrough in
// quickstart.md and the Phase 7 performance smoke (T065).
//
// Spec references:
//   - SC-CLASSIFY-001, SC-CLASSIFY-002, SC-CLASSIFY-005

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

interface MockServer {
  port: number;
  close: () => Promise<void>;
  setContent: (json: string) => void;
}

async function startMockOllama(): Promise<MockServer> {
  let content = JSON.stringify({
    facet_domain: 'agent-systems',
    facet_type: 'tutorial',
    tags: ['memory', 'retrieval', 'tutorial'],
    summary: 'short summary.',
    confidence: { domain: 0.92, type: 0.91, tags: 0.85 },
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
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    setContent: (j) => {
      content = j;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-e2e-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

describe('US1 SC-CLASSIFY-001 — end-to-end classify (mock-Ollama)', () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockOllama();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('happy path: 1 sentinel doc → classified row + mirrored frontmatter + 0 confidence on disk', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite, insertDocument } = await import(
        '@llm-corpus/storage'
      );
      const {
        Paths,
        stringifyMarkdownWithFrontmatter,
        CLASSIFIER_OUTPUT_JSON_SCHEMA,
        parseMarkdownWithFrontmatter,
      } = await import('@llm-corpus/contracts');
      const {
        classifyStage,
        ClassifyCircuitBreaker,
        batchPolicy,
      } = await import('@llm-corpus/pipeline');
      const { OllamaAdapter, loadEstablishedVocabulary } = await import(
        '@llm-corpus/inference'
      );

      // Seed taxonomy + sentinel doc.
      const docId = 'doc-fafa1234';
      const bodyRel = path.join('store', 'fa', `${docId}.md`);
      const db = openIndexReadWrite();
      try {
        db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
            ('domain', 'agent-systems', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'memory', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'retrieval', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'tutorial', 'established', '2026-05-01T00:00:00Z');
        `);
        insertDocument(db, {
          id: docId,
          title: 'A doc',
          body_path: bodyRel,
          source_path: '/inbox/foo.md',
          facet_domain: '',
          tags_json: '[]',
          facet_type: 'unclassified',
          source_type: 'inbox-filesystem',
          mime_type: 'text/markdown',
          hash: 'f'.repeat(64).replace(/.$/, '6'),
          ingest_timestamp: '2026-05-13T10:00:00.000Z',
          status: 'success',
        });
      } finally {
        db.close();
      }

      const full = path.join(Paths.docs(), bodyRel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(
        full,
        stringifyMarkdownWithFrontmatter({
          frontmatter: { id: docId, title: 'A doc' },
          body: '# Body\n\nContents.\n',
        }),
        'utf8',
      );

      const db2 = openIndexReadWrite();
      try {
        const c = new AbortController();
        const vocabRes = await loadEstablishedVocabulary(db2, c.signal);
        expect(vocabRes.ok).toBe(true);
        if (!vocabRes.ok) return;

        const adapter = new OllamaAdapter({
          model: 'qwen3.5:9b',
          schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
          baseUrl: `http://127.0.0.1:${mock.port}`,
        });
        const cb = new ClassifyCircuitBreaker();
        const result = await classifyStage({
          docId,
          db: db2,
          ollama: adapter,
          vocabulary: vocabRes.value,
          policy: batchPolicy,
          circuitBreaker: cb,
          modelName: 'qwen3.5:9b',
          signal: c.signal,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.outcome).toBe('classified');

        // SQL row populated.
        const row = db2
          .prepare(
            `SELECT facet_domain, facet_type, tags_json FROM documents WHERE id=?`,
          )
          .get(docId) as {
          facet_domain: string;
          facet_type: string;
          tags_json: string;
        };
        expect(row.facet_domain).toBe('agent-systems');
        expect(row.facet_type).toBe('tutorial');
        expect(JSON.parse(row.tags_json)).toEqual([
          'memory',
          'retrieval',
          'tutorial',
        ]);

        // Frontmatter mirrored.
        const text = await fsp.readFile(full, 'utf8');
        const { frontmatter } = parseMarkdownWithFrontmatter(text);
        expect(frontmatter['facet_domain']).toBe('agent-systems');
        expect(frontmatter['facet_type']).toBe('tutorial');
        expect(frontmatter['tags']).toEqual([
          'memory',
          'retrieval',
          'tutorial',
        ]);
        // No confidence in persisted file (SC-CLASSIFY-002).
        expect(text).not.toContain('confidence:');
      } finally {
        db2.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
