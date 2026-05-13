// T019 — Typed error classes used across packages.
// Constitution XI (Library/CLI Boundary): library code returns Result.err(<typed-error>);
// it never throws ad-hoc Error or process.exit.

import type { PrimitiveType } from './telemetry.js';

/**
 * Thrown by the runtime egress hook when a non-loopback destination is
 * attempted. Synchronous from the patched primitive; async primitives wrap
 * it in their normal error-propagation channel.
 *
 * See contracts/egress-hook-api.md §"EgressBlockedError contract".
 */
export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED' as const;
  override readonly name = 'EgressBlockedError';

  constructor(
    readonly primitive: PrimitiveType,
    readonly destination_host: string,
    readonly destination_port: number,
    readonly request_id: string,
  ) {
    super(
      `Egress to ${destination_host}:${destination_port} via ${primitive} ` +
        `blocked by local-only enforcement (NFR-002, ADR-001). request_id=${request_id}`,
    );
  }
}

/**
 * Thrown when `installEgressHook()` is called more than once in a process.
 * Multiple installs would compound interception layers and corrupt forensic
 * telemetry (see contracts/egress-hook-api.md §"installEgressHook").
 */
export class EgressHookAlreadyInstalledError extends Error {
  readonly code = 'EGRESS_HOOK_ALREADY_INSTALLED' as const;
  override readonly name = 'EgressHookAlreadyInstalledError';

  constructor() {
    super(
      'installEgressHook() may only be called once per process. ' +
        'Re-installing would compound interception and corrupt telemetry.',
    );
  }
}

/**
 * Returned (as Result.err) from `runTool()` when a subprocess fails.
 */
export class ToolInvocationError extends Error {
  override readonly name = 'ToolInvocationError';

