// SP-003 T060 — Full-file SHA-256 hasher.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-004, ADR-002
//   - specs/003-ingest-pipeline/data-model.md §"Entity 6 — Content Hash"
//   - specs/003-ingest-pipeline/data-model.md §"Entity 7 — Hash Stability"
//   - Constitution VII (Cancellable, Bounded IO)
//
// hashFile(path, signal) streams the full file through crypto.createHash('sha256')
// and returns lowercase hex. Pre-hash + post-hash fs.stat size compare provides
// defense against streaming-edit (vim, echo …>>) mid-hash; on size mismatch
// returns Result.err(IngestError('file_unstable')). Cancellable via signal.

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { IngestError, ok, err, type Result } from '@llm-corpus/contracts';

export interface HashResult {
  hash: string;
  sizeBytes: number;
}

/**
 * Stream-hash the file at `path` with SHA-256 and return lowercase hex.
 *
 * Stability defense (data-model.md Entity 7):
 *   1. fs.stat(path) → sizeBefore
 *   2. stream-hash full content
 *   3. fs.stat(path) → sizeAfter
 *   4. if sizeBefore !== sizeAfter → Result.err(IngestError('file_unstable'))
 *
 * Cancellation (Constitution VII):
 *   - AbortSignal honored at every async boundary
 *   - Underlying stream is destroyed on abort
 */
export async function hashFile(
  filePath: string,
  signal: AbortSignal,
): Promise<Result<HashResult, IngestError>> {
  signal.throwIfAborted();

  let sizeBefore: number;
  try {
    const stat = await fsp.stat(filePath);
    sizeBefore = stat.size;
  } catch (caught) {
    return err(
      new IngestError({
        error_code: 'normalize_failed',
        message: `Cannot stat file: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }

  signal.throwIfAborted();

  const hash = crypto.createHash('sha256');
  const readStream = fs.createReadStream(filePath);
  const onAbort = (): void => {
    readStream.destroy(new Error('aborted'));
  };
  if (signal.aborted) {
    readStream.destroy(new Error('aborted'));
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    await pipeline(readStream, hash);
  } catch (caught) {
    if (signal.aborted) {
      return err(
        new IngestError({
          error_code: 'aborted',
          message: 'hashFile aborted mid-stream',
          retriable: true,
        }),
      );
    }
    return err(
      new IngestError({
        error_code: 'normalize_failed',
        message: `Hash stream failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  signal.throwIfAborted();

  // Post-hash stability check.
  let sizeAfter: number;
  try {
    const stat = await fsp.stat(filePath);
    sizeAfter = stat.size;
  } catch (caught) {
    return err(
      new IngestError({
        error_code: 'file_unstable',
        message: `Cannot re-stat file: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }

  if (sizeBefore !== sizeAfter) {
    return err(
      new IngestError({
        error_code: 'file_unstable',
        message: `File size changed mid-hash: before=${sizeBefore} after=${sizeAfter}`,
        retriable: true,
        stat_before: sizeBefore,
        stat_after: sizeAfter,
      }),
    );
  }

  return ok({ hash: hash.digest('hex'), sizeBytes: sizeAfter });
}
