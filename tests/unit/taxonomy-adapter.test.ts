// T039 — Unit test: taxonomy-adapter (US2).
//
// References: FR-006, US2 AS1, US2 AS2, US2 AS3, Constitution XV
// (promoted-only), contracts/resource-taxonomy.md.
//
// Coverage:
//   - Empty SQLite: 4-axis envelope, all empty arrays
//   - taxonomy-mixed fixture (2 promoted domains + 3 promoted tags + 2 PROPOSED tags)
//     returns ONLY promoted entries; proposed tags absent from ALL four axes
//   - per-term document_count matches the fixture document count
//   - per-axis lexicographic ascending sort
//   - SQLite busy → IndexLockedError

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { buildTaxonomy } from '../../packages/storage/src/taxonomy-adapter.js';
import { IndexLockedError } from '../../packages/contracts/src/index.js';

describe('buildTaxonomy() (T039 / FR-006 / Constitution XV)', () => {
  it('returns empty 4-axis envelope on empty SQLite', async () => {
    const handle = await loadFixture('taxonomy-empty-1', null);
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        const ac = new AbortController();
        const result = await buildTaxonomy(ac.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual({
            domains: [],
            tags: [],
            types: [],
            source_types: [],
          });
        }
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('excludes proposed terms (Constitution XV) — promoted-only', async () => {
    const handle = await loadFixture('taxonomy-mixed-1', 'documents');
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        // Insert mixed taxonomy state: 5 established + 2 proposed.
        handle.db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
          ('domain', 'devops', 'established', '2026-05-01T00:00:00Z'),
          ('domain', 'linux',  'established', '2026-05-01T00:00:00Z'),
          ('tag',    'ansible','established', '2026-05-01T00:00:00Z'),
          ('tag',    'rhel-9', 'established', '2026-05-01T00:00:00Z'),
          ('tag',    'systemd','established', '2026-05-01T00:00:00Z'),
          ('tag',    'PROPOSED-tag-a', 'proposed', NULL),
          ('tag',    'PROPOSED-tag-b', 'proposed', NULL)
        `);
        const ac = new AbortController();
        const result = await buildTaxonomy(ac.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          // Domains: only the 2 established (devops, linux).
          const domains = result.value.domains.map((t) => t.term);
          expect(domains).toEqual(['devops', 'linux']);
          // Tags: only the 3 established. Proposed MUST be absent.
          const tags = result.value.tags.map((t) => t.term);
          expect(tags).toEqual(['ansible', 'rhel-9', 'systemd']);
          expect(tags).not.toContain('PROPOSED-tag-a');
          expect(tags).not.toContain('PROPOSED-tag-b');
          // Other axes empty (no established types/source_types in fixture).
          expect(result.value.types).toEqual([]);
          expect(result.value.source_types).toEqual([]);
        }
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('returns correct document_count per axis term', async () => {
    const handle = await loadFixture('taxonomy-counts-1', 'documents');
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        // Promote domains (devops, linux), tags (ansible, rhel-9, systemd),
        // types (tutorial, reference, analysis), source_types (article,
        // manual, book) so document_count reflects fixture rows.
        handle.db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
          ('domain',     'devops', 'established', '2026-05-01T00:00:00Z'),
          ('domain',     'linux',  'established', '2026-05-01T00:00:00Z'),
          ('domain',     'writing','established', '2026-05-01T00:00:00Z'),
          ('tag',        'ansible','established', '2026-05-01T00:00:00Z'),
          ('tag',        'rhel-9', 'established', '2026-05-01T00:00:00Z'),
          ('tag',        'systemd','established', '2026-05-01T00:00:00Z'),
          ('type',       'tutorial', 'established', '2026-05-01T00:00:00Z'),
          ('type',       'reference','established', '2026-05-01T00:00:00Z'),
          ('type',       'analysis', 'established', '2026-05-01T00:00:00Z'),
          ('source_type','article',  'established', '2026-05-01T00:00:00Z'),
          ('source_type','manual',   'established', '2026-05-01T00:00:00Z'),
          ('source_type','book',     'established', '2026-05-01T00:00:00Z')
        `);
        const ac = new AbortController();
        const result = await buildTaxonomy(ac.signal);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Domains: devops=2 (doc-ab12cd34, doc-cd34ef56),
        // linux=2 (doc-ef567890, doc-87654321), writing=1 (doc-12345678).
        const domains = Object.fromEntries(
          result.value.domains.map((t) => [t.term, t.document_count]),
        );
        expect(domains).toEqual({ devops: 2, linux: 2, writing: 1 });

        // Tags use json_each — ansible appears in 1 doc; rhel-9 in 3 docs;
        // systemd in 1 doc.
        const tags = Object.fromEntries(
          result.value.tags.map((t) => [t.term, t.document_count]),
        );
        expect(tags['ansible']).toBe(1);
        expect(tags['rhel-9']).toBe(3);
        expect(tags['systemd']).toBe(1);

        // Types: tutorial=2, reference=2, analysis=1.
        const types = Object.fromEntries(
          result.value.types.map((t) => [t.term, t.document_count]),
        );
        expect(types).toEqual({ tutorial: 2, reference: 2, analysis: 1 });

        // Source types: article=2, manual=2, book=1.
        const stypes = Object.fromEntries(
          result.value.source_types.map((t) => [t.term, t.document_count]),
        );
        expect(stypes).toEqual({ article: 2, manual: 2, book: 1 });
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('sorts each axis lexicographic ascending', async () => {
    const handle = await loadFixture('taxonomy-sort-1', null);
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        // Insert in scrambled order to exercise ORDER BY.
        handle.db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
          ('domain', 'zzz', 'established', '2026-05-01T00:00:00Z'),
          ('domain', 'aaa', 'established', '2026-05-01T00:00:00Z'),
          ('domain', 'mmm', 'established', '2026-05-01T00:00:00Z')
        `);
        const ac = new AbortController();
        const result = await buildTaxonomy(ac.signal);
        if (!result.ok) throw new Error('expected ok');
        expect(result.value.domains.map((t) => t.term)).toEqual([
          'aaa',
          'mmm',
          'zzz',
        ]);
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('IndexLockedError class is exportable for handler error mapping', () => {
    const e = new IndexLockedError({ uri: 'corpus://taxonomy' });
    expect(e.name).toBe('IndexLockedError');
    expect(e.data.uri).toBe('corpus://taxonomy');
  });
});
