// T009 — Unit test: Zod round-trip for the four MCP resource payload schemas.
//
// References: contracts/resource-{manifest,taxonomy,recent,document}.md,
// data-model.md "Operational entities", Constitution V (schema-enforced).
//
// Coverage:
//   - ManifestPayload: empty-state + populated-state both validate; type-mismatch fails
//   - TaxonomyPayload: 4-axis envelope, empty + populated, sort-order independent
//   - RecentPayload: entries array with strict shape; empty + populated
//   - DocumentPayload: uri + body + frontmatter, .passthrough() on frontmatter
//
// All schemas live in `packages/contracts/src/resource-schemas.ts` (created by T022).

import { describe, it, expect } from 'vitest';
import {
  ManifestPayload,
  TaxonomyTerm,
  TaxonomyPayload,
  RecentEntry,
  RecentPayload,
  DocumentFrontmatter,
  DocumentPayload,
} from '../../packages/contracts/src/resource-schemas.js';

const VALID_ISO = '2026-05-15T14:30:00.123Z';
const VALID_DOC_ID = 'doc-ab12cd34';
const VALID_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('ManifestPayload (Constitution V, contracts/resource-manifest.md)', () => {
  it('accepts the canonical empty-state shape', () => {
    const result = ManifestPayload.safeParse({
      doc_count: 0,
      established_domains: [],
      established_tags: [],
      last_ingest_timestamp: null,
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a populated shape', () => {
    const result = ManifestPayload.safeParse({
      doc_count: 247,
      established_domains: ['devops', 'linux', 'writing'],
      established_tags: ['ansible', 'rhel-9', 'systemd'],
      last_ingest_timestamp: '2026-05-15T14:30:00Z',
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative doc_count', () => {
    const result = ManifestPayload.safeParse({
      doc_count: -1,
      established_domains: [],
      established_tags: [],
      last_ingest_timestamp: null,
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer doc_count', () => {
    const result = ManifestPayload.safeParse({
      doc_count: 1.5,
      established_domains: [],
      established_tags: [],
      last_ingest_timestamp: null,
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad ISO-8601 last_ingest_timestamp', () => {
    const result = ManifestPayload.safeParse({
      doc_count: 1,
      established_domains: [],
      established_tags: [],
      last_ingest_timestamp: 'yesterday',
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('accepts null last_ingest_timestamp', () => {
    const result = ManifestPayload.safeParse({
      doc_count: 0,
      established_domains: [],
      established_tags: [],
      last_ingest_timestamp: null,
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-array established_domains', () => {
    const result = ManifestPayload.safeParse({
      doc_count: 0,
      established_domains: 'devops',
      established_tags: [],
      last_ingest_timestamp: null,
      schema_version: 'v1.0.0',
      taxonomy_version: 'v1.0.0',
    });
    expect(result.success).toBe(false);
  });
});

describe('TaxonomyPayload (4-axis envelope, contracts/resource-taxonomy.md)', () => {
  it('TaxonomyTerm requires non-negative integer document_count', () => {
    expect(TaxonomyTerm.safeParse({ term: 'devops', document_count: 0 }).success).toBe(true);
    expect(TaxonomyTerm.safeParse({ term: 'devops', document_count: -1 }).success).toBe(false);
    expect(TaxonomyTerm.safeParse({ term: 'devops', document_count: 1.5 }).success).toBe(false);
  });

  it('accepts the canonical empty-state shape', () => {
    const result = TaxonomyPayload.safeParse({
      domains: [],
      tags: [],
      types: [],
      source_types: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a populated 4-axis shape', () => {
    const result = TaxonomyPayload.safeParse({
      domains: [
        { term: 'devops', document_count: 87 },
        { term: 'linux', document_count: 64 },
      ],
      tags: [{ term: 'ansible', document_count: 45 }],
      types: [{ term: 'tutorial', document_count: 102 }],
      source_types: [{ term: 'article', document_count: 145 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects when an axis is missing', () => {
    const result = TaxonomyPayload.safeParse({
      domains: [],
      tags: [],
      types: [],
      // source_types missing
    });
    expect(result.success).toBe(false);
  });

  it('rejects when an axis is not an array', () => {
    const result = TaxonomyPayload.safeParse({
      domains: { term: 'devops', document_count: 1 },
      tags: [],
      types: [],
      source_types: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('RecentPayload (entries array, contracts/resource-recent.md)', () => {
  it('RecentEntry requires the full shape', () => {
    const result = RecentEntry.safeParse({
      id: VALID_DOC_ID,
      title: 'Hybrid Search',
      domain: 'devops',
      tags: ['sqlite', 'fts5'],
      ingest_timestamp: VALID_ISO,
    });
    expect(result.success).toBe(true);
  });

  it('RecentEntry rejects bad doc-id format', () => {
    const result = RecentEntry.safeParse({
      id: 'doc-XYZ',
      title: 't',
      domain: 'd',
      tags: [],
      ingest_timestamp: VALID_ISO,
    });
    expect(result.success).toBe(false);
  });

  it('accepts the canonical empty-state shape', () => {
    expect(RecentPayload.safeParse({ entries: [] }).success).toBe(true);
  });

  it('accepts a populated entries array', () => {
    const result = RecentPayload.safeParse({
      entries: [
        {
          id: VALID_DOC_ID,
          title: 'Doc 1',
          domain: 'devops',
          tags: ['a'],
          ingest_timestamp: VALID_ISO,
        },
        {
          id: 'doc-12345678',
          title: 'Doc 2',
          domain: 'linux',
          tags: [],
          ingest_timestamp: VALID_ISO,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('DocumentPayload (with .passthrough() frontmatter, contracts/resource-document.md)', () => {
  it('DocumentFrontmatter requires v1 minimum fields', () => {
    const result = DocumentFrontmatter.safeParse({
      id: VALID_DOC_ID,
      source_path: '/inbox/foo.md',
      ingest_timestamp: VALID_ISO,
      mime_type: 'text/markdown',
      hash: VALID_SHA256,
    });
    expect(result.success).toBe(true);
  });

  it('DocumentFrontmatter rejects missing required field', () => {
    const result = DocumentFrontmatter.safeParse({
      id: VALID_DOC_ID,
      source_path: '/inbox/foo.md',
      ingest_timestamp: VALID_ISO,
      mime_type: 'text/markdown',
      // hash missing
    });
    expect(result.success).toBe(false);
  });

  it('DocumentFrontmatter rejects bad SHA-256 hash', () => {
    const result = DocumentFrontmatter.safeParse({
      id: VALID_DOC_ID,
      source_path: '/inbox/foo.md',
      ingest_timestamp: VALID_ISO,
      mime_type: 'text/markdown',
      hash: 'not-a-sha256',
    });
    expect(result.success).toBe(false);
  });

  it('DocumentFrontmatter passes through unknown SP-004 fields (.passthrough)', () => {
    const result = DocumentFrontmatter.safeParse({
      id: VALID_DOC_ID,
      source_path: '/inbox/foo.md',
      ingest_timestamp: VALID_ISO,
      mime_type: 'text/markdown',
      hash: VALID_SHA256,
      // future SP-004 field — must NOT be stripped:
      title: 'My Doc',
      facet_domain: 'devops',
      tags: ['a', 'b'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { title?: string }).title).toBe('My Doc');
      expect((result.data as { facet_domain?: string }).facet_domain).toBe('devops');
    }
  });

  it('DocumentPayload requires uri + body + frontmatter', () => {
    const result = DocumentPayload.safeParse({
      uri: `corpus://docs/${VALID_DOC_ID}`,
      body: '# Hello\n',
      frontmatter: {
        id: VALID_DOC_ID,
        source_path: '/x.md',
        ingest_timestamp: VALID_ISO,
        mime_type: 'text/markdown',
        hash: VALID_SHA256,
      },
    });
    expect(result.success).toBe(true);
  });

  it('DocumentPayload rejects non-string body', () => {
    const result = DocumentPayload.safeParse({
      uri: `corpus://docs/${VALID_DOC_ID}`,
      body: 12345,
      frontmatter: {
        id: VALID_DOC_ID,
        source_path: '/x.md',
        ingest_timestamp: VALID_ISO,
        mime_type: 'text/markdown',
        hash: VALID_SHA256,
      },
    });
    expect(result.success).toBe(false);
  });
});
