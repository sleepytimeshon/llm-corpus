// T041 (SP-003) — UNIQUE constraint defense-in-depth.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { persist } from '../../packages/pipeline/src/persister.js';
import { Paths } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('persist unique-hash defense (T041)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('duplicate-hash INSERT rejected by UNIQUE constraint + persist.failed telemetry', async () => {
    const pendingDir = Paths.pending();
    await fsp.mkdir(pendingDir, { recursive: true });
    const f1 = path.join(pendingDir, 'a.md');
    const f2 = path.join(pendingDir, 'b.md');
    await fsp.writeFile(f1, 'a\n');
    await fsp.writeFile(f2, 'b\n');

    const hash = '9'.repeat(64);
    const r1 = await persist(
      {
        docId: 'doc-aaaaaaaa',
        hash,
        mimeType: 'text/markdown',
        pendingPath: f1,
        sourcePath: '/inbox/a.md',
        normalizedDoc: { body: 'a\n', frontmatter: {} },
        originalFilename: 'a.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r1.ok).toBe(true);

    const r2 = await persist(
      {
        docId: 'doc-bbbbbbbb',
        hash,
        mimeType: 'text/markdown',
        pendingPath: f2,
        sourcePath: '/inbox/b.md',
        normalizedDoc: { body: 'b\n', frontmatter: {} },
        originalFilename: 'b.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
      },
      new AbortController().signal,
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.data.error_code).toBe('persist_failed');
    }

    // Verify persist.failed telemetry was emitted.
    const tel = fs.readFileSync(Paths.telemetry(), 'utf8');
    expect(tel).toContain('persist.failed');
  });
});
