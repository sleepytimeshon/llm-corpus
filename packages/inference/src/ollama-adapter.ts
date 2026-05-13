// SP-004 US1 (T030) — OllamaAdapter.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-003, FR-CLASSIFY-004,
//     FR-CLASSIFY-009
//   - specs/004-classifier/research.md Decision B
//   - specs/004-classifier/contracts/adr-classifier-model-choice.md
//   - Constitution Principle I (Local-First, No Egress)
//   - Constitution Principle V (Schema-Enforced Structured Output)
//   - Constitution Principle VII (Cancellable, Bounded IO)
//
// Posts to `<baseUrl>/api/chat` with the canonical JSON Schema bound to
// Ollama's `format` parameter (Ollama 0.5+ structured-outputs). All HTTP IO
// routes through `undici.fetch` so AbortSignal propagates end-to-end (no
// Promise.race(setTimeout) anywhere). On ECONNREFUSED / network failure the
// caller receives Result.err(OllamaUnavailableError); on mid-flight abort
// the caller receives Result.err(AbortError-shaped error).
//
// The constructor asserts that the `format` parameter (i.e., the `schema`
// constructor option) is non-empty; missing schema throws
// `ClassifierConfigurationError` per FR-CLASSIFY-004 acceptance scenario.
// The baseUrl is restricted to localhost loopback at the call site
// (defense-in-depth — the SP-001 egress hook also enforces this, but the
// classifier's explicit allowlist guards against accidental cloud-fallback
// regressions per Principle I).

import { fetch } from 'undici';
import {
  ok,
  err,
  type Result,
  ClassifierConfigurationError,
  OllamaUnavailableError,
} from '@llm-corpus/contracts';

const LOCALHOST_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'] as const;

export interface OllamaAdapterOptions {
  /** Model name passed verbatim as the `model` field in the request body. */
  model: string;
  /** JSON Schema bound to the Ollama `format` parameter. MUST be non-empty. */
  schema: Readonly<Record<string, unknown>>;
  /** Base URL (loopback only). Defaults to http://localhost:11434. */
  baseUrl?: string;
}

export interface OllamaClassifyInput {
  systemMessage: string;
  userMessage: string;
  signal: AbortSignal;
}

export interface OllamaClassifyResult {
  /** Raw response string from `body.message.content` (caller validates). */
  content: string;
  /** Total wall-clock for the round-trip (ms). */
  durationMs: number;
  /** Approximate response token count from `body.eval_count` if present. */
  responseTokenCount: number;
}

/**
 * Type guard for the subset of Ollama `/api/chat` response shape we care
 * about. Defends against schema drift across Ollama versions — if these
 * fields shift, we want a clear validation failure here rather than a
 * TypeError deep in the call stack.
 */
function isOllamaChatResponse(
  v: unknown,
): v is { message?: { content?: string }; eval_count?: number } {
  return typeof v === 'object' && v !== null;
}

export class OllamaAdapter {
  readonly model: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly baseUrl: string;
  readonly chatUrl: string;

  constructor(options: OllamaAdapterOptions) {
    if (
      options.schema === undefined ||
      options.schema === null ||
      Object.keys(options.schema).length === 0
    ) {
      throw new ClassifierConfigurationError({
        key: 'schema',
        reason:
          'OllamaAdapter requires a non-empty JSON Schema for the structured-output `format` parameter (FR-CLASSIFY-004).',
      });
    }
    this.model = options.model;
    this.schema = options.schema;
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';
    // Principle I — only loopback destinations permitted at the classifier
    // boundary. The SP-001 egress hook is the runtime guard; this is the
    // construction-time guard.
    if (!LOCALHOST_PREFIXES.some((prefix) => this.baseUrl.startsWith(prefix))) {
      throw new ClassifierConfigurationError({
        key: 'baseUrl',
        reason: `OllamaAdapter baseUrl MUST be a loopback URL (http://localhost:* or http://127.0.0.1:*). Got: ${this.baseUrl}`,
      });
    }
    this.chatUrl = `${this.baseUrl.replace(/\/+$/, '')}/api/chat`;
  }

  async classify(
    input: OllamaClassifyInput,
  ): Promise<Result<OllamaClassifyResult, OllamaUnavailableError | Error>> {
    const started = Date.now();
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: input.systemMessage },
        { role: 'user', content: input.userMessage },
      ],
      format: this.schema,
      stream: false,
      options: {
        temperature: 0.1,
      },
    });

    let response;
    try {
      response = await fetch(this.chatUrl, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
      });
    } catch (caught) {
      const e = caught as Error & { code?: string; cause?: { code?: string } };
      // undici raises an AbortError on signal.abort(); surface it unchanged
      // so the caller can pattern-match on `error.name === 'AbortError'`.
      if (e.name === 'AbortError') {
        return err(e);
      }
      // Network-level failure (ECONNREFUSED, ENETUNREACH, etc.).
      const errno = e.code ?? e.cause?.code ?? 'UNKNOWN';
      return err(
        new OllamaUnavailableError(
          {
            errno: String(errno),
            message: (e.message ?? String(e)).slice(0, 1024),
          },
          e,
        ),
      );
    }

    if (!response.ok) {
      return err(
        new OllamaUnavailableError({
          errno: `HTTP_${response.status}`,
          message: `Ollama returned non-2xx: ${response.status} ${response.statusText}`,
        }),
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (caught) {
      return err(
        new OllamaUnavailableError(
          {
            errno: 'JSON_PARSE_FAILED',
            message: `Ollama response body not JSON: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }

    if (!isOllamaChatResponse(parsed)) {
      return err(
        new OllamaUnavailableError({
          errno: 'SHAPE_INVALID',
          message: 'Ollama response missing expected shape (message.content)',
        }),
      );
    }

    const content = parsed.message?.content;
    if (typeof content !== 'string') {
      return err(
        new OllamaUnavailableError({
          errno: 'SHAPE_INVALID',
          message: 'Ollama response missing message.content string',
        }),
      );
    }

    return ok({
      content,
      durationMs: Date.now() - started,
      responseTokenCount: parsed.eval_count ?? 0,
    });
  }
}
