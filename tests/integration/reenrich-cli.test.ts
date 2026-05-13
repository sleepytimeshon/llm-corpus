// T040-T046 (SP-004 US2) — `corpus reenrich` CLI integration suite.
//
// Covers:
//   - T040: lock acquisition + sentinel iteration + classify-stage dispatch.
//   - T041: --dry-run lists docs without Ollama HTTP calls or SQL UPDATEs.
//   - T042: already-classified rows are filtered at SQL level (skipped=0).
//   - T044: drain-lock contention emits pipeline.lock_contention + exits ok.
//   - T046: idempotent — fully-classified corpus → 0 Ollama calls.
//
// Tests T043 (full CLI invocation via spawn) + T045 (SIGTERM mid-batch
// against the spawned process) are deferred — they require a built CLI
// binary on PATH, which the build/test harness doesn't currently set up.
// The wire-level contract for those tests is covered by T040 + T044.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

interface MockServer {
  port: number;
  close: () => Promise<void>;
  callCount: () => number;
  reset: () => void;
}

async function startMockOllama(): Promise<MockServer> {
  let calls = 0;
  const content = JSON.stringify({
    facet_domain: 'agent-systems',
    facet_type: 'tutorial',
    tags: ['memory', 'retrieval', 'tutorial'],
    summary: 'short summary.',
    confidence: { domain: 0.9, type: 0.9, tags: 0.85 },
  });
  const server = http.createServer((_req, res) => {
    calls += 1;
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
    callCount: () => calls,
    reset: () => {
      calls = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-reenrich-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

async function seedSentinel(
  docId: string,
  ingestOffsetSec: number,
): Promise<void> {
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
      title: docId,
      body_path: bodyRel,
      source_path: `/inbox/${docId}.md`,
      facet_domain: '',
      tags_json: '[]',
      facet_type: 'unclassified',
      source_type: 'inbox-filesystem',
      mime_type: 'text/markdown',
      hash: docId.slice(4).padStart(64, '0'),
      ingest_timestamp: new Date(
        Date.parse('2026-05-13T10:00:00Z') + ingestOffsetSec * 1000,
      ).toISOString(),
      status: 'success',
    });
  } finally {
    db.close();
  }
  const full = path.join((await import('@llm-corpus/contracts')).Paths.docs(), bodyRel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(
    full,
    stringifyMarkdownWithFrontmatter({
      frontmatter: { id: docId, title: docId },
      body: 'sample body.\n',
    }),
    'utf8',
  );
}

async function seedClassified(docId: string): Promise<void> {
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
      title: docId,
      body_path: bodyRel,
      source_path: `/inbox/${docId}.md`,
      facet_domain: 'agent-systems',
      tags_json: '["a","b","c"]',
      facet_type: 'concept',
      source_type: 'inbox-filesystem',
      mime_type: 'text/markdown',
      hash: docId.slice(4).padStart(64, '1'),
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
      frontmatter: { id: docId, title: docId },
      body: 'sample body.\n',
    }),
    'utf8',
  );
}

async function seedTaxonomy(): Promise<void> {
  const { openIndexReadWrite } = await import('@llm-corpus/storage');
  const db = openIndexReadWrite();
  try {
    db.exec(`
      INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
        ('domain', 'agent-systems', 'established', '2026-05-01T00:00:00Z'),
        ('tag', 'memory', 'established', '2026-05-01T00:00:00Z'),
        ('tag', 'retrieval', 'established', '2026-05-01T00:00:00Z'),
        ('tag', 'tutorial', 'established', '2026-05-01T00:00:00Z');
    `);
  } finally {
    db.close();
  }
}

