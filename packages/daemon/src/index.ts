// SP-003 T073 — Daemon entry point. SP-004 T039 — post-persist classify hook.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001, FR-INGEST-010, FR-INGEST-013
//   - specs/004-classifier/spec.md FR-CLASSIFY-001, FR-CLASSIFY-006,
//     FR-CLASSIFY-015, FR-CLASSIFY-019
//   - Constitution VI (One Pipeline, Two Policies)
//   - Constitution IX (Concurrency-Safe Shared State — drain-lock reuse)
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
//   6. After each SP-003 drain succeeds, run SP-004 classify pass — iterate
//      sentinel rows (one at a time, FR-CLASSIFY-019) and invoke
//      classifyStage. Vocabulary snapshot loaded once per batch (Decision E).
//   7. On abort: stop watcher, await in-flight drain, release lock,
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
  classifyStage,
  ClassifyCircuitBreaker,
  acquireDrainLock,
  retrievalOrchestrator,
  runRecoveryScan,
} from '@llm-corpus/pipeline';
import {
  loadEstablishedVocabulary,
  OllamaAdapter,
  EmbeddingAdapter,
} from '@llm-corpus/inference';
import { openIndexReadWrite } from '@llm-corpus/storage';
import { CLASSIFIER_OUTPUT_JSON_SCHEMA } from '@llm-corpus/contracts';

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
  /** Optional: disable the SP-004 classify hook (tests / pre-Ollama setups). */
  classifyEnabled?: boolean;
  /** Optional: model name for the classifier. Default qwen3.5:9b. */
  classifierModel?: string;
  /** Optional: Ollama base URL for classifier. Default localhost:11434. */
  classifierBaseUrl?: string;
  /** Optional: disable the SP-005 retrieval hook (tests / pre-Ollama setups). */
  retrievalEnabled?: boolean;
  /** Optional: embedding model. Default nomic-embed-text. */
  embeddingModel?: string;
  /** Optional: embedding endpoint. Default http://localhost:11434/api/embeddings. */
  embeddingEndpoint?: string;
  /** Optional: expected embedding dimension. Default 768. */
  embeddingExpectedDim?: number;
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

  // SP-006 FR-HARDEN-001 — emit daemon.started session boundary BEFORE the
  // recovery scan runs. The scan uses this marker as its window bound.
  try {
    await emitTelemetry({
      event: 'daemon.started',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      pid: process.pid,
    });
  } catch {
    // Best-effort; telemetry must not crash startup.
  }

  // SP-006 FR-HARDEN-001 — run the recovery scan BEFORE activating the
  // inbox watcher / classify-hook / embed-hook chains. Failure does NOT
  // prevent daemon startup (warning logged; daemon continues with empty
  // recovery state). The scanner emits its own observability events.
  try {
    await runRecoveryScan(
      { policy: batchPolicy, paths: Paths, logger: { warn: (m: string) => process.stderr.write(`daemon: recovery: ${m}\n`) } },
      signal,
    );
  } catch (caught) {
    process.stderr.write(
      `daemon: recovery scan failed (continuing): ${(caught as Error).message}\n`,
    );
  }

  // Coalescing drain trigger: any 'add' event sets a pending flag; the
  // drain loop sees the flag and re-drains. Single-drain-at-a-time
  // semantics are enforced by the lock + the awaitingDrain promise.
  let pendingTrigger = false;
  let drainInFlight: Promise<void> | null = null;

  // SP-004 classify-stage adapter. Constructed lazily on first drain so
  // that startup doesn't fail if Ollama isn't running yet — the classify
  // hook is best-effort per FR-CLASSIFY-011 (the row stays sentinel until
  // the next attempt). `classifyEnabled` defaults to true; setting it to
  // false disables the hook entirely (tests, pre-Ollama setups).
  const classifyEnabled = options.classifyEnabled ?? true;
  const classifierModel = options.classifierModel ?? 'qwen3.5:9b';
  const classifierBaseUrl =
    options.classifierBaseUrl ?? 'http://localhost:11434';
  let ollamaAdapter: OllamaAdapter | null = null;
  const getOllamaAdapter = (): OllamaAdapter => {
    if (!ollamaAdapter) {
      ollamaAdapter = new OllamaAdapter({
        model: classifierModel,
        schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
        baseUrl: classifierBaseUrl,
      });
    }
    return ollamaAdapter;
  };

  // SP-005 retrieval-stage adapter (embedding). Same lazy-construction
  // pattern as the classifier adapter; failure routes the doc to the
  // failure lane without crashing the daemon.
  const retrievalEnabled = options.retrievalEnabled ?? true;
  const embeddingModel = options.embeddingModel ?? 'nomic-embed-text';
  const embeddingEndpoint =
    options.embeddingEndpoint ?? 'http://localhost:11434/api/embeddings';
  const embeddingExpectedDim = options.embeddingExpectedDim ?? 768;
  let embeddingAdapter: EmbeddingAdapter | null = null;
  const getEmbeddingAdapter = (): EmbeddingAdapter => {
    if (!embeddingAdapter) {
      embeddingAdapter = new EmbeddingAdapter({
        model: embeddingModel,
        endpoint: embeddingEndpoint,
        expectedDim: embeddingExpectedDim,
      });
    }
    return embeddingAdapter;
  };

  // SP-004 — post-drain classify pass. Acquires the drain-lock
  // independently from the SP-003 drain (which releases on completion);
  // the lock is the single serialization point across SP-003 + SP-004.
  // On contention, the classify pass is skipped — the next drain trigger
  // will retry, or `corpus reenrich` can drain the backlog manually.
  const runClassifyPass = async (): Promise<void> => {
    if (!classifyEnabled) return;
    const lockResult = acquireDrainLock({ signal });
    if (!lockResult.ok) {
      // Lock contention — skip; the next drain trigger or `corpus reenrich`
      // will retry. Telemetry emitted by the drain-lock itself in callers
      // that care; the daemon-loop case is a benign skip.
      return;
    }
    const lock = lockResult.value;
    try {
      const db = openIndexReadWrite();
      try {
        const vocabResult = await loadEstablishedVocabulary(db, signal);
        if (!vocabResult.ok) {
          process.stderr.write(
            `daemon: vocabulary load failed: ${vocabResult.error.message}\n`,
          );
          return;
        }
        const vocab = vocabResult.value;
        const circuitBreaker = new ClassifyCircuitBreaker();
        const sentinelRows = db
          .prepare(
            `SELECT id FROM documents
              WHERE facet_type = 'unclassified'
                AND status = 'success'
              ORDER BY ingest_timestamp ASC`,
          )
          .all() as Array<{ id: string }>;
        for (const row of sentinelRows) {
          if (signal.aborted) break;
          let adapter: OllamaAdapter;
          try {
            adapter = getOllamaAdapter();
          } catch (caught) {
            process.stderr.write(
              `daemon: classifier config error: ${(caught as Error).message}\n`,
            );
            return;
          }
          const stageResult = await classifyStage({
            docId: row.id,
            db,
            ollama: adapter,
            vocabulary: vocab,
            policy: batchPolicy,
            circuitBreaker,
            modelName: classifierModel,
            signal,
          });
          if (stageResult.ok && stageResult.value.halt) {
            // Circuit-breaker tripped — abandon the rest of this pass.
            break;
          }
          // SP-005 — post-classify retrieval hook chain. Run only on
          // successful classify (skip failed rows; they're sidecar'd
          // already). Best-effort: a retrieval failure leaves the row
          // classified-but-unindexed for the next `corpus reindex` pass.
          if (
            retrievalEnabled &&
            stageResult.ok &&
            stageResult.value.outcome === 'classified'
          ) {
            try {
              await retrievalOrchestrator({
                docId: row.id,
                db,
                embeddingAdapter: getEmbeddingAdapter(),
                policy: batchPolicy,
                signal,
              });
            } catch (caught) {
              process.stderr.write(
                `daemon: retrieval orchestrator error for ${row.id}: ${(caught as Error).message}\n`,
              );
            }
          }
        }
      } finally {
        db.close();
      }
    } finally {
      lock.release();
    }
  };

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
          // SP-004 post-persist classify pass. Runs after each SP-003 drain
          // success. The classify pass acquires the drain-lock independently
          // (the SP-003 drain has already released it). FR-CLASSIFY-001.
          await runClassifyPass().catch((caught) => {
            process.stderr.write(
              `daemon: classify pass error: ${(caught as Error).message}\n`,
            );
          });
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
