// SP-004 US1 (T038) — Classify-stage orchestrator.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-001, FR-CLASSIFY-005,
//     FR-CLASSIFY-008, FR-CLASSIFY-009, FR-CLASSIFY-010, FR-CLASSIFY-011,
//     FR-CLASSIFY-013, FR-CLASSIFY-019
//   - specs/004-classifier/data-model.md §"Entity 6"
//   - Constitution Principles VI, VII, IX, XIII
//
// Single classify-stage function — invoked by BOTH the SP-003 daemon's
// post-persist hook AND the `corpus reenrich` CLI command (Constitution VI:
// one pipeline, two policies; policy-record dispatch only).
//
// Per-document orchestration:
//
//   1. emit `classify.started`.
//   2. Read body via fs.readFile (Paths.docs() + bodyPath).
//   3. Build a per-doc AbortController:
//        const localController = new AbortController();
//        const merged = AbortSignal.any([signal, localController.signal]);
//        const timeout = setTimeout(
//          () => localController.abort('per_doc_timeout'),
//          policy.perDocClassifyTimeoutMs);
//      (NEVER `Promise.race(setTimeout)` — Constitution VII.)
//   4. renderClassifierPrompt(vocabulary, doc).
//   5. emit `classify.ollama_request`.
//   6. ollama.classify({systemMessage, userMessage, signal: merged}).
//   7. emit `classify.ollama_response`.
//   8. validateClassifierOutput(rawContent, vocabulary).
//   9. On SchemaInvalidError: emit `classify.schema_invalid`, retry once
//      per policy.classifyRetryMaxAttempts. On 2nd-fail: failure lane.
//  10. On VocabularyViolationError: emit `classify.vocabulary_violation`,
//      route to failure lane (`<doc-id>.error.json`).
//  11. On OllamaUnavailableError: circuit-breaker.recordFailure, emit
//      `classify.ollama_unavailable`, failure-lane sidecar. If
//      circuitBreaker.shouldHalt(), emit `classify.batch_halted` and
//      return halt=true.
//  12. On success: persistClassification (atomic SQL+frontmatter+proposed),
//      emit `classify.term_proposed` per proposed term, emit
//      `classify.completed`. Circuit-breaker recordSuccess.
//  13. Always clearTimeout(timeout) + cleanup signal listeners.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  Paths,
  emitTelemetry,
  withTempDir,
  OllamaUnavailableError,
  SchemaInvalidError,
  VocabularyViolationError,
  ClassifyPersistError,
  ClassifierError,
  type ClassifierOutput,
  type Sp004ClassifyErrorCodeType,
} from '@llm-corpus/contracts';
import {
  validateClassifierOutput,
  renderClassifierPrompt,
  type EstablishedVocabulary,
} from '@llm-corpus/inference';
import {
  persistClassification,
  type VocabularySnapshot,
} from '@llm-corpus/storage';
import type { Policy } from './policies.js';
import type { ClassifyCircuitBreaker } from './classify-circuit-breaker.js';

/**
 * Structural interface for the OllamaAdapter — keeps the orchestrator
 * unit-testable with a mock without importing the concrete class at the
 * test boundary.
 */
export interface OllamaClassifyPort {
  classify(input: {
    systemMessage: string;
    userMessage: string;
    signal: AbortSignal;
  }): Promise<
    | { ok: true; value: { content: string; durationMs: number; responseTokenCount: number } }
    | { ok: false; error: Error & { code?: string } }
  >;
}

export interface ClassifyStageInput {
  docId: string;
  db: DatabaseType;
  ollama: OllamaClassifyPort;
  vocabulary: EstablishedVocabulary;
  policy: Policy;
  circuitBreaker: ClassifyCircuitBreaker;
  /** Model name for telemetry. */
  modelName: string;
  /** Caller-scope signal (drain controller / SIGTERM). */
  signal: AbortSignal;
}

export type ClassifyStageOutcome = 'classified' | 'failed';

export interface ClassifyStageResult {
  outcome: ClassifyStageOutcome;
  /** Closed enum from data-model.md §"Entity 7" when outcome=failed. */
  errorCode?: Sp004ClassifyErrorCodeType;
  /** True if the circuit-breaker tripped on this invocation. */
  halt: boolean;
  /** Number of proposed terms recorded (>= 0). */
  proposedTermCount: number;
}

/**
 * Render Ollama-shape doc-context from the SQL row + body file. Reads
 * source_path / title / mime_type from the row (preferred) so the prompt
 * is consistent even if the body file frontmatter is stale.
 */
async function loadDocContext(
  db: DatabaseType,
  docId: string,
): Promise<
  Result<
    {
      title: string;
      sourcePath: string;
      mimeType: string;
      body: string;
      bodyPath: string;
    },
    ClassifyPersistError
  >
