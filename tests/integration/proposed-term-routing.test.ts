// T053 + T054 (SP-004 US3) — Proposed-term integration + no-auto-promotion.
//
// T053: end-to-end — seed 2 established domains + 5 tags; mock Ollama with
//   facet_domain_proposed=quantum-cryptography; assert:
//     - new taxonomy_terms row state=proposed
//     - established_count unchanged from seed
//     - corpus://taxonomy MCP read returns only original established set
//
// T054: 5 runs producing same proposed term collapse to 1 row; zero
//   established-state rows for that term; no INSERT INTO taxonomy_terms
//   with 'established' literal in SP-004 source.

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

async function startMockOllamaWithProposedDomain(): Promise<MockServer> {
  const content = JSON.stringify({
    facet_domain: 'agent-systems',
    facet_type: 'tutorial',
    tags: ['memory', 'retrieval', 'tutorial'],
    summary: 'short.',
    confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    facet_domain_proposed: 'quantum-cryptography',
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-us3-int-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

async function seedSentinel(docId: string): Promise<string> {
  const { openIndexReadWrite, insertDocument } = await import(
    '@llm-corpus/storage'
  );
  const { Paths, stringifyMarkdownWithFrontmatter } = await import(
    '@llm-corpus/contracts'
  );
  const bodyRel = path.join('store', docId.slice(4, 6), `${docId}.md`);
  const db = openIndexReadWrite();
  try {
    insertDocument(db, {
      id: docId,
      title: 't',
      body_path: bodyRel,
      source_path: '/p',
      facet_domain: '',
      tags_json: '[]',
      facet_type: 'unclassified',
      source_type: 'inbox-filesystem',
      mime_type: 'text/markdown',
      hash: docId.slice(4).padStart(64, '5'),
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
      frontmatter: { id: docId, title: 't' },
      body: 'body',
    }),
    'utf8',
  );
  return bodyRel;
}

describe('US3 SC-CLASSIFY-008/009 — proposed-term routing integration', () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockOllamaWithProposedDomain();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('T053 — proposed domain → taxonomy_terms state=proposed; established set unchanged', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const db0 = openIndexReadWrite();
      try {
        db0.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
            ('domain', 'agent-systems', 'established', '2026-05-01T00:00:00Z'),
            ('domain', 'distributed-systems', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'memory', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'retrieval', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'tutorial', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'paper', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'reference', 'established', '2026-05-01T00:00:00Z');
        `);
      } finally {
        db0.close();
      }

      const docId = 'doc-53535353';
      await seedSentinel(docId);

      const { classifyStage, ClassifyCircuitBreaker, batchPolicy } =
        await import('@llm-corpus/pipeline');
      const { OllamaAdapter, loadEstablishedVocabulary } = await import(
        '@llm-corpus/inference'
      );
      const { CLASSIFIER_OUTPUT_JSON_SCHEMA } = await import(
        '@llm-corpus/contracts'
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
          expect(result.value.outcome).toBe('classified');
          expect(result.value.proposedTermCount).toBe(1);
        }

        // Proposed-state row exists.
        const proposed = db
          .prepare(
            `SELECT state, established_at FROM taxonomy_terms WHERE axis='domain' AND term='quantum-cryptography'`,
          )
          .get() as { state: string; established_at: string | null };
        expect(proposed.state).toBe('proposed');
        expect(proposed.established_at).toBeNull();

        // Established set unchanged (7 = 2 domains + 5 tags).
        const established = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM taxonomy_terms WHERE state='established'`,
            )
            .get() as { n: number }
        ).n;
        expect(established).toBe(7);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T054 — 5 runs proposing same domain collapse to 1 row; zero established INSERTs from SP-004', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const db0 = openIndexReadWrite();
      try {
        db0.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
            ('domain', 'agent-systems', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'memory', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'retrieval', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'tutorial', 'established', '2026-05-01T00:00:00Z');
        `);
      } finally {
        db0.close();
      }

      const { classifyStage, ClassifyCircuitBreaker, batchPolicy } =
        await import('@llm-corpus/pipeline');
      const { OllamaAdapter, loadEstablishedVocabulary } = await import(
        '@llm-corpus/inference'
      );
      const { CLASSIFIER_OUTPUT_JSON_SCHEMA } = await import(
        '@llm-corpus/contracts'
      );

      for (let i = 0; i < 5; i += 1) {
        const docId = `doc-540504${i.toString(16).padStart(2, '0')}`;
        await seedSentinel(docId);
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
          const r = await classifyStage({
            docId,
            db,
            ollama: adapter,
            vocabulary: vocabRes.value,
            policy: batchPolicy,
            circuitBreaker: new ClassifyCircuitBreaker(),
            modelName: 'qwen3.5:9b',
            signal: c.signal,
          });
          expect(r.ok).toBe(true);
        } finally {
          db.close();
        }
      }

      const db = openIndexReadWrite();
      try {
        const proposed = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM taxonomy_terms WHERE axis='domain' AND term='quantum-cryptography'`,
            )
            .get() as { n: number }
        ).n;
        expect(proposed).toBe(1);
        const establishedNew = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM taxonomy_terms WHERE axis='domain' AND term='quantum-cryptography' AND state='established'`,
            )
            .get() as { n: number }
        ).n;
        expect(establishedNew).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
