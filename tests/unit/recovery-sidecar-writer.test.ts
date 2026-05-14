// SP-006 T019 — Unit test: .recovery.error.json sidecar writer.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-002, SC-HARDEN-004
//   - specs/006-hardening/data-model.md §"Paths.failed() + '/<doc-id>.recovery.error.json'"
//   - Constitution V (Schema), Constitution VIII (Atomic writes), Constitution X
//
// RED-phase: written before implementation.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';
import {
  writeRecoverySidecar,
  type RecoveryOrphan,
} from '../../packages/pipeline/src/recovery-resumability.js';

beforeEach(() => {
  const failed = Paths.failed();
  if (fs.existsSync(failed)) {
    for (const f of fs.readdirSync(failed)) {
      try { fs.unlinkSync(path.join(failed, f)); } catch { /* ignore */ }
    }
  } else {
    fs.mkdirSync(failed, { recursive: true });
  }
});

describe('writeRecoverySidecar — .recovery.error.json schema + idempotence', () => {
  it('exports writeRecoverySidecar', () => {
    expect(typeof writeRecoverySidecar).toBe('function');
  });

  it('writes <doc-id>.recovery.error.json with the SP-006 schema', async () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-aaaaaaaa',
      stage: 'ingest',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      inbox_file: 'a.md',
      resumable: false,
    };
    await writeRecoverySidecar(orphan, 'inbox file absent during kill window', Paths);
    const sidecarPath = path.join(Paths.failed(), 'doc-aaaaaaaa.recovery.error.json');
    expect(fs.existsSync(sidecarPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as {
      doc_id: string;
      stage: string;
      error_code: string;
      message: string;
      timestamp: string;
      retriable: boolean;
    };
    expect(content.doc_id).toBe('doc-aaaaaaaa');
    expect(content.stage).toBe('ingest');
    expect(content.error_code).toBe('unrecoverable_orphan');
    expect(typeof content.message).toBe('string');
    expect(typeof content.timestamp).toBe('string');
    expect(content.retriable).toBe(false);
  });

  it('idempotent re-write produces the same on-disk content (modulo timestamp)', async () => {
    const orphan: RecoveryOrphan = {
      doc_id: 'doc-bbbbbbbb',
      stage: 'classify',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      resumable: false,
    };
    await writeRecoverySidecar(orphan, 'test reason', Paths);
    const sidecarPath = path.join(Paths.failed(), 'doc-bbbbbbbb.recovery.error.json');
    const first = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
    await writeRecoverySidecar(orphan, 'test reason', Paths);
    const second = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
    // doc_id / stage / error_code / message / retriable must match.
    expect(second.doc_id).toBe(first.doc_id);
    expect(second.stage).toBe(first.stage);
    expect(second.error_code).toBe(first.error_code);
    expect(second.message).toBe(first.message);
    expect(second.retriable).toBe(first.retriable);
  });

  it('handles missing doc_id by using a stable fallback name', async () => {
    const orphan: RecoveryOrphan = {
      doc_id: null,
      stage: 'ingest',
      started_ts: '2026-05-13T09:01:00Z',
      last_seen_ts: '2026-05-13T09:01:00Z',
      inbox_file: 'orphan-noid.md',
      resumable: false,
    };
    await writeRecoverySidecar(orphan, 'no doc_id', Paths);
    // Some sidecar file should exist for the orphan in the failed dir.
    const entries = fs.readdirSync(Paths.failed()).filter((f) => f.endsWith('.recovery.error.json'));
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});
