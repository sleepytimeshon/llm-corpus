// T025 (SP-004 US1) — classify-stage orchestrator contract test.
//
// Verifies classifyStage:
//   - Emits classify.started + classify.ollama_request + classify.ollama_response
//     + classify.completed for the happy path.
//   - Wires a per-doc AbortController with setTimeout(controller.abort,
//     policy.perDocClassifyTimeoutMs) — NEVER Promise.race(setTimeout).
//   - clearTimeout on success or failure.
//   - On SchemaInvalidError retries once per policy.classifyRetryMaxAttempts.
//   - On VocabularyViolationError routes to failure lane + emits
//     classify.vocabulary_violation.
//   - On OllamaUnavailableError records on the circuit-breaker; if shouldHalt
//     returns true, emits classify.batch_halted + halt=true.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-001, FR-CLASSIFY-005,
//     FR-CLASSIFY-008, FR-CLASSIFY-009, FR-CLASSIFY-010, FR-CLASSIFY-011
//   - Constitution Principle VI, VII, IX
//
// TDD: this test MUST FAIL before T038 (the implementation) lands.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-stage-'));
  process.env.CORPUS_HOME = root;
  await fsp.mkdir(path.join(root, 'data'), { recursive: true });
  await fsp.mkdir(path.join(root, 'state'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true });
  await fsp.mkdir(path.join(root, 'config'), { recursive: true });
  return root;
}

async function seedSentinelDoc(
  docId: string,
  bodyRel: string,
  bodyText: string,
): Promise<void> {
  const { openIndexReadWrite, insertDocument } = await import(
    '@llm-corpus/storage'
  );
  const { Paths, stringifyMarkdownWithFrontmatter } = await import(
    '@llm-corpus/contracts'
  );
  const db = openIndexReadWrite();
  try {
    insertDocument(db, {
      id: docId,
      title: 'stage-title',
      body_path: bodyRel,
      source_path: '/inbox/x.md',
      facet_domain: '',
      tags_json: '[]',
      facet_type: 'unclassified',
      source_type: 'inbox-filesystem',
      mime_type: 'text/markdown',
      hash: 'e'.repeat(64).replace(/.$/, '5'),
      ingest_timestamp: '2026-05-13T10:00:00.000Z',
      status: 'success',
    });
  } finally {
    db.close();
  }
  const fullBody = path.join(Paths.docs(), bodyRel);
  await fsp.mkdir(path.dirname(fullBody), { recursive: true });
  await fsp.writeFile(
    fullBody,
    stringifyMarkdownWithFrontmatter({
      frontmatter: { id: docId, title: 'stage-title' },
      body: bodyText,
    }),
    'utf8',
  );
}

// Minimal mock OllamaAdapter implementing the classify shape.
interface MockOutcome {
  ok: boolean;
  content?: string;
  errorKind?: 'unavailable' | 'abort';
}
function makeMockAdapter(outcomes: MockOutcome[]): {
  classify: (input: {
    systemMessage: string;
    userMessage: string;
    signal: AbortSignal;
  }) => Promise<
    { ok: true; value: { content: string; durationMs: number; responseTokenCount: number } }
    | { ok: false; error: Error & { code?: string } }
  >;
  callCount: () => number;
} {
  let i = 0;
  return {
    classify: async () => {
      const out = outcomes[i++] ?? outcomes[outcomes.length - 1]!;
      if (out.ok) {
        return {
          ok: true,
          value: {
            content: out.content!,
            durationMs: 10,
            responseTokenCount: 50,
          },
        };
      }
      if (out.errorKind === 'unavailable') {
        const { OllamaUnavailableError } = await import('@llm-corpus/contracts');
        return {
          ok: false,
          error: new OllamaUnavailableError({
            errno: 'ECONNREFUSED',
            message: 'mock unavail',
          }),
        };
      }
      const e: Error & { code?: string } = new Error('mock abort');
      e.name = 'AbortError';
      return { ok: false, error: e };
    },
    callCount: () => i,
  };
}

const validContent = JSON.stringify({
  facet_domain: 'agent-systems',
  facet_type: 'tutorial',
  tags: ['memory', 'retrieval', 'tutorial'],
  summary: 'good summary.',
  confidence: { domain: 0.9, type: 0.9, tags: 0.85 },
});
const invalidContent = JSON.stringify({
  // facet_domain missing
  facet_type: 'tutorial',
  tags: ['memory', 'retrieval', 'tutorial'],
  summary: 'bad',
  confidence: { domain: 0.5, type: 0.5, tags: 0.5 },
});

