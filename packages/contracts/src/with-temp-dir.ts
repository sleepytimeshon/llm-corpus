// SP-003 PREREQ-005 — withTempDir atomic-write tmp-dir helper.
//
// References: specs/003-ingest-pipeline/plan.md PREREQ-005,
// Constitution Principle VIII (atomic writes), XIV (XDG paths via single
// resolver).
//
// Creates a temporary directory under Paths.cache() (NEVER os.tmpdir()) with
// a suffix matching `.tmp.<pid>.<rand4hex>` so concurrent writers cannot
// collide. The directory is cleaned up on:
//   1. Successful completion of the callback
//   2. Exception thrown by the callback
//   3. AbortSignal abort while the callback is running
//
// Used by SP-003 normalizers, persister, and sidecar writer for atomic
// `tmp + fsync + rename + dirsync` writes.

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Paths } from './paths.js';

export interface WithTempDirOptions {
  /** Optional AbortSignal — when aborted, cleanup runs before rejection. */
  signal?: AbortSignal;
  /** Optional namespace under Paths.cache() — defaults to 'withTempDir'. */
  namespace?: string;
}

/**
 * Allocate a temp dir under Paths.cache(), invoke `fn` with the dir path, and
 * recursively remove the dir on completion (success, error, or abort).
 *
 * The dir name matches `.tmp.<pid>.<rand4hex>` — predictable enough for
 * forensics yet unique under concurrent writers.
 */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
  opts: WithTempDirOptions = {},
): Promise<T> {
  const ns = opts.namespace ?? 'withTempDir';
  const base = path.join(Paths.cache(), ns);
  await fsp.mkdir(base, { recursive: true });
  const suffix = `.tmp.${process.pid}.${crypto.randomBytes(2).toString('hex')}`;
  const dir = path.join(base, suffix);
  await fsp.mkdir(dir, { recursive: true });

  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      await cleanupSafe(dir);
      throw new Error('withTempDir: aborted before invocation');
    }
    opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const result = await Promise.race([
      fn(dir),
      // Reject on abort so cleanup runs in `finally`.
      new Promise<never>((_resolve, reject) => {
        if (opts.signal) {
          const handler = (): void => {
            reject(new Error('withTempDir: aborted'));
          };
          if (opts.signal.aborted) {
            handler();
          } else {
            opts.signal.addEventListener('abort', handler, { once: true });
          }
        }
      }),
    ]);
    return result;
  } finally {
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onAbort);
    }
    void aborted; // marker — cleanup runs regardless
    await cleanupSafe(dir);
  }
}

async function cleanupSafe(dir: string): Promise<void> {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; cache dirs are non-canonical state.
  }
}

/**
 * Synchronous variant — used by signal handlers / process-exit hooks that
 * cannot await. Same semantics, same naming pattern, no abort support.
 */
export function withTempDirSync<T>(fn: (dir: string) => T): T {
  const base = path.join(Paths.cache(), 'withTempDir');
  fs.mkdirSync(base, { recursive: true });
  const suffix = `.tmp.${process.pid}.${crypto.randomBytes(2).toString('hex')}`;
  const dir = path.join(base, suffix);
  fs.mkdirSync(dir, { recursive: true });
  try {
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
