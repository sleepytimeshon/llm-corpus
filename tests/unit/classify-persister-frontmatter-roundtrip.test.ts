// T023 (SP-004 US1) — Frontmatter round-trip + body-byte-preservation.
//
// Verifies:
//   - After persistClassification, parseMarkdownWithFrontmatter(persisted) is
//     a valid object whose body section is BYTE-IDENTICAL to the pre-classify
//     body the SP-003 persister wrote.
//   - The classifier-frontmatter keys (facet_domain, facet_type, tags,
//     summary) ARE present in the post-classify frontmatter.
//   - The original SP-003 minimum-frontmatter keys (id, source_path,
//     ingest_timestamp, mime_type, hash, title) ARE preserved.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-008, R6
//   - Constitution Principle II, VIII

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'sp004-roundtrip-'),
  );
  process.env.CORPUS_HOME = root;
  await fsp.mkdir(path.join(root, 'data'), { recursive: true });
  await fsp.mkdir(path.join(root, 'state'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true });
  await fsp.mkdir(path.join(root, 'config'), { recursive: true });
  return root;
}

describe('US1 — persister frontmatter round-trip (FR-CLASSIFY-008 + R6)', () => {
  it('post-classify body section is byte-identical to SP-003 body', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite, insertDocument } = await import(
        '@llm-corpus/storage'
      );
      const { Paths, stringifyMarkdownWithFrontmatter, parseMarkdownWithFrontmatter } =
        await import('@llm-corpus/contracts');
      const docId = 'doc-99887766';
      const bodyRel = path.join('store', '99', `${docId}.md`);
      const sp003Body =
        '# A Document\n\nLine one of body.\nLine two.\n\n## Section\n\nMore body.\n';
      const db0 = openIndexReadWrite();
      try {
        insertDocument(db0, {
          id: docId,
          title: 't',
          body_path: bodyRel,
          source_path: '/inbox/foo.md',
          facet_domain: '',
          tags_json: '[]',
          facet_type: 'unclassified',
          source_type: 'inbox-filesystem',
          mime_type: 'text/markdown',
          hash: 'd'.repeat(64).replace(/.$/, '4'),
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
          frontmatter: {
            id: docId,
            source_path: '/inbox/foo.md',
            ingest_timestamp: '2026-05-13T10:00:00.000Z',
            mime_type: 'text/markdown',
            hash: 'd'.repeat(64).replace(/.$/, '4'),
            title: 'A Document',
          },
          body: sp003Body,
        }),
        'utf8',
      );

      const { persistClassification } = await import(
        '../../packages/storage/src/classify-persister.js'
      );
      const c = new AbortController();
      const db = openIndexReadWrite();
      try {
        const result = await persistClassification(
          {
            docId,
            classifierOutput: {
              facet_domain: 'agent-systems',
              facet_type: 'tutorial',
              tags: ['memory', 'retrieval', 'tutorial'],
              summary: 'short.',
              confidence: { domain: 0.9, type: 0.9, tags: 0.85 },
            },
            bodyPath: bodyRel,
            vocabulary: {
              domains: new Set(['agent-systems']),
              tags: new Set(['memory', 'retrieval', 'tutorial']),
              types: new Set(),
              snapshot_id: '11111111-1111-4111-8111-111111111111',
              loaded_at: '2026-05-13T10:00:00.000Z',
            },
            db,
          },
          c.signal,
        );
        expect(result.ok).toBe(true);
      } finally {
        db.close();
      }

      const persisted = await fsp.readFile(fullBody, 'utf8');
      const parsed = parseMarkdownWithFrontmatter(persisted);
      // Body section byte-identical (Principle II — no LLM-derived body).
      expect(parsed.body).toBe(sp003Body);
      // SP-003 minimum-frontmatter keys preserved.
      expect(parsed.frontmatter['id']).toBe(docId);
      expect(parsed.frontmatter['source_path']).toBe('/inbox/foo.md');
      expect(parsed.frontmatter['ingest_timestamp']).toBe(
        '2026-05-13T10:00:00.000Z',
      );
      expect(parsed.frontmatter['mime_type']).toBe('text/markdown');
      expect(parsed.frontmatter['hash']).toBe(
        'd'.repeat(64).replace(/.$/, '4'),
      );
      expect(parsed.frontmatter['title']).toBe('A Document');
      // SP-004 classifier-frontmatter keys added.
      expect(parsed.frontmatter['facet_domain']).toBe('agent-systems');
      expect(parsed.frontmatter['facet_type']).toBe('tutorial');
      expect(parsed.frontmatter['tags']).toEqual([
        'memory',
        'retrieval',
        'tutorial',
      ]);
      expect(parsed.frontmatter['summary']).toBe('short.');
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
