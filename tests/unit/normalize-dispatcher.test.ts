// T034 (SP-003) — normalize dispatcher.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { normalize } from '../../packages/extract/src/normalize.js';

describe('normalize dispatcher (T034)', () => {
  it('exports normalize', () => {
    expect(typeof normalize).toBe('function');
  });

  it('dispatches text/markdown to the markdown normalizer', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-dis-'));
    const file = path.join(dir, 'doc.md');
    await fsp.writeFile(file, '# md\n');
    const r = await normalize(
      {
        pendingPath: file,
        docId: 'doc-aaaaaaaa',
        sourcePath: file,
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/markdown',
        hash: '1'.repeat(64),
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body).toContain('# md');
  });

  it('dispatches text/plain to the text normalizer', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-dis-'));
    const file = path.join(dir, 'doc.txt');
    await fsp.writeFile(file, 'plain text');
    const r = await normalize(
      {
        pendingPath: file,
        docId: 'doc-aaaaaaaa',
        sourcePath: file,
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/plain',
        hash: '1'.repeat(64),
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body).toBe('plain text');
  });

  it('dispatches text/html to the html normalizer', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-dis-'));
    const file = path.join(dir, 'doc.html');
    await fsp.writeFile(file, '<h1>X</h1>');
    const r = await normalize(
      {
        pendingPath: file,
        docId: 'doc-aaaaaaaa',
        sourcePath: file,
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/html',
        hash: '1'.repeat(64),
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body).toContain('# X');
  });
});
