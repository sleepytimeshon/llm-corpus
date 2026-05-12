// T014 — Unit test: loadFixture() per-test isolation + cleanup discipline.
//
// References: plan.md Decision B, Constitution XIV (paths-only),
// Constitution IV (single-user, single-machine — fixtures are per-test).
//
// Coverage:
//   - Creates per-test <test-id>/ subdirectory under Paths.sp002FixturesRoot()
//   - Initializes a fresh SQLite at the per-test Paths.indexDb()
//   - Runs the schema migration (documents + taxonomy_terms tables exist)
//   - Two parallel test invocations get isolated subdirs (no row leakage)
//   - cleanup() removes the per-test root completely

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { Paths } from '../../packages/contracts/src/paths.js';

describe('loadFixture() (T014, plan.md Decision B)', () => {
  it('creates a per-test subdirectory under Paths.sp002FixturesRoot()', async () => {
    const handle = await loadFixture('test-isolation-1', null);
    try {
      // The per-test root must exist as <fixturesRoot>/<test-id>/
      const expectedRoot = path.join(
        Paths.sp002FixturesRoot(),
        'test-isolation-1',
      );
      expect(fs.existsSync(expectedRoot)).toBe(true);
    } finally {
      handle.cleanup();
    }
  });

  it('initializes a fresh SQLite with the SP-002 baseline schema', async () => {
    const handle = await loadFixture('test-isolation-2', null);
    try {
      // The handle exposes the fresh, schema-migrated DB.
      const tables = handle.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('documents');
      expect(names).toContain('taxonomy_terms');
    } finally {
      handle.cleanup();
    }
  });

  it('cleanup() removes the per-test root', async () => {
    const handle = await loadFixture('test-isolation-3', null);
    const expectedRoot = path.join(
      Paths.sp002FixturesRoot(),
      'test-isolation-3',
    );
    expect(fs.existsSync(expectedRoot)).toBe(true);
    handle.cleanup();
    expect(fs.existsSync(expectedRoot)).toBe(false);
  });

  it('two parallel invocations get isolated subdirs', async () => {
    const a = await loadFixture('test-iso-a', null);
    const b = await loadFixture('test-iso-b', null);
    try {
      // Insert into A; B must remain empty.
      a.db.exec(`
        INSERT INTO documents
        (id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-aaaaaaaa', 'A', 'a.md', '/a', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
                'c11d84923e68ec80a2ef3f97b79dbb9a85a4c9eb3d6e12da9c39d37a2475236c',
                '2026-05-15T14:30:00Z', 'success')
      `);

      const aCount = (
        a.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }
      ).n;
      const bCount = (
        b.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }
      ).n;
      expect(aCount).toBe(1);
      expect(bCount).toBe(0);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it('cleanup() is idempotent (second call no-ops without throwing)', async () => {
    const handle = await loadFixture('test-iso-cleanup-twice', null);
    handle.cleanup();
    // Second cleanup must not throw.
    expect(() => handle.cleanup()).not.toThrow();
  });
});
