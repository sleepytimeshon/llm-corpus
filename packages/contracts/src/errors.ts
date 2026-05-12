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
