// SP-007 T066 — already-established term: no-op idempotent path.
//
// References:
//   - specs/007-install-first-run/tasks.md T066
//   - specs/007-install-first-run/spec.md FR-INSTALL-014
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)
//   - Constitution X

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runTaxonomyPromote } from '../../packages/cli/src/install-helpers/taxonomy-promote-helpers.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-promote-already-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  const db = openIndexReadWrite();
  try {
    runSchemaMigration(db);
    db.prepare(
      `INSERT INTO taxonomy_terms (axis, term, state, established_at)
       VALUES ('domain', 'engineering', 'established', datetime('now'))`,
    ).run();
  } finally {
    db.close();
  }
  return d;
}

describe('SP-007 T066 — promote already-established (idempotent)', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('counts already-established without throwing; exits 0', async () => {
    await tempdir();
    const r = await runTaxonomyPromote(
      { axis: 'domain', terms: ['engineering'] },
      new AbortController().signal,
    );
    expect(r.alreadyEstablishedCount).toBe(1);
    expect(r.promotedCount).toBe(0);
  });
});
