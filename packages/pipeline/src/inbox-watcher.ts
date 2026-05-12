// SP-003 T070 — InboxWatcher.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001
//   - specs/003-ingest-pipeline/plan.md Decision E (chokidar)
//   - specs/003-ingest-pipeline/contracts/inbox-watcher.feature
//   - Constitution VII (cancellable IO)
//
// Wraps chokidar.watch() with:
//   - awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
//   - depth: 0 (no subdirectories)
//   - ignoreInitial: false (initial-scan included)
//   - usePolling: false (rely on inotify on Linux)
//
// Lifecycle:
//   - start() returns once the watcher emits 'ready'.
//   - onDetected(absolutePath) called on every 'add' event.
//   - close() on signal.aborted.
//   - On 'error' with errno ENOSPC: emit inbox.watcher_resource_exhausted
//     telemetry and surface WatcherError via the onError callback.

import * as chokidar from 'chokidar';
import {
  emitTelemetry,
  WatcherError,
} from '@llm-corpus/contracts';

export interface InboxWatcherOptions {
  /** Absolute path to the inbox directory (Paths.inbox()). */
  inboxPath: string;
  /** AbortSignal — watcher closes when aborted. */
  signal: AbortSignal;
  /** Called once for each detected file (after awaitWriteFinish). */
  onDetected: (absolutePath: string) => void;
  /** Optional error callback (e.g., ENOSPC). */
  onError?: (err: WatcherError) => void;
}

export interface InboxWatcherHandle {
  /** Wait for the initial-scan to complete. Resolves once chokidar emits 'ready'. */
  ready(): Promise<void>;
  /** Manually close the watcher (also triggered by signal.abort). */
  close(): Promise<void>;
}

export function InboxWatcher(options: InboxWatcherOptions): InboxWatcherHandle {
  const watcher = chokidar.watch(options.inboxPath, {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: 0,
    ignoreInitial: false,
    usePolling: false,
  });

  let readyResolve: (() => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  watcher.on('add', (filePath: string) => {
    try {
      options.onDetected(filePath);
    } catch {
      // Caller errors must not crash the watcher loop.
    }
  });

  watcher.on('ready', () => {
    readyResolve?.();
  });

  watcher.on('error', (caught: unknown) => {
    const e = caught as NodeJS.ErrnoException;
    const errno = typeof e.code === 'string' ? e.code : 'UNKNOWN';
    const message = (e.message ?? String(caught)).slice(0, 1024);
    const limitKind: 'inotify_watches' | 'open_files' | 'unknown' =
      errno === 'ENOSPC' ? 'inotify_watches' :
      errno === 'EMFILE' || errno === 'ENFILE' ? 'open_files' :
      'unknown';

    // Fire-and-forget telemetry; errors here cannot crash the watcher.
    void emitTelemetry({
      event: 'inbox.watcher_resource_exhausted',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failed',
      errno,
      limit_kind: limitKind,
      message,
    }).catch(() => undefined);

    const watcherErr = new WatcherError({
      errno,
      limit_kind: limitKind,
      message,
    });
    if (options.onError) {
      try {
        options.onError(watcherErr);
      } catch {
        // ignore secondary errors
      }
    }
    // If still waiting on ready, fail the promise.
    readyReject?.(watcherErr);
  });

  const closeFn = async (): Promise<void> => {
    try {
      await watcher.close();
    } catch {
      // best-effort
    }
  };

  if (options.signal.aborted) {
    void closeFn();
  } else {
    options.signal.addEventListener('abort', () => void closeFn(), {
      once: true,
    });
  }

  return {
    ready: () => readyPromise,
    close: closeFn,
  };
}
