// SP-007 T072 — Triage-path test: failures show → taxonomy promote.
//
// Drives the NFR-006 triage path against a synthetic vocabulary-violation:
//   (a) write a fixture sidecar describing a classify-stage vocab violation
//       for an unknown domain term;
//   (b) run `runFailuresShow` and assert the output reveals the missing
//       taxonomy term;
//   (c) seed the proposed taxonomy term and a stub document carrying it;
//   (d) run `runTaxonomyPromote` and assert the term transitions
//       proposed → established.
//
// The SP-005 reenrich step + SP-006 recovery scanner are NOT exercised here
// (the integration test T075 covers the end-to-end flow). This unit test
// confirms the CLI surfaces expose enough information for the operator to
// drive the triage path.
//
// References:
//   - specs/007-install-first-run/tasks.md T072
//   - specs/007-install-first-run/spec.md NFR-006, SC-007-023, SC-007-024,
//     FR-INSTALL-014, FR-INSTALL-025

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runFailuresShow } from '../../packages/cli/src/failures-command.js';
import { runTaxonomyPromote } from '../../packages/cli/src/install-helpers/taxonomy-promote-helpers.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-triage-path-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  await fs.mkdir(Paths.failed(), { recursive: true });
  const db = openIndexReadWrite();
  try {
    runSchemaMigration(db);
  } finally {
    db.close();
  }
  return d;
}

describe('SP-007 T072 — failures→taxonomy promote triage path', () => {
  let prev: string | undefined;
  let home: string;

  beforeEach(async () => {
    prev = process.env.CORPUS_HOME;
    home = await tempdir();
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prev;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('reveals the missing taxonomy term and promote transitions proposed → established', async () => {
    // (a) Write a fixture sidecar describing a classify-stage vocab violation.
    const docId = 'doc-12345678';
    const missingTerm = 'climbing';
    const sidecarPayload = {
      doc_id: docId,
      stage: 'classify',
      error_code: 'vocab_violation',
      message: `unknown domain term: ${missingTerm}`,
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    };
    await fs.writeFile(
      path.join(Paths.failed(), `${docId}.error.json`),
      JSON.stringify(sidecarPayload),
      'utf8',
    );

    // (b) Run failures show and confirm the missing term is in the output.
    const show = await runFailuresShow(
      { doc_id: docId },
      new AbortController().signal,
    );
    expect(show.entry).not.toBeNull();
    expect(show.entry?.stage).toBe('classify');
    expect(show.entry?.error_code).toBe('vocab_violation');
    expect(show.entry?.message).toContain(missingTerm);

    // (c) Seed the proposed taxonomy term (mimicking what the SP-004
    //     classifier would write to taxonomy_terms when it rejected the doc).
    const db = openIndexReadWrite();
    try {
      db.prepare(
        `INSERT OR IGNORE INTO taxonomy_terms (axis, term, state, established_at)
         VALUES (?, ?, 'proposed', NULL)`,
      ).run('domain', missingTerm);
    } finally {
      db.close();
    }

    // (d) Run taxonomy promote and confirm proposed → established.
    const res = await runTaxonomyPromote(
      { axis: 'domain', terms: [missingTerm] },
      new AbortController().signal,
    );
    expect(res.promotedCount).toBe(1);
    expect(res.alreadyEstablishedCount).toBe(0);
    expect(res.promoted[0]).toEqual({ axis: 'domain', term: missingTerm });

    // Verify SQL state directly.
    const dbCheck = openIndexReadWrite();
    try {
      const row = dbCheck
        .prepare(
          `SELECT state, established_at FROM taxonomy_terms WHERE axis = ? AND term = ?`,
        )
        .get('domain', missingTerm) as { state: string; established_at: string | null };
      expect(row.state).toBe('established');
      expect(row.established_at).not.toBeNull();
    } finally {
      dbCheck.close();
    }
  });
});
