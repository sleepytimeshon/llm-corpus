// T038 (SP-003) — persist (single-transaction commit).

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

describe('persist (T038)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports persist', () => {
    expect(typeof persist).toBe('function');
  });

  it('writes body file + INSERT row + renames pending→processed atomically', async () => {
    // Ensure pending dir + a pending file exist.
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const pendingFile = path.join(pendingDir, 'doc.md');
    await fsp.writeFile(pendingFile, '# body\n');

    // Initialize schema by opening DB once.
    const db0 = openIndexReadWrite();
    db0.close();

    const result = await persist(
      {
        docId: 'doc-12345678',
        hash: '1'.repeat(64),
        mimeType: 'text/markdown',
        pendingPath: pendingFile,
        sourcePath: '/inbox/doc.md',
        normalizedDoc: {
          body: '# body\n',
          frontmatter: { id: 'doc-12345678', hash: '1'.repeat(64) },
        },
        originalFilename: 'doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Body file exists.
      const absBody = path.join(Paths.docs(), result.value.bodyPath);
      expect(fs.existsSync(absBody)).toBe(true);
      // Pending file moved.
      expect(fs.existsSync(pendingFile)).toBe(false);
      // Processed file present.
      expect(fs.existsSync(result.value.processedPath)).toBe(true);
      // documents row inserted.
      const db = openIndexReadWrite();
      const row = db
        .prepare('SELECT id, hash, status FROM documents WHERE id = ?')
        .get('doc-12345678') as { id: string; hash: string; status: string } | undefined;
      db.close();
      expect(row).toBeDefined();
      expect(row?.status).toBe('success');
    }
  });

  it('rejects duplicate hash via UNIQUE constraint', async () => {
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    // First insert.
    const f1 = path.join(pendingDir, 'a.md');
    await fsp.writeFile(f1, '# a\n');
    const hash = '2'.repeat(64);
    const r1 = await persist(
      {
        docId: 'doc-22222222',
        hash,
        mimeType: 'text/markdown',
        pendingPath: f1,
        sourcePath: '/inbox/a.md',
        normalizedDoc: { body: '# a\n', frontmatter: { id: 'doc-22222222' } },
        originalFilename: 'a.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r1.ok).toBe(true);

    // Second insert with same hash but different doc_id.
    const f2 = path.join(pendingDir, 'b.md');
    await fsp.writeFile(f2, '# b\n');
    const r2 = await persist(
      {
        docId: 'doc-33333333',
        hash,
        mimeType: 'text/markdown',
        pendingPath: f2,
        sourcePath: '/inbox/b.md',
        normalizedDoc: { body: '# b\n', frontmatter: { id: 'doc-33333333' } },
        originalFilename: 'b.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.data.error_code).toBe('persist_failed');
    }
  });
});
