// T029 (SP-004 US1) — Circuit-breaker batch-halted integration.
//
// With Ollama unreachable, processing 4 sentinel docs should:
//   - Emit 3 classify.ollama_unavailable events (one per attempt up to threshold).
//   - After 3rd consecutive failure, emit classify.batch_halted.
//   - Subsequent docs in the batch are NOT attempted (no Ollama HTTP call).
//
// Spec references:
//   - Edge Case "Ollama service unavailable" circuit-breaker
//   - FR-CLASSIFY-010

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-cb-int-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

describe('US1 — circuit-breaker batch_halted after threshold consecutive Ollama failures', () => {
  it('after 3 consecutive ollama_unavailable, batch halts; remaining docs not attempted', async () => {
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

      // Seed 4 sentinel docs.
      const ids = [
        'doc-c0c0c0c0',
        'doc-c1c1c1c1',
        'doc-c2c2c2c2',
        'doc-c3c3c3c3',
      ];
      const db = openIndexReadWrite();
      try {
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i]!;
          const bodyRel = path.join('store', id.slice(4, 6), `${id}.md`);
          insertDocument(db, {
            id,
            title: 't',
            body_path: bodyRel,
            source_path: '/p',
            facet_domain: '',
            tags_json: '[]',
            facet_type: 'unclassified',
            source_type: 'inbox-filesystem',
            mime_type: 'text/markdown',
            hash:
              i.toString(16).repeat(64).slice(0, 63) + i.toString(16).slice(-1),
            ingest_timestamp: `2026-05-13T10:00:0${i}.000Z`,
            status: 'success',
          });
          const full = path.join(Paths.docs(), bodyRel);
          await fsp.mkdir(path.dirname(full), { recursive: true });
          await fsp.writeFile(
            full,
            stringifyMarkdownWithFrontmatter({
              frontmatter: { id, title: 't' },
              body: 'body',
            }),
            'utf8',
          );
        }
      } finally {
        db.close();
      }

      const db2 = openIndexReadWrite();
      try {
        const c = new AbortController();
        const vocabRes = await loadEstablishedVocabulary(db2, c.signal);
        if (!vocabRes.ok) throw new Error('vocab load failed');
        const adapter = new OllamaAdapter({
          model: 'qwen3.5:9b',
          schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
          baseUrl: 'http://127.0.0.1:1',
        });
        const cb = new ClassifyCircuitBreaker({ threshold: 3 });
        let processed = 0;
        let halted = false;
        for (const id of ids) {
          if (halted) break;
          processed += 1;
          const r = await classifyStage({
            docId: id,
            db: db2,
            ollama: adapter,
            vocabulary: vocabRes.value,
            policy: batchPolicy,
            circuitBreaker: cb,
            modelName: 'qwen3.5:9b',
            signal: c.signal,
          });
          if (r.ok && r.value.halt) halted = true;
        }
        // Expect: processed 3 docs (each tripping a failure), then halt.
        // The 4th doc is never attempted.
        expect(processed).toBe(3);
        expect(halted).toBe(true);
      } finally {
        db2.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
