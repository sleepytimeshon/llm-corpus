// T029 (SP-003) — normalize-text.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { normalizeText } from '../../packages/extract/src/normalize-text.js';

describe('normalizeText (T029)', () => {
  it('exports normalizeText', () => {
    expect(typeof normalizeText).toBe('function');
  });

  it('wraps plain text in minimal Markdown with FR-008 frontmatter', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-txt-'));
    const file = path.join(dir, 'doc.txt');
    const text = 'Hello world.\nLine two.\n';
    await fsp.writeFile(file, text);

    const result = await normalizeText(
      {
        pendingPath: file,
        docId: 'doc-12345678',
        sourcePath: '/inbox/doc.txt',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/plain',
        hash: 'c'.repeat(64),
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Body is byte-identical to the source.
      expect(result.value.body).toBe(text);
      expect(result.value.frontmatter['id']).toBe('doc-12345678');
    }
  });
});
