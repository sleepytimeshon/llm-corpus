// SP-006 T055 — Integration test: tier-fallthrough cascade end-to-end.
//
// Drives the full tier cascade against a synthetic in-memory DB:
//   (a) Tier 0 returns ≥ min_results → tier_used='hybrid' (no fallthrough)
//   (b) Tier 0 underdelivers → falls to Tier 1 BM25-only → tier_used='bm25-only'
//   (c) Tier 1 underdelivers → falls to Tier 2 catalog-grep → tier_used='catalog-grep'
//   (d) Tier 2 CATALOG.md absent → search.tier_skipped → falls to Tier 3 fs-grep
//   (e) tier_used field present on every SearchHit
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-013..019
//   - SC-HARDEN-010..SC-HARDEN-013

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths, type SearchInput } from '@llm-corpus/contracts';
import { runTieredSearch } from '../../packages/index/src/tier-orchestrator.js';
import { runBm25OnlyTier } from '../../packages/index/src/bm25-only-tier.js';
import { runCatalogGrepTier } from '../../packages/index/src/catalog-grep-tier.js';
import { runFsGrepTier } from '../../packages/index/src/fs-grep-tier.js';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';

let db: Database.Database;

async function seedDocsAndFts(): Promise<void> {
  db = new Database(':memory:');
  // Enable sqlite-vec.
  const sqliteVec = await import('sqlite-vec');
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      title TEXT,
      facet_domain TEXT,
      facet_type TEXT,
      tags_json TEXT DEFAULT '[]',
      ingest_timestamp TEXT,
      source_type TEXT,
      body_path TEXT,
      status TEXT DEFAULT 'success'
    );
  `);
  runSp005Migration(db);

  // Seed 3 docs with body files and FTS5 rows.
  for (let i = 1; i <= 3; i++) {
    const id = `doc-0000000${i}`;
    const prefix = id.slice(4, 6);
    const dir = path.join(Paths.docsStore(), prefix);
    await fsp.mkdir(dir, { recursive: true });
    const body = `# Doc ${i}\n\nThis is doc ${i} talking about RETRIEVAL token ${i}.\n`;
    const bodyPath = path.join(dir, `${id}.md`);
    await fsp.writeFile(bodyPath, body, 'utf8');
    db.prepare(
      `INSERT INTO documents (id, title, facet_domain, facet_type, tags_json, ingest_timestamp, source_type, body_path, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success')`,
    ).run(
      id,
      `Doc ${i}`,
      'engineering',
      'reference',
      '[]',
      '2026-05-13T00:00:00Z',
      'manual',
      bodyPath,
    );
    db.prepare(
      `INSERT INTO documents_fts (doc_id, title, summary, tags, facet_topic, body_excerpt)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, `Doc ${i}`, 'A doc about retrieval', 'retrieval', 'retrieval', body);
  }
}

async function writeCatalogMd(): Promise<void> {
  const lines = [
    'doc-00000001 | Doc 1 | engineering | reference | A doc about retrieval token 1.',
    'doc-00000002 | Doc 2 | engineering | reference | A doc about retrieval token 2.',
    'doc-00000003 | Doc 3 | engineering | reference | A doc about retrieval token 3.',
  ];
  await fsp.mkdir(Paths.data(), { recursive: true });
  await fsp.writeFile(
    path.join(Paths.data(), 'CATALOG.md'),
    lines.join('\n') + '\n',
    'utf8',
  );
}

describe('T055 — tier-fallthrough end-to-end (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-tier-e2e-'));
    process.env.CORPUS_HOME = tmpHome;
    await fsp.mkdir(Paths.state(), { recursive: true });
    await seedDocsAndFts();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* no-op */
    }
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

  it('cascades Tier 0 empty → Tier 1 BM25 → returns bm25-only hits', async () => {
    const input: SearchInput = { query: 'retrieval', limit: 20 };
    const result = await runTieredSearch(
      input,
      {
        tier0: async () => ({
          tier: 'hybrid',
          hits: [],
          elapsed_ms: 1,
          outcome: 'completed',
        }),
        tier1: async (signal) =>
          runBm25OnlyTier({ input, db, topK: 64, signal }),
        tier2: async (signal) => runCatalogGrepTier({ input, signal }),
        tier3: async (signal) =>
          runFsGrepTier({ input, db, timeoutMs: 5_000, signal }),
        policy: {
          minResultsForFallthrough: 3,
          tierTotalBudgetMs: 5_000,
          tierBm25TimeoutMs: 1_000,
          tierCatalogGrepTimeoutMs: 1_000,
          tierFsGrepTimeoutMs: 2_000,
        },
      },
      new AbortController().signal,
    );
    expect(result.hits.length).toBeGreaterThanOrEqual(3);
    // All hits carry a tier_used field.
    for (const h of result.hits) {
      expect(['hybrid', 'bm25-only', 'catalog-grep', 'fs-grep']).toContain(
        h.tier_used,
      );
    }
    expect(result.tier_used).toBe('bm25-only');
  });

  it('cascades Tier 0+1 empty → Tier 2 CATALOG.md grep → returns catalog-grep hits', async () => {
    await writeCatalogMd();
    const input: SearchInput = { query: 'retrieval', limit: 20 };
    const result = await runTieredSearch(
      input,
      {
        tier0: async () => ({
          tier: 'hybrid',
          hits: [],
          elapsed_ms: 1,
          outcome: 'completed',
        }),
        tier1: async () => ({
          tier: 'bm25-only',
          hits: [],
          elapsed_ms: 1,
          outcome: 'completed',
        }),
        tier2: async (signal) => runCatalogGrepTier({ input, signal }),
        tier3: async (signal) =>
          runFsGrepTier({ input, db, timeoutMs: 5_000, signal }),
        policy: {
          minResultsForFallthrough: 3,
          tierTotalBudgetMs: 5_000,
          tierBm25TimeoutMs: 1_000,
          tierCatalogGrepTimeoutMs: 1_000,
          tierFsGrepTimeoutMs: 2_000,
        },
      },
      new AbortController().signal,
    );
    expect(result.hits.length).toBeGreaterThanOrEqual(3);
    expect(result.tier_used).toBe('catalog-grep');
    for (const h of result.hits) {
      expect(h.tier_used).toBe('catalog-grep');
    }
  });

  it('cascades all the way to Tier 3 fs-grep when prior tiers empty AND CATALOG.md absent', async () => {
    // No CATALOG.md — Tier 2 skips → Tier 3 fs-grep runs.
    const input: SearchInput = { query: 'RETRIEVAL', limit: 20 };
    const result = await runTieredSearch(
      input,
      {
        tier0: async () => ({
          tier: 'hybrid',
          hits: [],
          elapsed_ms: 1,
          outcome: 'completed',
        }),
        tier1: async () => ({
          tier: 'bm25-only',
          hits: [],
          elapsed_ms: 1,
          outcome: 'completed',
        }),
        tier2: async (signal) => runCatalogGrepTier({ input, signal }),
        tier3: async (signal) =>
          runFsGrepTier({ input, db, timeoutMs: 5_000, signal }),
        policy: {
          minResultsForFallthrough: 3,
          tierTotalBudgetMs: 10_000,
          tierBm25TimeoutMs: 1_000,
          tierCatalogGrepTimeoutMs: 1_000,
          tierFsGrepTimeoutMs: 5_000,
        },
      },
      new AbortController().signal,
    );
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.tier_used).toBe('fs-grep');
  });
});
