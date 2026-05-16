// SP-007 T036 — SQLite single-file setup (install-step 4).
//
// References:
//   - specs/007-install-first-run/tasks.md T023 / T036
//   - specs/007-install-first-run/spec.md FR-INSTALL-006, SC-007-007, NFR-010
//   - Constitution Principles VII, VIII, XIII
//
// Opens `Paths.indexDb()` via `openIndexReadWrite` (SP-001 helper which also
// runs the SP-001..SP-006 schema migrations); executes `PRAGMA wal_checkpoint(
// TRUNCATE)`; explicitly unlinks the `-wal` and `-shm` sidecars. The
// post-call on-disk footprint at `dirname(Paths.indexDb())` is exactly one
// file (the `.db`). NFR-010 commits the substrate to a single-file index for
// operator-friendly snapshot / move / backup.

import * as fs from 'node:fs/promises';
import {
  Paths,
  InstallReceiptWriteError,
  emitTelemetry,
} from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';

export interface SqliteSinglefileDeps {
  /** Optional override for tests — alternate close handle. */
  closeOverride?: () => void;
}

async function unlinkSafe(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return;
    throw cause;
  }
}

export async function setupSingleFileSqlite(
  deps: SqliteSinglefileDeps,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new InstallReceiptWriteError({
      message: 'aborted before sqlite_singlefile',
    });
  }
  const startedAt = Date.now();
  try {
    const db = openIndexReadWrite();
    try {
      // The openIndexReadWrite path runs the migration set; ensure WAL
      // is checkpointed and truncated so sidecars are recoverable into the
      // main db file.
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      if (deps.closeOverride) deps.closeOverride();
      else db.close();
    }
    // Sidecar cleanup: SQLite may leave -wal/-shm files behind even after
    // TRUNCATE (depending on open handles); explicit unlink restores NFR-010.
    const indexDb = Paths.indexDb();
    await unlinkSafe(indexDb + '-wal');
    await unlinkSafe(indexDb + '-shm');
  } catch (cause) {
    try {
      await emitTelemetry({
        event: 'install.step_failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failure',
        step: 'sqlite_singlefile',
        duration_ms: Date.now() - startedAt,
        error_code: (cause as Error).message?.slice(0, 64) ?? 'unknown',
      });
    } catch {
      /* telemetry must not crash install */
    }
    throw new InstallReceiptWriteError(
      { message: `sqlite_singlefile failed: ${(cause as Error).message ?? cause}` },
      cause,
    );
  }
}
