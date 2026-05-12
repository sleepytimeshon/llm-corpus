// SP-003 T059 — Failure-lane mover + .error.json sidecar writer.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-007
//   - specs/003-ingest-pipeline/data-model.md §"Entity 5 — .error.json Sidecar"
//   - Constitution VIII (atomic writes)
//
// Atomically moves a file to Paths.failed()/ with a sibling `.error.json`
// sidecar. Used by:
//   - Validation gate rejection (file in Paths.inbox())
//   - Pipeline error during hash/normalize/persist (file in Paths.pending())

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  Paths,
  PersistError,
  err,
  ok,
  type Result,
  withTempDir,
  type IngestStage,
  type IngestErrorCode,
} from '@llm-corpus/contracts';

export interface SidecarInput {
  error_code: IngestErrorCode;
  message: string;
  retriable: boolean;
  source_path: string;
  stage: IngestStage;
  timestamp: string;
}

export interface RouteToFailedInput {
  /** Absolute path of the file currently to move (inbox or pending). */
  filePath: string;
  /** Sidecar contents (will be JSON-serialized). */
  sidecar: SidecarInput;
}

/**
 * Atomically move `filePath` into Paths.failed()/ and write the sibling
 * `.error.json` sidecar. The sidecar write uses withTempDir for atomicity
 * (tmp + rename).
 *
 * On filename collision in Paths.failed()/, the moved file is suffixed with
 * an 8-hex-random tag (defensive — FR-INGEST-007 allows uniquification).
 */
export async function routeToFailed(
  input: RouteToFailedInput,
): Promise<Result<{ failedPath: string; sidecarPath: string }, PersistError>> {
  const failedRoot = Paths.failed();
  await fsp.mkdir(failedRoot, { recursive: true });

  const baseName = path.basename(input.filePath);
  let failedPath = path.join(failedRoot, baseName);
  let sidecarPath = failedPath + '.error.json';

  // Collision-defense: if the target already exists, append an 8-hex tag.
  try {
    await fsp.access(failedPath);
    const tag = crypto.randomBytes(4).toString('hex');
    failedPath = path.join(failedRoot, `${baseName}-${tag}`);
    sidecarPath = failedPath + '.error.json';
  } catch {
    // No collision — proceed.
  }

  // Move the failed file. If it doesn't exist (we may have been called when
  // the file was never moved into pending yet), we skip the move but still
  // write the sidecar.
  try {
    await fsp.rename(input.filePath, failedPath);
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    if (e.code === 'EXDEV') {
      // Cross-device rename; fall back to copy + unlink.
      try {
        await fsp.copyFile(input.filePath, failedPath);
        await fsp.unlink(input.filePath);
      } catch (caught2) {
        return err(
          new PersistError({
            error_code: 'persist_failed',
            message: `Failure-lane move (copy fallback) failed: ${(caught2 as Error).message}`,
            retriable: true,
          }),
        );
      }
    } else if (e.code !== 'ENOENT') {
      // ENOENT means the source vanished — proceed with sidecar-only write.
      return err(
        new PersistError({
          error_code: 'persist_failed',
          message: `Failure-lane move failed: ${e.message}`,
          retriable: true,
        }),
      );
    }
  }

  // Atomic sidecar write via withTempDir.
  try {
    await withTempDir(async (tmpDir) => {
      const tmpSidecar = path.join(tmpDir, 'error.json');
      const fh = await fsp.open(tmpSidecar, 'w');
      try {
        await fh.writeFile(JSON.stringify(input.sidecar, null, 2), 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fsp.rename(tmpSidecar, sidecarPath);
    });
  } catch (caught) {
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: `Sidecar write failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }

  return ok({ failedPath, sidecarPath });
}
