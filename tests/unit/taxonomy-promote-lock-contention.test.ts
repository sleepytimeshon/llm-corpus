// SP-007 T064 — Drain-lock contention causes promote to exit non-zero with
// `taxonomy.promote_lock_contention` telemetry; ZERO SQL writes occur.
//
// References:
//   - specs/007-install-first-run/tasks.md T064
//   - specs/007-install-first-run/spec.md FR-INSTALL-014, SC-007-022
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)
//   - Constitution IX

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runTaxonomyPromote } from '../../packages/cli/src/install-helpers/taxonomy-promote-helpers.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-promote-lock-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  const db = openIndexReadWrite();
  try {
    runSchemaMigration(db);
    db.prepare(
      `INSERT INTO taxonomy_terms (axis, term, state, established_at)
       VALUES ('domain', 'pending', 'proposed', NULL)`,
    ).run();
  } finally {
    db.close();
  }
  return d;
}

describe('SP-007 T064 — promote lock-contention path', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('rejects with TaxonomyPromoteLockContentionError when drain-lock held by another PID', async () => {
    await tempdir();
    // Simulate another live process holding the lock (write our own PID; the
    // promote will see PID == process.pid and treat as held — see drain-lock
    // implementation note: only `holderPid !== process.pid` triggers steal).
    // To exercise contention reliably we need a PID that's alive but != our
    // own. Use a PID that doesn't exist + a future-proof: write 999999998
    // which is dead → drain-lock would steal. Instead, write the parent PID.
    const otherPid = process.ppid;
    await fs.writeFile(Paths.drainLock(), String(otherPid), 'utf8');

    await expect(
      runTaxonomyPromote(
        { axis: 'domain', terms: ['pending'] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: 'TaxonomyPromoteLockContentionError' });

    // ZERO SQL writes: row is still 'proposed'.
    const db = openIndexReadWrite();
    try {
      const row = db
        .prepare(`SELECT state FROM taxonomy_terms WHERE axis=? AND term=?`)
        .get('domain', 'pending') as { state: string };
      expect(row.state).toBe('proposed');
    } finally {
      db.close();
    }
  });
});
