// T040 (SP-003) — body file layout under Paths.docsStore().

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { persist } from '../../packages/pipeline/src/persister.js';
import { Paths } from '@llm-corpus/contracts';
import { fetchDocument } from '@llm-corpus/storage';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('persist body layout (T040)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('body file path = Paths.docsStore() + /<id-prefix>/<doc-id>.md', async () => {
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const f = path.join(pendingDir, 'doc.md');
    await fsp.writeFile(f, 'body\n');

    const docId = 'doc-abcdef12';
    const r = await persist(
      {
        docId,
        hash: '6'.repeat(64),
        mimeType: 'text/markdown',
        pendingPath: f,
        sourcePath: '/inbox/doc.md',
        normalizedDoc: { body: 'body\n', frontmatter: { id: docId } },
        originalFilename: 'doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);

    // Decision I: id-prefix = doc_id.slice(4, 6) — first 2 hex of hex tail.
    const expected = path.join(Paths.docsStore(), 'ab', `${docId}.md`);
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('documents.body_path stores relative path store/<id-prefix>/<doc-id>.md', async () => {
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const f = path.join(pendingDir, 'doc.md');
    await fsp.writeFile(f, 'body\n');

    const docId = 'doc-deadbeef';
    const r = await persist(
      {
        docId,
        hash: '7'.repeat(64),
        mimeType: 'text/markdown',
        pendingPath: f,
        sourcePath: '/inbox/doc.md',
        normalizedDoc: { body: 'body\n', frontmatter: { id: docId } },
        originalFilename: 'doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bodyPath).toBe(path.join('store', 'de', `${docId}.md`));
    }
  });

  it('SP-002 fetchDocument can dereference the row body_path', async () => {
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const f = path.join(pendingDir, 'doc.md');
    await fsp.writeFile(f, 'body verbatim\n');

    const docId = 'doc-ffffffff';
    const r = await persist(
      {
        docId,
        hash: '8'.repeat(64),
        mimeType: 'text/markdown',
        pendingPath: f,
        sourcePath: '/inbox/doc.md',
        normalizedDoc: { body: 'body verbatim\n', frontmatter: { id: docId } },
        originalFilename: 'doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);

    const fetched = await fetchDocument(docId, new AbortController().signal);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.value.body).toContain('body verbatim');
    }
  });
});
