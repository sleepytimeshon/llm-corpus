// T033 (SP-003) — PDF subprocess timeout via AbortSignal.

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

describe('normalizePdf timeout (T033)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('aborted subprocess returns extract_failed', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-pdf-'));
    const file = path.join(dir, 'doc.pdf');
    fs.writeFileSync(file, Buffer.from('%PDF-1.4 stub'));
    const controller = new AbortController();
    // Abort almost immediately so subprocess is killed.
    setImmediate(() => controller.abort());
    const result = await normalizePdf(
      {
        pendingPath: file,
        docId: 'doc-12345678',
        sourcePath: file,
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'application/pdf',
        hash: '0'.repeat(64),
      },
      controller.signal,
      { timeoutMs: 30_000 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('extract_failed');
    }
  }, 60_000);
});
