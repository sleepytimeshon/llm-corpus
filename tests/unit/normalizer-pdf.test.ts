// T032 (SP-003) — normalize-pdf (subprocess invocation).

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { normalizePdf } from '../../packages/extract/src/normalize-pdf.js';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('normalizePdf (T032)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports normalizePdf', () => {
    expect(typeof normalizePdf).toBe('function');
  });

  it('returns NormalizeError when input is not a valid PDF', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-pdf-'));
    const file = path.join(dir, 'fake.pdf');
    fs.writeFileSync(file, 'not a pdf');
    const result = await normalizePdf(
      {
        pendingPath: file,
        docId: 'doc-12345678',
        sourcePath: file,
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'application/pdf',
        hash: 'f'.repeat(64),
      },
      new AbortController().signal,
      { timeoutMs: 30_000 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('extract_failed');
    }
  }, 60_000);
});
