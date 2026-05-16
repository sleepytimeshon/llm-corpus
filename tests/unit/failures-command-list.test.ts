// SP-007 T070 — Unit test for `corpus failures list` CLI.
//
// References:
//   - specs/007-install-first-run/tasks.md T070 / T073
//   - specs/007-install-first-run/spec.md NFR-006, SC-007-023
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution V (Zod), VII (no Promise.race), XI (CLI exits only)
//
// The CLI is a thin human-operator surface over `Paths.failed()`. It reads
// the SP-006 / SP-003 sidecars directly — NOT via the corpus://failures MCP
// resource — because the MCP resource is for AI agents and spawning an MCP
// server for a read-only CLI lookup violates Constitution VII budgeting.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runFailuresList } from '../../packages/cli/src/failures-command.js';

interface SidecarPayload {
  doc_id: string | null;
  stage: string;
  error_code: string;
  message: string;
  timestamp: string;
  retriable: boolean;
}

async function makeTempHome(): Promise<{ home: string; failedDir: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-failures-list-'));
  // CORPUS_HOME = <home> → Paths.data() = <home>/data; Paths.failed() = <home>/data/docs/failed
  const failedDir = path.join(home, 'data', 'docs', 'failed');
  await fs.mkdir(failedDir, { recursive: true });
  return { home, failedDir };
}

async function writeSidecar(
  failedDir: string,
  filename: string,
  payload: SidecarPayload,
): Promise<string> {
  const p = path.join(failedDir, filename);
  await fs.writeFile(p, JSON.stringify(payload, null, 2), 'utf8');
  return p;
}

describe('SP-007 T070 — runFailuresList', () => {
  let prev: string | undefined;
  let home: string;
  let failedDir: string;

  beforeEach(async () => {
    prev = process.env.CORPUS_HOME;
    const t = await makeTempHome();
    home = t.home;
    failedDir = t.failedDir;
    process.env.CORPUS_HOME = home;
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prev;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('lists no entries when failed/ is empty', async () => {
    const res = await runFailuresList({ json: true }, new AbortController().signal);
    expect(res.entries).toEqual([]);
    expect(res.total_count).toBe(0);
    expect(res.returned_count).toBe(0);
  });

  it('lists no entries when failed/ does not exist (ENOENT)', async () => {
    await fs.rm(failedDir, { recursive: true, force: true });
    const res = await runFailuresList({ json: true }, new AbortController().signal);
    expect(res.entries).toEqual([]);
    expect(res.total_count).toBe(0);
  });

  it('reads both *.error.json and *.recovery.error.json sidecars', async () => {
    await writeSidecar(failedDir, 'doc-aaaaaaaa.error.json', {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'unknown domain term',
      timestamp: '2026-05-10T10:00:00Z',
      retriable: true,
    });
    await writeSidecar(failedDir, 'doc-bbbbbbbb.recovery.error.json', {
      doc_id: 'doc-bbbbbbbb',
      stage: 'unrecoverable_orphan',
      error_code: 'recovery_failed',
      message: 'no resume marker',
      timestamp: '2026-05-11T10:00:00Z',
      retriable: false,
    });
    const res = await runFailuresList({ json: true }, new AbortController().signal);
    expect(res.total_count).toBe(2);
    expect(res.returned_count).toBe(2);
    const docIds = res.entries.map((e) => e.doc_id).sort();
    expect(docIds).toEqual(['doc-aaaaaaaa', 'doc-bbbbbbbb']);
  });

  it('sorts entries descending by timestamp', async () => {
    await writeSidecar(failedDir, 'doc-11111111.error.json', {
      doc_id: 'doc-11111111',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'old',
      timestamp: '2026-05-01T10:00:00Z',
      retriable: true,
    });
    await writeSidecar(failedDir, 'doc-22222222.error.json', {
      doc_id: 'doc-22222222',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'newest',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    });
    await writeSidecar(failedDir, 'doc-33333333.error.json', {
      doc_id: 'doc-33333333',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'middle',
      timestamp: '2026-05-06T10:00:00Z',
      retriable: true,
    });
    const res = await runFailuresList({ json: true }, new AbortController().signal);
    expect(res.entries[0].doc_id).toBe('doc-22222222');
    expect(res.entries[1].doc_id).toBe('doc-33333333');
    expect(res.entries[2].doc_id).toBe('doc-11111111');
  });

  it('filters by stage', async () => {
    await writeSidecar(failedDir, 'doc-aaaaaaaa.error.json', {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'm1',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    });
    await writeSidecar(failedDir, 'doc-bbbbbbbb.error.json', {
      doc_id: 'doc-bbbbbbbb',
      stage: 'embed',
      error_code: 'embed_failed',
      message: 'm2',
      timestamp: '2026-05-11T10:00:00Z',
      retriable: true,
    });
    const res = await runFailuresList(
      { json: true, stage: 'classify' },
      new AbortController().signal,
    );
    expect(res.total_count).toBe(1);
    expect(res.entries[0].doc_id).toBe('doc-aaaaaaaa');
  });

  it('filters by since (ISO-8601)', async () => {
    await writeSidecar(failedDir, 'doc-aaaaaaaa.error.json', {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'old',
      timestamp: '2026-05-01T10:00:00Z',
      retriable: true,
    });
    await writeSidecar(failedDir, 'doc-bbbbbbbb.error.json', {
      doc_id: 'doc-bbbbbbbb',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'new',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    });
    const res = await runFailuresList(
      { json: true, since: '2026-05-10T00:00:00Z' },
      new AbortController().signal,
    );
    expect(res.total_count).toBe(1);
    expect(res.entries[0].doc_id).toBe('doc-bbbbbbbb');
  });

  it('paginates by limit + offset', async () => {
    for (let i = 0; i < 5; i++) {
      await writeSidecar(failedDir, `doc-0000000${i}.error.json`, {
        doc_id: `doc-0000000${i}`,
        stage: 'classify',
        error_code: 'vocab_violation',
        message: `m${i}`,
        timestamp: `2026-05-0${i + 1}T10:00:00Z`,
        retriable: true,
      });
    }
    const res = await runFailuresList(
      { json: true, limit: 2, offset: 1 },
      new AbortController().signal,
    );
    expect(res.total_count).toBe(5);
    expect(res.returned_count).toBe(2);
    // descending by timestamp: doc-00000004 (newest), doc-00000003, ...
    // offset 1 limit 2 → [doc-00000003, doc-00000002]
    expect(res.entries.map((e) => e.doc_id)).toEqual([
      'doc-00000003',
      'doc-00000002',
    ]);
  });

  it('skips malformed sidecars (no throw)', async () => {
    await writeSidecar(failedDir, 'doc-aaaaaaaa.error.json', {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      error_code: 'ok',
      message: 'good',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    });
    await fs.writeFile(
      path.join(failedDir, 'doc-bbbbbbbb.error.json'),
      'not json',
      'utf8',
    );
    const res = await runFailuresList({ json: true }, new AbortController().signal);
    expect(res.total_count).toBe(1);
    expect(res.entries[0].doc_id).toBe('doc-aaaaaaaa');
  });
});
