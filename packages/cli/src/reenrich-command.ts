// SP-004 US2 (T047) — `corpus reenrich [--dry-run]` CLI command.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-002, FR-CLASSIFY-015,
//     FR-CLASSIFY-019
//   - Constitution Principle VI (single classify-stage function)
//   - Constitution Principle IX (drain-lock single serialization point)
//   - Constitution Principle XI (CLI is the exit boundary)
//
// Drains the sentinel-row backlog by invoking the SAME classify-stage
// function the daemon's post-persist hook uses. Acquires Paths.drainLock()
// independently; on contention emits pipeline.lock_contention + returns
// ok with all-zero summary (FR-INGEST-011 contract preserved).
//
// Iteration order is FIFO by ingest_timestamp ASC (FR-CLASSIFY-002).
//
// --dry-run lists which docs WOULD be classified but issues ZERO Ollama
// HTTP calls (mock-observer verifies zero invocations).

import {
  ok,
  err,
  type Result,
  emitTelemetry,
  CLASSIFIER_OUTPUT_JSON_SCHEMA,
} from '@llm-corpus/contracts';
import {
  classifyStage,
  ClassifyCircuitBreaker,
  acquireDrainLock,
  type Policy,
  type OllamaClassifyPort,
} from '@llm-corpus/pipeline';
import { openIndexReadWrite } from '@llm-corpus/storage';
import {
  OllamaAdapter,
  loadEstablishedVocabulary,
} from '@llm-corpus/inference';

export interface ReenrichSummary {
  classified: number;
  failed: number;
  skipped: number;
  /** In-band flag — `corpus reenrich --dry-run`. */
  dryRun: boolean;
  /** In-band flag — drain-lock contention; classified/failed/skipped all 0. */
  lockContended: boolean;
}

export interface ReenrichArgs {
  dryRun?: boolean;
  modelName?: string;
  baseUrl?: string;
}

export interface ReenrichCommandInput {
  args: ReenrichArgs;
  policy: Policy;
  signal: AbortSignal;
  /** Optional Ollama port injection for tests (bypasses real OllamaAdapter). */
  ollamaOverride?: OllamaClassifyPort;
}

/**
 * Parse `--dry-run` from a process.argv-style array (everything after the
 * `reenrich` subcommand). Defensive — invalid flags are ignored rather than
 * exit-1'd; the CLI wrapper translates Result.err to exit codes.
 */
export function parseReenrichArgs(argv: readonly string[]): ReenrichArgs {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

export async function runReenrichCommand(
  input: ReenrichCommandInput,
): Promise<Result<ReenrichSummary, Error>> {
  const { args, policy, signal } = input;
  const summary: ReenrichSummary = {
    classified: 0,
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

  let db;
  try {
    db = openIndexReadWrite();
  } catch (caught) {
    lock.release();
    return err(caught as Error);
  }

  try {
    const vocabResult = await loadEstablishedVocabulary(db, signal);
    if (!vocabResult.ok) {
      return err(new Error(`vocabulary load failed: ${vocabResult.error.message}`));
    }
    const vocabulary = vocabResult.value;
    const circuitBreaker = new ClassifyCircuitBreaker();

    const rows = db
      .prepare(
        `SELECT id FROM documents
          WHERE facet_type = 'unclassified'
            AND status = 'success'
          ORDER BY ingest_timestamp ASC`,
      )
      .all() as Array<{ id: string }>;

    let adapter: OllamaClassifyPort | null = input.ollamaOverride ?? null;

    for (const row of rows) {
      if (signal.aborted) break;

      if (summary.dryRun) {
        process.stderr.write(`[dry-run] would classify ${row.id}\n`);
        continue;
      }

      if (!adapter) {
        try {
          adapter = new OllamaAdapter({
            model: args.modelName ?? 'qwen3.5:9b',
            schema: CLASSIFIER_OUTPUT_JSON_SCHEMA,
            baseUrl: args.baseUrl ?? 'http://localhost:11434',
          });
        } catch (caught) {
          return err(caught as Error);
        }
      }

      const stageResult = await classifyStage({
        docId: row.id,
        db,
        ollama: adapter,
        vocabulary,
        policy,
        circuitBreaker,
        modelName: args.modelName ?? 'qwen3.5:9b',
        signal,
      });

      if (!stageResult.ok) {
        summary.failed += 1;
        if (policy.emitProgress) {
          process.stderr.write(`[${row.id}] error: ${stageResult.error.message}\n`);
        }
        continue;
      }
      const value = stageResult.value;
      if (value.outcome === 'classified') {
        summary.classified += 1;
        if (policy.emitProgress) {
          process.stderr.write(`[${row.id}] classified\n`);
        }
      } else {
        summary.failed += 1;
        if (policy.emitProgress) {
          process.stderr.write(
            `[${row.id}] failed: ${value.errorCode ?? 'unknown'}\n`,
          );
        }
      }
      if (value.halt) {
        // Circuit-breaker tripped — stop iterating.
        break;
      }
    }

    return ok(summary);
  } finally {
    db.close();
    lock.release();
  }
}

/**
 * CLI wrapper — Result-to-exit-code translator. Constitution XI: the CLI
 * is the only legitimate process.exit site for the reenrich code path.
 * The library function `runReenrichCommand` returns a Result; this
 * wrapper unwraps and writes the summary to stdout.
 */
export async function runReenrichCli(argv: readonly string[]): Promise<number> {
  const { interactivePolicy } = await import('@llm-corpus/pipeline');
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  try {
    const args = parseReenrichArgs(argv);
    const result = await runReenrichCommand({
      args,
      policy: interactivePolicy,
      signal: controller.signal,
    });
    if (!result.ok) {
      process.stderr.write(`reenrich: ${result.error.message}\n`);
      return 1;
    }
    const s = result.value;
    process.stdout.write(
      `classified=${s.classified}, failed=${s.failed}, skipped=${s.skipped}\n`,
    );
    return 0;
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}
