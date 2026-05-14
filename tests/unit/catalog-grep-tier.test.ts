// SP-006 T041 — Unit test for Tier 2 in-process CATALOG.md grep retriever.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   - runCatalogGrepTier reads Paths.data() + '/CATALOG.md' line-by-line
//   - Case-insensitive substring match on the query terms
//   - Constructs SearchHit shape with tier_used='catalog-grep'
//   - On CATALOG.md absence: outcome='skipped', emits search.tier_skipped
//   - On AbortSignal pre-fire: outcome='aborted'
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-014
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Tier 2"
//   - specs/006-hardening/data-model.md §"Entity 3"
//   - Constitution Principles V, VII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths } from '@llm-corpus/contracts';
import { runCatalogGrepTier } from '../../packages/index/src/catalog-grep-tier.js';

const writeCatalog = async (lines: string[]): Promise<void> => {
  await fsp.mkdir(Paths.data(), { recursive: true });
  await fsp.writeFile(
    path.join(Paths.data(), 'CATALOG.md'),
    lines.join('\n') + (lines.length > 0 ? '\n' : ''),
    'utf8',
  );
};

describe('T041 — runCatalogGrepTier (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(() => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-catalog-grep-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('matches the query case-insensitively over CATALOG.md lines', async () => {
    await writeCatalog([
      'doc-aaaaaaaa | Hybrid Retrieval Primer | engineering | reference | A primer about retrieval.',
      'doc-bbbbbbbb | Coffee Brewing | lifestyle | reference | Brewing methods at home.',
      'doc-cccccccc | BM25 Deep Dive | engineering | reference | Lower-tier ranking algorithms.',
    ]);
    const controller = new AbortController();
    const result = await runCatalogGrepTier({
      input: { query: 'retrieval', limit: 20 },
      signal: controller.signal,
    });
    expect(result.tier).toBe('catalog-grep');
    expect(result.outcome).toBe('completed');
    const ids = result.hits.map((h) => h.uri);
    expect(ids).toContain('corpus://docs/doc-aaaaaaaa');
    expect(result.hits.every((h) => h.tier_used === 'catalog-grep')).toBe(true);
  });

  it('returns outcome="skipped" when CATALOG.md is absent', async () => {
    const controller = new AbortController();
    const result = await runCatalogGrepTier({
      input: { query: 'whatever', limit: 20 },
      signal: controller.signal,
    });
    expect(result.tier).toBe('catalog-grep');
    expect(result.outcome).toBe('skipped');
    expect(result.hits.length).toBe(0);
  });

  it('returns outcome="aborted" when signal is pre-fired', async () => {
    await writeCatalog([
      'doc-aaaaaaaa | something | engineering | reference | x.',
    ]);
    const controller = new AbortController();
    controller.abort();
    const result = await runCatalogGrepTier({
      input: { query: 'something', limit: 20 },
      signal: controller.signal,
    });
    expect(result.outcome).toBe('aborted');
    expect(result.hits.length).toBe(0);
  });

  it('respects the limit', async () => {
    const lines = Array.from({ length: 10 }, (_v, i) => {
      const id = `doc-${i.toString(16).padStart(8, '0')}`;
      return `${id} | retrieval-${i} | engineering | reference | retrieval token here.`;
    });
    await writeCatalog(lines);
    const controller = new AbortController();
    const result = await runCatalogGrepTier({
      input: { query: 'retrieval', limit: 3 },
      signal: controller.signal,
    });
    expect(result.tier).toBe('catalog-grep');
    expect(result.outcome).toBe('completed');
    expect(result.hits.length).toBe(3);
  });
});
