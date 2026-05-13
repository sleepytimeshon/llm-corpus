// SP-005 PREREQ-007 — Local Ollama embedding adapter.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-005, FR-RETRIEVAL-006,
//     FR-RETRIEVAL-013
//   - specs/005-retrieval/research.md Decision D
//   - specs/005-retrieval/contracts/adr-embedding-model.md
//   - Constitution Principle I (Local-First, No Egress)
//   - Constitution Principle V (Schema-Enforced Structured Output)
//   - Constitution Principle VII (Cancellable, Bounded IO)
//   - Constitution Principle XIII (Telemetry-or-Die)
//
// Posts to `<baseUrl>/api/embeddings` (Ollama's legacy single-prompt
// embedding endpoint — Decision D) with `{model, prompt}` body. AbortSignal
// propagates end-to-end through undici. The response shape is
// `{embedding: number[N]}`; the adapter validates length against the
// configured expected dimension and ensures all entries are finite.
//
// Telemetry: embed.started before each call; embed.completed on success;
// embed.failed on every error path. NEVER includes the input text nor any
// body content in payloads (Constitution I + SC-RETRIEVAL-016).

import { fetch } from 'undici';
import {
  ok,
  err,
  type Result,
  EmbeddingUnavailableError,
  EmbeddingDimensionMismatchError,
  EmbeddingValidationError,
  emitTelemetry,
} from '@llm-corpus/contracts';

const LOCALHOST_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'] as const;

export interface EmbeddingAdapterOptions {
  /** Embedding model name (e.g., 'nomic-embed-text'). */
  model: string;
  /** Endpoint URL — MUST be loopback (Principle I). */
  endpoint?: string;
  /** Expected output dimension (e.g., 768 for nomic-embed-text). */
  expectedDim: number;
}

export type EmbeddingError =
  | EmbeddingUnavailableError
  | EmbeddingDimensionMismatchError
  | EmbeddingValidationError;

function ensureLoopback(url: string): void {
  if (!LOCALHOST_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    throw new EmbeddingUnavailableError({
      errno: 'NON_LOOPBACK',
      message: `EmbeddingAdapter endpoint MUST be loopback (Principle I). Got: ${url}`,
      retriable: false,
    });
  }
}

interface OllamaEmbeddingResponse {
  embedding?: unknown;
}

function isObjectWithEmbedding(v: unknown): v is OllamaEmbeddingResponse {
  return typeof v === 'object' && v !== null;
}

/**
 * Adapter for the local Ollama embedding endpoint. Single instance per
 * process; shared by index-stage (embed documents) and search-orchestrator
 * (embed queries).
 */
export class EmbeddingAdapter {
  readonly model: string;
  readonly endpoint: string;
  readonly expectedDim: number;

  constructor(options: EmbeddingAdapterOptions) {
    this.model = options.model;
    this.endpoint = options.endpoint ?? 'http://localhost:11434/api/embeddings';
    this.expectedDim = options.expectedDim;
    ensureLoopback(this.endpoint);
  }

  /**
   * Embed a document text (concatenated frontmatter fields + body excerpt).
   * Emits embed.started / embed.completed / embed.failed telemetry events
   * tagged with the doc_id for observability.
   */
  async embedDocument(
    text: string,
    signal: AbortSignal,
    docId: string,
  ): Promise<Result<Float32Array, EmbeddingError>> {
    return this.embed(text, signal, docId);
  }

  /**
   * Embed a user query string. No doc_id (queries are ephemeral) — telemetry
   * uses the doc_id-absent variant of embed.failed (per the schema). Caller
   * may pass a synthetic doc_id like `doc-query` if a real one is required
   * by upstream telemetry — but the search orchestrator does NOT emit per-
   * query embed.started/completed (it emits search.* events).
   */
  async embedQuery(
    text: string,
    signal: AbortSignal,
  ): Promise<Result<Float32Array, EmbeddingError>> {
    return this.embed(text, signal, undefined);
  }

