// SP-006 T023 — Recovery scanner: detect orphan in-flight work after kill-9.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-001, FR-HARDEN-003, FR-HARDEN-004,
//     FR-HARDEN-005, FR-HARDEN-006, FR-HARDEN-007
//   - specs/006-hardening/contracts/adr-kill9-recovery.md
//   - specs/006-hardening/data-model.md §"Entity 1 — RecoveryOrphan", §"Entity 5"
//   - Constitution VII (cancellable), IX (drain-lock), X (idempotent),
//     XIII (telemetry), XIV (XDG paths)
//
// Algorithm:
//   1. Acquire Paths.drainLock(); on contention emit scan_skipped and exit.
//   2. Stream Paths.telemetry() JSONL line-by-line; collect raw events.
//   3. Locate the most-recent daemon.started marker (the scan boundary).
//   4. Within the window, build (doc_id, stage) → started/last_seen map;
//      remove entries that have a matching *.completed / *.failed within
//      the same window.
//   5. Emit recovery.orphan_found per remaining entry.
//   6. Route each orphan through classifyOrphan (resumability matrix).
//   7. For resumable: invoke requeue + emit recovery.resumed.
//   8. For non-resumable: writeRecoverySidecar + emit recovery.aborted.
//   9. Emit recovery.scan_completed; release lock; return summary.
//
// Notes on reverse-iteration: the FR/spec language calls for "backwards from
// end-of-file" — semantically equivalent to a forward parse where we find
// the LAST daemon.started and consider only events at-or-after it. The
// telemetry log is typically <1MB even for long-running sessions, so a
// streamed forward parse is bounded and simpler than chunked reverse-line
// iteration; we keep the I/O fully cancellable via AbortSignal between
// chunks. Constitution VII is satisfied either way.

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { Paths as DefaultPaths, emitTelemetry } from '@llm-corpus/contracts';
import { acquireDrainLock } from './drain-lock.js';
import type { Policy } from './policies.js';
import {
  classifyOrphan,
  writeRecoverySidecar,
  type RecoveryOrphan,
  type RecoveryStage,
} from './recovery-resumability.js';

export interface RecoveryScannerDeps {
  policy: Policy;
  paths: typeof DefaultPaths;
  logger: { warn: (m: string) => void };
}

export interface RecoveryScanResult {
  /** True if the scan was skipped (no prior session or lock contention). */
  skipped: boolean;
  /** When skipped: 'no_prior_session' | 'lock_contention' | undefined. */
  skipReason?: 'no_prior_session' | 'lock_contention';
  /** True if the scan was aborted by signal/timeout. */
  aborted: boolean;
  /** Detected orphans (resumable + non-resumable). */
  orphans: RecoveryOrphan[];
  /** Number of orphans re-queued. */
  resumedCount: number;
  /** Number of orphans fail-cleaned with sidecars. */
  abortedCount: number;
  /** Wall-clock elapsed milliseconds. */
  durationMs: number;
  /** The daemon.started timestamp that bounded the scan window. */
  daemonSessionStartTs: string | null;
}

interface RawEvent {
  event: string;
  timestamp?: string;
  doc_id?: string | null;
  file_path?: string;
  [key: string]: unknown;
}

const RECOVERY_STAGES: RecoveryStage[] = [
  'ingest',
  'classify',
  'embed',
  'index',
  'edges-build',
];

// Map raw event names to recovery stages. `ingest.normalized` is the SP-003
// `*.started`-equivalent for the ingest stage (per fixtures + spec — the
// scanner treats it as an in-flight marker; ingest.completed terminates it).
const STAGE_STARTED_EVENTS = new Map<string, RecoveryStage>([
  ['ingest.normalized', 'ingest'],
  ['classify.started', 'classify'],
  ['embed.started', 'embed'],
  ['index.started', 'index'],
  ['edges.started', 'edges-build'],
]);

