// SP-006 T018 — Unit test: classifyOrphan resumability-matrix dispatcher.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-002
//   - specs/006-hardening/contracts/adr-kill9-recovery.md §"Resumability Matrix"
//   - specs/006-hardening/data-model.md §"Entity 1 — RecoveryOrphan"
//   - Constitution X (Idempotent Pipeline Transitions)
//
// RED-phase: written before implementation. Verifies the matrix dispatch
// for ingest-file-present / ingest-file-absent / classify / embed / index /
// edges-build.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';
import {
  classifyOrphan,
  type RecoveryOrphan,
  type RecoveryDeps,
} from '../../packages/pipeline/src/recovery-resumability.js';
import { batchPolicy } from '../../packages/pipeline/src/policies.js';

function buildDeps(): RecoveryDeps {
  return {
    policy: batchPolicy,
    paths: Paths,
    logger: { warn: () => undefined },
  };
}

beforeEach(() => {
  // Ensure clean inbox.
  const inbox = Paths.inbox();
  if (fs.existsSync(inbox)) {
    for (const f of fs.readdirSync(inbox)) {
      try { fs.unlinkSync(path.join(inbox, f)); } catch { /* ignore */ }
    }
  } else {
    fs.mkdirSync(inbox, { recursive: true });
  }
});

describe('classifyOrphan — resumability matrix', () => {
  it('exports classifyOrphan', () => {
    expect(typeof classifyOrphan).toBe('function');
  });

  it('stage=ingest + inbox file present → resumable with requeue thunk', () => {
    const inbox = Paths.inbox();
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, 'a.md'), '# Test\nbody');
    const orphan: RecoveryOrphan = {
      doc_id: null,
      stage: 'ingest',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      inbox_file: 'a.md',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(true);
    if (resolution.resumable) {
      expect(typeof resolution.requeue).toBe('function');
    }
  });

  it('stage=ingest + inbox file absent → non-resumable with sidecarReason', () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'ingest',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      inbox_file: 'never-existed.md',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(false);
    if (!resolution.resumable) {
      expect(resolution.sidecarReason).toMatch(/inbox|missing|absent/i);
    }
  });

  it('stage=ingest with no inbox_file is non-resumable', () => {
    const orphan: RecoveryOrphan = {
      doc_id: null,
      stage: 'ingest',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(false);
  });

  it('stage=classify → always resumable (Constitution X idempotency)', () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'classify',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(true);
    if (resolution.resumable) {
      expect(typeof resolution.requeue).toBe('function');
    }
  });

  it('stage=embed → always resumable', () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'embed',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(true);
  });

  it('stage=index → always resumable', () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'index',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(true);
  });

  it('stage=edges-build → always resumable', () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'edges-build',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      resumable: false,
    };
    const resolution = classifyOrphan(orphan, buildDeps());
    expect(resolution.resumable).toBe(true);
  });
});
