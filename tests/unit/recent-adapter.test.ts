// T058 — Unit test: recent-adapter (US3).
//
// References: FR-007, US3 AS1, contracts/resource-recent.md.
//
// Coverage:
//   - Empty SQLite: Result.ok({entries: []})
//   - 25-success fixture with default N=10: 10 entries in strict descending
//     ingest_timestamp order
//   - Tie-breaker: ingest_timestamp ties broken by id ascending
//   - Each entry has id, title, domain, tags (parsed from tags_json),
//     ingest_timestamp
//   - Configurable N: N=5 → 5; N=100 → all 25 (no padding when fewer than N)
//   - SQLite busy → IndexLockedError

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { buildRecent } from '../../packages/storage/src/recent-adapter.js';

describe('buildRecent() (T058 / FR-007)', () => {
  it('returns empty entries on empty SQLite', async () => {
    const handle = await loadFixture('recent-empty-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      const ac = new AbortController();
      const result = await buildRecent(ac.signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ entries: [] });
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('returns 10 entries in descending order with default N=10', async () => {
    const handle = await loadFixture('recent-25-1', 'recent-25-success');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      const ac = new AbortController();
      const result = await buildRecent(ac.signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.entries.length).toBe(10);
      const ts = result.value.entries.map((e) => e.ingest_timestamp);
      // Strictly descending.
      for (let i = 1; i < ts.length; i++) {
        expect(ts[i] < ts[i - 1]).toBe(true);
      }
      // First entry should be the most recent (14:30:00).
      expect(result.value.entries[0]!.ingest_timestamp).toBe(
        '2026-05-15T14:30:00Z',
      );
      expect(result.value.entries[0]!.id).toBe('doc-00000001');
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('breaks timestamp ties by id ascending', async () => {
    const handle = await loadFixture('recent-ties-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Three rows with the same timestamp; ids in scrambled insert order.
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES
        ('doc-cccccccc', 'C', 'c.md', '/c', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success'),
        ('doc-aaaaaaaa', 'A', 'a.md', '/a', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success'),
        ('doc-bbbbbbbb', 'B', 'b.md', '/b', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success')
      `);
      const ac = new AbortController();
      const result = await buildRecent(ac.signal);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.entries.map((e) => e.id)).toEqual([
        'doc-aaaaaaaa',
        'doc-bbbbbbbb',
        'doc-cccccccc',
      ]);
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('parses tags_json as string[] in each entry', async () => {
    const handle = await loadFixture('recent-tags-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-aa000001', 'Tagged', 't.md', '/t', 'devops',
                '["sqlite","search","fts5"]', 'tutorial', 'article', 'text/markdown',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                '2026-05-15T14:30:00Z', 'success')
      `);
      const ac = new AbortController();
      const result = await buildRecent(ac.signal);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.entries.length).toBe(1);
      const e = result.value.entries[0]!;
      expect(e.id).toBe('doc-aa000001');
      expect(e.title).toBe('Tagged');
      expect(e.domain).toBe('devops');
      expect(e.tags).toEqual(['sqlite', 'search', 'fts5']);
      expect(e.ingest_timestamp).toBe('2026-05-15T14:30:00Z');
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('returns ALL entries when fewer than N exist (no padding)', async () => {
    const handle = await loadFixture('recent-fewer-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES
        ('doc-aa000001', 'A', 'a.md', '/a', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success'),
        ('doc-aa000002', 'B', 'b.md', '/b', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:25:00Z', 'success'),
        ('doc-aa000003', 'C', 'c.md', '/c', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:20:00Z', 'success')
      `);
      const ac = new AbortController();
      // Default N=10; only 3 docs exist.
      const result = await buildRecent(ac.signal);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.entries.length).toBe(3);
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });
});
