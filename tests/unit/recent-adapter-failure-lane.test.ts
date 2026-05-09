// T059 — Unit test: corpus://recent excludes failure-lane and trash docs.
//
// References: FR-007, US3 AS2, Constitution X (three-folder routing),
// contracts/resource-recent.md "Failure-lane exclusion".
//
// Failure-lane (status='failed') and trash (status='trashed') documents
// MUST NOT appear in `entries`. Verified against fixture rows of mixed
// statuses.

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { buildRecent } from '../../packages/storage/src/recent-adapter.js';

describe('buildRecent() failure-lane exclusion (T059 / US3 AS2 / Constitution X)', () => {
  it('excludes status=failed rows', async () => {
    const handle = await loadFixture(
      'recent-failure-1',
      'recent-mixed-failure',
    );
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      const ac = new AbortController();
      const result = await buildRecent(ac.signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 5 success + 5 failed → 5 entries (all 5 success).
      expect(result.value.entries.length).toBe(5);
      const ids = result.value.entries.map((e) => e.id);
      // None of the failure ids appear.
      for (const id of ids) {
        expect(id.startsWith('doc-aa')).toBe(true);
        expect(id.startsWith('doc-ff')).toBe(false);
      }
      // Order is descending by ingest_timestamp.
      const ts = result.value.entries.map((e) => e.ingest_timestamp);
      for (let i = 1; i < ts.length; i++) {
        expect(ts[i] < ts[i - 1]).toBe(true);
      }
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('excludes status=trashed rows', async () => {
    const handle = await loadFixture('recent-trashed-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES
        ('doc-aa000001', 'Live',    'a.md', '/a', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success'),
        ('doc-aa000002', 'Live2',   'b.md', '/b', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:25:00Z', 'success'),
        ('doc-7a570001', 'Trashed', 't.md', '/t', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T15:00:00Z', 'trashed')
      `);
      const ac = new AbortController();
      const result = await buildRecent(ac.signal);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.entries.length).toBe(2);
      for (const e of result.value.entries) {
        expect(e.id.startsWith('doc-aa')).toBe(true);
      }
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });
});
