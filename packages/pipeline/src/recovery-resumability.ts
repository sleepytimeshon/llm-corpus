// SP-006 T024 — Recovery orphan resumability-matrix dispatcher + sidecar writer.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-002
//   - specs/006-hardening/contracts/adr-kill9-recovery.md §"Resumability Matrix"
//   - specs/006-hardening/data-model.md §"Entity 1 — RecoveryOrphan"
//   - Constitution X (Idempotent Pipeline Transitions)
//
// Returns either:
//   {resumable: true, requeue: () => Promise<void>}
//   {resumable: false, sidecarReason: string}
//
// The requeue thunk is a placeholder hook into the existing SP-003/004/005
// pipeline surfaces; the actual stage invocation is wired by the daemon's
// recovery dispatcher (which has the open DB handle + adapters in scope).
// For the scanner-level test surface the thunk just resolves — exercising
// the matrix dispatch independent of the stage adapters.
//
// withTempDir is used for atomic sidecar writes per Constitution VIII.

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Paths as DefaultPaths, withTempDir } from '@llm-corpus/contracts';
import type { Policy } from './policies.js';

export type RecoveryStage =
  | 'ingest'
  | 'classify'
  | 'embed'
  | 'index'
  | 'edges-build';

export interface RecoveryOrphan {
  doc_id: string | null;
  stage: RecoveryStage;
  started_ts: string;
  last_seen_ts: string;
  inbox_file?: string;
  resumable: boolean;
  unresumable_reason?: string;
}

export interface RecoveryDeps {
  policy: Policy;
  paths: typeof DefaultPaths;
  logger: { warn: (m: string) => void };
}

export type RecoveryResolution =
  | { resumable: true; requeue: () => Promise<void> }
  | { resumable: false; sidecarReason: string };

/**
 * Route an orphan through the resumability matrix.
 *
 * Per Decision B in research.md:
 *   - ingest + inbox file present → resumable
 *   - ingest + inbox file absent  → non-resumable
 *   - classify / embed / index / edges-build → always resumable (Constitution X)
 */
export function classifyOrphan(
  orphan: RecoveryOrphan,
  deps: RecoveryDeps,
): RecoveryResolution {
  if (orphan.stage === 'ingest') {
    if (!orphan.inbox_file) {
      return {
        resumable: false,
        sidecarReason: 'ingest orphan has no inbox_file metadata',
      };
    }
    const inboxPath = path.join(deps.paths.inbox(), orphan.inbox_file);
    if (!fs.existsSync(inboxPath)) {
      return {
        resumable: false,
        sidecarReason: `ingest file ${orphan.inbox_file} absent from inbox during recovery`,
      };
    }
    return {
      resumable: true,
      // The actual re-queue happens via the daemon's drain loop; the scanner
      // emits recovery.resumed and the next drain trigger picks up the file.
      requeue: async (): Promise<void> => undefined,
    };
  }

  // All sub-stages after ingest are idempotent per Constitution X. The
  // recovery scanner just needs to record that the row should be re-queued;
  // the daemon's normal classify/embed/index/edges hook chains pick it up
  // on the next pass (sentinel rows for classify; already-classified rows
  // for embed/index/edges via the standard retrieval-orchestrator surface).
  return {
    resumable: true,
    requeue: async (): Promise<void> => undefined,
  };
}

/**
 * Write a <doc-id>.recovery.error.json sidecar at Paths.failed(). Schema
 * mirrors the SP-003 verbatim shape with error_code='unrecoverable_orphan'.
 * Idempotent: re-writing produces the same content. Atomic via withTempDir.
 */
export async function writeRecoverySidecar(
  orphan: RecoveryOrphan,
  reason: string,
  paths: typeof DefaultPaths = DefaultPaths,
): Promise<void> {
  const failedRoot = paths.failed();
  await fsp.mkdir(failedRoot, { recursive: true });
  const name = orphan.doc_id
    ? `${orphan.doc_id}.recovery.error.json`
    // For pre-persist orphans we fall back to the inbox_file basename when
    // available, else a stable hash-free placeholder.
    : `${(orphan.inbox_file ?? 'orphan').replace(/[^a-z0-9.-]/gi, '_')}.recovery.error.json`;
  const sidecarPath = path.join(failedRoot, name);

  const payload = {
    doc_id: orphan.doc_id,
    stage: orphan.stage,
    error_code: 'unrecoverable_orphan',
    message: reason.slice(0, 1024),
    timestamp: new Date().toISOString(),
    retriable: false,
  };

  await withTempDir(async (tmpDir) => {
    const tmp = path.join(tmpDir, 'sidecar.json');
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(payload, null, 2), 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, sidecarPath);
  });
}
