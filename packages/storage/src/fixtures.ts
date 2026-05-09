// T028 — Fixture loader for SP-002 populated-corpus integration tests.
//
// References: plan.md Decision B, Constitution XIV (paths-only — fixtures
// resolve under Paths.cache(), never os.tmpdir()), Constitution IV.
//
// **Test-only export.** This module is NOT exported from the package's
// public `index.ts`; consumers must import the file path directly from
// tests. Production code MUST NOT import this — the SC-010 lint rule's
// scope check prevents it (and the `package.json` `exports` map omits it).
//
// Per-test isolation discipline:
//   - Each test passes a unique testId; fixtures live under
//     Paths.sp002FixturesRoot()/<testId>/
//   - The per-test SQLite DB is the per-test Paths.indexDb() resolved with
//     CORPUS_HOME pointed at the per-test root
//   - cleanup() removes the entire <testId> subtree; idempotent

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { Paths } from '@llm-corpus/contracts';
import { runSchemaMigration } from './schema-migration.js';

/**
 * The optional fixture-name argument identifies a fixture template under
 * `tests/fixtures/sp002-populated/<fixtureName>.sql`. When `null`, the test
 * gets a freshly migrated empty DB and is responsible for any seed inserts.
 */
export type FixtureName =
  | 'documents'
  | 'recent-25-success'
  | 'recent-mixed-failure'
  | null;

export interface FixtureHandle {
  /** The fresh, schema-migrated SQLite handle. */
  db: DatabaseType;
  /**
   * The per-test root directory under Paths.sp002FixturesRoot(). Tests can
   * write extra files (frontmatter bodies under `data/docs/`, etc.) under
   * this root; cleanup() removes the whole subtree.
   */
  rootDir: string;
  /** Idempotent cleanup — closes the DB and removes rootDir. */
  cleanup: () => void;
}

/**
 * Initialize a per-test fixture environment. Caller MUST call handle.cleanup()
 * (typically in afterEach) — leaks bloat the cache directory.
 */
export async function loadFixture(
  testId: string,
  fixtureName: FixtureName,
): Promise<FixtureHandle> {
  // Resolve the per-test root via Paths (Constitution XIV — never os.tmpdir).
  const rootDir = path.join(Paths.sp002FixturesRoot(), testId);

  // Clean up any leftover from a prior failed test run with the same id.
  if (fs.existsSync(rootDir)) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
  fs.mkdirSync(rootDir, { recursive: true });

  // The per-test DB lives at <rootDir>/data/index.db. We open via the
  // direct path here (NOT through Paths.indexDb()) because we want the DB
  // to live INSIDE the per-test root for cleanup, not at the global
  // CORPUS_HOME location. Production code uses Paths.indexDb() (Constitution
  // XIV); this is test plumbing.
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'index.db');
  const db = new Database(dbPath);

  // Apply the SP-002 baseline schema.
  runSchemaMigration(db);

  // Optionally seed from a fixture template. T029 populates these files;
  // when the file is empty (Phase 1 placeholder), exec() is a no-op.
  if (fixtureName !== null) {
    // Resolve fixture file relative to the repo root. We walk up from this
    // module's URL until we find the `tests/fixtures/sp002-populated/`
    // directory — which works for both source-level tests (via tsx) and
    // built-output tests.
    const fixtureSqlPath = resolveFixturePath(`${fixtureName}.sql`);
    const sql = fs.readFileSync(fixtureSqlPath, 'utf8');
    if (sql.trim().length > 0) {
      db.exec(sql);
    }
  }

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      db.close();
    } catch {
      // best-effort
    }
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  };

  return { db, rootDir, cleanup };
}

/**
 * Walk up from the repo's package install location to find the source-tree
 * fixture file. This works regardless of whether the test runs from `dist/`
 * or `src/`. Throws if not found.
 */
function resolveFixturePath(filename: string): string {
  // Start from the current file's directory.
  // `import.meta.url` in NodeNext / ESM gives a file URL.
  const here = new URL('.', import.meta.url).pathname;
  // Walk up until we find a `tests/fixtures/sp002-populated/<filename>`.
  let dir = here;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'sp002-populated',
      filename,
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `loadFixture: could not locate fixture template "${filename}" under tests/fixtures/sp002-populated/`,
  );
}