const STAGE_COMPLETED_EVENTS = new Map<string, RecoveryStage>([
  ['ingest.completed', 'ingest'],
  ['classify.completed', 'classify'],
  ['classify.failed', 'classify'],
  ['embed.completed', 'embed'],
  ['embed.failed', 'embed'],
  ['index.completed', 'index'],
  ['index.failed', 'index'],
  ['edges.completed', 'edges-build'],
  ['edges.failed', 'edges-build'],
]);

function orphanKey(docId: string | null, stage: RecoveryStage): string {
  return `${docId ?? '(null)'}::${stage}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function safeEmit(
  fn: () => Promise<void>,
  logger: { warn: (m: string) => void },
): Promise<void> {
  try {
    await fn();
  } catch (caught) {
    logger.warn(`recovery telemetry emit failed: ${(caught as Error).message}`);
  }
}

/**
 * Run a recovery scan. Read the telemetry log; detect orphans; dispatch
 * through the resumability matrix; emit observability events. Idempotent
 * across re-invocations (re-detecting the same orphans re-runs the same
 * idempotent re-queues).
 */
export async function runRecoveryScan(
  deps: RecoveryScannerDeps,
  signal: AbortSignal,
): Promise<RecoveryScanResult> {
  const startedAt = Date.now();
  const result: RecoveryScanResult = {
    skipped: false,
    aborted: false,
    orphans: [],
    resumedCount: 0,
    abortedCount: 0,
    durationMs: 0,
    daemonSessionStartTs: null,
  };

  // Honor an already-aborted signal up front.
  if (signal.aborted) {
    result.aborted = true;
    await safeEmit(
      () =>
        emitTelemetry({
          event: 'recovery.aborted_scan',
          timestamp: nowIso(),
          severity: 'warn',
          outcome: 'aborted',
          reason: 'abort_signal',
        }),
      deps.logger,
    );
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // Wire an inner controller chained to caller's signal + policy timeout.
  const innerController = new AbortController();
  const onParentAbort = (): void => innerController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });
  const timeoutMs = deps.policy.recoveryScanTimeoutMs;
  const timeoutHandle = setTimeout(
    () => innerController.abort(),
    timeoutMs,
  );

  const cleanup = (): void => {
    clearTimeout(timeoutHandle);
    signal.removeEventListener('abort', onParentAbort);
  };

  try {
    // 1. Acquire the drain lock. On contention, emit scan_skipped and exit.
    // The lock's auto-release is wired to innerController.signal (not the
    // outer signal) so the lock releases on EITHER outer abort OR the
    // recoveryScanTimeoutMs internal timeout — otherwise the lock would
    // persist after a timeout and stall subsequent drains.
    const lockResult = acquireDrainLock({ signal: innerController.signal });
    if (!lockResult.ok) {
      result.skipped = true;
      result.skipReason = 'lock_contention';
      await safeEmit(
        () =>
          emitTelemetry({
            event: 'recovery.scan_skipped',
            timestamp: nowIso(),
            severity: 'info',
            outcome: 'success',
            reason: 'lock_contention',
          }),
        deps.logger,
      );
      result.durationMs = Date.now() - startedAt;
      return result;
    }
    const lock = lockResult.value;

    try {
      // 2. Stream + parse telemetry events.
      const events: RawEvent[] = [];
      const telemetryPath = deps.paths.telemetry();
      if (!fs.existsSync(telemetryPath)) {
        // No telemetry file at all → no prior session.
        result.skipped = true;
        result.skipReason = 'no_prior_session';
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.scan_skipped',
              timestamp: nowIso(),
              severity: 'info',
              outcome: 'success',
              reason: 'no_prior_session',
            }),
          deps.logger,
        );
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      const stream = fs.createReadStream(telemetryPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lineOffset = 0;
      try {
        for await (const rawLine of rl) {
          lineOffset += rawLine.length + 1;
          if (innerController.signal.aborted) {
            // Drop further iteration.
            rl.close();
            stream.close();
            result.aborted = true;
            break;
          }
          if (rawLine.length === 0) continue;
          try {
            const parsed = JSON.parse(rawLine) as RawEvent;
            events.push(parsed);
          } catch (caught) {
            await safeEmit(
              () =>
                emitTelemetry({
                  event: 'recovery.telemetry_parse_failed',
                  timestamp: nowIso(),
                  severity: 'warn',
                  outcome: 'failed',
                  line_offset: lineOffset - rawLine.length - 1,
                  error: ((caught as Error).message ?? 'parse error').slice(0, 1024),
                }),
              deps.logger,
            );
          }
        }
      } finally {
        rl.close();
      }

      if (result.aborted) {
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.aborted_scan',
              timestamp: nowIso(),
              severity: 'warn',
              outcome: 'aborted',
              reason: innerController.signal.aborted && signal.aborted ? 'abort_signal' : 'timeout',
            }),
          deps.logger,
        );
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      // 3. Find the most-recent daemon.started boundary.
      let boundaryIdx = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev && ev.event === 'daemon.started') {
          boundaryIdx = i;
          break;
        }
      }
      if (boundaryIdx === -1) {
        result.skipped = true;
        result.skipReason = 'no_prior_session';
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.scan_skipped',
              timestamp: nowIso(),
              severity: 'info',
              outcome: 'success',
              reason: 'no_prior_session',
            }),
          deps.logger,
        );
        result.durationMs = Date.now() - startedAt;
        return result;
      }
      const window = events.slice(boundaryIdx);
      const boundaryHead = window[0];
      const boundaryTs = boundaryHead?.timestamp ?? null;
      result.daemonSessionStartTs = boundaryTs;

      // 4. Detect recovery-during-recovery (Scenario 5).
      const priorScanStart = window.find(
        (e) => e.event === 'recovery.scan_started',
      );
      const priorScanCompleted = window.find(
        (e) => e.event === 'recovery.scan_completed',
      );
      if (priorScanStart && !priorScanCompleted) {
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.scan_reentry',
              timestamp: nowIso(),
              severity: 'warn',
              outcome: 'success',
              prior_scan_start_ts: priorScanStart.timestamp ?? boundaryTs ?? nowIso(),
            }),
          deps.logger,
        );
      }

      // 5. Emit recovery.scan_started.
      await safeEmit(
        () =>
          emitTelemetry({
            event: 'recovery.scan_started',
            timestamp: nowIso(),
            severity: 'info',
            outcome: 'success',
            daemon_session_start_ts: boundaryTs,
          }),
        deps.logger,
      );

      // 6. Build started + completed maps over the scan window.
      const startedMap = new Map<
        string,
        { stage: RecoveryStage; doc_id: string | null; started_ts: string; last_seen_ts: string; inbox_file?: string }
      >();
      const completedKeys = new Set<string>();

      for (const ev of window) {
        if (innerController.signal.aborted) {
          result.aborted = true;
          break;
        }
        const ts = typeof ev.timestamp === 'string' ? ev.timestamp : '';
        const startStage = STAGE_STARTED_EVENTS.get(ev.event);
        if (startStage) {
          const docId = typeof ev.doc_id === 'string' ? ev.doc_id : null;
          // Skip the ingest.normalized event when ingest.completed is in the
          // SP-003 ingest path; here we conservatively track all started
          // events and let the completed pass match against them.
          const key = orphanKey(docId, startStage);
          const existing = startedMap.get(key);
          const inboxFile =
            startStage === 'ingest' && typeof ev.file_path === 'string'
              ? ev.file_path.split('/').pop()
              : undefined;
          if (!existing) {
            startedMap.set(key, {
              stage: startStage,
              doc_id: docId,
              started_ts: ts,
              last_seen_ts: ts,
              inbox_file: inboxFile,
            });
          } else {
            existing.last_seen_ts = ts;
            if (inboxFile && !existing.inbox_file) existing.inbox_file = inboxFile;
          }
          continue;
        }
        const completedStage = STAGE_COMPLETED_EVENTS.get(ev.event);
        if (completedStage) {
          const docId = typeof ev.doc_id === 'string' ? ev.doc_id : null;
          completedKeys.add(orphanKey(docId, completedStage));
        }
      }

      if (result.aborted) {
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.aborted_scan',
              timestamp: nowIso(),
              severity: 'warn',
              outcome: 'aborted',
              reason: 'abort_signal',
            }),
          deps.logger,
        );
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      // 7. Compute orphans = started \ completed.
      const orphans: RecoveryOrphan[] = [];
      for (const [key, entry] of startedMap) {
        if (completedKeys.has(key)) continue;
        const orphan: RecoveryOrphan = {
          doc_id: entry.doc_id,
          stage: entry.stage,
          started_ts: entry.started_ts,
          last_seen_ts: entry.last_seen_ts,
          inbox_file: entry.inbox_file,
          resumable: false,
        };
        orphans.push(orphan);
      }

      // 8. Emit orphan_found + dispatch.
      for (const orphan of orphans) {
        if (innerController.signal.aborted) {
          result.aborted = true;
          break;
        }
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.orphan_found',
              timestamp: nowIso(),
              severity: 'info',
              outcome: 'success',
              doc_id: orphan.doc_id,
              stage: orphan.stage,
              started_ts: orphan.started_ts,
            }),
          deps.logger,
        );

        const resolution = classifyOrphan(orphan, deps);
        if (resolution.resumable) {
          try {
            await resolution.requeue();
            if (orphan.doc_id) {
              await safeEmit(
                () =>
                  emitTelemetry({
                    event: 'recovery.resumed',
                    timestamp: nowIso(),
                    severity: 'info',
                    outcome: 'success',
                    doc_id: orphan.doc_id as string,
                    stage: orphan.stage,
                  }),
                deps.logger,
              );
            }
            orphan.resumable = true;
            result.resumedCount += 1;
          } catch (caught) {
            // Requeue itself failed — surface as recovery.aborted with the
            // diagnostic; the operator can re-run reenrich/reindex.
            await safeEmit(
              () =>
                emitTelemetry({
                  event: 'recovery.aborted',
                  timestamp: nowIso(),
                  severity: 'warn',
                  outcome: 'failed',
                  doc_id: orphan.doc_id,
                  stage: orphan.stage,
                  reason: `requeue failed: ${(caught as Error).message}`.slice(0, 1024),
                }),
              deps.logger,
            );
            result.abortedCount += 1;
          }
        } else {
          await writeRecoverySidecar(orphan, resolution.sidecarReason, deps.paths);
          await safeEmit(
            () =>
              emitTelemetry({
                event: 'recovery.aborted',
                timestamp: nowIso(),
                severity: 'warn',
                outcome: 'failed',
                doc_id: orphan.doc_id,
                stage: orphan.stage,
                reason: resolution.sidecarReason.slice(0, 1024),
              }),
            deps.logger,
          );
          orphan.unresumable_reason = resolution.sidecarReason;
          result.abortedCount += 1;
        }
        result.orphans.push(orphan);
      }

      // 9. Emit scan_completed (even when aborted mid-orphan).
      result.durationMs = Date.now() - startedAt;
      if (!result.aborted) {
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.scan_completed',
              timestamp: nowIso(),
              severity: 'info',
              outcome: 'success',
              duration_ms: result.durationMs,
              resumed_count: result.resumedCount,
              aborted_count: result.abortedCount,
              daemon_session_start_ts: boundaryTs,
            }),
          deps.logger,
        );
      } else {
        await safeEmit(
          () =>
            emitTelemetry({
              event: 'recovery.aborted_scan',
              timestamp: nowIso(),
              severity: 'warn',
              outcome: 'aborted',
              reason: 'abort_signal',
            }),
          deps.logger,
        );
      }
      return result;
    } finally {
      lock.release();
    }
  } finally {
    cleanup();
  }
}

// Keep the stage enum exportable for the daemon dispatcher.
export { RECOVERY_STAGES };
// Re-export types from resumability for ergonomic single-module import.
export type { RecoveryOrphan, RecoveryStage } from './recovery-resumability.js';