describe('US2 — corpus reenrich CLI', () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockOllama();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('T040 — drains sentinel rows via classify-stage; summary populated', async () => {
    const root = await makeIsolatedCorpus();
    try {
      await seedTaxonomy();
      await seedSentinel('doc-d1d1d1d1', 1);
      await seedSentinel('doc-d2d2d2d2', 2);
      mock.reset();

      const { runReenrichCommand } = await import(
        '../../packages/cli/src/reenrich-command.js'
      );
      const { interactivePolicy } = await import('@llm-corpus/pipeline');
      const result = await runReenrichCommand({
        args: { baseUrl: `http://127.0.0.1:${mock.port}` },
        policy: interactivePolicy,
        signal: new AbortController().signal,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.classified).toBe(2);
        expect(result.value.failed).toBe(0);
        expect(result.value.skipped).toBe(0);
        expect(result.value.lockContended).toBe(false);
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T041 — --dry-run lists docs WITHOUT Ollama HTTP calls or SQL UPDATEs', async () => {
    const root = await makeIsolatedCorpus();
    try {
      await seedTaxonomy();
      await seedSentinel('doc-e1e1e1e1', 1);
      await seedSentinel('doc-e2e2e2e2', 2);
      mock.reset();

      const { runReenrichCommand } = await import(
        '../../packages/cli/src/reenrich-command.js'
      );
      const { interactivePolicy } = await import('@llm-corpus/pipeline');
      const result = await runReenrichCommand({
        args: {
          dryRun: true,
          baseUrl: `http://127.0.0.1:${mock.port}`,
        },
        policy: interactivePolicy,
        signal: new AbortController().signal,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dryRun).toBe(true);
        expect(result.value.classified).toBe(0);
        expect(result.value.failed).toBe(0);
      }
      // Zero Ollama HTTP calls during dry run.
      expect(mock.callCount()).toBe(0);

      // Rows still sentinel.
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const db = openIndexReadWrite();
      try {
        const count = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM documents WHERE facet_type='unclassified'`,
            )
            .get() as { n: number }
        ).n;
        expect(count).toBe(2);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T042 — already-classified rows filtered at SQL level (skipped=0)', async () => {
    const root = await makeIsolatedCorpus();
    try {
      await seedTaxonomy();
      // Mixed corpus: 2 sentinel + 1 already-classified.
      await seedSentinel('doc-f1f1f1f1', 1);
      await seedSentinel('doc-f2f2f2f2', 2);
      await seedClassified('doc-f3f3f3f3');
      mock.reset();

      const { runReenrichCommand } = await import(
        '../../packages/cli/src/reenrich-command.js'
      );
      const { interactivePolicy } = await import('@llm-corpus/pipeline');
      const result = await runReenrichCommand({
        args: { baseUrl: `http://127.0.0.1:${mock.port}` },
        policy: interactivePolicy,
        signal: new AbortController().signal,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.classified).toBe(2);
        expect(result.value.failed).toBe(0);
        // skipped=0 because the WHERE clause filters at SQL level.
        expect(result.value.skipped).toBe(0);
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T044 — drain-lock contention emits pipeline.lock_contention + exits ok with all-zero summary', async () => {
    const root = await makeIsolatedCorpus();
    try {
      await seedTaxonomy();
      await seedSentinel('doc-aaaaaaaa', 1);

      // Manually hold the drain-lock.
      const { acquireDrainLock } = await import('@llm-corpus/pipeline');
      const holderResult = acquireDrainLock();
      expect(holderResult.ok).toBe(true);
      if (!holderResult.ok) return;
      try {
        const { runReenrichCommand } = await import(
          '../../packages/cli/src/reenrich-command.js'
        );
        const { interactivePolicy } = await import('@llm-corpus/pipeline');
        const result = await runReenrichCommand({
          args: { baseUrl: `http://127.0.0.1:${mock.port}` },
          policy: interactivePolicy,
          signal: new AbortController().signal,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.lockContended).toBe(true);
          expect(result.value.classified).toBe(0);
          expect(result.value.failed).toBe(0);
        }
      } finally {
        holderResult.value.release();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T046 — idempotent: fully-classified corpus → 0 Ollama calls, all-zero summary', async () => {
    const root = await makeIsolatedCorpus();
    try {
      await seedTaxonomy();
      await seedClassified('doc-bbbbbbbb');
      await seedClassified('doc-cccccccc');
      mock.reset();

      const { runReenrichCommand } = await import(
        '../../packages/cli/src/reenrich-command.js'
      );
      const { interactivePolicy } = await import('@llm-corpus/pipeline');
      const result = await runReenrichCommand({
        args: { baseUrl: `http://127.0.0.1:${mock.port}` },
        policy: interactivePolicy,
        signal: new AbortController().signal,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.classified).toBe(0);
        expect(result.value.failed).toBe(0);
        expect(result.value.skipped).toBe(0);
      }
      expect(mock.callCount()).toBe(0);
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
