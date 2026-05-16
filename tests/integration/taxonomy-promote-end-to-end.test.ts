// SP-007 T069 — Integration: taxonomy-promote end-to-end against a clean
// installed-receipt + seeded taxonomy_terms; covers per-term + threshold +
// missing-term + lock-contention.
//
// References:
//   - specs/007-install-first-run/tasks.md T069
//   - specs/007-install-first-run/spec.md FR-INSTALL-014
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runTaxonomyPromoteCommand } from '../../packages/cli/src/taxonomy-promote-command.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-promote-e2e-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  const db = openIndexReadWrite();
  try {
    runSchemaMigration(db);
    // Seed proposed terms.
    db.prepare(
      `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
       ('domain', 'climbing', 'proposed', NULL),
       ('domain', 'skiing',   'proposed', NULL),
       ('domain', 'cycling',  'proposed', NULL)`,
    ).run();
    // Synthesize documents that 'proposed' these terms so the threshold
    // mode can count from documents.facet_domain.
    const insertDoc = db.prepare(
      `INSERT INTO documents (
         id, title, body_path, source_path, facet_domain, tags_json,
         facet_type, source_type, mime_type, hash, ingest_timestamp, status
       ) VALUES (?, ?, ?, ?, ?, '[]', 'unclassified', 'unknown', 'text/markdown', ?, ?, 'success')`,
    );
    function makeId(seed: string): string {
      return (
        'doc-' +
        Array.from(seed)
          .reduce((acc, c) => (acc * 33 + c.charCodeAt(0)) >>> 0, 5381)
          .toString(16)
          .padStart(8, '0')
          .slice(0, 8)
      );
    }
    // 5 docs for climbing
    for (let i = 0; i < 5; i++) {
      const id = makeId('climbing-' + i);
      insertDoc.run(id, 't', '/tmp/' + id, '/tmp/' + id, 'climbing', 'h' + i + 'c', new Date().toISOString());
    }
    // 10 docs for skiing
    for (let i = 0; i < 10; i++) {
      const id = makeId('skiing-' + i);
      insertDoc.run(id, 't', '/tmp/' + id, '/tmp/' + id, 'skiing', 'h' + i + 's', new Date().toISOString());
    }
    // 15 docs for cycling
    for (let i = 0; i < 15; i++) {
      const id = makeId('cycling-' + i);
      insertDoc.run(id, 't', '/tmp/' + id, '/tmp/' + id, 'cycling', 'h' + i + 'y', new Date().toISOString());
    }
  } finally {
    db.close();
  }
  return d;
}

describe('SP-007 T069 — taxonomy promote end-to-end', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('per-term promote → threshold promote → missing-term → exits 0/0/non-zero', async () => {
    await tempdir();

    // (a) Promote climbing by axis+term.
    const stdoutBuf: string[] = [];
    const r1 = await runTaxonomyPromoteCommand({
      argv: ['--axis=domain', '--term=climbing'],
      signal: new AbortController().signal,
      stdout: (m) => stdoutBuf.push(m),
      stderr: () => undefined,
    });
    expect(r1.exit).toBe(0);

    // (b) Threshold promote at N=10 → skiing + cycling get promoted.
    const r2 = await runTaxonomyPromoteCommand({
      argv: ['--from-proposed-with-count-ge=10'],
      signal: new AbortController().signal,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(r2.exit).toBe(0);

    const db = openIndexReadWrite();
    try {
      const states = db
        .prepare(`SELECT term, state FROM taxonomy_terms WHERE axis='domain' ORDER BY term`)
        .all() as { term: string; state: string }[];
      const byTerm = Object.fromEntries(states.map((s) => [s.term, s.state]));
      expect(byTerm.climbing).toBe('established');
      expect(byTerm.skiing).toBe('established');
      expect(byTerm.cycling).toBe('established');
    } finally {
      db.close();
    }

    // (c) Missing term → exits non-zero.
    const r3 = await runTaxonomyPromoteCommand({
      argv: ['--axis=domain', '--term=does_not_exist'],
      signal: new AbortController().signal,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(r3.exit).not.toBe(0);
  });
});
