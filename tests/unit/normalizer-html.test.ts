// T030 (SP-003) — normalize-html (turndown frozen rules).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { normalizeHtml } from '../../packages/extract/src/normalize-html.js';

describe('normalizeHtml (T030)', () => {
  it('exports normalizeHtml', () => {
    expect(typeof normalizeHtml).toBe('function');
  });

  it('produces Markdown from HTML', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-html-'));
    const file = path.join(dir, 'page.html');
    await fsp.writeFile(file, '<h1>Title</h1><p>Body para.</p>');

    const result = await normalizeHtml(
      {
        pendingPath: file,
        docId: 'doc-12345678',
        sourcePath: '/inbox/page.html',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/html',
        hash: 'd'.repeat(64),
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // ATX heading style (frozen rule).
      expect(result.value.body).toContain('# Title');
      expect(result.value.body).toContain('Body para.');
    }
  });

  it('deterministic output across two runs on same input (frozen rule set)', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-html-'));
    const file = path.join(dir, 'page.html');
    await fsp.writeFile(
      file,
      '<h1>Header</h1><ul><li>one</li><li>two</li></ul><pre><code>code</code></pre>',
    );

    const input = {
      pendingPath: file,
      docId: 'doc-12345678',
      sourcePath: '/inbox/page.html',
      ingestTimestamp: '2026-05-12T00:00:00.000Z',
      mimeType: 'text/html' as const,
      hash: 'd'.repeat(64),
    };

    const a = await normalizeHtml(input, new AbortController().signal);
    const b = await normalizeHtml(input, new AbortController().signal);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.body).toBe(b.value.body);
    }
  });
});
