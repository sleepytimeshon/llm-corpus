// T049-T052 (SP-004 US3) — Proposed-term routing + vocabulary-violation
// routing contract tests.
//
// T049: facet_domain_proposed → insertProposedTerm + classify.term_proposed.
// T050: facet_tags_proposed (each entry) → insertProposedTerm + telemetry.
// T051: domain not in vocab AND no facet_domain_proposed → vocab-violation.
// T052: tag not in vocab AND not in facet_tags_proposed → vocab-violation.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp004-us3-'));
  process.env.CORPUS_HOME = root;
  for (const sub of ['data', 'state', 'cache', 'config']) {
    await fsp.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

async function seedSentinel(docId: string): Promise<{ bodyRel: string }> {
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
      hash: docId.slice(4).padStart(64, '0'),
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
  return { bodyRel };
}

const vocab = (): {
  domains: ReadonlySet<string>;
  tags: ReadonlySet<string>;
} => ({
  domains: new Set(['agent-systems']),
  tags: new Set(['memory', 'retrieval', 'tutorial']),
});

describe('US3 — proposed-term routing + vocabulary-violation routing', () => {
  it('T049 — facet_domain_proposed routes to taxonomy_terms with state=proposed', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-49494949';
      const { bodyRel } = await seedSentinel(docId);
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { persistClassification } = await import(
        '@llm-corpus/storage'
      );

      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        const result = await persistClassification(
          {
            docId,
            classifierOutput: {
              facet_domain: 'agent-systems',
              facet_type: 'tutorial',
              tags: ['memory', 'retrieval', 'tutorial'],
              summary: 's',
              confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
              facet_domain_proposed: 'quantum-cryptography',
            },
            bodyPath: bodyRel,
            vocabulary: vocab(),
            db,
          },
          c.signal,
        );
        expect(result.ok).toBe(true);
        const row = db
          .prepare(
            `SELECT state FROM taxonomy_terms WHERE axis='domain' AND term='quantum-cryptography'`,
          )
          .get() as { state: string };
        expect(row.state).toBe('proposed');

        // Re-running with same proposed term: ON CONFLICT DO NOTHING.
        // Insert a second sentinel doc.
        const docId2 = 'doc-49494950';
        const { bodyRel: rel2 } = await seedSentinel(docId2);
        const result2 = await persistClassification(
          {
            docId: docId2,
            classifierOutput: {
              facet_domain: 'agent-systems',
              facet_type: 'tutorial',
              tags: ['memory', 'retrieval', 'tutorial'],
              summary: 's',
              confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
              facet_domain_proposed: 'quantum-cryptography',
            },
            bodyPath: rel2,
            vocabulary: vocab(),
            db,
          },
          c.signal,
        );
        expect(result2.ok).toBe(true);
        // Still exactly one row for the proposed term.
        const count = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM taxonomy_terms WHERE axis='domain' AND term='quantum-cryptography'`,
            )
            .get() as { n: number }
        ).n;
        expect(count).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T050 — facet_tags_proposed: each entry routes to taxonomy_terms with state=proposed', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-50505050';
      const { bodyRel } = await seedSentinel(docId);
      const { openIndexReadWrite, persistClassification } = await import(
        '@llm-corpus/storage'
      );
      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        const result = await persistClassification(
          {
            docId,
            classifierOutput: {
              facet_domain: 'agent-systems',
              facet_type: 'tutorial',
              tags: ['memory', 'novel-tag-a', 'novel-tag-b'],
              summary: 's',
              confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
              facet_tags_proposed: ['novel-tag-a', 'novel-tag-b'],
            },
            bodyPath: bodyRel,
            vocabulary: vocab(),
            db,
          },
          c.signal,
        );
        expect(result.ok).toBe(true);
        const rows = db
          .prepare(`SELECT term FROM taxonomy_terms WHERE axis='tag' AND state='proposed'`)
          .all() as Array<{ term: string }>;
        const terms = new Set(rows.map((r) => r.term));
        expect(terms.has('novel-tag-a')).toBe(true);
        expect(terms.has('novel-tag-b')).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('T051 — facet_domain not in vocab AND no proposed → VocabularyViolationError', async () => {
    const { validateClassifierOutput } = await import('@llm-corpus/inference');
    const { VocabularyViolationError } = await import('@llm-corpus/contracts');
    const v = {
      domains: new Set(['agent-systems']),
      tags: new Set(['memory', 'retrieval', 'tutorial']),
      types: new Set<string>(),
      snapshot_id: '11111111-1111-4111-8111-111111111111',
      loaded_at: '2026-05-13T10:00:00.000Z',
    };
    const bad = JSON.stringify({
      facet_domain: 'hallucinated-domain',
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'tutorial'],
      summary: 's',
      confidence: { domain: 0.5, type: 0.5, tags: 0.5 },
    });
    const r = validateClassifierOutput(bad, v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(VocabularyViolationError);
    }
  });

  it('T052 — tag not in vocab AND not in facet_tags_proposed → VocabularyViolationError', async () => {
    const { validateClassifierOutput } = await import('@llm-corpus/inference');
    const { VocabularyViolationError } = await import('@llm-corpus/contracts');
    const v = {
      domains: new Set(['agent-systems']),
      tags: new Set(['memory', 'retrieval', 'tutorial']),
      types: new Set<string>(),
      snapshot_id: '11111111-1111-4111-8111-111111111111',
      loaded_at: '2026-05-13T10:00:00.000Z',
    };
    const bad = JSON.stringify({
      facet_domain: 'agent-systems',
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'unknown-tag'],
      summary: 's',
      confidence: { domain: 0.5, type: 0.5, tags: 0.5 },
    });
    const r = validateClassifierOutput(bad, v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(VocabularyViolationError);
    }
  });
});
