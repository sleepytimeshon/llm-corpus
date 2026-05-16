// SP-007 T025 — RED-phase contract test for `loadAndInsertTaxonomySeed`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadAndInsertTaxonomySeed } from '../../packages/cli/src/install-helpers/taxonomy-seed-loader.js';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { Paths, type TaxonomySeed } from '@llm-corpus/contracts';

async function makeCorpusHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-seed-'));
  process.env.CORPUS_HOME = dir;
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  await fs.mkdir(Paths.state(), { recursive: true });
  return dir;
}

function makeSeed(): TaxonomySeed {
  // 25-entry floor: 5+6+9+5
  const seed: { axis: 'domain' | 'type' | 'tag' | 'source_type'; term: string }[] = [];
  for (let i = 0; i < 5; i++) seed.push({ axis: 'domain', term: `dom${i}` });
  for (let i = 0; i < 6; i++) seed.push({ axis: 'type', term: `typ${i}` });
  for (let i = 0; i < 9; i++) seed.push({ axis: 'tag', term: `tag${i}` });
  for (let i = 0; i < 5; i++) seed.push({ axis: 'source_type', term: `src${i}` });
  return seed;
}

describe('SP-007 T025 — loadAndInsertTaxonomySeed', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('inserts all rows on first run; counts match', async () => {
    await makeCorpusHome();
    const db = openIndexReadWrite();
    try {
      const seed = makeSeed();
      const r = await loadAndInsertTaxonomySeed(
        db,
        { seedOverride: seed },
        new AbortController().signal,
      );
      expect(r.insertedCount).toBe(seed.length);
      expect(r.skippedCount).toBe(0);
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM taxonomy_terms WHERE state='established'`,
        )
        .get() as { c: number };
      expect(row.c).toBeGreaterThanOrEqual(seed.length);
    } finally {
      db.close();
    }
  });

  it('idempotent — second run inserts zero, skips all', async () => {
    await makeCorpusHome();
    const db = openIndexReadWrite();
    try {
      const seed = makeSeed();
      await loadAndInsertTaxonomySeed(
        db,
        { seedOverride: seed },
        new AbortController().signal,
      );
      const r2 = await loadAndInsertTaxonomySeed(
        db,
        { seedOverride: seed },
        new AbortController().signal,
      );
      expect(r2.insertedCount).toBe(0);
      expect(r2.skippedCount).toBe(seed.length);
    } finally {
      db.close();
    }
  });

  it('default bundled seed.json file is loadable and Zod-valid', async () => {
    await makeCorpusHome();
    const db = openIndexReadWrite();
    try {
      const r = await loadAndInsertTaxonomySeed(
        db,
        {},
        new AbortController().signal,
      );
      expect(r.insertedCount).toBeGreaterThanOrEqual(25);
    } finally {
      db.close();
    }
  });
});
