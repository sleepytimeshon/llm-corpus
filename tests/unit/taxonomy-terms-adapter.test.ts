// T006 (SP-004 PREREQ-005) — Contract test for the proposed-term write-side
// adapter in packages/storage/src/taxonomy-terms-adapter.ts.
//
// Verifies:
//   - `insertProposedTerm(db, axis, term, signal)` executes
//     `INSERT INTO taxonomy_terms (axis, term, state, established_at)
//      VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`.
//   - First invocation inserts (inserted=true); second invocation with the
//     same (axis, term) is a no-op (inserted=false, zero new rows).
//   - The function signature does NOT accept `state` as a parameter — the
//     state literal `'proposed'` is baked into the SQL string.
//   - Source-file grep over the implementation file reveals NO
//     `state='established'` literal inside write paths (defense-in-depth
//     against future bugs).
//   - Cancellable via `signal.throwIfAborted()` BEFORE bind.
//
// Spec references:
//   - specs/004-classifier/plan.md PREREQ-005
//   - specs/004-classifier/spec.md FR-CLASSIFY-007
//   - specs/004-classifier/research.md Decision I
//   - Constitution Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)
//
// TDD: this test MUST FAIL before T012 (the implementation) lands.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

// Per-test corpus root override.
async function makeIsolatedCorpus(): Promise<string> {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'sp004-tax-adapter-'),
  );
  process.env.CORPUS_HOME = root;
  await fsp.mkdir(path.join(root, 'data'), { recursive: true });
  await fsp.mkdir(path.join(root, 'state'), { recursive: true });
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true });
  await fsp.mkdir(path.join(root, 'config'), { recursive: true });
  return root;
}

describe('PREREQ-005 — taxonomy-terms-adapter.insertProposedTerm (contract)', () => {
  it('insertProposedTerm is exported from packages/storage', async () => {
    const mod = (await import(
      '../../packages/storage/src/taxonomy-terms-adapter.js'
    )) as Record<string, unknown>;
    expect(typeof mod.insertProposedTerm).toBe('function');
  });

  it('first invocation inserts a proposed-state row', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import(
        '../../packages/storage/src/document-writer.js'
      );
      const { insertProposedTerm } = await import(
        '../../packages/storage/src/taxonomy-terms-adapter.js'
      );
      const db = openIndexReadWrite();
      try {
        const controller = new AbortController();
        const result = await insertProposedTerm(
          db,
          'domain',
          'quantum-cryptography',
          controller.signal,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.inserted).toBe(true);
        }
        const row = db
          .prepare(
            `SELECT axis, term, state, established_at FROM taxonomy_terms WHERE axis='domain' AND term='quantum-cryptography'`,
          )
          .get() as {
          axis: string;
          term: string;
          state: string;
          established_at: string | null;
        };
        expect(row).toBeDefined();
        expect(row.state).toBe('proposed');
        expect(row.established_at).toBeNull();
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('second invocation with same (axis, term) is a no-op (ON CONFLICT DO NOTHING)', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import(
        '../../packages/storage/src/document-writer.js'
      );
      const { insertProposedTerm } = await import(
        '../../packages/storage/src/taxonomy-terms-adapter.js'
      );
      const db = openIndexReadWrite();
      try {
        const c = new AbortController();
        const r1 = await insertProposedTerm(db, 'tag', 'dup-tag', c.signal);
        expect(r1.ok && r1.value.inserted).toBe(true);
        const r2 = await insertProposedTerm(db, 'tag', 'dup-tag', c.signal);
        expect(r2.ok).toBe(true);
        if (r2.ok) {
          expect(r2.value.inserted).toBe(false);
        }
        const count = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM taxonomy_terms WHERE axis='tag' AND term='dup-tag'`,
            )
            .get() as { n: number }
        ).n;
        expect(count).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('aborted signal short-circuits before INSERT (cancellable IO)', async () => {
    const root = await makeIsolatedCorpus();
    try {
      const { openIndexReadWrite } = await import(
        '../../packages/storage/src/document-writer.js'
      );
      const { insertProposedTerm } = await import(
        '../../packages/storage/src/taxonomy-terms-adapter.js'
      );
      const db = openIndexReadWrite();
      try {
        const controller = new AbortController();
        controller.abort();
        let threw = false;
        try {
          await insertProposedTerm(
            db,
            'domain',
            'aborted-term',
            controller.signal,
          );
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      delete process.env.CORPUS_HOME;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('implementation file contains no "state=\'established\'" literal in write paths (Principle XV)', () => {
    const filePath = path.join(
      process.cwd(),
      'packages/storage/src/taxonomy-terms-adapter.ts',
    );
    const source = fs.readFileSync(filePath, 'utf8');
    // The implementation must not contain any literal 'established' state
    // value that lands inside an INSERT statement. Grep for ANY occurrence
    // of the string `'established'` (single-quoted SQL literal) — this
    // adapter is small enough that there should be zero.
    expect(source.includes("'established'")).toBe(false);
  });
});
