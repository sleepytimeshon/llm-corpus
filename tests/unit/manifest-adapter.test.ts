// T032 — Unit test: manifest-adapter (US1).
//
// References: FR-005, US1 AS3, data-model.md "Validation rules",
// contracts/resource-manifest.md.
//
// Coverage:
//   - Empty SQLite: doc_count=0, all lists empty, last_ingest_timestamp=null
//   - Populated SQLite: doc_count, lex-sorted established_domains/tags,
//     MAX(ingest_timestamp), schema/taxonomy versions
//   - Empty-state invariant (doc_count==0 ⇒ all lists empty + null timestamp)
//   - signal.throwIfAborted() propagates
//   - SQLite busy → Result.err(IndexLockedError)

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { buildManifest } from '../../packages/storage/src/manifest-adapter.js';
import {
  IndexLockedError,
  SCHEMA_VERSION,
  TAXONOMY_VERSION,
} from '../../packages/contracts/src/index.js';

describe('buildManifest() (T032 / FR-005)', () => {
  it('returns canonical empty-state manifest on empty SQLite', async () => {
    const handle = await loadFixture('manifest-empty-1', null);
    try {
      // Point production-style adapter at this per-test DB by overriding
      // CORPUS_HOME briefly. The fixture loader created the schema-migrated
      // DB inside its own subdirectory; we mirror its location into a
      // CORPUS_HOME so Paths.indexDb() resolves to that file.
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        const ac = new AbortController();
        const result = await buildManifest(ac.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual({
            doc_count: 0,
            established_domains: [],
            established_tags: [],
            last_ingest_timestamp: null,
            schema_version: SCHEMA_VERSION,
            taxonomy_version: TAXONOMY_VERSION,
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

  it('returns populated manifest with sorted-ascending domains and tags', async () => {
    const handle = await loadFixture('manifest-populated-1', 'documents');
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        // Add 2 promoted domains + 3 promoted tags into the same DB.
        // Insertion order is deliberately scrambled so we exercise sort.
        handle.db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
          ('domain', 'linux',  'established', '2026-05-01T00:00:00Z'),
          ('domain', 'devops', 'established', '2026-05-01T00:00:00Z'),
          ('tag',    'systemd','established', '2026-05-01T00:00:00Z'),
          ('tag',    'ansible','established', '2026-05-01T00:00:00Z'),
          ('tag',    'rhel-9', 'established', '2026-05-01T00:00:00Z')
        `);
        const ac = new AbortController();
        const result = await buildManifest(ac.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          // documents.sql ships 5 success rows.
          expect(result.value.doc_count).toBe(5);
          expect(result.value.established_domains).toEqual(['devops', 'linux']);
          expect(result.value.established_tags).toEqual([
            'ansible',
            'rhel-9',
            'systemd',
          ]);
          // MAX(ingest_timestamp) across the 5 documents = 14:30:00.
          expect(result.value.last_ingest_timestamp).toBe(
            '2026-05-15T14:30:00Z',
          );
          expect(result.value.schema_version).toBe(SCHEMA_VERSION);
          expect(result.value.taxonomy_version).toBe(TAXONOMY_VERSION);
        }
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('honors the empty-state invariant', async () => {
    // Even if proposed terms exist, a doc_count==0 corpus has no
    // ESTABLISHED domains/tags (Constitution XV) — the established lists
    // remain empty, the timestamp remains null.
    const handle = await loadFixture('manifest-invariant-1', null);
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        // Add ONLY proposed terms — should NOT promote into established_*.
        handle.db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
          ('domain', 'proposed-only',  'proposed', NULL),
          ('tag',    'also-proposed', 'proposed', NULL)
        `);
        const ac = new AbortController();
        const result = await buildManifest(ac.signal);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.doc_count).toBe(0);
          expect(result.value.established_domains).toEqual([]);
          expect(result.value.established_tags).toEqual([]);
          expect(result.value.last_ingest_timestamp).toBeNull();
        }
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('throws when signal is aborted before invocation', async () => {
    const handle = await loadFixture('manifest-abort-1', null);
    try {
      const prevHome = process.env.CORPUS_HOME;
      process.env.CORPUS_HOME = handle.rootDir;
      try {
        const ac = new AbortController();
        ac.abort();
        await expect(buildManifest(ac.signal)).rejects.toThrow();
      } finally {
        if (prevHome === undefined) delete process.env.CORPUS_HOME;
        else process.env.CORPUS_HOME = prevHome;
      }
    } finally {
      handle.cleanup();
    }
  });

  it('exports IndexLockedError for handler error-mapping', () => {
    // The adapter returns Result.err(IndexLockedError) on SQLITE_BUSY.
    // Synthesizing a real WAL contention is exercised in the integration
    // test; here we verify the error class is wired correctly.
    const err = new IndexLockedError({ uri: 'corpus://manifest' });
    expect(err.name).toBe('IndexLockedError');
    expect(err.code).toBe('INDEX_LOCKED');
    expect(err.data.uri).toBe('corpus://manifest');
  });
});