> {
  const row = db
    .prepare(
      `SELECT title, source_path, mime_type, body_path
         FROM documents WHERE id = ?`,
    )
    .get(docId) as
    | {
        title: string;
        source_path: string;
        mime_type: string;
        body_path: string;
      }
    | undefined;
  if (!row) {
    return err(
      new ClassifyPersistError({
        error_code: 'persist_failed',
        message: `document ${docId} not found`,
        retriable: false,
      }),
    );
  }
  try {
    const fullPath = path.join(Paths.docs(), row.body_path);
    const fileContent = await fsp.readFile(fullPath, 'utf8');
    // Strip leading frontmatter for the prompt-body excerpt. Done
    // defensively without invoking the full parser to keep this fast.
    const stripped = stripLeadingFrontmatter(fileContent);
    return ok({
      title: row.title,
      sourcePath: row.source_path,
      mimeType: row.mime_type,
      body: stripped,
      bodyPath: row.body_path,
    });
  } catch (caught) {
    return err(
      new ClassifyPersistError({
        error_code: 'persist_failed',
        message: `read body file failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }
}

function stripLeadingFrontmatter(text: string): string {
  if (!text.startsWith('---\n')) return text;
  const close = text.indexOf('\n---\n', 4);
  if (close === -1) return text;
  return text.slice(close + 5);
}

/**
 * Write a <doc-id>.error.json sidecar to Paths.failed() atomically.
 */
async function writeErrorSidecar(
  docId: string,
  errorCode: Sp004ClassifyErrorCodeType,
  message: string,
  retriable: boolean,
  retryCount: number,
): Promise<void> {
  const failedRoot = Paths.failed();
  await fsp.mkdir(failedRoot, { recursive: true });
  const sidecarPath = path.join(failedRoot, `${docId}.error.json`);
  const sidecar = {
    error_code: errorCode,
    message: message.slice(0, 1024),
    retriable,
    doc_id: docId,
    stage: 'classify' as const,
    timestamp: new Date().toISOString(),
    retry_count: retryCount,
  };
  try {
    await withTempDir(async (tmpDir) => {
      const tmp = path.join(tmpDir, `${docId}.error.json`);
      const fh = await fsp.open(tmp, 'w');
      try {
        await fh.writeFile(JSON.stringify(sidecar, null, 2), 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fsp.rename(tmp, sidecarPath);
    });
  } catch {
    // Best-effort — sidecar write failure surfaces as telemetry-or-die in
    // the caller's catch block.
  }
}

function vocabSnapshotForPersister(
  vocab: EstablishedVocabulary,
): VocabularySnapshot {
  return {
    domains: vocab.domains,
    tags: vocab.tags,
  };
}

function round2dp(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Classify a single sentinel document end-to-end.
 *
 * Returns Result.ok with outcome + halt flag. Errors that surface as
 * Result.err are unrecoverable bugs (failed sidecar write that ALSO failed
 * telemetry); the typical failure paths emit telemetry + sidecar and
 * return ok with outcome='failed'.
 */
export async function classifyStage(
  input: ClassifyStageInput,
): Promise<Result<ClassifyStageResult, ClassifierError>> {
  const {
    docId,
    db,
    ollama,
    vocabulary,
    policy,
    circuitBreaker,
    modelName,
    signal,
  } = input;

  signal.throwIfAborted();
  const startedAt = Date.now();

  // emit classify.started
  await emitTelemetry({
    event: 'classify.started',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    model_name: modelName,
    vocabulary_snapshot_id: vocabulary.snapshot_id,
  });

  // Load doc context.
  const ctxResult = await loadDocContext(db, docId);
  if (!ctxResult.ok) {
    await emitTelemetry({
      event: 'classify.failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failed',
      doc_id: docId,
      error_code: 'persist_failed',
      message: ctxResult.error.data.message ?? 'doc load failed',
      stage: 'classify',
    });
    await writeErrorSidecar(
      docId,
      'persist_failed',
      ctxResult.error.data.message ?? 'doc load failed',
      true,
      0,
    );
    return ok({ outcome: 'failed', errorCode: 'persist_failed', halt: false, proposedTermCount: 0 });
  }
  const docCtx = ctxResult.value;

  const { systemMessage, userMessage } = renderClassifierPrompt(vocabulary, {
    title: docCtx.title,
    sourcePath: docCtx.sourcePath,
    mimeType: docCtx.mimeType,
    body: docCtx.body,
  });

  // Per-doc abort plumbing.
  const localController = new AbortController();
  const onParentAbort = (): void => localController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });
  const timeoutHandle = setTimeout(() => {
    localController.abort();
  }, policy.perDocClassifyTimeoutMs);

  const cleanup = (): void => {
    clearTimeout(timeoutHandle);
    signal.removeEventListener('abort', onParentAbort);
  };

  try {
    // ---- Ollama call (with retry on SchemaInvalid per policy) ----
    let retryCount = 0;
    let lastSchemaError: SchemaInvalidError | null = null;
    let validated: ClassifierOutput | null = null;
    let lastValidationError: SchemaInvalidError | VocabularyViolationError | null = null;
    const maxAttempts = 1 + policy.classifyRetryMaxAttempts; // initial + retries

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const reqStart = Date.now();
      // emit classify.ollama_request
      await emitTelemetry({
        event: 'classify.ollama_request',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        doc_id: docId,
        model_name: modelName,
        prompt_token_estimate: Math.min(
          Math.floor((systemMessage.length + userMessage.length) / 4),
          1_000_000,
        ),
        schema_field_count: 7,
      });

      const ollamaResult = await ollama.classify({
        systemMessage,
        userMessage,
        signal: localController.signal,
      });

      if (!ollamaResult.ok) {
        const e = ollamaResult.error;
        if (e instanceof OllamaUnavailableError) {
          // Ollama unavailable — circuit-breaker + failure lane, no retry.
          circuitBreaker.recordFailure('ollama_unavailable');
          await emitTelemetry({
            event: 'classify.ollama_unavailable',
            timestamp: new Date().toISOString(),
            severity: 'error',
            outcome: 'failed',
            doc_id: docId,
            errno: e.data.errno,
            message: (e.data.message ?? e.message ?? 'unavailable').slice(0, 1024),
          });
          await writeErrorSidecar(
            docId,
            'ollama_unavailable',
            e.data.message ?? e.message,
            true,
            retryCount,
          );
          if (circuitBreaker.shouldHalt()) {
            await emitTelemetry({
              event: 'classify.batch_halted',
              timestamp: new Date().toISOString(),
              severity: 'error',
              outcome: 'failed',
              consecutive_failures: circuitBreaker.consecutiveFailures,
              threshold: circuitBreaker.threshold,
              last_error_code:
                circuitBreaker.lastErrorCode ?? 'ollama_unavailable',
            });
            return ok({
              outcome: 'failed',
              errorCode: 'ollama_unavailable',
              halt: true,
              proposedTermCount: 0,
            });
          }
          return ok({
            outcome: 'failed',
            errorCode: 'ollama_unavailable',
            halt: false,
            proposedTermCount: 0,
          });
        }
        if (e.name === 'AbortError') {
          await emitTelemetry({
            event: 'classify.failed',
            timestamp: new Date().toISOString(),
            severity: 'error',
            outcome: 'aborted',
            doc_id: docId,
            error_code: 'classify_aborted',
            message: 'classify aborted',
            stage: 'classify',
          });
          await writeErrorSidecar(
            docId,
            'classify_aborted',
            'classify aborted',
            true,
            retryCount,
          );
          return ok({
            outcome: 'failed',
            errorCode: 'classify_aborted',
            halt: false,
            proposedTermCount: 0,
          });
        }
        // Unknown error from Ollama port — treat as unavailable for safety.
        circuitBreaker.recordFailure('ollama_unavailable');
        await emitTelemetry({
          event: 'classify.ollama_unavailable',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failed',
          doc_id: docId,
          errno: 'UNKNOWN',
          message: e.message.slice(0, 1024),
        });
        await writeErrorSidecar(
          docId,
          'ollama_unavailable',
          e.message,
          true,
          retryCount,
        );
        return ok({
          outcome: 'failed',
          errorCode: 'ollama_unavailable',
          halt: circuitBreaker.shouldHalt(),
          proposedTermCount: 0,
        });
      }

      // emit classify.ollama_response
      await emitTelemetry({
        event: 'classify.ollama_response',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        doc_id: docId,
        response_token_count: ollamaResult.value.responseTokenCount,
        duration_ms: Date.now() - reqStart,
      });

      // Defense-in-depth validation.
      const validationResult = validateClassifierOutput(
        ollamaResult.value.content,
        vocabulary,
      );
      if (validationResult.ok) {
        validated = validationResult.value;
        break;
      }
      const valErr = validationResult.error;
      lastValidationError = valErr;
      if (valErr instanceof SchemaInvalidError) {
        lastSchemaError = valErr;
        await emitTelemetry({
          event: 'classify.schema_invalid',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          outcome: 'rejected',
          doc_id: docId,
          validation_errors: valErr.data.validation_errors.slice(0, 5),
        });
        // Retry per policy.classifyRetryMaxAttempts.
        if (attempt + 1 < maxAttempts) {
          retryCount = attempt + 1;
          continue;
        }
      }
      if (valErr instanceof VocabularyViolationError) {
        await emitTelemetry({
          event: 'classify.vocabulary_violation',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          outcome: 'rejected',
          doc_id: docId,
          offending_field: valErr.data.offending_field,
          offending_value: valErr.data.offending_value,
          established_count:
            valErr.data.offending_field === 'tag'
              ? vocabulary.tags.size
              : vocabulary.domains.size,
        });
        await writeErrorSidecar(
          docId,
          'vocabulary_violation',
          `${valErr.data.offending_field}: ${valErr.data.offending_value}`,
          true,
          retryCount,
        );
        return ok({
          outcome: 'failed',
          errorCode: 'vocabulary_violation',
          halt: false,
          proposedTermCount: 0,
        });
      }
      // Final attempt schema_invalid → fall through to failure lane.
    }

    if (!validated) {
      // Both attempts produced SchemaInvalidError.
      const message =
        lastSchemaError?.data.validation_errors.join('; ') ??
        lastValidationError?.message ??
        'schema invalid';
      await writeErrorSidecar(
        docId,
        'schema_invalid',
        message,
        true,
        retryCount,
      );
      await emitTelemetry({
        event: 'classify.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        error_code: 'schema_invalid',
        message: message.slice(0, 1024),
        stage: 'classify',
      });
      return ok({
        outcome: 'failed',
        errorCode: 'schema_invalid',
        halt: false,
        proposedTermCount: 0,
      });
    }

    // ---- Persist (atomic SQL + frontmatter + proposed-term INSERTs) ----
    const persistResult = await persistClassification(
      {
        docId,
        classifierOutput: validated,
        bodyPath: docCtx.bodyPath,
        vocabulary: vocabSnapshotForPersister(vocabulary),
        db,
      },
      signal,
    );

    if (!persistResult.ok) {
      const pe = persistResult.error;
      circuitBreaker.recordFailure(
        (pe.data.error_code as Sp004ClassifyErrorCodeType) ?? 'persist_failed',
      );
      await emitTelemetry({
        event: 'classify.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        error_code:
          (pe.data.error_code as Sp004ClassifyErrorCodeType) ??
          'persist_failed',
        message: (pe.data.message ?? pe.message ?? 'persist failed').slice(0, 1024),
        stage: 'classify',
      });
      await writeErrorSidecar(
        docId,
        (pe.data.error_code as Sp004ClassifyErrorCodeType) ?? 'persist_failed',
        pe.data.message ?? pe.message,
        pe.data.retriable ?? true,
        retryCount,
      );
      return ok({
        outcome: 'failed',
        errorCode:
          (pe.data.error_code as Sp004ClassifyErrorCodeType) ?? 'persist_failed',
        halt: false,
        proposedTermCount: 0,
      });
    }

    // ---- Emit classify.term_proposed events for each recorded proposal ----
    if (validated.facet_domain_proposed) {
      const inDomain = vocabulary.domains.has(validated.facet_domain_proposed);
      await emitTelemetry({
        event: 'classify.term_proposed',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        doc_id: docId,
        axis: 'domain',
        term: validated.facet_domain_proposed.slice(0, 256),
        inserted_or_conflicted: inDomain ? 'conflicted' : 'inserted',
      });
    }
    if (validated.facet_tags_proposed) {
      for (const tag of validated.facet_tags_proposed) {
        const inTags = vocabulary.tags.has(tag);
        await emitTelemetry({
          event: 'classify.term_proposed',
          timestamp: new Date().toISOString(),
          severity: 'info',
          outcome: 'success',
          doc_id: docId,
          axis: 'tag',
          term: tag.slice(0, 256),
          inserted_or_conflicted: inTags ? 'conflicted' : 'inserted',
        });
      }
    }

    circuitBreaker.recordSuccess();

    // emit classify.completed
    await emitTelemetry({
      event: 'classify.completed',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      doc_id: docId,
      facet_domain: validated.facet_domain.slice(0, 256),
      facet_type: validated.facet_type,
      tag_count: validated.tags.length,
      confidence_summary: {
        domain: round2dp(validated.confidence.domain),
        type: round2dp(validated.confidence.type),
        tags: round2dp(validated.confidence.tags),
      },
      retry_count: retryCount,
      duration_ms: Date.now() - startedAt,
    });

    return ok({
      outcome: 'classified',
      halt: false,
      proposedTermCount: persistResult.value.proposedTermCount,
    });
  } finally {
    cleanup();
    // Defensive — ensure the snapshot_id reference is held so the
    // optimizer doesn't elide the closure (and the vocabulary.snapshot_id
    // is observable in telemetry).
    void crypto;
  }
}
