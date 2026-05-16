// SP-007 T075 — Integration test: failure-lane CLI triage with ≥ 10 distinct
// error_codes.
//
// References:
//   - specs/007-install-first-run/tasks.md T075
//   - specs/007-install-first-run/execution-journal.md (S-1 through S-12)
//   - specs/007-install-first-run/spec.md NFR-006, SC-007-023, SC-007-024
//
// Drives each failure mode from the execution journal against fixture
// sidecars; asserts `corpus failures show <doc-id>` reveals the failure
// mode and that `corpus failures list` surfaces all of them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import {
  runFailuresList,
  runFailuresShow,
} from '../../packages/cli/src/failures-command.js';

interface ScenarioSpec {
  doc_id: string;
  stage:
    | 'validation'
    | 'hash'
    | 'normalize'
    | 'persist'
    | 'classify'
    | 'embed'
    | 'index'
    | 'edges-build'
    | 'ingest'
    | 'unrecoverable_orphan';
  error_code: string;
  message: string;
  retriable: boolean;
  isRecoverySidecar?: boolean;
}

const SCENARIOS: readonly ScenarioSpec[] = [
  // 1. classify - vocab violation (domain) — primary triage scenario.
  {
    doc_id: 'doc-00000001',
    stage: 'classify',
    error_code: 'vocab_violation',
    message: 'unknown domain term: climbing',
    retriable: true,
  },
  // 2. classify - vocab violation (type).
  {
    doc_id: 'doc-00000002',
    stage: 'classify',
    error_code: 'vocab_violation',
    message: 'unknown type term: photo-essay',
    retriable: true,
  },
  // 3. validation - frontmatter invalid.
  {
    doc_id: 'doc-00000003',
    stage: 'validation',
    error_code: 'frontmatter_invalid',
    message: 'missing required field: title',
    retriable: true,
  },
  // 4. hash - duplicate.
  {
    doc_id: 'doc-00000004',
    stage: 'hash',
    error_code: 'duplicate_doc',
    message: 'duplicate hash collides with doc-aaaaaaaa',
    retriable: false,
  },
  // 5. normalize - extraction failed.
  {
    doc_id: 'doc-00000005',
    stage: 'normalize',
    error_code: 'extraction_failed',
    message: 'unable to extract plain text from binary body',
    retriable: false,
  },
  // 6. persist - unique constraint.
  {
    doc_id: 'doc-00000006',
    stage: 'persist',
    error_code: 'unique_constraint_violation',
    message: 'documents.id collision',
    retriable: false,
  },
  // 7. embed - embedder unavailable.
  {
    doc_id: 'doc-00000007',
    stage: 'embed',
    error_code: 'embedder_unavailable',
    message: 'connect ECONNREFUSED 127.0.0.1:11434',
    retriable: true,
  },
  // 8. index - WAL write failure.
  {
    doc_id: 'doc-00000008',
    stage: 'index',
    error_code: 'index_write_failed',
    message: 'SQLITE_FULL: database or disk is full',
    retriable: true,
  },
  // 9. edges-build - graph failure.
  {
    doc_id: 'doc-00000009',
    stage: 'edges-build',
    error_code: 'edges_build_failed',
    message: 'RRF fusion failed for doc-00000009',
    retriable: true,
  },
  // 10. unrecoverable_orphan (recovery sidecar).
  {
    doc_id: 'doc-0000000a',
    stage: 'unrecoverable_orphan',
    error_code: 'recovery_failed',
    message: 'body file missing for resumable sentinel',
    retriable: false,
    isRecoverySidecar: true,
  },
  // 11. ingest - generic.
  {
    doc_id: 'doc-0000000b',
    stage: 'ingest',
    error_code: 'ingest_failed',
    message: 'unable to read inbox file (EACCES)',
    retriable: true,
  },
];

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-triage-cli-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.failed(), { recursive: true });
  return d;
}

async function writeAllSidecars(): Promise<void> {
  const dir = Paths.failed();
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    const suffix = s.isRecoverySidecar ? '.recovery.error.json' : '.error.json';
    const payload = {
      doc_id: s.doc_id,
      stage: s.stage,
      error_code: s.error_code,
      message: s.message,
      // Spread timestamps so the descending-sort assertion is deterministic.
      timestamp: `2026-05-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
      retriable: s.retriable,
    };
    await fs.writeFile(
      path.join(dir, `${s.doc_id}${suffix}`),
      JSON.stringify(payload),
      'utf8',
    );
  }
}

describe('SP-007 T075 — failure-lane CLI triage integration', () => {
  let prev: string | undefined;
  let home: string;

  beforeEach(async () => {
    prev = process.env.CORPUS_HOME;
    home = await tempdir();
    await writeAllSidecars();
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prev;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('surfaces ≥ 10 distinct error_codes via failures list', async () => {
    const res = await runFailuresList(
      { json: true, limit: 100 },
      new AbortController().signal,
    );
    expect(res.total_count).toBe(SCENARIOS.length);
    expect(res.returned_count).toBe(SCENARIOS.length);
    const codes = new Set(res.entries.map((e) => e.error_code));
    expect(codes.size).toBeGreaterThanOrEqual(10);
  });

  it('returns the matching sidecar for every scenario via failures show', async () => {
    for (const s of SCENARIOS) {
      const shown = await runFailuresShow(
        { doc_id: s.doc_id },
        new AbortController().signal,
      );
      expect(shown.entry, `doc_id=${s.doc_id}`).not.toBeNull();
      expect(shown.entry?.stage, `doc_id=${s.doc_id}`).toBe(s.stage);
      expect(shown.entry?.error_code, `doc_id=${s.doc_id}`).toBe(s.error_code);
      expect(shown.entry?.message, `doc_id=${s.doc_id}`).toBe(s.message);
    }
  });

  it('filters by stage', async () => {
    const res = await runFailuresList(
      { json: true, stage: 'classify' },
      new AbortController().signal,
    );
    const classifyCount = SCENARIOS.filter((s) => s.stage === 'classify').length;
    expect(res.total_count).toBe(classifyCount);
    expect(res.entries.every((e) => e.stage === 'classify')).toBe(true);
  });

  it('filters by since (ISO-8601)', async () => {
    const res = await runFailuresList(
      { json: true, since: '2026-05-15T00:00:00Z', limit: 100 },
      new AbortController().signal,
    );
    // Scenarios indexed i=5 onward have timestamps >= 2026-05-15.
    const expectedAfter = SCENARIOS.filter(
      (_, i) => Date.parse(`2026-05-${String(10 + i).padStart(2, '0')}T10:00:00Z`) >=
        Date.parse('2026-05-15T00:00:00Z'),
    ).length;
    expect(res.total_count).toBe(expectedAfter);
  });

  it('returns null entry for an unknown doc-id', async () => {
    const res = await runFailuresShow(
      { doc_id: 'doc-deadbeef' },
      new AbortController().signal,
    );
    expect(res.entry).toBeNull();
  });

  it('reads both *.error.json and *.recovery.error.json sidecars', async () => {
    const res = await runFailuresList(
      { json: true, limit: 100 },
      new AbortController().signal,
    );
    const hasOrphan = res.entries.some(
      (e) => e.stage === 'unrecoverable_orphan',
    );
    expect(hasOrphan).toBe(true);
  });
});
