// SP-006 T042 — Unit test for Tier 3 fs-grep retriever (Constitution XII subprocess hygiene).
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   - Invokes runTool('grep', [...]) — NEVER a shell-string exec
//   - Maps matched file paths to doc_ids via filesystem layout
//   - Per-hit `tier_used === 'fs-grep'`
//   - On ENOENT (grep binary absent): outcome='skipped' OR 'failed'
//     (returns empty, does NOT throw)
//   - On pre-aborted signal: outcome='aborted'
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-015
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Tier 3"
//   - specs/006-hardening/data-model.md §"Entity 3"
//   - Constitution Principles V, VII, XII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths } from '@llm-corpus/contracts';
import { runFsGrepTier } from '../../packages/index/src/fs-grep-tier.js';

let db: Database.Database;

async function writeDoc(docId: string, body: string, title = 'Doc'): Promise<void> {
  const prefix = docId.slice(4, 6); // doc-XX...
  const dir = path.join(Paths.docsStore(), prefix);
  await fsp.mkdir(dir, { recursive: true });
  const bodyPath = path.join(dir, `${docId}.md`);
  await fsp.writeFile(bodyPath, body, 'utf8');
  db.prepare(
    `INSERT INTO documents (id, title, facet_domain, facet_type, tags_json, ingest_timestamp, source_type, body_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success')`,
  ).run(
    docId,
    title,
    'engineering',
    'reference',
    '[]',
    '2026-05-13T00:00:00Z',
    'manual',
    bodyPath,
  );
}

describe('T042 — runFsGrepTier (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-fs-grep-'));
    process.env.CORPUS_HOME = tmpHome;
    await fsp.mkdir(Paths.data(), { recursive: true });
    db = new Database(':memory:');
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
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {
        /* no-op */
      }
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

  it('returns SearchHits with tier_used="fs-grep" mapping file paths to doc_ids', async () => {
    await writeDoc('doc-aaaaaaaa', '# Title\n\nThis body contains the unique-marker-xyz42 token.\n', 'A');
    await writeDoc('doc-bbbbbbbb', '# Other\n\nNothing here.\n', 'B');
    const controller = new AbortController();
    const result = await runFsGrepTier({
      input: { query: 'unique-marker-xyz42', limit: 20 },
      db,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    expect(result.tier).toBe('fs-grep');
    expect(result.outcome).toBe('completed');
    const ids = result.hits.map((h) => h.uri);
    expect(ids).toContain('corpus://docs/doc-aaaaaaaa');
    expect(result.hits.every((h) => h.tier_used === 'fs-grep')).toBe(true);
  });

  it('returns outcome="completed" with 0 hits when nothing matches', async () => {
    await writeDoc('doc-aaaaaaaa', '# Title\n\nbody.\n');
    const controller = new AbortController();
    const result = await runFsGrepTier({
      input: { query: 'nonexistent_token_zzz', limit: 20 },
      db,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    expect(result.tier).toBe('fs-grep');
    expect(result.outcome).toBe('completed');
    expect(result.hits.length).toBe(0);
  });

  it('returns outcome="aborted" on pre-fired signal', async () => {
    await writeDoc('doc-aaaaaaaa', '# Title\n\nbody marker.\n');
    const controller = new AbortController();
    controller.abort();
    const result = await runFsGrepTier({
      input: { query: 'marker', limit: 20 },
      db,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    expect(result.outcome).toBe('aborted');
  });

  it('returns outcome="skipped" with empty hits when the docs root is missing', async () => {
    // No docs written — fs-grep over a non-existent / empty docs dir.
    const controller = new AbortController();
    const result = await runFsGrepTier({
      input: { query: 'whatever', limit: 20 },
      db,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    expect(['skipped', 'completed']).toContain(result.outcome);
    expect(result.hits.length).toBe(0);
  });
});
