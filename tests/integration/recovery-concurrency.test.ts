// SP-006 T022/T029 — Integration test: recovery scan + concurrent drain
// invocations observe the drain-lock and emit pipeline.lock_contention.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-006, SC-HARDEN-015
//   - Constitution IX (Concurrency-Safe Shared State)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';
import { runRecoveryScan } from '../../packages/pipeline/src/recovery-scanner.js';
import { batchPolicy } from '../../packages/pipeline/src/policies.js';

beforeEach(() => {
  const telemetryPath = Paths.telemetry();
  if (fs.existsSync(telemetryPath)) fs.unlinkSync(telemetryPath);
  const lockPath = Paths.drainLock();
  if (fs.existsSync(lockPath)) {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
});

describe('recovery scan — drain-lock contention', () => {
  it('second concurrent recovery scan emits scan_skipped lock_contention', async () => {
    const telemetryPath = Paths.telemetry();
    fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
    fs.writeFileSync(
      telemetryPath,
      JSON.stringify({
        event: 'daemon.started',
        timestamp: '2026-05-13T09:00:00Z',
        severity: 'info',
        outcome: 'success',
        pid: 1,
      }) + '\n' +
      JSON.stringify({
        event: 'classify.started',
        timestamp: '2026-05-13T09:01:00Z',
        doc_id: 'doc-aaaaaaaa',
      }) + '\n',
    );

    // Simulate a foreign holder by writing this process's PID to the lock
    // (the same-pid check in acquireDrainLock returns the lock; we want
    // contention behavior, so simulate a different live PID — we use PPID
    // which should be alive but distinct from process.pid).
    const lockPath = Paths.drainLock();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.ppid));
    try {
      const result = await runRecoveryScan(
        { policy: batchPolicy, paths: Paths, logger: { warn: () => undefined } },
        new AbortController().signal,
      );
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('lock_contention');
      const events = fs
        .readFileSync(telemetryPath, 'utf8')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { event: string; [k: string]: unknown });
      const skipped = events.find(
        (e) => e.event === 'recovery.scan_skipped' && e['reason'] === 'lock_contention',
      );
      expect(skipped).toBeDefined();
    } finally {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  });
});
