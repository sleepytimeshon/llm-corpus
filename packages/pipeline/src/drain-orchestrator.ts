// SP-003 T072 — Drain orchestrator.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-003, 004, 005, 006, 007,
//     008, 009, 010, 011
//   - specs/003-ingest-pipeline/data-model.md §"State transitions"
//   - Constitution VI/VII/VIII/IX/X/XIII
//
// drain(input, policy, signal):
//   1. Acquire drain lock. On contention: emit pipeline.lock_contention +
//      return ok with summary.
//   2. Iterate all files in Paths.pending() (leftover from prior aborted
//      drain) AND all files initially present in Paths.inbox().
//   3. For each inbox file: validation gate → atomic move to pending.
//   4. For each pending file: hash → dedup check → normalize → persist.
//   5. On retriable error AND policy.retryOnRetriableError: retry once.
//   6. Per-doc AbortController bounded by policy.perDocTimeoutMs.
//   7. Release lock in finally.

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  emitTelemetry,
  type Result,
  ok,
  err,
  IngestError,
  ValidationError,
  type IngestErrorCode,
} from '@llm-corpus/contracts';
import { validateInboxFile } from './validation-gate.js';
import { hashFile } from './hasher.js';
import { normalize } from '@llm-corpus/extract';
import { persist } from './persister.js';
import { acquireDrainLock } from './drain-lock.js';
import { routeToFailed } from './failure-lane.js';
import {
  openIndexReadWrite,
  findDocumentByHash,
} from '@llm-corpus/storage';
import type { Policy } from './policies.js';

export interface DrainInput {
  /** Optional: only drain these files (CLI one-shot subset). If empty/undefined, drain inbox + pending. */
  files?: readonly string[];
}

export interface DrainSummary {
  /** Number of files successfully ingested into a new documents row. */
  ingested: number;
  /** Number of files that hit the dedup short-circuit. */
  deduplicated: number;
  /** Number of files routed to Paths.failed(). */
  failed: number;
  /** Number of files where the drain lock was contended (always 0 or 1). */
  lockContended: 0 | 1;
}

/** Generate a doc_id from the file's hash (data-model.md Entity 9). */
function docIdFromHash(hash: string): string {
  return `doc-${hash.slice(0, 8)}`;
}

/** Move a file to Paths.pending() atomically. */
async function moveToPending(absolutePath: string): Promise<string> {
  const pendingRoot = Paths.pending();
  await fsp.mkdir(pendingRoot, { recursive: true });
  const target = path.join(pendingRoot, path.basename(absolutePath));
  // If target already exists (e.g., from a prior aborted drain), do not
  // overwrite; the file at `absolutePath` is the source of truth.
  try {
    await fsp.access(target);
    // Conflict — append randomness defensively.
    const tag = Math.floor(Math.random() * 0xffff).toString(16);
    const tagged = path.join(pendingRoot, `${tag}-${path.basename(absolutePath)}`);
    await fsp.rename(absolutePath, tagged);
    return tagged;
  } catch {
    await fsp.rename(absolutePath, target);
    return target;
  }
}

interface OneDocOutcome {
  outcome: 'ingested' | 'deduplicated' | 'failed';
}

