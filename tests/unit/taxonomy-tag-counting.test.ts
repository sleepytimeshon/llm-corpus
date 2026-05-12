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
         '02ccd9ef3784768cb60963a40e4a45f499bea1abf4925a656f02b734e8d67096', '2026-05-01T00:00:00Z', 'success'),
        ('doc-aa000002', 'B', 'b.md', '/b', 'devops', '["rust"]',           'tutorial', 'article', 'text/markdown',
         '9996229af2dd45c1fb7cd416fb1b4d0bb5c572d0aeb0e56592380019e1f23f3c', '2026-05-02T00:00:00Z', 'success'),
        ('doc-aa000003', 'C', 'c.md', '/c', 'devops', '["sqlite"]',         'tutorial', 'article', 'text/markdown',
         '81a8430cd69d665f89c8eebdbd668ebc933713f7a98984747bf49ec361501d29', '2026-05-03T00:00:00Z', 'success')
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
         'e035d67f37b83ff3305e5ebf6b23230828cc42fd43bdb083c123b39bc127af38', '2026-05-01T00:00:00Z', 'success')
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
         '69e2356d35ce2fc0997c0bafea027a51b95f23d95e9a31c1786ea01da67b1850', '2026-05-01T00:00:00Z', 'success')
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
         '61e90a27f719432b48c2814c04c6b0b430b8a8ba54b057cdf9c339fb5c374e86', '2026-05-01T00:00:00Z', 'success'),
        ('doc-dd000002', 'Failed', 'b.md', '/b', 'devops', '["rust"]', 'tutorial', 'article', 'text/markdown',
         '91b1d15123691d3dc5820075e80fc372d61eba8e0eb891f7b84ee63e71e888ca', '2026-05-02T00:00:00Z', 'failed'),
        ('doc-dd000003', 'Trashed','c.md', '/c', 'devops', '["rust"]', 'tutorial', 'article', 'text/markdown',
         '244d7bff230337dc09279b65e8b61628b3e14ebd8647d2d599aab1f8cb5a85d0', '2026-05-03T00:00:00Z', 'trashed')
      `);
      // Only the success row counts.
      expect(countDocsWithTag(handle.db, 'rust')).toBe(1);
    } finally {
      handle.cleanup();
    }
  });
});
