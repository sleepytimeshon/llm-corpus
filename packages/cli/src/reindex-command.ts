// SP-005 US2 (T063) — `corpus reindex [--dry-run]` CLI command.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-012, FR-RETRIEVAL-014,
//     FR-RETRIEVAL-018
//   - Constitution Principles VII, IX, XI
//
// Backfills the SP-005 retrieval tables (documents_fts + documents_vec
// + edges) for already-classified documents lacking corresponding
// entries. Acquires Paths.drainLock() independently; on contention emits
// pipeline.lock_contention + exits 0 with the all-zero summary
// (FR-INGEST-011 contract preserved across all writer surfaces).
//
// Iterates rows `WHERE facet_type != 'unclassified' AND status='success'
// AND NOT EXISTS (SELECT 1 FROM documents_vec WHERE doc_id = id)`. For
// each: invokes retrievalOrchestrator (embed + index + edges-build).
// Idempotency check ensures re-running on a fully-indexed corpus is a
// no-op (Constitution X; SC-RETRIEVAL-015).
//
// --dry-run: lists target rows; ZERO Ollama HTTP calls; ZERO SQL writes.

import {
  ok,
  err,
  type Result,
  emitTelemetry,
} from '@llm-corpus/contracts';
import {
  retrievalOrchestrator,
  acquireDrainLock,
  type Policy,
} from '@llm-corpus/pipeline';
import {
  openIndexReadWrite,
  regenerateCatalogFromDb,
} from '@llm-corpus/storage';
import { EmbeddingAdapter } from '@llm-corpus/inference';
import type { Database as DatabaseType } from 'better-sqlite3';

export interface ReindexSummary {
  indexed: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  lockContended: boolean;
  /** SP-006 — CATALOG.md regenerated row count (0 when --no-catalog). */
  catalogLines?: number;
}

export interface ReindexArgs {
  dryRun?: boolean;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  embeddingExpectedDim?: number;
  /** SP-006 T054 — regenerate Paths.data()/CATALOG.md after backfill (default true). */
  regenerateCatalog?: boolean;
}

export interface ReindexCommandInput {
  args: ReindexArgs;
  policy: Policy;
  signal: AbortSignal;
  /** Optional override for tests — supply a pre-configured adapter. */
  embeddingAdapterOverride?: EmbeddingAdapter;
  /** Optional override for tests — supply a progress reporter sink. */
  onProgress?: (msg: string) => void;
}

export function parseReindexArgs(argv: readonly string[]): ReindexArgs {
  return {
    dryRun: argv.includes('--dry-run'),
    // SP-006 T054 — default true; --no-catalog opts out (used by ops tests).
    regenerateCatalog: !argv.includes('--no-catalog'),
  };
}

