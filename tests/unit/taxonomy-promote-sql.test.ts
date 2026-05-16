// SP-007 T063 — RED-phase contract test for `runTaxonomyPromote` SQL flow.
//
// References:
//   - specs/007-install-first-run/tasks.md T063
//   - specs/007-install-first-run/spec.md FR-INSTALL-014, SC-007-018, SC-007-019
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
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-promote-sql-'));
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

function makeDocId(seed: string): string {
  // 8 hex chars derived deterministically from seed (djb2 hash).
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return 'doc-' + h.toString(16).padStart(8, '0').slice(0, 8);
}

function seedProposed(
  axis: string,
  term: string,
  proposedByDocsCount: number,
): void {
  const db = openIndexReadWrite();
  try {
    db.prepare(
      `INSERT OR IGNORE INTO taxonomy_terms (axis, term, state, established_at)
       VALUES (?, ?, 'proposed', NULL)`,
    ).run(axis, term);
    // For axis=domain: write the term into N synthetic documents.facet_domain.
    if (axis === 'domain') {
      const stmt = db.prepare(
        `INSERT INTO documents (
           id, title, body_path, source_path, facet_domain, tags_json,
           facet_type, source_type, mime_type, hash, ingest_timestamp, status
         ) VALUES (?, ?, ?, ?, ?, '[]', 'unclassified', 'unknown', 'text/markdown', ?, ?, 'success')`,
      );
      for (let i = 0; i < proposedByDocsCount; i++) {
        const id = makeDocId(`${axis}|${term}|${i}`);
        stmt.run(
          id,
          'title',
          '/tmp/' + id + '.md',
          '/tmp/' + id + '.md',
          term,
          `${term}-${i}-hash`,
          new Date().toISOString(),
        );
      }
    }
  } finally {
    db.close();
  }
}

function seedEstablished(axis: string, term: string): void {
  const db = openIndexReadWrite();
  try {
    db.prepare(
      `INSERT OR REPLACE INTO taxonomy_terms (axis, term, state, established_at)
       VALUES (?, ?, 'established', datetime('now'))`,
    ).run(axis, term);
  } finally {
    db.close();
  }
}

describe('SP-007 T063 — runTaxonomyPromote SQL flow', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('per-term mode: proposed → established with established_at set', async () => {
    await tempdir();
    seedProposed('domain', 'climbing', 0);

    const r = await runTaxonomyPromote(
      { axis: 'domain', terms: ['climbing'] },
      new AbortController().signal,
    );
    expect(r.promotedCount).toBe(1);
    expect(r.alreadyEstablishedCount).toBe(0);

    const db = openIndexReadWrite();
    try {
      const row = db
        .prepare(
          `SELECT state, established_at FROM taxonomy_terms WHERE axis=? AND term=?`,
        )
        .get('domain', 'climbing') as
        | { state: string; established_at: string | null }
        | undefined;
      expect(row?.state).toBe('established');
      expect(row?.established_at).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it('per-term mode: already-established is a no-op (idempotent)', async () => {
    await tempdir();
    seedEstablished('domain', 'engineering');
    const r = await runTaxonomyPromote(
      { axis: 'domain', terms: ['engineering'] },
      new AbortController().signal,
    );
    expect(r.promotedCount).toBe(0);
    expect(r.alreadyEstablishedCount).toBe(1);
  });

  it('threshold mode: promotes proposed rows with proposed_count >= N (computed from documents)', async () => {
    await tempdir();
    seedProposed('domain', 'low_volume', 2); // 2 docs
    seedProposed('domain', 'high_volume', 5); // 5 docs

    const r = await runTaxonomyPromote(
      { from_proposed_with_count_ge: 5 },
      new AbortController().signal,
    );
    // Only high_volume meets threshold.
    expect(r.promotedCount).toBe(1);

    const db = openIndexReadWrite();
    try {
      const high = db
        .prepare(`SELECT state FROM taxonomy_terms WHERE axis=? AND term=?`)
        .get('domain', 'high_volume') as { state: string };
      const low = db
        .prepare(`SELECT state FROM taxonomy_terms WHERE axis=? AND term=?`)
        .get('domain', 'low_volume') as { state: string };
      expect(high.state).toBe('established');
      expect(low.state).toBe('proposed');
    } finally {
      db.close();
    }
  });
});