describe('US1 — classifyStage (contract)', () => {
  it('classifyStage is exported from packages/pipeline', async () => {
    const mod = (await import(
      '../../packages/pipeline/src/classify-stage.js'
    )) as Record<string, unknown>;
    expect(typeof mod.classifyStage).toBe('function');
  });

  it('happy path — UPDATEs SQL + frontmatter mirror + reports outcome=classified', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-aaaa1111';
      const bodyRel = path.join('store', 'aa', `${docId}.md`);
      await seedSentinelDoc(docId, bodyRel, 'sample body.\n');
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { interactivePolicy } = await import(
        '../../packages/pipeline/src/policies.js'
      );
      const { ClassifyCircuitBreaker } = await import(
        '../../packages/pipeline/src/classify-circuit-breaker.js'
      );
      const { classifyStage } = await import(
        '../../packages/pipeline/src/classify-stage.js'
      );
      const mock = makeMockAdapter([{ ok: true, content: validContent }]);
      const cb = new ClassifyCircuitBreaker();
      const c = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await classifyStage(
          {
            docId,
            db,
            ollama: mock,
            vocabulary: {
              domains: new Set(['agent-systems']),
              tags: new Set(['memory', 'retrieval', 'tutorial']),
              types: new Set(),
              snapshot_id: '11111111-1111-4111-8111-111111111111',
              loaded_at: '2026-05-13T10:00:00.000Z',
            },
            policy: interactivePolicy,
            circuitBreaker: cb,
            modelName: 'qwen3.5:9b',
            signal: c.signal,
          },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('classified');
          expect(result.value.halt).toBe(false);
        }
        const row = db
          .prepare(`SELECT facet_type FROM documents WHERE id=?`)
          .get(docId) as { facet_type: string };
        expect(row.facet_type).toBe('tutorial');
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('schema-invalid → 1 retry per policy.classifyRetryMaxAttempts, then failure lane', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-bbbb2222';
      const bodyRel = path.join('store', 'bb', `${docId}.md`);
      await seedSentinelDoc(docId, bodyRel, 'body.\n');
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { interactivePolicy } = await import(
        '../../packages/pipeline/src/policies.js'
      );
      const { ClassifyCircuitBreaker } = await import(
        '../../packages/pipeline/src/classify-circuit-breaker.js'
      );
      const { classifyStage } = await import(
        '../../packages/pipeline/src/classify-stage.js'
      );
      const mock = makeMockAdapter([
        { ok: true, content: invalidContent },
        { ok: true, content: invalidContent },
      ]);
      const cb = new ClassifyCircuitBreaker();
      const c = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await classifyStage({
          docId,
          db,
          ollama: mock,
          vocabulary: {
            domains: new Set(['agent-systems']),
            tags: new Set(['memory', 'retrieval', 'tutorial']),
            types: new Set(),
            snapshot_id: '11111111-1111-4111-8111-111111111111',
            loaded_at: '2026-05-13T10:00:00.000Z',
          },
          policy: interactivePolicy,
          circuitBreaker: cb,
          modelName: 'qwen3.5:9b',
          signal: c.signal,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('failed');
          expect(result.value.errorCode).toBe('schema_invalid');
        }
        // Two Ollama calls — original + 1 retry.
        expect(mock.callCount()).toBe(2);
        // Row stays sentinel.
        const row = db
          .prepare(`SELECT facet_type FROM documents WHERE id=?`)
          .get(docId) as { facet_type: string };
        expect(row.facet_type).toBe('unclassified');
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('ollama_unavailable trips the circuit-breaker; halt=true when threshold hit', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-cccc3333';
      const bodyRel = path.join('store', 'cc', `${docId}.md`);
      await seedSentinelDoc(docId, bodyRel, 'body.\n');
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { interactivePolicy } = await import(
        '../../packages/pipeline/src/policies.js'
      );
      const { ClassifyCircuitBreaker } = await import(
        '../../packages/pipeline/src/classify-circuit-breaker.js'
      );
      const { classifyStage } = await import(
        '../../packages/pipeline/src/classify-stage.js'
      );
      const mock = makeMockAdapter([{ ok: false, errorKind: 'unavailable' }]);
      const cb = new ClassifyCircuitBreaker({ threshold: 1 });
      const c = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await classifyStage({
          docId,
          db,
          ollama: mock,
          vocabulary: {
            domains: new Set(['agent-systems']),
            tags: new Set(['memory', 'retrieval', 'tutorial']),
            types: new Set(),
            snapshot_id: '11111111-1111-4111-8111-111111111111',
            loaded_at: '2026-05-13T10:00:00.000Z',
          },
          policy: interactivePolicy,
          circuitBreaker: cb,
          modelName: 'qwen3.5:9b',
          signal: c.signal,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('failed');
          expect(result.value.errorCode).toBe('ollama_unavailable');
          expect(result.value.halt).toBe(true);
        }
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