export async function runReindexCommand(
  input: ReindexCommandInput,
): Promise<Result<ReindexSummary, Error>> {
  const { args, policy, signal } = input;
  const summary: ReindexSummary = {
    indexed: 0,
    failed: 0,
    skipped: 0,
    dryRun: args.dryRun === true,
    lockContended: false,
  };

  signal.throwIfAborted();

  const lockResult = acquireDrainLock({ signal });
  if (!lockResult.ok) {
    await emitTelemetry({
      event: 'pipeline.lock_contention',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      lock_path: lockResult.error.data.lock_path,
      requesting_pid: process.pid,
    });
    summary.lockContended = true;
    return ok(summary);
  }
  const lock = lockResult.value;

  let db: DatabaseType;
  try {
    db = openIndexReadWrite();
  } catch (caught) {
    lock.release();
    return err(caught as Error);
  }

  try {
    const candidateRows = db
      .prepare(
        `SELECT d.id AS id
           FROM documents d
          WHERE d.facet_type != 'unclassified'
            AND d.status = 'success'
            AND NOT EXISTS (
              SELECT 1 FROM documents_vec v WHERE v.doc_id = d.id
            )
          ORDER BY d.ingest_timestamp ASC`,
      )
      .all() as Array<{ id: string }>;

    if (args.dryRun === true) {
      // Report the candidates; issue zero Ollama / SQL-write operations.
      summary.skipped = candidateRows.length;
      for (const row of candidateRows) {
        input.onProgress?.(`[dry-run] would reindex ${row.id}`);
      }
      return ok(summary);
    }

    // Build the embedding adapter once for the whole run.
    const adapter =
      input.embeddingAdapterOverride ??
      new EmbeddingAdapter({
        model: args.embeddingModel ?? 'nomic-embed-text',
        endpoint:
          args.embeddingEndpoint ?? 'http://localhost:11434/api/embeddings',
        expectedDim: args.embeddingExpectedDim ?? 768,
      });

    let processed = 0;
    for (const row of candidateRows) {
      if (signal.aborted) break;
      processed += 1;
      const start = Date.now();
      const r = await retrievalOrchestrator({
        docId: row.id,
        db,
        embeddingAdapter: adapter,
        policy,
        signal,
      });
      const elapsedMs = Date.now() - start;
      if (!r.ok) {
        summary.failed += 1;
        input.onProgress?.(
          `[${processed}/${candidateRows.length}] ${row.id} ... failed (${r.error.message}) in ${elapsedMs}ms`,
        );
        continue;
      }
      if (r.value.outcome === 'indexed') {
        summary.indexed += 1;
        input.onProgress?.(
          `[${processed}/${candidateRows.length}] ${row.id} ... embedded + indexed in ${elapsedMs}ms`,
        );
      } else if (r.value.outcome === 'skipped') {
        summary.skipped += 1;
        input.onProgress?.(
          `[${processed}/${candidateRows.length}] ${row.id} ... already indexed (skipped)`,
        );
      } else {
        summary.failed += 1;
        input.onProgress?.(
          `[${processed}/${candidateRows.length}] ${row.id} ... failed (${r.value.errorCode ?? 'unknown'}) in ${elapsedMs}ms`,
        );
      }
    }
  } finally {
    // SP-006 T054: regenerate CATALOG.md from the canonical documents table
    // after the backfill loop. Idempotent — re-running on the same DB
    // produces the same lines. Failures are logged + swallowed; the SQL
    // index backfill is the transactional unit (Constitution VIII).
    if (
      args.dryRun !== true &&
      args.regenerateCatalog !== false &&
      !signal.aborted
    ) {
      try {
        const r = await regenerateCatalogFromDb(db, signal);
        summary.catalogLines = r.written;
        input.onProgress?.(`CATALOG.md regenerated (${r.written} lines)`);
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        input.onProgress?.(`CATALOG.md regeneration failed: ${message}`);
        await emitTelemetry({
          event: 'search.tier_failed',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          outcome: 'failed',
          tier: 'catalog-grep',
          error_code: 'catalog_regenerate_failed',
          duration_ms: 0,
        }).catch(() => {
          /* never crash on telemetry */
        });
      }
    }
    try {
      db.close();
    } catch {
      // best-effort
    }
    lock.release();
  }

  return ok(summary);
}

/**
 * CLI entry point — invoked from `corpus reindex [--dry-run]`. Owns the
 * SIGTERM / SIGINT wiring and unwraps the Result into stdout / stderr.
 */
export async function runReindexCli(argv: readonly string[]): Promise<number> {
  const { interactivePolicy } = await import('@llm-corpus/pipeline');
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  try {
    const args = parseReindexArgs(argv);
    const result = await runReindexCommand({
      args,
      policy: interactivePolicy,
      signal: controller.signal,
      onProgress: (msg) => process.stderr.write(`${msg}\n`),
    });
    if (!result.ok) {
      process.stderr.write(`reindex: ${result.error.message}\n`);
      return 1;
    }
    const s = result.value;
    if (s.lockContended) {
      process.stdout.write(
        `reindex: drain-lock contention — another writer is active; exiting 0\n`,
      );
      return 0;
    }
    process.stdout.write(
      `indexed=${s.indexed}, failed=${s.failed}, skipped=${s.skipped}\n`,
    );
    return 0;
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}
