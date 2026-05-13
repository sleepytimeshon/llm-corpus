// T061 (SP-004 Phase 6) — No body content appears in telemetry payloads.
//
// Spec references:
//   - SC-CLASSIFY-020
//   - Constitution Principle I + FR-CLASSIFY-013
//
// Fixture body contains the sentinel string FIXTURE_CANARY_SP004. After a
// classify run, the telemetry JSONL at Paths.telemetry() must NOT contain
// any instance of that string.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

const CANARY = 'FIXTURE_CANARY_SP004';

interface MockServer {
  port: number;
  close: () => Promise<void>;
}

async function startMockOllama(): Promise<MockServer> {
  const content = JSON.stringify({
    facet_domain: 'agent-systems',
    facet_type: 'tutorial',
    tags: ['memory', 'retrieval', 'tutorial'],
    summary: 'short summary without canary.',
    confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-canary-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

describe('SC-CLASSIFY-020 — no body content in telemetry payloads (Principle I)', () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockOllama();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('classify run with FIXTURE_CANARY_SP004 in body produces telemetry with zero canary matches', async () => {
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

      const docId = 'doc-cacacaca';
      const bodyRel = path.join('store', 'ca', `${docId}.md`);
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
          title: 'canary-test',
          body_path: bodyRel,
          source_path: '/inbox/canary.md',
          facet_domain: '',
          tags_json: '[]',
          facet_type: 'unclassified',
          source_type: 'inbox-filesystem',
          mime_type: 'text/markdown',
          hash: 'c'.repeat(64).replace(/.$/, '9'),
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
          frontmatter: { id: docId, title: 'canary-test' },
          body: `# Body with ${CANARY} embedded inside.\n\nMore content with ${CANARY} appearing again.\n`,
        }),
        'utf8',
      );

      const db2 = openIndexReadWrite();
      try {
        const c = new AbortController();
        const vocabRes = await loadEstablishedVocabulary(db2, c.signal);
        if (!vocabRes.ok) throw new Error('vocab load failed');
        const adapter = new OllamaAdapter({
          model: 'qwen3.5:9b',
          schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
          baseUrl: `http://127.0.0.1:${mock.port}`,
        });
        const r = await classifyStage({
          docId,
          db: db2,
          ollama: adapter,
          vocabulary: vocabRes.value,
          policy: batchPolicy,
          circuitBreaker: new ClassifyCircuitBreaker(),
          modelName: 'qwen3.5:9b',
          signal: c.signal,
        });
        expect(r.ok).toBe(true);
      } finally {
        db2.close();
      }

      const telemetryFile = Paths.telemetry();
      const telemetryText = await fsp.readFile(telemetryFile, 'utf8');
      // The body section had the canary; the telemetry JSONL must NOT.
      expect(telemetryText).not.toContain(CANARY);
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
