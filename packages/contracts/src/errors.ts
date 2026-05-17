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

// ============================================================================
// SP-006 — Production-hardening typed errors (PREREQ-003)
// ============================================================================
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-021
//   - Constitution Principle XI (Library/CLI Boundary)
//
// 6 typed errors — RecoveryScanError base + RecoveryOrphanUnresumableError +
// 4 standalone errors. None invoke process.exit; all are throwable.

export type RecoveryScanReason =
  | 'lock_contention'
  | 'no_prior_session'
  | 'telemetry_unreadable'
  | 'aborted'
  | 'timeout';

/**
 * Base class for the SP-006 recovery-scanner typed errors. Subclasses inherit
 * so callers can pattern-match on `instanceof RecoveryScanError` or on the
 * specific subclass (e.g., RecoveryOrphanUnresumableError).
 */
export class RecoveryScanError extends Error {
  readonly code = 'RECOVERY_SCAN_ERROR' as const;
  override readonly name: string = 'RecoveryScanError';
  readonly data: {
    reason?: RecoveryScanReason | string;
    message?: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      reason?: RecoveryScanReason | string;
      message?: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Recovery scan error${data.reason ? ` (${data.reason})` : ''}${
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
 * The recovery scanner classified an orphan as non-resumable (e.g., the
 * ingest inbox file was deleted during the kill window). Writes a
 * `.recovery.error.json` sidecar at Paths.failed() and surfaces this typed
 * error to the recovery orchestrator.
 */
export class RecoveryOrphanUnresumableError extends RecoveryScanError {
  override readonly name = 'RecoveryOrphanUnresumableError';
  override readonly data: {
    doc_id: string | null;
    stage: 'ingest' | 'classify' | 'embed' | 'index' | 'edges-build';
    reason: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      doc_id: string | null;
      stage: 'ingest' | 'classify' | 'embed' | 'index' | 'edges-build';
      reason: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super({ ...data }, cause);
    this.data = data;
  }
}

/**
 * The corpus://failures resource adapter or handler encountered an error
 * (malformed sidecar, glob failure, validation error). Retriable when the
 * `error_code` indicates a transient condition.
 */
export class FailuresResourceError extends Error {
  readonly code = 'FAILURES_RESOURCE_ERROR' as const;
  override readonly name = 'FailuresResourceError';
  readonly data: {
    error_code: string;
    message: string;
    sidecar_path?: string;
    retriable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code: string;
      message: string;
      sidecar_path?: string;
      retriable?: boolean;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Failures resource error (${data.error_code}): ${data.message}${
        data.sidecar_path ? ` at ${data.sidecar_path}` : ''
      }`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * The tier-fallthrough orchestrator encountered an unrecoverable error
 * (budget exceeded with no partial set, all tiers failed, etc.).
 */
export class TierFallthroughError extends Error {
  readonly code = 'TIER_FALLTHROUGH_ERROR' as const;
  override readonly name = 'TierFallthroughError';
  readonly data: {
    tier: 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep';
    reason: 'budget_exceeded' | 'all_tiers_failed' | 'aborted' | string;
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      tier: 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep';
      reason: 'budget_exceeded' | 'all_tiers_failed' | 'aborted' | string;
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Tier fallthrough error (tier=${data.tier}, reason=${data.reason}): ${data.message}`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * The Tier 2 CATALOG.md flat-file is missing from Paths.data(). The
 * tier-orchestrator emits `search.tier_skipped` and falls through to Tier 3.
 */
export class CatalogMissingError extends Error {
  readonly code = 'CATALOG_MISSING' as const;
  override readonly name = 'CatalogMissingError';
  readonly data: {
    catalog_path: string;
    [key: string]: unknown;
  };

  constructor(data: { catalog_path: string; [key: string]: unknown }) {
    super(`CATALOG.md not found at ${data.catalog_path}`);
    this.data = data;
  }
}

/**
 * The Tier 3 fs-grep subprocess failed (grep not found, ENOENT,
 * non-zero exit). Surfaces as `search.tier_failed` telemetry.
 */
export class GrepSubprocessError extends Error {
  readonly code = 'GREP_SUBPROCESS_ERROR' as const;
  override readonly name = 'GrepSubprocessError';
  readonly data: {
    errno: string;
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: { errno: string; message: string; [key: string]: unknown },
    cause?: unknown,
  ) {
    super(`grep subprocess failed (errno=${data.errno}): ${data.message}`);
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

// ============================================================================
// SP-007 — Install / uninstall / taxonomy-promote typed errors (PREREQ-003)
// ============================================================================
//
// References:
//   - specs/007-install-first-run/spec.md FR-INSTALL-019, SC-007-032
//   - specs/007-install-first-run/tasks.md T004 / T014
//   - Constitution Principle XI (Library/CLI Boundary)
//
// 10 typed errors — every install / uninstall / taxonomy-promote failure
// surface returns Result.err(<typed-error>) (or throws), NEVER process.exit.
// process.exit is reserved for the three CLI command entry points
// (install-command.ts / uninstall-command.ts / taxonomy-promote-command.ts)
// per Constitution XI + FR-INSTALL-019.

/** `corpus init` preflight failure — Node version / Ollama / XDG / partial debris. */
export class InstallPreflightError extends Error {
  readonly code = 'INSTALL_PREFLIGHT_ERROR' as const;
  override readonly name = 'InstallPreflightError';
  readonly data: {
    unmet_requirement: string;
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      unmet_requirement: string;
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Install preflight failed (${data.unmet_requirement}): ${data.message}`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** OS firewall provisioning failed (binary missing / sudo unavailable / pfctl-iptables non-zero). */
export class InstallFirewallProvisionError extends Error {
  readonly code = 'INSTALL_FIREWALL_PROVISION_ERROR' as const;
  override readonly name = 'InstallFirewallProvisionError';
  readonly data: {
    error_code: string;
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      error_code: string;
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Install firewall provision failed (${data.error_code}): ${data.message}`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** MCP-client config mutation failed (malformed JSON / write failure). */
export class InstallMCPClientConfigError extends Error {
  readonly code = 'INSTALL_MCP_CLIENT_CONFIG_ERROR' as const;
  override readonly name = 'InstallMCPClientConfigError';
  readonly data: {
    path: string;
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: { path: string; message: string; [key: string]: unknown },
    cause?: unknown,
  ) {
    super(`Install MCP-client config mutation failed (${data.path}): ${data.message}`);
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** Install-receipt atomic write failed. */
export class InstallReceiptWriteError extends Error {
  readonly code = 'INSTALL_RECEIPT_WRITE_ERROR' as const;
  override readonly name = 'InstallReceiptWriteError';
  readonly data: { message: string; [key: string]: unknown };

  constructor(
    data: { message: string; [key: string]: unknown },
    cause?: unknown,
  ) {
    super(`Install receipt write failed: ${data.message}`);
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** 90-second `corpus init` budget exceeded; AbortController fired. */
export class InstallBudgetExceededError extends Error {
  readonly code = 'INSTALL_BUDGET_EXCEEDED' as const;
  override readonly name = 'InstallBudgetExceededError';
  readonly data: {
    elapsed_ms: number;
    budget_ms: number;
    [key: string]: unknown;
  };

  constructor(data: {
    elapsed_ms: number;
    budget_ms: number;
    [key: string]: unknown;
  }) {
    super(
      `Install budget exceeded: elapsed=${data.elapsed_ms}ms > budget=${data.budget_ms}ms`,
    );
    this.data = data;
  }
}

/**
 * `corpus uninstall` preflight failed because the install-receipt is missing,
 * malformed, or fails Zod (e.g., `schema_version: 2`). ZERO destructive ops
 * occur before this fires.
 */
export class UninstallReceiptMissingError extends Error {
  readonly code = 'UNINSTALL_RECEIPT_MISSING' as const;
  override readonly name = 'UninstallReceiptMissingError';
  readonly data: {
    receipt_path: string;
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      receipt_path: string;
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Uninstall preflight failed (receipt at ${data.receipt_path}): ${data.message}`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** OS firewall reverse-command (recorded in install-receipt) failed during uninstall. */
export class UninstallFirewallReverseError extends Error {
  readonly code = 'UNINSTALL_FIREWALL_REVERSE_ERROR' as const;
  override readonly name = 'UninstallFirewallReverseError';
  readonly data: {
    reverse_command: { cmd: string; args: readonly string[] };
    message: string;
    [key: string]: unknown;
  };

  constructor(
    data: {
      reverse_command: { cmd: string; args: readonly string[] };
      message: string;
      [key: string]: unknown;
    },
    cause?: unknown,
  ) {
    super(
      `Uninstall firewall reverse (${data.reverse_command.cmd}) failed: ${data.message}`,
    );
    this.data = data;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * `corpus taxonomy promote` could not acquire `Paths.drainLock()` — another
 * drain process (typically the daemon) is holding the lock. ZERO SQL writes
 * occur before this fires.
 */
export class TaxonomyPromoteLockContentionError extends Error {
  readonly code = 'TAXONOMY_PROMOTE_LOCK_CONTENTION' as const;
  override readonly name = 'TaxonomyPromoteLockContentionError';
  readonly data: {
    lock_path: string;
    lock_holder_hint?: string;
    [key: string]: unknown;
  };

  constructor(data: {
    lock_path: string;
    lock_holder_hint?: string;
    [key: string]: unknown;
  }) {
    super(
      `Taxonomy promote lock contention at ${data.lock_path}${
        data.lock_holder_hint !== undefined
          ? ` (holder hint: ${data.lock_holder_hint})`
          : ''
      }`,
    );
    this.data = data;
  }
}

/**
 * `corpus taxonomy promote --axis=<v> --term=<t>` could not find a matching
 * `(axis, term)` row in `taxonomy_terms`. ROLLBACKs the transaction; ZERO
 * SQL writes persist.
 */
export class TaxonomyPromoteMissingTermError extends Error {
  readonly code = 'TAXONOMY_PROMOTE_MISSING_TERM' as const;
  override readonly name = 'TaxonomyPromoteMissingTermError';
  readonly data: {
    axis: string;
    term: string;
    [key: string]: unknown;
  };

  constructor(data: { axis: string; term: string; [key: string]: unknown }) {
    super(`Taxonomy promote missing term: ${data.axis}/${data.term}`);
    this.data = data;
  }
}

/**
 * `corpus taxonomy promote` argv failed `TaxonomyPromoteArgsZodSchema`
 * (unknown axis, mixed --axis/--term + --from-proposed-with-count-ge,
 * empty terms, negative threshold).
 */
export class TaxonomyPromoteArgsError extends Error {
  readonly code = 'TAXONOMY_PROMOTE_ARGS_ERROR' as const;
  override readonly name = 'TaxonomyPromoteArgsError';
  readonly data: {
    issues: readonly string[];
    message: string;
    [key: string]: unknown;
  };

  constructor(data: {
    issues: readonly string[];
    message: string;
    [key: string]: unknown;
  }) {
    super(`Taxonomy promote args error: ${data.message}`);
    this.data = data;
  }
}

// ============================================================================
// SP-008 typed errors — engagement-proxy + corpus accept
//
// References:
//   - specs/008-user-acceptance/data-model.md "Schema migration delta — errors.ts"
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-002, FR-ENGAGEMENT-017
//   - Constitution Principle XI (library code never `process.exit`s; CLI
//     entry points are the ONLY layer permitted to translate these errors
//     into exit codes).
// ============================================================================

/**
 * Thrown by `packages/cli/src/engagement/telemetry-log-scanner.ts` when a
 * telemetry-log line fails JSON parse or Zod validation against the
 * `TelemetryEvent` discriminated union.
 *
 * The scanner skips the line, increments `parse_errors_count` in the
 * in-flight report, AND emits an `engagement.report_telemetry_parse_failed`
 * event before re-raising this error to the caller IFF the caller opts into
 * strict mode. In permissive mode (the default for the report flow) the
 * scanner swallows the line + emits the event + continues; the caller never
 * sees this error.
 */
export class EngagementProxyTelemetryParseError extends Error {
  readonly code = 'ENGAGEMENT_PROXY_TELEMETRY_PARSE' as const;
  override readonly name = 'EngagementProxyTelemetryParseError';
  readonly data: {
    line_number?: number;
    error_message: string;
    telemetry_log_path: string;
    [key: string]: unknown;
  };

  constructor(data: {
    line_number?: number;
    error_message: string;
    telemetry_log_path: string;
    [key: string]: unknown;
  }) {
    super(
      `Engagement-proxy telemetry parse failed at ${data.telemetry_log_path}` +
        `${data.line_number !== undefined ? `:${data.line_number}` : ''}: ${data.error_message}`,
    );
    this.data = data;
  }
}

/**
 * Thrown by
 * `packages/cli/src/engagement/engagement-proxy-report-args-parser.ts`
 * when `--since` / `--until` are malformed ISO-8601 OR `since > until`.
 *
 * Catch site: `engagement-proxy-command.ts` translates to stderr + non-zero
 * exit per FR-ENGAGEMENT-017.
 */
export class EngagementProxyWindowInvalidError extends Error {
  readonly code = 'ENGAGEMENT_PROXY_WINDOW_INVALID' as const;
  override readonly name = 'EngagementProxyWindowInvalidError';
  readonly data: {
    since: string;
    until: string;
    reason: string;
    [key: string]: unknown;
  };

  constructor(data: {
    since: string;
    until: string;
    reason: string;
    [key: string]: unknown;
  }) {
    super(
      `Engagement-proxy window invalid: since=${data.since} until=${data.until} (${data.reason})`,
    );
    this.data = data;
  }
}

/**
 * Thrown by `packages/cli/src/engagement/acceptance-event-writer.ts` when
 * the supplied `request_id` has NO matching `engagement.corpus_find_invoked`
 * event in the telemetry log.
 *
 * Catch site: `accept-command.ts` translates to stderr + exit 1 per
 * FR-ENGAGEMENT-002 + FR-ENGAGEMENT-017.
 */
export class AcceptUnknownRequestIdError extends Error {
  readonly code = 'ACCEPT_UNKNOWN_REQUEST_ID' as const;
  override readonly name = 'AcceptUnknownRequestIdError';
  readonly data: {
    request_id: string;
    telemetry_log_path: string;
    [key: string]: unknown;
  };

  constructor(data: {
    request_id: string;
    telemetry_log_path: string;
    [key: string]: unknown;
  }) {
    super(
      `unknown request_id: ${data.request_id} (no matching engagement.corpus_find_invoked in ${data.telemetry_log_path})`,
    );
    this.data = data;
  }
}

/**
 * Thrown by `packages/cli/src/engagement/acceptance-event-writer.ts` when the
 * matching `engagement.corpus_find_invoked` event has `result_count === 0`.
 *
 * Zero-result queries are valid (emitted + counted as queries) but cannot be
 * the target of `corpus accept` per FR-ENGAGEMENT-002.
 *
 * Catch site: `accept-command.ts` translates to stderr + exit 1.
 */
export class AcceptZeroResultQueryError extends Error {
  readonly code = 'ACCEPT_ZERO_RESULT_QUERY' as const;
  override readonly name = 'AcceptZeroResultQueryError';
  readonly data: {
    request_id: string;
    [key: string]: unknown;
  };

  constructor(data: { request_id: string; [key: string]: unknown }) {
    super(`cannot accept zero-result query: ${data.request_id}`);
    this.data = data;
  }
}

/**
 * INFORMATIONAL (NOT a failure) — used internally by the acceptance-event
 * writer to signal the idempotent no-op path per FR-ENGAGEMENT-002 +
 * Constitution X (idempotency).
 *
 * Catch site: `accept-command.ts` translates to stdout
 * "already accepted: <request-id> at <prior_timestamp>" + exit 0.
 *
 * ZERO duplicate `engagement.acceptance_event` is written to the telemetry
 * log when this is thrown.
 */
export class AcceptDuplicateRequestIdError extends Error {
  readonly code = 'ACCEPT_DUPLICATE_REQUEST_ID' as const;
  override readonly name = 'AcceptDuplicateRequestIdError';
  readonly data: {
    request_id: string;
    prior_acceptance_timestamp: string;
    [key: string]: unknown;
  };

  constructor(data: {
    request_id: string;
    prior_acceptance_timestamp: string;
    [key: string]: unknown;
  }) {
    super(
      `already accepted: ${data.request_id} at ${data.prior_acceptance_timestamp}`,
    );
    this.data = data;
  }
}
