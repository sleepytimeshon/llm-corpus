// T021 (SP-004 US1) — Classify-persister contract test.
//
// Verifies persistClassification:
//   - Opens write-side SQLite connection.
//   - UPDATE documents SET facet_domain=?, tags_json=?, facet_type=?
//     WHERE id=? AND facet_type='unclassified'.
//   - INSERTs 0..N proposed terms via insertProposedTerm.
//   - Writes the rewritten body file via withTempDir + atomic rename.
//   - Commits SQL + body-rename as a single atomic transaction.
//   - UPDATE matching 0 rows (already classified or never sentinel) → rollback
//     + Result.err(ClassifyPersistError) + tmp file removed.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-008, FR-CLASSIFY-012
//   - Constitution Principle VIII (Atomic Writes)
//   - Constitution Principle X (Idempotent Pipeline Transitions)
//
// TDD: this test MUST FAIL before T036 (the implementation) lands.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

const VALID_OUTPUT = {
  facet_domain: 'agent-systems',
  facet_type: 'tutorial',
  tags: ['memory', 'retrieval', 'tutorial'],
  summary: 'a short summary of the doc.',
  confidence: { domain: 0.9, type: 0.9, tags: 0.85 },
} as const;

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'sp004-persister-'),
  );
  process.env.CORPUS_HOME = root;
  await fsp.mkdir(path.join(root, 'data'), { recursive: true });
  await fsp.mkdir(path.join(root, 'state'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true });
  await fsp.mkdir(path.join(root, 'config'), { recursive: true });
  return root;
}

async function seedSentinelDoc(
  docId: string,
  bodyRelPath: string,
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
      title: 'seed-title',
      body_path: bodyRelPath,
      source_path: '/inbox/seed.md',
      facet_domain: '',
      tags_json: '[]',
      facet_type: 'unclassified',
      source_type: 'inbox-filesystem',
      mime_type: 'text/markdown',
      hash: 'a'.repeat(64).replace(/.$/, '1'),
      ingest_timestamp: '2026-05-13T10:00:00.000Z',
      status: 'success',
    });
  } finally {
    db.close();
  }
  // Write the seeded body file.
  const fullBody = path.join(Paths.docs(), bodyRelPath);
  await fsp.mkdir(path.dirname(fullBody), { recursive: true });
  const content = stringifyMarkdownWithFrontmatter({
    frontmatter: {
      id: docId,
      source_path: '/inbox/seed.md',
      ingest_timestamp: '2026-05-13T10:00:00.000Z',
      mime_type: 'text/markdown',
      hash: 'a'.repeat(64).replace(/.$/, '1'),
      title: 'seed-title',
    },
    body: bodyText,
  });
  await fsp.writeFile(fullBody, content, 'utf8');
}

const vocab = (): {
  domains: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  types: ReadonlySet<string>;
  snapshot_id: string;
  loaded_at: string;
} => ({
  domains: new Set(['agent-systems']),
  tags: new Set(['memory', 'retrieval', 'tutorial']),
  types: new Set(),
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  loaded_at: '2026-05-13T10:00:00.000Z',
});

