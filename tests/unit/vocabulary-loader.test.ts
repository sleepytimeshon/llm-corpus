// T018 (SP-004 US1) — Established-vocabulary loader contract test.
//
// Verifies loadEstablishedVocabulary(db, signal):
//   - Returns Result<EstablishedVocabulary, StorageError>.
//   - Snapshot.domains / .tags / .types are Sets of established-state terms.
//   - Snapshot has a fresh UUID v4 snapshot_id per invocation.
//   - Handles empty taxonomy_terms (returns empty Sets, not error).
//   - Two invocations produce two distinct snapshot_ids.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-006
//   - specs/004-classifier/research.md Decision E (per-batch refresh)
//   - specs/004-classifier/data-model.md §"Entity 2 — EstablishedVocabulary"
//   - Constitution Principle XV (Dynamic Taxonomy)
//
// TDD: this test MUST FAIL before T031 (the implementation) lands.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'sp004-vocab-loader-'),
  );
  process.env.CORPUS_HOME = root;
  await fsp.mkdir(path.join(root, 'data'), { recursive: true });
  await fsp.mkdir(path.join(root, 'state'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true });
  await fsp.mkdir(path.join(root, 'config'), { recursive: true });
  return root;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('US1 — loadEstablishedVocabulary (contract)', () => {
  it('loadEstablishedVocabulary is exported from packages/inference', async () => {
    const mod = (await import(
      '../../packages/inference/src/vocabulary.js'
    )) as Record<string, unknown>;
    expect(typeof mod.loadEstablishedVocabulary).toBe('function');
  });

  it('returns empty Sets when taxonomy_terms is empty', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { loadEstablishedVocabulary } = await import(
        '../../packages/inference/src/vocabulary.js'
      );
      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        const result = await loadEstablishedVocabulary(db, c.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.domains.size).toBe(0);
          expect(result.value.tags.size).toBe(0);
          expect(result.value.types.size).toBe(0);
          expect(result.value.snapshot_id).toMatch(UUID_V4);
        }
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('loads established-state terms grouped by axis', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { loadEstablishedVocabulary } = await import(
        '../../packages/inference/src/vocabulary.js'
      );
      const db = openIndexReadWrite();
      try {
        db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at)
          VALUES
            ('domain', 'agent-systems', 'established', '2026-05-01T00:00:00Z'),
            ('domain', 'distributed-systems', 'established', '2026-05-01T00:00:00Z'),
            ('domain', 'proposed-noise', 'proposed', NULL),
            ('tag', 'memory', 'established', '2026-05-01T00:00:00Z'),
            ('tag', 'retrieval', 'established', '2026-05-01T00:00:00Z'),
            ('type', 'tutorial', 'established', '2026-05-01T00:00:00Z');
        `);
        const c = new AbortController();
        const result = await loadEstablishedVocabulary(db, c.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.domains.has('agent-systems')).toBe(true);
          expect(result.value.domains.has('distributed-systems')).toBe(true);
          // proposed-state must NOT appear in the established snapshot.
          expect(result.value.domains.has('proposed-noise')).toBe(false);
          expect(result.value.tags.has('memory')).toBe(true);
          expect(result.value.tags.has('retrieval')).toBe(true);
          expect(result.value.types.has('tutorial')).toBe(true);
        }
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('generates a fresh snapshot_id (UUID v4) per invocation', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { loadEstablishedVocabulary } = await import(
        '../../packages/inference/src/vocabulary.js'
      );
      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        const r1 = await loadEstablishedVocabulary(db, c.signal);
        const r2 = await loadEstablishedVocabulary(db, c.signal);
        expect(r1.ok && r2.ok).toBe(true);
        if (r1.ok && r2.ok) {
          expect(r1.value.snapshot_id).not.toBe(r2.value.snapshot_id);
          expect(r1.value.snapshot_id).toMatch(UUID_V4);
          expect(r2.value.snapshot_id).toMatch(UUID_V4);
        }
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('aborts before SQL access when signal is pre-aborted', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { loadEstablishedVocabulary } = await import(
        '../../packages/inference/src/vocabulary.js'
      );
      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        c.abort();
        let threw = false;
        try {
          await loadEstablishedVocabulary(db, c.signal);
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
