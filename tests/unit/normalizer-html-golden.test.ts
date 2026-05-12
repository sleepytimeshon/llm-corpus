// T031 (SP-003) — golden test for turndown rule-set drift detection.

import { describe, it, expect } from 'vitest';
import { normalizeHtml } from '../../packages/extract/src/normalize-html.js';

const FIXTURE_PATH = 'tests/fixtures/sp003-ingest/valid-html.html';

describe('normalizeHtml golden output (T031)', () => {
  it('valid-html.html fixture produces deterministic, ATX-style Markdown', async () => {
    const result = await normalizeHtml(
      {
        pendingPath: FIXTURE_PATH,
        docId: 'doc-deadbeef',
        sourcePath: '/inbox/valid-html.html',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/html',
        hash: 'e'.repeat(64),
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Frozen-rule outputs: ATX `#`, fenced code blocks (```).
      expect(result.value.body).toContain('SP-003 HTML fixture');
      expect(result.value.body).toContain('# SP-003 HTML fixture');
      expect(result.value.body).toContain('## List rendering');
      expect(result.value.body).toContain('```');
    }
  });
});