  constructor(
    readonly code: 'EXIT_NONZERO' | 'SPAWN_FAILED' | 'ABORTED' | 'TIMEOUT',
    readonly tool: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    cause?: unknown,
  ) {
    super(
      `runTool(${tool}, [${args.join(', ')}]) failed: ${code} (exit=${exitCode}). stderr=${stderr.slice(0, 256)}`,
    );
    if (cause !== undefined) {
      // Node 16+ Error#cause; preserve for diagnostics.
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Thrown when a Zod-validated payload fails schema validation in a non-telemetry
 * context (e.g., MCP tool input parsing). Telemetry has its own
 * `TelemetryValidationError` in `telemetry.ts`.
 */
export class SchemaValidationError extends Error {
  override readonly name = 'SchemaValidationError';

  constructor(
    readonly schemaName: string,
    readonly details: string,
    cause?: unknown,
  ) {
    super(`Schema validation failed for ${schemaName}: ${details}`);
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

// ============================================================================
// SP-002 — MCP resource error classes (T004 / T024)
// ============================================================================

/**
 * Returned (as Result.err) by document-adapter when a `corpus://docs/{id}`
 * read finds no matching row in `documents` with `status = 'success'`.
 * Maps to MCP error code -32010 at the handler boundary.
 *
 * See specs/002-mcp-resources/contracts/mcp-resources-api.md §"Error contracts"
 * and contracts/resource-document.md.
 */
export class DocumentNotFoundError extends Error {
  readonly code = 'DOCUMENT_NOT_FOUND' as const;
  override readonly name = 'DocumentNotFoundError';
  readonly data: { docId: string };

  constructor(data: { docId: string }) {
    super(`Document not found: id="${data.docId}".`);
    this.data = data;
  }
}

/**
 * Returned (as Result.err) by any resource adapter when a SQLite read
 * exhausts the WAL `busy_timeout` PRAGMA window (default 5000 ms).
 * Maps to MCP error code -32011 at the handler boundary; retriable.
 *
 * See contracts/mcp-resources-api.md §"index_locked envelope" and
 * contracts/resource-document.md §"Error paths".
 */
export class IndexLockedError extends Error {
  readonly code = 'INDEX_LOCKED' as const;
  override readonly name = 'IndexLockedError';
  readonly data: { uri: string };

  constructor(data: { uri: string }) {
    super(
      `Index locked while reading "${data.uri}" — SQLite WAL writer contention exhausted busy_timeout. Retriable.`,
    );
    this.data = data;
  }
}

/**
 * Returned (as Result.err) by document-adapter when the body file's
 * frontmatter `id` does NOT match the requested URI's `{id}` path component.
 * This is a corpus-integrity bug per Constitution VIII (transactional
 * index ↔ document store), NOT a user error. Maps to MCP error code
 * -32603 (Internal error) with severity `error` telemetry.
 */
export class IntegrityLossError extends Error {
  readonly code = 'INTEGRITY_LOSS' as const;
  override readonly name = 'IntegrityLossError';
  readonly data: { requestedId: string; frontmatterFoundId: string };

  constructor(data: { requestedId: string; frontmatterFoundId: string }) {
    super(
      `Integrity loss: URI id "${data.requestedId}" does not match frontmatter id "${data.frontmatterFoundId}".`,
    );
    this.data = data;
  }
}

/**
 * Reserved for SP-004 — thrown when the taxonomy registry fails to parse.
 * Exported but NOT thrown anywhere in SP-002 (resource handlers read SQLite
 * directly, not the JSON registry). Declared here so the SP-004 promotion
 * workflow inherits the error type without a new contracts release.
 */
export class TaxonomyParseError extends Error {
  readonly code = 'TAXONOMY_PARSE_ERROR' as const;
  override readonly name = 'TaxonomyParseError';
  readonly data: { source: string; details: string };

  constructor(data: { source: string; details: string }) {
    super(`Taxonomy parse error in ${data.source}: ${data.details}`);
    this.data = data;
  }
}

/**
 * Thrown at server boot when `config.toml` contains an out-of-range or
 * malformed value for a known key (e.g. `[resources.recent] window_size`
 * outside [1, 100]). Caught at the boot boundary BEFORE `markReady()` —
 * the server fails to start rather than starting with a bad config.
 *
 * See plan.md Decision C, contracts/resource-recent.md §"Window size N".
 */
export class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR' as const;
  override readonly name = 'ConfigurationError';
  readonly data: { key: string; reason: string };

  constructor(data: { key: string; reason: string }) {
    super(`Configuration error: ${data.key} — ${data.reason}`);
    this.data = data;
  }
}

/**
 * Thrown when YAML parsing or markdown-frontmatter splitting fails on a
 * document body file. Wraps the underlying js-yaml error for context.
 */
export class FrontmatterParseError extends Error {
  readonly code = 'FRONTMATTER_PARSE_ERROR' as const;
  override readonly name = 'FrontmatterParseError';
  readonly data: { details: string };

  constructor(data: { details: string }, cause?: unknown) {
    super(`Frontmatter parse error: ${data.details}`);
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

// ============================================================================
// SP-003 — Ingest-pipeline typed errors (PREREQ-004)
// ============================================================================
//
// References:
//   - specs/003-ingest-pipeline/plan.md PREREQ-004
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-007 (closed error_code enum)
//   - Constitution Principle XI (Library/CLI Boundary)
//
// Every library function in packages/{pipeline,extract,storage} returns
// Result<T, E> where E is one of these typed errors. None of these constructors
// performs IO or invokes process.exit (Constitution XI).

/**
 * The closed enum of error codes that ingest stages can surface. Mirrors the
 * `.error.json` sidecar `error_code` field (data-model.md Entity 5) and the
 * Sp003ErrorCode union in telemetry.ts.
 */
export type IngestErrorCode =
  | 'filename_sanity_failed'
  | 'mime_not_allowlisted'
  | 'mime_mismatch'
  | 'size_exceeded'
  | 'file_unstable'
  | 'extract_failed'
  | 'normalize_failed'
  | 'persist_failed'
  | 'telemetry_write_failed'
  | 'aborted';

export type IngestStage = 'validate' | 'normalize' | 'persist';

/**
 * Generic ingest-pipeline error. Specific stage errors below subclass
 * IngestError so callers can pattern-match on `instanceof IngestError` for
 * the common case OR on the specific class for stage-aware handling.
 */
export class IngestError extends Error {
  readonly code = 'INGEST_ERROR' as const;
  override readonly name: string = 'IngestError';
  readonly data: {
    stage?: IngestStage;
    error_code?: IngestErrorCode;
    retriable?: boolean;
    message?: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      stage?: IngestStage;
      error_code?: IngestErrorCode;
      retriable?: boolean;
      message?: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Ingest error${data.stage ? ` (stage=${data.stage})` : ''}${
        data.error_code ? `: ${data.error_code}` : ''
      }${data.message ? ` — ${data.message}` : ''}`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Validation-gate rejection (filename sanity / extension / MIME-sniff / size).
 * The `error_code` field is the FR-INGEST-007 closed enum.
 */
export class ValidationError extends IngestError {
  override readonly name = 'ValidationError';
  override readonly data: {
    error_code: IngestErrorCode;
    message: string;
    file_path?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code: IngestErrorCode;
      message: string;
      file_path?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super({ stage: 'validate', ...data }, cause);
    this.data = data;
  }
}

/**
 * Normalization-stage failure (per-MIME extractor / converter error).
 */
export class NormalizeError extends IngestError {
  override readonly name = 'NormalizeError';
  override readonly data: {
    error_code: IngestErrorCode;
    message?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code: IngestErrorCode;
      message?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super({ stage: 'normalize', ...data }, cause);
    this.data = data;
  }
}

/**
 * Persist-stage failure (SQLite INSERT, body-file rename, transaction
 * rollback, UNIQUE constraint violation, etc.).
 */
export class PersistError extends IngestError {
  override readonly name = 'PersistError';
  override readonly data: {
    error_code: IngestErrorCode;
    message?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code: IngestErrorCode;
      message?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super({ stage: 'persist', ...data }, cause);
    this.data = data;
  }
}

/**
 * Watcher-level failure (inotify exhaustion, fs.watch boot failure, etc.).
 * Routes through the daemon's master AbortController; the daemon emits
 * `inbox.watcher_resource_exhausted` telemetry before exiting.
 */
export class WatcherError extends Error {
  readonly code = 'WATCHER_ERROR' as const;
  override readonly name = 'WatcherError';
  readonly data: {
    errno?: string;
    limit_kind?: string;
    message?: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      errno?: string;
      limit_kind?: string;
      message?: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Watcher error${data.errno ? ` (errno=${data.errno})` : ''}${
        data.message ? ` — ${data.message}` : ''
      }`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

// ============================================================================
// SP-004 — Classifier-stage typed errors (PREREQ-003)
// ============================================================================
//
// References:
//   - specs/004-classifier/plan.md PREREQ-003
//   - specs/004-classifier/spec.md FR-CLASSIFY-017
//   - Constitution Principle XI (Library/CLI Boundary)
//
// All four domain-specific subclasses extend ClassifierError, so callers can
// pattern-match on `instanceof ClassifierError` for the common case OR on the
// specific class for stage-aware handling. ClassifierConfigurationError is
// boot-time error from missing config; it does not extend ClassifierError.

export type ClassifyErrorCode =
  | 'ollama_unavailable'
  | 'schema_invalid'
  | 'vocabulary_violation'
  | 'classify_aborted'
  | 'persist_failed'
  | 'telemetry_write_failed'
  | 'frontmatter_rewrite_failed';

/**
 * Generic classifier-stage error. The four stage-specific subclasses below
 * inherit so callers can pattern-match by category or by class.
 */
export class ClassifierError extends Error {
  readonly code = 'CLASSIFIER_ERROR' as const;
  override readonly name: string = 'ClassifierError';
  readonly data: {
    error_code?: ClassifyErrorCode;
    message?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code?: ClassifyErrorCode;
      message?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Classifier error${data.error_code ? ` (${data.error_code})` : ''}${
        data.message ? `: ${data.message}` : ''
      }`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * The Ollama HTTP endpoint at `http://localhost:11434` was unreachable
 * (ECONNREFUSED, ENETUNREACH, etc.) or the chat request failed at the
 * transport layer. Retriable — the user may restart Ollama and reenrich.
 */
export class OllamaUnavailableError extends ClassifierError {
  override readonly name = 'OllamaUnavailableError';
  override readonly data: {
    errno: string;
    message: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      errno: string;
      message: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'ollama_unavailable',
        retriable: data.retriable ?? true,
        ...data,
      },
      cause,
    );
    this.data = data;
  }
}

/**
 * The Ollama response failed Zod schema validation (FR-CLASSIFY-005
 * defense-in-depth). Retriable — the classifier retries once before this
 * surfaces; the failure-lane sidecar's `retry_count` reports the attempt.
 */
export class SchemaInvalidError extends ClassifierError {
  override readonly name = 'SchemaInvalidError';
  override readonly data: {
    validation_errors: readonly string[];
    message?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      validation_errors: readonly string[];
      message?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'schema_invalid',
        retriable: data.retriable ?? true,
        message: data.message,
      },
      cause,
    );
    this.data = data;
  }
}

/**
 * The classifier emitted a value (`facet_domain` or a `tags[i]`) that is
 * neither in the established-vocabulary snapshot nor in the corresponding
 * `*_proposed` field. FR-CLASSIFY-006 defense-in-depth — the row routes to
 * the failure lane with `error_code='vocabulary_violation'`.
 */
export class VocabularyViolationError extends ClassifierError {
  override readonly name = 'VocabularyViolationError';
  override readonly data: {
    offending_field: 'facet_domain' | 'facet_type' | 'tag';
    offending_value: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      offending_field: 'facet_domain' | 'facet_type' | 'tag';
      offending_value: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'vocabulary_violation',
        retriable: data.retriable ?? true,
      },
      cause,
    );
    this.data = data;
  }
}

/**
 * Paired SQL UPDATE + body-file rewrite transaction failed. ROLLBACK was
 * issued, no SQL or body-file changes persisted, and the tmp body file was
 * cleaned up. The doc row stays sentinel. Retriable on the next classify-
 * stage attempt.
 */
export class ClassifyPersistError extends ClassifierError {
  override readonly name = 'ClassifyPersistError';
  override readonly data: {
    error_code: ClassifyErrorCode;
    message: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code: ClassifyErrorCode;
      message: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: data.error_code,
        retriable: data.retriable ?? true,
        message: data.message,
      },
      cause,
    );
    this.data = data;
  }
}

/**
 * Thrown at OllamaAdapter construction time (or at module boot) when the
 * structured-output `format` parameter is missing, the
 * `CLASSIFIER_OUTPUT_JSON_SCHEMA` failed to render, or the configured model
 * is not loaded locally. Bootstrapping failure — distinct from
 * `ClassifierError` because no doc_id context exists at construction time.
 */
export class ClassifierConfigurationError extends Error {
  readonly code = 'CLASSIFIER_CONFIGURATION_ERROR' as const;
  override readonly name = 'ClassifierConfigurationError';
  readonly data: { key: string; reason: string };

  constructor(data: { key: string; reason: string }) {
    super(`Classifier configuration error: ${data.key} — ${data.reason}`);
    this.data = data;
  }
}

/**
 * Returned (as Result.err) by acquireDrainLock when another drain process
 * already holds the flock. Concurrent invocations exit 0 after emitting
 * `pipeline.lock_contention` telemetry (FR-INGEST-011).
 */
export class LockContentionError extends Error {
  readonly code = 'LOCK_CONTENTION' as const;
  override readonly name = 'LockContentionError';
  readonly data: {
    lock_path: string;
    message?: string;
    [key: string]: unknown;
  };

  constructor(data: {
    lock_path: string;
    message?: string;
    [key: string]: unknown;
  }) {
    super(
      `Lock contention on ${data.lock_path}${
        data.message ? `: ${data.message}` : ''
      }`,
    );
    this.data = data;
  }
}

// ============================================================================
// SP-005 — Retrieval-stage typed errors (PREREQ-003)
// ============================================================================
//
// References:
//   - specs/005-retrieval/plan.md PREREQ-003
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-014
//   - Constitution Principle XI (Library/CLI Boundary)
//
// 9 typed errors — RetrievalError base + 8 subclasses. None invoke
// process.exit; all are throwable / Result.err-wrappable.

export type RetrievalErrorCode =
  | 'embedding_unavailable'
  | 'embedding_dimension_mismatch'
  | 'embedding_validation_failed'
  | 'embed_aborted'
  | 'index_unavailable'
  | 'edges_build_timeout'
  | 'invalid_explicit_related_target'
  | 'edges_aborted'
  | 'persist_failed'
  | 'validation_error'
  | 'query_aborted'
  | 'all_signals_failed'
  | 'internal_error'
  | 'fusion_failed';

/**
 * Base class for the SP-005 retrieval-stage typed errors. Specific subclasses
 * inherit so callers can pattern-match on `instanceof RetrievalError` or on
 * the specific subclass.
 */
export class RetrievalError extends Error {
  readonly code = 'RETRIEVAL_ERROR' as const;
  override readonly name: string = 'RetrievalError';
  readonly data: {
    error_code?: RetrievalErrorCode;
    message?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code?: RetrievalErrorCode;
      message?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Retrieval error${data.error_code ? ` (${data.error_code})` : ''}${
        data.message ? `: ${data.message}` : ''
      }`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** Ollama embedding endpoint unreachable / non-2xx. Retriable. */
export class EmbeddingUnavailableError extends RetrievalError {
  override readonly name = 'EmbeddingUnavailableError';
  override readonly data: {
    errno: string;
    message: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      errno: string;
      message: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'embedding_unavailable',
        retriable: data.retriable ?? true,
        ...data,
      },
      cause,
    );
    this.data = data;
  }
}

/** Ollama embedding length != configured expected dimension. */
export class EmbeddingDimensionMismatchError extends RetrievalError {
  override readonly name = 'EmbeddingDimensionMismatchError';
  override readonly data: {
    expected: number;
    got: number;
    message?: string;
    [key: string]: unknown;
  };

  constructor(data: {
    expected: number;
    got: number;
    message?: string;
    [key: string]: unknown;
  }) {
    super({
      error_code: 'embedding_dimension_mismatch',
      retriable: false,
      message:
        data.message ??
        `Embedding dimension mismatch: expected=${data.expected}, got=${data.got}`,
      ...data,
    });
    this.data = data;
  }
}

/** Ollama embedding contained non-finite entries. */
export class EmbeddingValidationError extends RetrievalError {
  override readonly name = 'EmbeddingValidationError';
  override readonly data: {
    message: string;
    [key: string]: unknown;
  };

  constructor(data: { message: string; [key: string]: unknown }) {
    super({
      error_code: 'embedding_validation_failed',
      retriable: false,
      ...data,
    });
    this.data = data;
  }
}

/** SQLite read failed (FTS5 / vec / edges / DB file). */
export class IndexUnavailableError extends RetrievalError {
  override readonly name = 'IndexUnavailableError';
  override readonly data: {
    signal_kind: 'bm25' | 'dense' | 'graph' | 'confidence';
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      signal_kind: 'bm25' | 'dense' | 'graph' | 'confidence';
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'index_unavailable',
        retriable: true,
        ...data,
      },
      cause,
    );
    this.data = data;
  }
}

/** Edges-build per-doc timeout fired. */
export class EdgesBuildTimeoutError extends RetrievalError {
  override readonly name = 'EdgesBuildTimeoutError';
  override readonly data: {
    doc_id: string;
    timeout_ms: number;
    message?: string;
    [key: string]: unknown;
  };

  constructor(data: {
    doc_id: string;
    timeout_ms: number;
    message?: string;
    [key: string]: unknown;
  }) {
    super({
      error_code: 'edges_build_timeout',
      retriable: true,
      message:
        data.message ??
        `Edges-build timeout for ${data.doc_id} after ${data.timeout_ms}ms`,
      ...data,
    });
    this.data = data;
  }
}

/** Caller's AbortSignal fired before search response was ready. */
export class SearchAbortedError extends RetrievalError {
  override readonly name = 'SearchAbortedError';
  override readonly data: {
    message?: string;
    [key: string]: unknown;
  };

  constructor(data: { message?: string; [key: string]: unknown } = {}) {
    super({
      error_code: 'query_aborted',
      retriable: true,
      message: data.message ?? 'search aborted by caller signal',
      ...data,
    });
    this.data = data;
  }
}

/** Input validation failed against SearchInputZodSchema. */
export class SearchValidationError extends RetrievalError {
  override readonly name = 'SearchValidationError';
  override readonly data: {
    issues: readonly string[];
    message?: string;
    hint?: string;
    [key: string]: unknown;
  };

  constructor(data: {
    issues: readonly string[];
    message?: string;
    hint?: string;
    [key: string]: unknown;
  }) {
    super({
      error_code: 'validation_error',
      retriable: true,
      message: data.message ?? `validation failed: ${data.issues.join('; ')}`,
      ...data,
    });
    this.data = data;
  }
}

/** RRF fusion or output validation produced an internal-error envelope. */
export class FusionError extends RetrievalError {
  override readonly name = 'FusionError';
  override readonly data: {
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: { message: string; [key: string]: unknown },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'fusion_failed',
        retriable: false,
        ...data,
      },
      cause,
    );
    this.data = data;
  }
}

/** Atomic FTS5 + vec + edges INSERT transaction failed. */
export class IndexPersistError extends RetrievalError {
  override readonly name = 'IndexPersistError';
  override readonly data: {
    doc_id: string;
    stage: 'fts5' | 'vec' | 'edges';
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      doc_id: string;
      stage: 'fts5' | 'vec' | 'edges';
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      {
        error_code: 'persist_failed',
        retriable: true,
        ...data,
      },
      cause,
    );
    this.data = data;
  }
}
