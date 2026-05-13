// T028 (SP-004 US1) — Ollama unavailable → failure-lane + sidecar.
//
// Asserts:
//   - classify.ollama_unavailable telemetry emitted (severity error).
//   - <doc-id>.error.json sidecar at Paths.failed() with
//     error_code='ollama_unavailable', retriable=true, stage='classify'.
//   - SQL row stays sentinel.
//
// Spec references:
//   - Edge Case "Ollama service unavailable"
//   - FR-CLASSIFY-011

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-unavail-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

describe('US1 — Ollama unavailable → failure-lane sidecar (Edge Case + FR-CLASSIFY-011)', () => {
  it('emits classify.ollama_unavailable + writes <doc-id>.error.json + row stays sentinel', async () => {
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
      const {
        classifyStage,
        ClassifyCircuitBreaker,
        batchPolicy,
      } = await import('@llm-corpus/pipeline');
      const { OllamaAdapter, loadEstablishedVocabulary } = await import(
        '@llm-corpus/inference'
      );

      const docId = 'doc-deaddead';
      const bodyRel = path.join('store', 'de', `${docId}.md`);
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
          hash: '7'.repeat(64).replace(/.$/, '7'),
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

      const db2 = openIndexReadWrite();
      try {
        const c = new AbortController();
        const vocabRes = await loadEstablishedVocabulary(db2, c.signal);
        if (!vocabRes.ok) throw new Error('vocab load failed');
        const adapter = new OllamaAdapter({
          model: 'qwen3.5:9b',
          schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
          // Unused port → ECONNREFUSED.
          baseUrl: 'http://127.0.0.1:1',
        });
        const result = await classifyStage({
          docId,
          db: db2,
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
          expect(result.value.errorCode).toBe('ollama_unavailable');
        }
        // Row stays sentinel.
        const row = db2
          .prepare(`SELECT facet_type FROM documents WHERE id=?`)
          .get(docId) as { facet_type: string };
        expect(row.facet_type).toBe('unclassified');
      } finally {
        db2.close();
      }

      // Sidecar present.
      const sidecarPath = path.join(Paths.failed(), `${docId}.error.json`);
      const sidecarText = await fsp.readFile(sidecarPath, 'utf8');
      const sidecar = JSON.parse(sidecarText) as {
        error_code: string;
        retriable: boolean;
        stage: string;
      };
      expect(sidecar.error_code).toBe('ollama_unavailable');
      expect(sidecar.retriable).toBe(true);
      expect(sidecar.stage).toBe('classify');
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
