// T022 (SP-004 US1) — Confidence MUST NOT appear in persisted frontmatter.
//
// Verifies that after persistClassification succeeds, the body file's
// parsed YAML frontmatter has NO `confidence`, `origin`, `provenance_*`,
// `captured_at`, or `corpus capture` keys (Principle II forbidden-list).
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-013, SC-CLASSIFY-002
//   - Constitution Principle II (User Curates, LLM Classifies Metadata)

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';

const OUTPUT_WITH_CONFIDENCE = {
  facet_domain: 'agent-systems',
  facet_type: 'tutorial',
  tags: ['memory', 'retrieval', 'tutorial'],
  summary: 'a summary.',
  confidence: { domain: 0.95, type: 0.9, tags: 0.85 },
} as const;

async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'sp004-no-conf-'),
  );
  process.env.CORPUS_HOME = root;
  await fsp.mkdir(path.join(root, 'data'), { recursive: true });
  await fsp.mkdir(path.join(root, 'state'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true });
  await fsp.mkdir(path.join(root, 'config'), { recursive: true });
  return root;
}

describe('US1 — classify-persister NEVER writes confidence to frontmatter (FR-CLASSIFY-013)', () => {
  it('parsed frontmatter has no confidence + no forbidden-list keys', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite, insertDocument } = await import(
        '@llm-corpus/storage'
      );
      const { Paths, stringifyMarkdownWithFrontmatter, parseMarkdownWithFrontmatter } =
        await import('@llm-corpus/contracts');
      const docId = 'doc-cdef0123';
      const bodyRel = path.join('store', 'cd', `${docId}.md`);
      const db0 = openIndexReadWrite();
      try {
        insertDocument(db0, {
          id: docId,
          title: 't',
          body_path: bodyRel,
          source_path: '/p',
          facet_domain: '',
          tags_json: '[]',
          facet_type: 'unclassified',
          source_type: 'inbox-filesystem',
          mime_type: 'text/markdown',
          hash: 'c'.repeat(64).replace(/.$/, '3'),
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
          frontmatter: { id: docId, title: 't', hash: 'c'.repeat(64).replace(/.$/, '3') },
          body: 'body content.\n',
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
            classifierOutput: OUTPUT_WITH_CONFIDENCE,
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

      const text = await fsp.readFile(fullBody, 'utf8');
      const { frontmatter } = parseMarkdownWithFrontmatter(text);

      const forbidden = [
        'confidence',
        'origin',
        'provenance',
        'provenance_kind',
        'provenance_uri',
        'captured_at',
        'corpus capture',
        'facet_domain_proposed',
        'facet_tags_proposed',
      ];
      for (const k of forbidden) {
        expect(
          frontmatter[k],
          `frontmatter should NOT contain forbidden key "${k}"`,
        ).toBeUndefined();
      }
      // grep over the raw file content for `confidence:` — must not appear
      // anywhere inside the body either (defense-in-depth SC-CLASSIFY-002).
      expect(text).not.toContain('confidence:');
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
