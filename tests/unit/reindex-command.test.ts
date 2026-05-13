// SP-005 T057-T059 — Contract tests for reindex-command.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-012, FR-RETRIEVAL-018,
//     SC-RETRIEVAL-006, SC-RETRIEVAL-015

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runSchemaMigration } from '../../packages/storage/src/schema-migration.js';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import {
  runReindexCommand,
  parseReindexArgs,
} from '../../packages/cli/src/reindex-command.js';
import { interactivePolicy } from '../../packages/pipeline/src/policies.js';
import type { EmbeddingAdapter } from '../../packages/inference/src/embedding-adapter.js';
import { ok } from '../../packages/contracts/src/result.js';

let corpusRoot: string;

beforeEach(() => {
  corpusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp005-reindex-'));
  process.env.CORPUS_HOME = corpusRoot;
  // Seed an index.db file in corpus data dir with the SP-002/004/005 schema.
  const dataDir = path.join(corpusRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'index.db');
  const db = new Database(dbPath);
  sqliteVec.load(db);
  runSchemaMigration(db);
  runSp005Migration(db);
  // Seed a classified row + a body file so embed-stage can read it.
  const bodyContent = '---\nsummary: test summary\n---\n\nbody content here';
  const docsDir = path.join(dataDir, 'docs', 'store', 'aa');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    path.join(docsDir, 'doc-aaaaaaaa.md'),
    bodyContent,
    'utf8',
  );
  db.prepare(
    `INSERT INTO documents (id, title, body_path, source_path,
                            facet_domain, tags_json, facet_type,
                            source_type, mime_type, hash, ingest_timestamp, status)
       VALUES (?, 'Test Doc', 'store/aa/doc-aaaaaaaa.md', 'inbox/x.md',
               'test-domain', '["a","b"]', 'concept', 'article',
               'text/markdown', 'h1', ?, 'success')`,
  ).run('doc-aaaaaaaa', new Date().toISOString());
  db.close();
});

afterEach(() => {
  delete process.env.CORPUS_HOME;
  fs.rmSync(corpusRoot, { recursive: true, force: true });
});

function mockEmbedder(): EmbeddingAdapter {
  return {
    model: 'mock',
    endpoint: 'http://localhost:11434/api/embeddings',
    expectedDim: 768,
    async embedDocument(): Promise<{ ok: true; value: Float32Array }> {
      return ok(new Float32Array(768));
    },
    async embedQuery(): Promise<{ ok: true; value: Float32Array }> {
      return ok(new Float32Array(768));
    },
  } as unknown as EmbeddingAdapter;
}

describe('reindex-command', () => {
  it('parseReindexArgs detects --dry-run', () => {
    expect(parseReindexArgs([])).toEqual({ dryRun: false });
    expect(parseReindexArgs(['--dry-run'])).toEqual({ dryRun: true });
  });

  it('backfills documents_fts + vec for classified-but-unindexed rows', async () => {
    const r = await runReindexCommand({
      args: { dryRun: false },
      policy: interactivePolicy,
      signal: new AbortController().signal,
      embeddingAdapterOverride: mockEmbedder(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.indexed).toBe(1);
    expect(r.value.failed).toBe(0);
    expect(r.value.skipped).toBe(0);

    // Verify both rows landed.
    const dbPath = path.join(corpusRoot, 'data', 'index.db');
    const db = new Database(dbPath, { readonly: true });
    sqliteVec.load(db);
    try {
      const fts = (
        db.prepare(`SELECT COUNT(*) AS n FROM documents_fts`).get() as {
          n: number;
        }
      ).n;
      const vec = (
        db.prepare(`SELECT COUNT(*) AS n FROM documents_vec`).get() as {
          n: number;
        }
      ).n;
      expect(fts).toBe(1);
      expect(vec).toBe(1);
    } finally {
      db.close();
    }
  });

  it('--dry-run issues zero Ollama HTTP calls + zero SQL writes', async () => {
    let calls = 0;
    const trapAdapter = {
      model: 'mock',
      endpoint: 'http://localhost:11434/api/embeddings',
      expectedDim: 768,
      async embedDocument(): Promise<unknown> {
        calls += 1;
        return ok(new Float32Array(768));
      },
      async embedQuery(): Promise<unknown> {
        calls += 1;
        return ok(new Float32Array(768));
      },
    } as unknown as EmbeddingAdapter;

    const r = await runReindexCommand({
      args: { dryRun: true },
      policy: interactivePolicy,
      signal: new AbortController().signal,
      embeddingAdapterOverride: trapAdapter,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.dryRun).toBe(true);
    expect(r.value.skipped).toBe(1);
    expect(r.value.indexed).toBe(0);
    expect(calls).toBe(0);

    // Verify ZERO new rows in documents_fts / vec.
    const dbPath = path.join(corpusRoot, 'data', 'index.db');
    const db = new Database(dbPath, { readonly: true });
    sqliteVec.load(db);
    try {
      const fts = (
        db.prepare(`SELECT COUNT(*) AS n FROM documents_fts`).get() as {
          n: number;
        }
      ).n;
      const vec = (
        db.prepare(`SELECT COUNT(*) AS n FROM documents_vec`).get() as {
          n: number;
        }
      ).n;
      expect(fts).toBe(0);
      expect(vec).toBe(0);
    } finally {
      db.close();
    }
  });

  it('idempotency — re-running on fully-indexed corpus is a no-op (zero Ollama calls)', async () => {
    // First pass — indexes the row.
    let calls = 0;
    const adapter = {
      model: 'mock',
      endpoint: 'http://localhost:11434/api/embeddings',
      expectedDim: 768,
      async embedDocument(): Promise<unknown> {
        calls += 1;
        return ok(new Float32Array(768));
      },
      async embedQuery(): Promise<unknown> {
        calls += 1;
        return ok(new Float32Array(768));
      },
    } as unknown as EmbeddingAdapter;

    await runReindexCommand({
      args: { dryRun: false },
      policy: interactivePolicy,
      signal: new AbortController().signal,
      embeddingAdapterOverride: adapter,
    });
    expect(calls).toBeGreaterThan(0);

    // Reset call counter; re-run; expect zero new calls + indexed=0.
    calls = 0;
    const r = await runReindexCommand({
      args: { dryRun: false },
      policy: interactivePolicy,
      signal: new AbortController().signal,
      embeddingAdapterOverride: adapter,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.indexed).toBe(0);
    expect(r.value.failed).toBe(0);
    expect(calls).toBe(0);
  });
});
