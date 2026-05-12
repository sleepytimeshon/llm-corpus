// SP-003 T069 — Drain lock (single-writer serialization).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-011
//   - specs/003-ingest-pipeline/data-model.md §"Entity 11 — Drain Lock"
//   - Constitution VII (cancellable), IX (concurrency-safe shared state)
//
// Lock semantics:
//   - O_EXCL exclusive-create on Paths.drainLock() — atomic on POSIX.
//   - On contention (EEXIST), check if the holder PID is still alive; if
//     not, the lock is stale and we steal it. Otherwise return
//     LockContentionError.
//   - release() unlinks the lock file.
//   - SIGTERM/SIGINT handlers in the daemon call release().
//   - AbortSignal abort also triggers release().

import * as fs from 'node:fs';
import { Paths, LockContentionError, ok, err, type Result } from '@llm-corpus/contracts';

export interface DrainLockHandle {
  /** Release the lock (idempotent — safe to call multiple times). */
  release(): void;
  /** True if the lock has been released. */
  readonly released: boolean;
  /** The absolute lock-file path. */
  readonly lockPath: string;
}

export interface AcquireDrainLockOptions {
  /** Optional signal — when aborted, release the lock. */
  signal?: AbortSignal;
}

function isPidAlive(pid: number): boolean {
  try {
    // signal 0 = existence check; throws if pid does not exist.
    process.kill(pid, 0);
    return true;
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    // EPERM means the process exists but we lack permission — treat as alive.
    return e.code === 'EPERM';
  }
}

/**
 * Acquire an exclusive lock on Paths.drainLock(). Returns Result.ok(handle)
 * on success; Result.err(LockContentionError) if another drain holds it.
 *
 * Stale-lock recovery: if the holder PID is dead, steal the lock (unlink
 * + retry once).
 */
export function acquireDrainLock(
  options: AcquireDrainLockOptions = {},
): Result<DrainLockHandle, LockContentionError> {
  const lockPath = Paths.drainLock();
  // Ensure parent dir exists.
  const dir = lockPath.substring(0, lockPath.lastIndexOf('/'));
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }

  const tryCreate = (): boolean => {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (caught) {
      const e = caught as NodeJS.ErrnoException;
      if (e.code === 'EEXIST') return false;
      throw caught;
    }
  };

  if (!tryCreate()) {
    // Stale-lock check.
    let holderPid: number | null = null;
    try {
      const content = fs.readFileSync(lockPath, 'utf8').trim();
      const p = Number.parseInt(content, 10);
      if (Number.isFinite(p) && p > 0) holderPid = p;
    } catch {
      // Lock file vanished mid-read — retry create.
    }

    if (holderPid !== null && holderPid !== process.pid && !isPidAlive(holderPid)) {
      // Steal.
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // race with another stealer
      }
      if (tryCreate()) {
        return makeHandle(lockPath, options.signal);
      }
    }

    return err(
      new LockContentionError({
        lock_path: lockPath,
        message: `Lock held by pid=${holderPid ?? 'unknown'}`,
      }),
    );
  }

  return makeHandle(lockPath, options.signal);
}

function makeHandle(
  lockPath: string,
  signal?: AbortSignal,
): Result<DrainLockHandle, LockContentionError> {
  let released = false;

  const releaseFn = (): void => {
    if (released) return;
    released = true;
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // best-effort
    }
  };

  if (signal) {
    if (signal.aborted) {
      releaseFn();
    } else {
      signal.addEventListener('abort', releaseFn, { once: true });
    }
  }

  return ok({
    release: releaseFn,
    get released(): boolean {
      return released;
    },
    lockPath,
  });
}
