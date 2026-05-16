// SP-007 T071 — Unit test for `corpus failures show <doc-id>` CLI.
//
// References:
//   - specs/007-install-first-run/tasks.md T071 / T073
//   - specs/007-install-first-run/spec.md NFR-006, SC-007-023
//   - Constitution V (Zod), XI (CLI exits only)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runFailuresShow } from '../../packages/cli/src/failures-command.js';

async function makeTempHome(): Promise<{ home: string; failedDir: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-failures-show-'));
  // CORPUS_HOME = <home> → Paths.data() = <home>/data; Paths.failed() = <home>/data/docs/failed
  const failedDir = path.join(home, 'data', 'docs', 'failed');
  await fs.mkdir(failedDir, { recursive: true });
  return { home, failedDir };
}

describe('SP-007 T071 — runFailuresShow', () => {
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

  it('returns the matching sidecar entry for *.error.json', async () => {
    const payload = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      error_code: 'vocab_violation',
      message: 'unknown domain term: surfing',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    };
    await fs.writeFile(
      path.join(failedDir, 'doc-aaaaaaaa.error.json'),
      JSON.stringify(payload),
      'utf8',
    );
    const res = await runFailuresShow(
      { doc_id: 'doc-aaaaaaaa' },
      new AbortController().signal,
    );
    expect(res.entry.doc_id).toBe('doc-aaaaaaaa');
    expect(res.entry.stage).toBe('classify');
    expect(res.entry.error_code).toBe('vocab_violation');
    expect(res.entry.sidecar_path).toContain('doc-aaaaaaaa.error.json');
  });

  it('returns the matching sidecar entry for *.recovery.error.json', async () => {
    const payload = {
      doc_id: 'doc-cccccccc',
      stage: 'unrecoverable_orphan',
      error_code: 'recovery_failed',
      message: 'orphaned doc-cccccccc',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: false,
    };
    await fs.writeFile(
      path.join(failedDir, 'doc-cccccccc.recovery.error.json'),
      JSON.stringify(payload),
      'utf8',
    );
    const res = await runFailuresShow(
      { doc_id: 'doc-cccccccc' },
      new AbortController().signal,
    );
    expect(res.entry.doc_id).toBe('doc-cccccccc');
    expect(res.entry.stage).toBe('unrecoverable_orphan');
    expect(res.entry.sidecar_path).toContain('doc-cccccccc.recovery.error.json');
  });

  it('returns null entry when doc-id is absent', async () => {
    const res = await runFailuresShow(
      { doc_id: 'doc-missing0' },
      new AbortController().signal,
    );
    expect(res.entry).toBeNull();
  });

  it('returns null when failed/ dir does not exist (ENOENT)', async () => {
    await fs.rm(failedDir, { recursive: true, force: true });
    const res = await runFailuresShow(
      { doc_id: 'doc-aaaaaaaa' },
      new AbortController().signal,
    );
    expect(res.entry).toBeNull();
  });

  it('skips malformed sidecars and continues searching', async () => {
    await fs.writeFile(
      path.join(failedDir, 'doc-bad00000.error.json'),
      'not json',
      'utf8',
    );
    const good = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      error_code: 'ok',
      message: 'good',
      timestamp: '2026-05-12T10:00:00Z',
      retriable: true,
    };
    await fs.writeFile(
      path.join(failedDir, 'doc-aaaaaaaa.error.json'),
      JSON.stringify(good),
      'utf8',
    );
    const res = await runFailuresShow(
      { doc_id: 'doc-aaaaaaaa' },
      new AbortController().signal,
    );
    expect(res.entry?.doc_id).toBe('doc-aaaaaaaa');
  });
});
