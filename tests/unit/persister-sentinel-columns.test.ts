// T039 (SP-003) — sentinel column values + CHECK constraints.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { persist } from '../../packages/pipeline/src/persister.js';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('persist sentinel columns (T039)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('row has facet_domain="", tags_json="[]", facet_type="unclassified", source_type="inbox-filesystem"', async () => {
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const f = path.join(pendingDir, 'doc.md');
    await fsp.writeFile(f, 'body\n');

    const r = await persist(
      {
        docId: 'doc-44444444',
        hash: '4'.repeat(64),
        mimeType: 'text/markdown',
        pendingPath: f,
        sourcePath: '/inbox/doc.md',
        normalizedDoc: { body: 'body\n', frontmatter: { id: 'doc-44444444' } },
        originalFilename: 'doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);

    const db = openIndexReadWrite();
    const row = db
      .prepare(
        'SELECT facet_domain, tags_json, facet_type, source_type FROM documents WHERE id = ?',
      )
      .get('doc-44444444') as
      | { facet_domain: string; tags_json: string; facet_type: string; source_type: string }
      | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row?.facet_domain).toBe('');
    expect(row?.tags_json).toBe('[]');
    expect(row?.facet_type).toBe('unclassified');
    expect(row?.source_type).toBe('inbox-filesystem');
  });

  it('row passes CHECK (id GLOB doc-[0-9a-f]{8})', async () => {
    // Negative case: doc_id with non-hex chars should fail.
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const f = path.join(pendingDir, 'doc.md');
    await fsp.writeFile(f, 'body\n');

    const r = await persist(
      {
        docId: 'doc-zzzzzzzz',
        hash: '5'.repeat(64),
        mimeType: 'text/markdown',
        pendingPath: f,
        sourcePath: '/inbox/doc.md',
        normalizedDoc: { body: 'body\n', frontmatter: {} },
        originalFilename: 'doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.data.error_code).toBe('persist_failed');
    }
  });
});