  private async embed(
    text: string,
    signal: AbortSignal,
    docId: string | undefined,
  ): Promise<Result<Float32Array, EmbeddingError>> {
    const startedAt = Date.now();

    if (docId) {
      await emitTelemetry({
        event: 'embed.started',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        doc_id: docId,
        model_name: this.model,
        input_token_estimate: Math.min(
          Math.floor(text.length / 4),
          1_000_000,
        ),
      });
    }

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        body: JSON.stringify({ model: this.model, prompt: text }),
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
    } catch (caught) {
      const e = caught as Error & { code?: string; cause?: { code?: string } };
      if (e.name === 'AbortError') {
        await emitTelemetry({
          event: 'embed.failed',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'aborted',
          doc_id: docId,
          model_name: this.model,
          error_code: 'embed_aborted',
          message: 'embedding aborted by caller signal',
        });
        return err(
          new EmbeddingUnavailableError(
            {
              errno: 'ABORTED',
              message: 'embedding aborted',
              retriable: true,
            },
            e,
          ),
        );
      }
      const errno = e.code ?? e.cause?.code ?? 'UNKNOWN';
      await emitTelemetry({
        event: 'embed.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        model_name: this.model,
        error_code: 'embedding_unavailable',
        message: (e.message ?? String(e)).slice(0, 1024),
      });
      return err(
        new EmbeddingUnavailableError(
          {
            errno: String(errno),
            message: (e.message ?? String(e)).slice(0, 1024),
          },
          e,
        ),
      );
    }

    if (!response.ok) {
      const message = `Ollama embedding endpoint returned ${response.status} ${response.statusText}`;
      await emitTelemetry({
        event: 'embed.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        model_name: this.model,
        error_code: 'embedding_unavailable',
        message: message.slice(0, 1024),
      });
      return err(
        new EmbeddingUnavailableError({
          errno: `HTTP_${response.status}`,
          message,
        }),
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (caught) {
      const message = `Ollama response body not JSON: ${(caught as Error).message}`;
      await emitTelemetry({
        event: 'embed.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        model_name: this.model,
        error_code: 'embedding_unavailable',
        message: message.slice(0, 1024),
      });
      return err(
        new EmbeddingUnavailableError(
          { errno: 'JSON_PARSE_FAILED', message },
          caught,
        ),
      );
    }

    if (!isObjectWithEmbedding(parsed) || !Array.isArray(parsed.embedding)) {
      const message = 'Ollama response missing embedding array';
      await emitTelemetry({
        event: 'embed.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        model_name: this.model,
        error_code: 'embedding_unavailable',
        message,
      });
      return err(
        new EmbeddingUnavailableError({
          errno: 'SHAPE_INVALID',
          message,
        }),
      );
    }

    const embeddingArr = parsed.embedding as unknown[];

    if (embeddingArr.length !== this.expectedDim) {
      await emitTelemetry({
        event: 'embed.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        doc_id: docId,
        model_name: this.model,
        error_code: 'embedding_dimension_mismatch',
        message: `expected=${this.expectedDim}, got=${embeddingArr.length}`,
      });
      return err(
        new EmbeddingDimensionMismatchError({
          expected: this.expectedDim,
          got: embeddingArr.length,
        }),
      );
    }

    // Validate finite numbers + convert to Float32Array.
    const vec = new Float32Array(this.expectedDim);
    for (let i = 0; i < this.expectedDim; i += 1) {
      const v = embeddingArr[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        await emitTelemetry({
          event: 'embed.failed',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failed',
          doc_id: docId,
          model_name: this.model,
          error_code: 'embedding_validation_failed',
          message: `non-finite entry at index ${i}`,
        });
        return err(
          new EmbeddingValidationError({
            message: `non-finite entry at index ${i}: ${String(v)}`,
          }),
        );
      }
      vec[i] = v;
    }

    if (docId) {
      await emitTelemetry({
        event: 'embed.completed',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        doc_id: docId,
        model_name: this.model,
        dimension: this.expectedDim,
        duration_ms: Date.now() - startedAt,
      });
    }

    return ok(vec);
  }
}
