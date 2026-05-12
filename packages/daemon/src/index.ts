// SP-003 T073 — Daemon entry point.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001, FR-INGEST-010, FR-INGEST-013
//   - Constitution XI (Library/CLI Boundary — daemon is one of the two
//     legitimate process.exit sites in SP-003 source)
//
// Single main() function:
//   1. Wire SIGTERM + SIGINT to a master AbortController.
//   2. Initialize schema migration (idempotent).
//   3. Start InboxWatcher with master signal.
//   4. On every detected file: enqueue for drain.
//   5. Drain loop coordinated with watcher events (single drain at a time
//      per drain-lock).
//   6. On abort: stop watcher, await in-flight drain, release lock,
//      process.exit(0) within 2s budget.

import * as fs from 'node:fs';
import {
  Paths,
  emitTelemetry,
} from '@llm-corpus/contracts';
import {
  InboxWatcher,
  drain,
  batchPolicy,
} from '@llm-corpus/pipeline';
import { openIndexReadWrite } from '@llm-corpus/storage';

// NOTE: worker-bootstrap.ts is a side-effecting module that calls
// installEgressHook() at top level. It is preloaded into Worker threads
// via `--require` (see packages/daemon/package.json `./worker-bootstrap`
// export entry + packages/daemon/src/worker-spawn-guard.ts path lookup).
// It MUST NOT be re-exported from this main-thread entry — doing so causes
// a second installEgressHook() call in the main thread, where transport's
// egress-hook-bootstrap.ts has already installed the singleton, and the
// guard throws EgressHookAlreadyInstalledError. The prior re-export was
// dead-code "backward compat" that nothing depended on.

export interface DaemonOptions {
  /** Optional: skip the process.exit at end (used by tests). */
  noExit?: boolean;
  /** Optional: external AbortController (tests). */
  controller?: AbortController;
}

const SHUTDOWN_GRACE_MS = 2000;

/**
 * Long-running daemon. Owns the watcher + drain coordination. Returns once
 * the master AbortController is aborted (either via signal handler or by
 * the optional external controller).
 */
export async function main(options: DaemonOptions = {}): Promise<number> {
  const controller = options.controller ?? new AbortController();
  const signal = controller.signal;

  const onSignal = (sig: NodeJS.Signals): void => {
    if (!signal.aborted) {
      // Best-effort observability event.
      void emitTelemetry({
        event: 'ingest.aborted',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'aborted',
        file_path: '(daemon-lifecycle)',
        stage: 'validate',
      }).catch(() => undefined);
      // Signal handlers must not throw; ignore unused argument.
      void sig;
      controller.abort();
    }
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  // Initialize schema (idempotent).
  try {
    const db = openIndexReadWrite();
    db.close();
  } catch (caught) {
    process.stderr.write(
      `daemon: schema init failed: ${(caught as Error).message}\n`,
    );
    if (!options.noExit) process.exit(1);
    return 1;
  }

  // Ensure XDG dirs exist.
  for (const dir of [Paths.inbox(), Paths.pending(), Paths.processed(), Paths.failed(), Paths.docsStore()]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Coalescing drain trigger: any 'add' event sets a pending flag; the
  // drain loop sees the flag and re-drains. Single-drain-at-a-time
  // semantics are enforced by the lock + the awaitingDrain promise.
  let pendingTrigger = false;
  let drainInFlight: Promise<void> | null = null;

  const runDrain = async (): Promise<void> => {
    if (drainInFlight) {
      pendingTrigger = true;
      return;
    }
    drainInFlight = (async (): Promise<void> => {
      try {
        do {
          pendingTrigger = false;
          const result = await drain({}, batchPolicy, signal);
          if (!result.ok) {
            // drain itself failing is reported but does not crash the daemon.
            process.stderr.write(
              `daemon: drain error: ${result.error.message}\n`,
            );
          }
        } while (pendingTrigger && !signal.aborted);
      } finally {
        drainInFlight = null;
      }
    })();
    await drainInFlight;
  };

  const watcher = InboxWatcher({
    inboxPath: Paths.inbox(),
    signal,
    onDetected: () => {
      // Watcher is depth:0; trigger drain (drain itself iterates all of inbox/).
      void runDrain().catch(() => undefined);
    },
  });

  try {
    await watcher.ready();
  } catch (caught) {
    process.stderr.write(`daemon: watcher boot failed: ${(caught as Error).message}\n`);
    if (!options.noExit) process.exit(1);
    return 1;
  }

  // Initial drain (covers any leftovers from prior aborted run + any inbox
  // files the watcher saw during initial-scan + dispatched via onDetected).
  await runDrain().catch(() => undefined);

  // Wait until aborted.
  if (!signal.aborted) {
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  // Graceful shutdown with 2s budget.
  const shutdownStart = Date.now();
  try {
    await Promise.race([
      (async (): Promise<void> => {
        await watcher.close();
        if (drainInFlight) await drainInFlight;
      })(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_GRACE_MS);
      }),
    ]);
  } catch {
    // best-effort
  }
  void shutdownStart;

  process.off('SIGTERM', onSignal);
  process.off('SIGINT', onSignal);

  if (!options.noExit) {
    process.exit(0);
  }
  return 0;
}

/**
 * One-shot drain — used by `corpus drain` CLI subcommand. NOT a long-running
 * daemon. Invokes drain() once with the interactivePolicy and returns.
 */
export async function runOneShotDrain(): Promise<number> {
  const { interactivePolicy } = await import('@llm-corpus/pipeline');
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  try {
    // Ensure schema is present.
    try {
      const db = openIndexReadWrite();
      db.close();
    } catch (caught) {
      process.stderr.write(`drain: schema init failed: ${(caught as Error).message}\n`);
      return 1;
    }
    const result = await drain({}, interactivePolicy, controller.signal);
    if (!result.ok) {
      process.stderr.write(`drain: ${result.error.message}\n`);
      return 1;
    }
    const s = result.value;
    process.stdout.write(
      JSON.stringify({
        ingested: s.ingested,
        deduplicated: s.deduplicated,
        failed: s.failed,
        lock_contended: s.lockContended,
      }) + '\n',
    );
    return 0;
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}
