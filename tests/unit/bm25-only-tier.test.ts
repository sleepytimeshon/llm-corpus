// SP-006 T040 — Unit test for Tier 1 BM25-only retriever.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   - runBm25OnlyTier delegates to Fts5Adapter (no dense/graph/confidence)
//   - Returns TierResult { tier: 'bm25-only', hits[], elapsed_ms, outcome }
//   - Per-hit `tier_used === 'bm25-only'`
//   - Honors AbortSignal (throws / outcome='aborted')
//   - On FTS5 error, outcome='failed' (no throw)
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-013
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Tier 1"
//   - specs/006-hardening/data-model.md §"Entity 3 — TierResult"
//   - Constitution Principles V, VII

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sqliteVec from 'sqlite-vec';

import type { SearchInput } from '@llm-corpus/contracts';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import { runBm25OnlyTier } from '../../packages/index/src/bm25-only-tier.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  sqliteVec.load(db);
  // Minimal documents table for the FTS5 JOIN.
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

  // Seed three docs.
  db.prepare(
    `INSERT INTO documents (id, title, facet_domain, facet_type, tags_json, ingest_timestamp, source_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'success')`,
  ).run(
    'doc-aaaaaaaa',
    'Hybrid retrieval primer',
    'engineering',
    'reference',
    '["retrieval"]',
    '2026-05-13T00:00:00Z',
    'manual',
  );
  db.prepare(
    `INSERT INTO documents (id, title, facet_domain, facet_type, tags_json, ingest_timestamp, source_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'success')`,
  ).run(
    'doc-bbbbbbbb',
    'BM25 only test',
    'engineering',
    'reference',
    '["retrieval"]',
    '2026-05-13T00:00:00Z',
    'manual',
  );
  db.prepare(
    `INSERT INTO documents (id, title, facet_domain, facet_type, tags_json, ingest_timestamp, source_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'success')`,
  ).run(
    'doc-cccccccc',
    'Unrelated',
    'engineering',
    'reference',
    '[]',
    '2026-05-13T00:00:00Z',
    'manual',
  );

  // Seed FTS5 rows.
  db.prepare(
    `INSERT INTO documents_fts (doc_id, title, summary, tags, facet_topic, body_excerpt)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('doc-aaaaaaaa', 'Hybrid retrieval primer', 'A primer about retrieval', 'retrieval', 'retrieval', 'Hybrid retrieval mixes BM25 with dense embeddings.');
  db.prepare(
    `INSERT INTO documents_fts (doc_id, title, summary, tags, facet_topic, body_excerpt)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('doc-bbbbbbbb', 'BM25 only test', 'BM25 only fixture', 'retrieval', 'retrieval', 'This document is about BM25 retrieval.');
  db.prepare(
    `INSERT INTO documents_fts (doc_id, title, summary, tags, facet_topic, body_excerpt)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('doc-cccccccc', 'Unrelated', 'Different content', '', '', 'Coffee brewing techniques.');
});

afterEach(() => {
  db.close();
});

describe('T040 — runBm25OnlyTier (US3 P2)', () => {
  it('returns TierResult with tier="bm25-only" and per-hit tier_used="bm25-only"', async () => {
    const input: SearchInput = { query: 'retrieval', limit: 20 };
    const controller = new AbortController();
    const result = await runBm25OnlyTier({
      input,
      db,
      topK: 64,
      signal: controller.signal,
    });
    expect(result.tier).toBe('bm25-only');
    expect(result.outcome).toBe('completed');
    expect(result.hits.length).toBeGreaterThan(0);
    for (const h of result.hits) {
      expect(h.tier_used).toBe('bm25-only');
    }
    expect(typeof result.elapsed_ms).toBe('number');
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 hits for non-matching queries (outcome=completed)', async () => {
    const input: SearchInput = { query: 'nonexistent_term_zzzzz', limit: 20 };
    const controller = new AbortController();
    const result = await runBm25OnlyTier({
      input,
      db,
      topK: 64,
      signal: controller.signal,
    });
    expect(result.tier).toBe('bm25-only');
    expect(result.outcome).toBe('completed');
    expect(result.hits.length).toBe(0);
  });

  it('honors pre-aborted signal with outcome="aborted"', async () => {
    const input: SearchInput = { query: 'retrieval', limit: 20 };
    const controller = new AbortController();
    controller.abort();
    const result = await runBm25OnlyTier({
      input,
      db,
      topK: 64,
      signal: controller.signal,
    });
    expect(result.tier).toBe('bm25-only');
    expect(result.outcome).toBe('aborted');
    expect(result.hits.length).toBe(0);
  });
});