describe('US1 — classify-persister (contract)', () => {
  it('persistClassification is exported from packages/storage', async () => {
    const mod = (await import(
      '../../packages/storage/src/classify-persister.js'
    )) as Record<string, unknown>;
    expect(typeof mod.persistClassification).toBe('function');
  });

  it('UPDATEs SQL columns AND mirrors frontmatter atomically', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-11223344';
      const bodyRel = path.join('store', '11', `${docId}.md`);
      await seedSentinelDoc(docId, bodyRel, '# Seed body content.\n');

      const { persistClassification } = await import(
        '../../packages/storage/src/classify-persister.js'
      );
      const { openIndexReadWrite } = await import('@llm-corpus/storage');
      const { Paths, parseMarkdownWithFrontmatter } = await import(
        '@llm-corpus/contracts'
      );

      const controller = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await persistClassification(
          {
            docId,
            classifierOutput: VALID_OUTPUT,
            bodyPath: bodyRel,
            vocabulary: vocab(),
            db,
          },
          controller.signal,
        );
        expect(result.ok).toBe(true);

        const row = db
          .prepare(
            `SELECT facet_domain, tags_json, facet_type FROM documents WHERE id=?`,
          )
          .get(docId) as {
          facet_domain: string;
          tags_json: string;
          facet_type: string;
        };
        expect(row.facet_domain).toBe('agent-systems');
        expect(row.facet_type).toBe('tutorial');
        expect(JSON.parse(row.tags_json)).toEqual([
          'memory',
          'retrieval',
          'tutorial',
        ]);
      } finally {
        db.close();
      }

      const fullBody = path.join(Paths.docs(), bodyRel);
      const text = await fsp.readFile(fullBody, 'utf8');
      const { frontmatter, body } = parseMarkdownWithFrontmatter(text);
      expect(frontmatter['facet_domain']).toBe('agent-systems');
      expect(frontmatter['facet_type']).toBe('tutorial');
      expect(frontmatter['tags']).toEqual([
        'memory',
        'retrieval',
        'tutorial',
      ]);
      expect(body).toContain('Seed body content');
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('UPDATE matching 0 rows (row already classified) → Result.err + sentinel preserved', async () => {
    const root = await makeIsolatedCorpus();
    try {
      // Seed an ALREADY-classified doc (facet_type != 'unclassified').
      const { openIndexReadWrite, insertDocument } = await import(
        '@llm-corpus/storage'
      );
      const { Paths, stringifyMarkdownWithFrontmatter } = await import(
        '@llm-corpus/contracts'
      );
      const docId = 'doc-55667788';
      const bodyRel = path.join('store', '55', `${docId}.md`);
      const db0 = openIndexReadWrite();
      try {
        insertDocument(db0, {
          id: docId,
          title: 't',
          body_path: bodyRel,
          source_path: '/p',
          facet_domain: 'already-classified',
          tags_json: '["a","b","c"]',
          facet_type: 'concept',
          source_type: 'inbox-filesystem',
          mime_type: 'text/markdown',
          hash: 'b'.repeat(64).replace(/.$/, '2'),
          ingest_timestamp: '2026-05-13T10:00:00.000Z',
          status: 'success',
        });
      } finally {
        db0.close();
      }
      const fullBody = path.join(Paths.docs(), bodyRel);
      await fsp.mkdir(path.dirname(fullBody), { recursive: true });
      await fsp.writeFile(
        fullBody,
        stringifyMarkdownWithFrontmatter({
          frontmatter: { id: docId, title: 't' },
          body: 'body',
        }),
        'utf8',
      );

      const { persistClassification } = await import(
        '../../packages/storage/src/classify-persister.js'
      );
      const { ClassifyPersistError } = await import('@llm-corpus/contracts');
      const controller = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await persistClassification(
          {
            docId,
            classifierOutput: VALID_OUTPUT,
            bodyPath: bodyRel,
            vocabulary: vocab(),
            db,
          },
          controller.signal,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeInstanceOf(ClassifyPersistError);
        }
        const row = db
          .prepare(`SELECT facet_type FROM documents WHERE id=?`)
          .get(docId) as { facet_type: string };
        // Row stays at its pre-existing state — no overwrite.
        expect(row.facet_type).toBe('concept');
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('proposed-term routing INSERTs into taxonomy_terms with state=proposed', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const docId = 'doc-aabbccdd';
      const bodyRel = path.join('store', 'aa', `${docId}.md`);
      await seedSentinelDoc(docId, bodyRel, 'body content.\n');

      const { persistClassification } = await import(
        '../../packages/storage/src/classify-persister.js'
      );
      const { openIndexReadWrite } = await import('@llm-corpus/storage');

      const proposedOutput = {
        ...VALID_OUTPUT,
        facet_domain_proposed: 'quantum-cryptography',
        facet_tags_proposed: ['novel-tag-x'],
      };

      const controller = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await persistClassification(
          {
            docId,
            classifierOutput: proposedOutput,
            bodyPath: bodyRel,
            vocabulary: vocab(),
            db,
          },
          controller.signal,
        );
        expect(result.ok).toBe(true);
        const dom = db
          .prepare(
            `SELECT state FROM taxonomy_terms WHERE axis='domain' AND term=?`,
          )
          .get('quantum-cryptography') as { state: string } | undefined;
        expect(dom?.state).toBe('proposed');
        const tag = db
          .prepare(
            `SELECT state FROM taxonomy_terms WHERE axis='tag' AND term=?`,
          )
          .get('novel-tag-x') as { state: string } | undefined;
        expect(tag?.state).toBe('proposed');
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
