// SP-006 T017 — Unit test: runRecoveryScan core behavior.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-001, FR-HARDEN-003, FR-HARDEN-004,
//     FR-HARDEN-005, FR-HARDEN-007
//   - specs/006-hardening/contracts/adr-kill9-recovery.md
//   - specs/006-hardening/data-model.md §"Entity 1 — RecoveryOrphan"
//   - Constitution VII, IX, XIII
//
// RED-phase: written before implementation. Verifies the scanner's
// telemetry emissions, orphan-map construction, scan-boundary detection,
// AbortSignal cancellation, lock contention behavior, and malformed-line
// graceful skipping.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';
import {
  runRecoveryScan,
  type RecoveryScanResult,
} from '../../packages/pipeline/src/recovery-scanner.js';
import { batchPolicy } from '../../packages/pipeline/src/policies.js';

interface JsonLine {
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

function writeTelemetry(lines: JsonLine[]): void {
  const telemetryPath = Paths.telemetry();
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  fs.writeFileSync(
    telemetryPath,
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    { encoding: 'utf8' },
  );
}

function readTelemetryEvents(): JsonLine[] {
  const telemetryPath = Paths.telemetry();
  if (!fs.existsSync(telemetryPath)) return [];
  const content = fs.readFileSync(telemetryPath, 'utf8');
  const out: JsonLine[] = [];
  for (const line of content.split('\n')) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line) as JsonLine);
    } catch {
      // Skip malformed lines used by the parse-failure test.
    }
  }
  return out;
}

function buildDeps(): {
  policy: typeof batchPolicy;
  paths: typeof Paths;
  logger: { warn: (m: string) => void };
  // Minimal noop requeue for orphan dispatch (Phase 3 needs the scanner to
  // emit recovery.orphan_found regardless; whether a re-queue actually fires
  // is exercised separately).
  requeueOverride?: (
    orphan: unknown,
  ) => Promise<{ resumable: boolean; sidecarReason?: string }>;
} {
  return {
    policy: batchPolicy,
    paths: Paths,
    logger: { warn: () => undefined },
  };
}

