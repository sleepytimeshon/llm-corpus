// T040 — Unit test: tag counting via json_each (US2).
//
// References: FR-006, contracts/resource-taxonomy.md adapter pseudocode,
// Constitution VIII (no SQL injection — parameterized binding only).
//
// The taxonomy adapter counts docs containing a tag by scanning each
// document's `tags_json` array via SQLite's json1 `json_each()` extension.
// This test verifies the count behavior across edge cases.

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { countDocsWithTag } from '../../packages/storage/src/taxonomy-adapter.js';

describe('countDocsWithTag (T040 / FR-006 / Constitution VIII)', () => {
  it('counts 0 for tag absent across all docs', async () => {
    const handle = await loadFixture('tag-counting-empty-1', null);
    try {
      // No documents inserted → tag count must be 0.
      expect(countDocsWithTag(handle.db, 'never-seen')).toBe(0);
    } finally {
      handle.cleanup();
    }
  });

  it('counts a tag appearing in some-but-not-all docs', async () => {
    const handle = await loadFixture('tag-counting-mixed-1', null);
    try {
      // 3 docs: 2 with "rust", 1 without.
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES
        ('doc-aa000001', 'A', 'a.md', '/a', 'devops', '["rust","sqlite"]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-01T00:00:00Z', 'success'),
        ('doc-aa000002', 'B', 'b.md', '/b', 'devops', '["rust"]',           'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-02T00:00:00Z', 'success'),
        ('doc-aa000003', 'C', 'c.md', '/c', 'devops', '["sqlite"]',         'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-03T00:00:00Z', 'success')
      `);
      expect(countDocsWithTag(handle.db, 'rust')).toBe(2);
      expect(countDocsWithTag(handle.db, 'sqlite')).toBe(2);
    } finally {
      handle.cleanup();
    }
  });

  it('counts 0 for a doc with empty tags_json array', async () => {
    const handle = await loadFixture('tag-counting-empty-arr-1', null);
    try {
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-bb000001', 'NoTags', 'n.md', '/n', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-01T00:00:00Z', 'success')
      `);
      expect(countDocsWithTag(handle.db, 'rust')).toBe(0);
    } finally {
      handle.cleanup();
    }
  });

  it('handles tag with hyphen and special chars (parameterized binding)', async () => {
    const handle = await loadFixture('tag-counting-special-1', null);
    try {
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-cc000001', 'A', 'a.md', '/a', 'devops', '["rhel-9","ansible-2.12"]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-01T00:00:00Z', 'success')
      `);
      expect(countDocsWithTag(handle.db, 'rhel-9')).toBe(1);
      expect(countDocsWithTag(handle.db, 'ansible-2.12')).toBe(1);
    } finally {
      handle.cleanup();
    }
  });

  it('excludes failure-lane and trash docs', async () => {
    const handle = await loadFixture('tag-counting-status-1', null);
    try {
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES
        ('doc-dd000001', 'OK',     'a.md', '/a', 'devops', '["rust"]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-01T00:00:00Z', 'success'),
        ('doc-dd000002', 'Failed', 'b.md', '/b', 'devops', '["rust"]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-02T00:00:00Z', 'failed'),
        ('doc-dd000003', 'Trashed','c.md', '/c', 'devops', '["rust"]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-03T00:00:00Z', 'trashed')
      `);
      // Only the success row counts.
      expect(countDocsWithTag(handle.db, 'rust')).toBe(1);
    } finally {
      handle.cleanup();
    }
  });
});