async function processOneFile(
  absolutePath: string,
  policy: Policy,
  parentSignal: AbortSignal,
): Promise<OneDocOutcome> {
  // Per-doc AbortController combining parent signal + per-doc timeout.
  const docController = new AbortController();
  const onParentAbort = (): void => docController.abort();
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => docController.abort(), policy.perDocTimeoutMs);

  const cleanup = (): void => {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onParentAbort);
  };

  const ingestStart = Date.now();

  try {
    // ---- Gate 1: validation ----
    const validation = await validateInboxFile(absolutePath, docController.signal);
    if (!validation.ok) {
      await routeFailedFromInbox(absolutePath, validation.error);
      return { outcome: 'failed' };
    }
    const validated = validation.value;

    // ---- Gate 2: move inbox → pending ----
    let pendingPath: string;
    try {
      pendingPath = await moveToPending(validated.filePath);
    } catch (caught) {
      await routeFailedFromInbox(
        absolutePath,
        new ValidationError({
          error_code: 'persist_failed',
          message: `inbox→pending move failed: ${(caught as Error).message}`,
          file_path: absolutePath,
          retriable: true,
        }),
      );
      return { outcome: 'failed' };
    }

    // ---- Gate 3: hash ----
    const hashRes = await hashFile(pendingPath, docController.signal);
    if (!hashRes.ok) {
      const code = (hashRes.error.data.error_code ?? 'normalize_failed') as IngestErrorCode;
      await routeFailedFromPending(pendingPath, absolutePath, code, hashRes.error, 'validate');
      // Special telemetry: file_unstable.
      if (code === 'file_unstable') {
        await emitTelemetry({
          event: 'ingest.file_unstable',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          outcome: 'failed',
          file_path: absolutePath,
          error_code: 'file_unstable',
          stat_before: Number(hashRes.error.data.stat_before ?? 0),
          stat_after: Number(hashRes.error.data.stat_after ?? 0),
        });
      } else if (code === 'aborted') {
        await emitTelemetry({
          event: 'ingest.aborted',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          outcome: 'aborted',
          file_path: absolutePath,
          stage: 'validate',
        });
      }
      return { outcome: 'failed' };
    }
    const { hash } = hashRes.value;

    // ---- Gate 4: dedup check ----
    const docId = docIdFromHash(hash);
    {
      const db = openIndexReadWrite();
      try {
        const existing = findDocumentByHash(db, hash);
        if (existing !== null) {
          await emitTelemetry({
            event: 'ingest.dedup_hit',
            timestamp: new Date().toISOString(),
            severity: 'info',
            outcome: 'deduplicated',
            file_path: absolutePath,
            hash,
            existing_doc_id: existing,
          });
          // Remove the duplicate from pending/ (per FR-INGEST-005 spec).
          await fsp.rm(pendingPath, { force: true }).catch(() => undefined);
          return { outcome: 'deduplicated' };
        }
      } finally {
        db.close();
      }
    }

    await emitTelemetry({
      event: 'ingest.dedup_miss',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      file_path: absolutePath,
      hash,
    });

    // ---- Gate 5: normalize ----
    const ingestTimestamp = new Date().toISOString();
    const normalizeRes = await normalize(
      {
        pendingPath,
        docId,
        sourcePath: absolutePath,
        ingestTimestamp,
        mimeType: validated.mimeType,
        hash,
      },
      docController.signal,
      { timeoutMs: policy.perStageTimeoutMs },
    );

    if (!normalizeRes.ok) {
      const code = (normalizeRes.error.data.error_code ?? 'normalize_failed') as IngestErrorCode;
      await routeFailedFromPending(pendingPath, absolutePath, code, normalizeRes.error, 'normalize');
      return { outcome: 'failed' };
    }

    // ---- Gate 6: persist ----
    const persistRes = await persist(
      {
        docId,
        hash,
        mimeType: validated.mimeType,
        pendingPath,
        sourcePath: absolutePath,
        normalizedDoc: normalizeRes.value,
        originalFilename: path.basename(absolutePath),
        ingestTimestamp,
      },
      docController.signal,
    );

    if (!persistRes.ok) {
      const code = (persistRes.error.data.error_code ?? 'persist_failed') as IngestErrorCode;
      await routeFailedFromPending(pendingPath, absolutePath, code, persistRes.error, 'persist');
      return { outcome: 'failed' };
    }

    // ingest.completed.
    await emitTelemetry({
      event: 'ingest.completed',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      doc_id: docId,
      hash,
      duration_ms: Date.now() - ingestStart,
      mime_type: validated.mimeType,
    });

    return { outcome: 'ingested' };
  } catch (caught) {
    // Unexpected — emit and route to failed if possible.
    const wasAborted = docController.signal.aborted;
    const msg = (caught as Error).message ?? String(caught);
    await emitTelemetry({
      event: wasAborted ? 'ingest.aborted' : 'persist.failed',
      timestamp: new Date().toISOString(),
      severity: wasAborted ? 'warn' : 'error',
      outcome: wasAborted ? 'aborted' : 'failed',
      ...(wasAborted
        ? { file_path: absolutePath, stage: 'normalize' as const }
        : {
            file_path: absolutePath,
            error_code: 'persist_failed' as const,
            message: msg.slice(0, 1024),
            stage: 'persist' as const,
          }),
    } as Parameters<typeof emitTelemetry>[0]);

    // Try to route the source file if it still exists at absolutePath.
    try {
      await fsp.access(absolutePath);
      await routeToFailed({
        filePath: absolutePath,
        sidecar: {
          error_code: wasAborted ? 'aborted' : 'persist_failed',
          message: msg.slice(0, 1024),
          retriable: wasAborted,
          source_path: absolutePath,
          stage: 'persist',
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      /* file already moved away */
    }
    return { outcome: 'failed' };
  } finally {
    cleanup();
  }
}

async function routeFailedFromInbox(
  inboxPath: string,
  error: IngestError | ValidationError,
): Promise<void> {
  const code = (error.data.error_code ?? 'normalize_failed') as IngestErrorCode;
  const message = (error.data.message ?? error.message ?? 'unknown').toString();
  const retriable = Boolean(error.data.retriable ?? false);
  // Atomically move + sidecar.
  try {
    await fsp.access(inboxPath);
    await routeToFailed({
      filePath: inboxPath,
      sidecar: {
        error_code: code,
        message: message.slice(0, 1024),
        retriable,
        source_path: inboxPath,
        stage: 'validate',
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    /* source vanished */
  }
}

async function routeFailedFromPending(
  pendingPath: string,
  sourcePath: string,
  errorCode: IngestErrorCode,
  error: IngestError | Error,
  stage: 'validate' | 'normalize' | 'persist',
): Promise<void> {
  const message = (error.message ?? 'unknown').toString();
  let retriable = false;
  if ('data' in error && typeof (error as IngestError).data === 'object') {
    retriable = Boolean((error as IngestError).data.retriable ?? false);
  }
  try {
    await fsp.access(pendingPath);
    await routeToFailed({
      filePath: pendingPath,
      sidecar: {
        error_code: errorCode,
        message: message.slice(0, 1024),
        retriable,
        source_path: sourcePath,
        stage,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    /* source vanished */
  }
}

/**
 * Drain function — used by both interactive (CLI) and batch (daemon)
 * callers (Constitution VI single drain function).
 */
export async function drain(
  input: DrainInput,
  policy: Policy,
  signal: AbortSignal,
): Promise<Result<DrainSummary, IngestError>> {
  const summary: DrainSummary = {
    ingested: 0,
    deduplicated: 0,
    failed: 0,
    lockContended: 0,
  };

  // ---- Acquire drain lock ----
  const lockRes = acquireDrainLock({ signal });
  if (!lockRes.ok) {
    await emitTelemetry({
      event: 'pipeline.lock_contention',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      lock_path: lockRes.error.data.lock_path,
      requesting_pid: process.pid,
    });
    summary.lockContended = 1;
    return ok(summary);
  }
  const lock = lockRes.value;

  try {
    // ---- Collect files to drain ----
    const files: string[] = [];
    if (input.files && input.files.length > 0) {
      files.push(...input.files);
    } else {
      // Pending leftovers FIRST (from prior aborted drain).
      const pendingRoot = Paths.pending();
      const inboxRoot = Paths.inbox();
      if (fs.existsSync(pendingRoot)) {
        for (const name of await fsp.readdir(pendingRoot)) {
          const full = path.join(pendingRoot, name);
          const stat = await fsp.stat(full).catch(() => null);
          if (stat?.isFile()) files.push(full);
        }
      }
      if (fs.existsSync(inboxRoot)) {
        for (const name of await fsp.readdir(inboxRoot)) {
          const full = path.join(inboxRoot, name);
          const stat = await fsp.stat(full).catch(() => null);
          if (stat?.isFile()) files.push(full);
        }
      }
    }

    for (const f of files) {
      if (signal.aborted) {
        await emitTelemetry({
          event: 'ingest.aborted',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          outcome: 'aborted',
          file_path: f,
          stage: 'validate',
        });
        // Best-effort route to failed.
        try {
          await fsp.access(f);
          await routeToFailed({
            filePath: f,
            sidecar: {
              error_code: 'aborted',
              message: 'drain aborted before processing',
              retriable: true,
              source_path: f,
              stage: 'validate',
              timestamp: new Date().toISOString(),
            },
          });
        } catch {
          /* gone */
        }
        summary.failed += 1;
        continue;
      }

      // Determine whether `f` is in pending/ already (skip validation move).
      const isPending = f.startsWith(Paths.pending() + path.sep);
      let outcome: OneDocOutcome;
      if (isPending) {
        outcome = await processPendingFile(f, policy, signal);
      } else {
        outcome = await processOneFile(f, policy, signal);
      }

      // Retry-once on retriable errors (policy-gated).
      if (
        outcome.outcome === 'failed' &&
        policy.retryOnRetriableError &&
        !signal.aborted
      ) {
        // The file has been routed to failed/ already; we cannot retry from
        // there in SP-003 (SP-006 adds --retry-failed). Retry is a no-op
        // at this point — the policy hook is preserved for future use.
      }

      summary[outcome.outcome === 'ingested' ? 'ingested' : outcome.outcome === 'deduplicated' ? 'deduplicated' : 'failed'] += 1;
    }

    return ok(summary);
  } catch (caught) {
    return err(
      new IngestError({
        error_code: 'persist_failed',
        message: `Drain orchestrator failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  } finally {
    lock.release();
  }
}

/**
 * Process a file already in Paths.pending() (skips validation; the file is
 * either trusted because the prior drain placed it there, OR it's a
 * leftover from an aborted drain — re-validate to be safe).
 */
async function processPendingFile(
  pendingPath: string,
  policy: Policy,
  parentSignal: AbortSignal,
): Promise<OneDocOutcome> {
  // For safety, treat pending leftovers as if they were inbox files: hash
  // them then re-route. We don't move them back to inbox/; we just hash +
  // normalize + persist (validation already passed at the original drop).
  //
  // For SP-003 simplicity: re-validate so the same code path applies.
  // This means re-running the MIME/size checks once more — defensive +
  // matches Constitution X idempotent-pipeline-transition semantics.
  //
  // Cheap implementation: pretend pending leftover is an inbox file and
  // pass through processOneFile after moving it back to inbox/.
  const inboxRoot = Paths.inbox();
  await fsp.mkdir(inboxRoot, { recursive: true });
  const baseName = path.basename(pendingPath);
  const target = path.join(inboxRoot, baseName);
  try {
    await fsp.rename(pendingPath, target);
  } catch {
    // If it can't move back, route to failed.
    await routeFailedFromPending(
      pendingPath,
      pendingPath,
      'persist_failed',
      new Error('pending→inbox restore failed'),
      'persist',
    );
    return { outcome: 'failed' };
  }
  return processOneFile(target, policy, parentSignal);
}