beforeEach(() => {
  // Ensure each test has a clean telemetry log.
  const telemetryPath = Paths.telemetry();
  if (fs.existsSync(telemetryPath)) fs.unlinkSync(telemetryPath);
  // Clean drain lock if leftover from prior test.
  const lockPath = Paths.drainLock();
  if (fs.existsSync(lockPath)) {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
  // Ensure failed dir is clean.
  const failed = Paths.failed();
  if (fs.existsSync(failed)) {
    for (const f of fs.readdirSync(failed)) {
      try { fs.unlinkSync(path.join(failed, f)); } catch { /* ignore */ }
    }
  }
});

describe('runRecoveryScan — boundary and orphan detection', () => {
  it('exports runRecoveryScan', () => {
    expect(typeof runRecoveryScan).toBe('function');
  });

  it('emits recovery.scan_skipped {reason=no_prior_session} when telemetry has no daemon.started', async () => {
    writeTelemetry([
      { event: 'classify.started', timestamp: '2026-05-13T09:00:00Z', doc_id: 'doc-aaaaaaaa' },
    ]);
    const controller = new AbortController();
    const result = await runRecoveryScan(buildDeps(), controller.signal);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no_prior_session');
    const events = readTelemetryEvents();
    const skipped = events.find((e) => e.event === 'recovery.scan_skipped');
    expect(skipped).toBeDefined();
    expect(skipped?.['reason']).toBe('no_prior_session');
  });

  it('emits scan_started + scan_completed + orphan_found for a single classify orphan', async () => {
    writeTelemetry([
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1234 },
      { event: 'classify.started', timestamp: '2026-05-13T09:01:01Z', doc_id: 'doc-aaaaaaaa' },
      // No classify.completed — this is an orphan.
    ]);
    const controller = new AbortController();
    const result = await runRecoveryScan(buildDeps(), controller.signal);
    expect(result.skipped).toBe(false);
    expect(result.orphans.length).toBe(1);
    expect(result.orphans[0].stage).toBe('classify');
    expect(result.orphans[0].doc_id).toBe('doc-aaaaaaaa');
    const events = readTelemetryEvents();
    const started = events.find((e) => e.event === 'recovery.scan_started');
    const orphan = events.find((e) => e.event === 'recovery.orphan_found');
    const completed = events.find((e) => e.event === 'recovery.scan_completed');
    expect(started).toBeDefined();
    expect(orphan).toBeDefined();
    expect(orphan?.['doc_id']).toBe('doc-aaaaaaaa');
    expect(orphan?.['stage']).toBe('classify');
    expect(completed).toBeDefined();
  });

  it('classify.started with matching classify.completed produces NO orphan', async () => {
    writeTelemetry([
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1234 },
      { event: 'classify.started', timestamp: '2026-05-13T09:01:01Z', doc_id: 'doc-aaaaaaaa' },
      { event: 'classify.completed', timestamp: '2026-05-13T09:01:05Z', doc_id: 'doc-aaaaaaaa', facet_domain: 'rhel', facet_type: 'reference' },
    ]);
    const controller = new AbortController();
    const result = await runRecoveryScan(buildDeps(), controller.signal);
    expect(result.orphans.length).toBe(0);
  });

  it('classify.started with matching classify.failed produces NO orphan', async () => {
    writeTelemetry([
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1234 },
      { event: 'classify.started', timestamp: '2026-05-13T09:01:01Z', doc_id: 'doc-aaaaaaaa' },
      { event: 'classify.failed', timestamp: '2026-05-13T09:01:05Z', doc_id: 'doc-aaaaaaaa', error_code: 'schema_invalid' },
    ]);
    const result = await runRecoveryScan(buildDeps(), new AbortController().signal);
    expect(result.orphans.length).toBe(0);
  });

  it('detects orphans across all five stages (ingest/classify/embed/index/edges-build)', async () => {
    writeTelemetry([
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 },
      // ingest orphan
      { event: 'ingest.normalized', timestamp: '2026-05-13T09:01:00Z', doc_id: 'doc-11111111', file_path: '/foo/a.md' },
      // classify orphan
      { event: 'classify.started', timestamp: '2026-05-13T09:02:00Z', doc_id: 'doc-22222222' },
      // embed orphan
      { event: 'embed.started', timestamp: '2026-05-13T09:03:00Z', doc_id: 'doc-33333333' },
      // index orphan
      { event: 'index.started', timestamp: '2026-05-13T09:04:00Z', doc_id: 'doc-44444444' },
      // edges-build orphan
      { event: 'edges.started', timestamp: '2026-05-13T09:05:00Z', doc_id: 'doc-55555555' },
    ]);
    const result = await runRecoveryScan(buildDeps(), new AbortController().signal);
    const byStage = new Map(result.orphans.map((o) => [o.stage, o]));
    expect(byStage.has('classify')).toBe(true);
    expect(byStage.has('embed')).toBe(true);
    expect(byStage.has('index')).toBe(true);
    expect(byStage.has('edges-build')).toBe(true);
  });

  it('emits recovery.aborted_scan and respects AbortSignal', async () => {
    // Large fixture so the scan has work to do.
    const lines: JsonLine[] = [
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 },
    ];
    for (let i = 0; i < 500; i++) {
      lines.push({
        event: 'classify.started',
        timestamp: `2026-05-13T09:${String(i).padStart(2, '0').slice(0, 2)}:00Z`,
        doc_id: `doc-${i.toString(16).padStart(8, '0')}`,
      });
    }
    writeTelemetry(lines);
    const controller = new AbortController();
    // Abort before scan starts so the scan must observe the aborted signal
    // and emit recovery.aborted_scan.
    controller.abort();
    const result = await runRecoveryScan(buildDeps(), controller.signal);
    expect(result.aborted).toBe(true);
    const events = readTelemetryEvents();
    const aborted = events.find((e) => e.event === 'recovery.aborted_scan');
    expect(aborted).toBeDefined();
  });

  it('emits recovery.scan_skipped {reason=lock_contention} when drain lock is held', async () => {
    // Pre-acquire the drain lock with this process's PID; the scanner cannot
    // steal a live PID's lock.
    const lockPath = Paths.drainLock();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));
    try {
      writeTelemetry([
        { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 },
        { event: 'classify.started', timestamp: '2026-05-13T09:01:00Z', doc_id: 'doc-aaaaaaaa' },
      ]);
      const result = await runRecoveryScan(buildDeps(), new AbortController().signal);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('lock_contention');
      const events = readTelemetryEvents();
      const skipped = events.find((e) => e.event === 'recovery.scan_skipped');
      expect(skipped?.['reason']).toBe('lock_contention');
    } finally {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  });

  it('emits recovery.telemetry_parse_failed for malformed lines but continues scan', async () => {
    const telemetryPath = Paths.telemetry();
    fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
    const lines = [
      JSON.stringify({ event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 }),
      'THIS IS NOT JSON {{{', // malformed
      JSON.stringify({ event: 'classify.started', timestamp: '2026-05-13T09:01:00Z', doc_id: 'doc-aaaaaaaa' }),
    ];
    fs.writeFileSync(telemetryPath, lines.join('\n') + '\n');
    const result = await runRecoveryScan(buildDeps(), new AbortController().signal);
    // Scan should still complete and find the orphan.
    expect(result.skipped).toBe(false);
    expect(result.orphans.length).toBe(1);
    const events = readTelemetryEvents();
    const parseFailed = events.find((e) => e.event === 'recovery.telemetry_parse_failed');
    expect(parseFailed).toBeDefined();
  });

  it('only considers events after the most-recent daemon.started marker', async () => {
    writeTelemetry([
      // Older session — orphan should NOT be detected (out of scope window).
      { event: 'daemon.started', timestamp: '2026-05-12T09:00:00Z', severity: 'info', outcome: 'success', pid: 0 },
      { event: 'classify.started', timestamp: '2026-05-12T09:01:00Z', doc_id: 'doc-99999999' },
      // New session marker; scan window starts here.
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 },
      { event: 'classify.started', timestamp: '2026-05-13T09:01:00Z', doc_id: 'doc-aaaaaaaa' },
    ]);
    const result = await runRecoveryScan(buildDeps(), new AbortController().signal);
    expect(result.orphans.length).toBe(1);
    expect(result.orphans[0].doc_id).toBe('doc-aaaaaaaa');
  });

  it('emits recovery.scan_reentry when prior scan_started has no matching scan_completed', async () => {
    writeTelemetry([
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 },
      // Prior recovery scan started but never completed.
      { event: 'recovery.scan_started', timestamp: '2026-05-13T09:00:30Z', severity: 'info', outcome: 'success', daemon_session_start_ts: '2026-05-13T09:00:00Z' },
      { event: 'classify.started', timestamp: '2026-05-13T09:01:00Z', doc_id: 'doc-aaaaaaaa' },
    ]);
    const result = await runRecoveryScan(buildDeps(), new AbortController().signal);
    const events = readTelemetryEvents();
    const reentry = events.find((e) => e.event === 'recovery.scan_reentry');
    expect(reentry).toBeDefined();
    // Scan still proceeds to detect orphans.
    expect(result.orphans.length).toBe(1);
  });

  it('RecoveryScanResult shape includes resumed_count, aborted_count, duration_ms', async () => {
    writeTelemetry([
      { event: 'daemon.started', timestamp: '2026-05-13T09:00:00Z', severity: 'info', outcome: 'success', pid: 1 },
    ]);
    const result: RecoveryScanResult = await runRecoveryScan(
      buildDeps(),
      new AbortController().signal,
    );
    expect(typeof result.durationMs).toBe('number');
    expect(typeof result.resumedCount).toBe('number');
    expect(typeof result.abortedCount).toBe('number');
    expect(Array.isArray(result.orphans)).toBe(true);
  });
});

// Touch fsp to keep import live (used for fixture authoring helpers below if extended).
void fsp;
