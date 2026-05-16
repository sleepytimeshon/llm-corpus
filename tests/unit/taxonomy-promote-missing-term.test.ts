// SP-007 T065 — Missing-term error: per-term promote on (axis, term) that
// doesn't exist in taxonomy_terms rejects with TaxonomyPromoteMissingTermError;
// transaction ROLLBACKs; ZERO SQL writes persist.
//
// References:
//   - specs/007-install-first-run/tasks.md T065
//   - specs/007-install-first-run/spec.md FR-INSTALL-014, SC-007-021
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runTaxonomyPromote } from '../../packages/cli/src/install-helpers/taxonomy-promote-helpers.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-promote-missing-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  const db = openIndexReadWrite();
  try {
    runSchemaMigration(db);
  } finally {
    db.close();
  }
  return d;
}

describe('SP-007 T065 — promote missing-term path', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('rejects on missing (axis, term); ZERO SQL writes', async () => {
    await tempdir();
    const db = openIndexReadWrite();
    let before = 0;
    try {
      before = (
        db.prepare(`SELECT COUNT(*) AS c FROM taxonomy_terms`).get() as { c: number }
      ).c;
    } finally {
      db.close();
    }

    await expect(
      runTaxonomyPromote(
        { axis: 'domain', terms: ['does_not_exist'] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: 'TaxonomyPromoteMissingTermError' });

    const db2 = openIndexReadWrite();
    try {
      const after = (
        db2.prepare(`SELECT COUNT(*) AS c FROM taxonomy_terms`).get() as {
          c: number;
        }
      ).c;
      expect(after).toBe(before);
    } finally {
      db2.close();
    }
  });
});
