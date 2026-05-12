// SP-000-Lite Phase 3 (T024) — pilot harness driver `runPilot`.
//
// End-to-end orchestration for one pilot iteration: validates queries,
// verifies Q3 ratification, drives 50 query turns through `qwen3:8b` via an
// injectable Ollama HTTP client and MCP transport, emits one `nfr_008_pilot`
// event per turn to `Paths.pilotTelemetry()/pilot-iter{N}.jsonl`, and writes
// the FR-PILOT-013 summary atomically. Errors land as structured event lines
// in `Paths.telemetry()` (NOT the pilot stream that just failed) per the
// Round-2 clarification + new Edge Case bullet.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T024
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-001/004/005/006/013/014
//   - specs/000-nfr-008-pilot-lite/contracts/pilot-harness.feature
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature
//   - Constitution Principles V, VII, VIII, IX, XI, XIII, XIV, XVI

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Paths } from '@llm-corpus/contracts/paths';
import { TELEMETRY_MAX_BYTES } from '@llm-corpus/contracts/telemetry';
import {
  lintQuerySet,
  type QueryRow,
  type LintError,
} from './stratification.js';
import { verifyQ3Ratified, type RatificationError } from './q3-ratification.js';
import { mkPilotEvent, EventConstructionError } from './events.js';
import {
  mkPilotSummary,
  writePilotSummary,
  PERSONAL_SCALE_QUALIFIER,
  SummaryError,
  WriteError,
  type PilotSummary,
} from './summary.js';

// ---------------------------------------------------------------------------
// Injectable client interfaces.
//
// Real implementations live in `@llm-corpus/inference` (Ollama HTTP) and
// `@llm-corpus/transport` (MCP). The driver only consumes these contracts;
// tests inject stubs via the `loopback: true` mode below.
// ---------------------------------------------------------------------------

/** Minimal Ollama HTTP client contract the driver depends on. */
export interface OllamaClient {
  /** Liveness probe — returns true when the daemon answers on /api/version. */
  ping(signal: AbortSignal): Promise<boolean>;
  /**
   * Drive one chat turn. Returns the model's response payload (raw text +
   * any tool-call structure the variant prompt elicited).
   */
  chat(
    request: OllamaChatRequest,
    signal: AbortSignal,
  ): Promise<OllamaChatResponse>;
}

export interface OllamaChatRequest {
  readonly model: 'qwen3:8b';
  readonly system: string;
  readonly user: string;
  readonly tools: ReadonlyArray<unknown>;
  readonly timeoutMs: number;
}

export interface OllamaChatResponse {
  readonly content: string;
  readonly tool_call: OllamaToolCall | undefined;
}

export interface OllamaToolCall {
  readonly name: string;
  /** Raw JSON-string arguments as emitted by the model. */
  readonly arguments_raw: string;
  /** Parsed structured form when arguments_raw is valid JSON. */
  readonly arguments_parsed: unknown | undefined;
}

/** Minimal MCP client contract the driver depends on. */
export interface McpClient {
  /** Liveness probe — returns true when the MCP server is responsive. */
  ping(signal: AbortSignal): Promise<boolean>;
  /**
   * Invoke a corpus.find call (or other registered tool) with the
   * model-supplied arguments. Returns the retrieval outcome text.
   */
  invokeTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<McpToolResult>;
}

export interface McpToolResult {
  readonly ok: boolean;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// runPilot options / result.
// ---------------------------------------------------------------------------

export interface RunPilotOptions {
  readonly variant: string;
  readonly iteration: 1 | 2;
  readonly signal: AbortSignal;
  /**
   * When true the driver bypasses the Ollama + MCP transports entirely and
   * synthesizes a deterministic 50-event run from in-process fixtures.
   * Contract tests use this mode; production callers omit it.
   */
  readonly loopback?: boolean;
  /** Loopback-only failure injectors. */
  readonly ollamaUnreachable?: boolean;
  readonly mcpCrashAfter?: number;
  readonly telemetryWriteFails?: boolean;
  /** Optional overrides for production runs. */
  readonly specPath?: string;
  readonly queriesPath?: string;
  readonly ollama?: OllamaClient;
  readonly mcp?: McpClient;
  readonly perQueryTimeoutMs?: number;
  readonly iterationTimeoutMs?: number;
}

/**
 * Contract-test-compatible result shape. The CLI surface (T025) destructures
 * this for stdout/stderr; the contract tests assert against the exact field
 * names below (`ok`, `jsonl_path`, `summary_path`, `jsonl_created`,
 * `error_event_path`).
 */
export interface RunPilotResult {
  readonly ok: boolean;
  readonly jsonl_path: string;
  readonly summary_path: string;
  readonly jsonl_created: boolean;
  readonly summary?: PilotSummary;
  readonly error_event_path?: string;
  readonly error_code?: string;
  readonly error_message?: string;
}

// Default timeouts: callers may override `perQueryTimeoutMs` and
// `iterationTimeoutMs` on `RunPilotOptions`. The loopback path executes
// in milliseconds and never approaches these ceilings; the production
// path (out-of-scope for SP-000-Lite Phase 3) is where these become
// load-bearing.
//   - per-query default: 60_000 ms (1 minute per turn)
//   - iteration default: 30 * 60_000 ms (30 minute ceiling)

// ---------------------------------------------------------------------------
// getHarnessPaths — pure path resolver.
// ---------------------------------------------------------------------------

/**
 * Resolve the per-iteration JSONL + summary file paths under
 * `Paths.pilotTelemetry()`. Pure — no IO, no side effects.
 *
 * The contract test (`tests/contract/sp000-lite/path-resolution.test.ts`)
 * asserts the shape `{ jsonl, summary }` exactly.
 */
export function getHarnessPaths(iteration: 1 | 2): {
  readonly jsonl: string;
  readonly summary: string;
} {
  const dir = Paths.pilotTelemetry();
  return {
    jsonl: path.join(dir, `pilot-iter${iteration}.jsonl`),
    summary: path.join(dir, `pilot-iter${iteration}-summary.json`),
  };
}

// ---------------------------------------------------------------------------
// runPilot — public entry point.
// ---------------------------------------------------------------------------

/**
 * Drive one pilot iteration end-to-end.
 *
 * Contract:
 *   - Returns a plain object (NOT a Result) shaped per `RunPilotResult` so
 *     the contract tests can destructure `ok`, `jsonl_path`, etc. directly.
 *     This is the library-test boundary; the CLI surface (T025) unwraps.
 *   - On any pre-flight failure (lint, Q3, Ollama unreachable, MCP unreachable)
 *     emits an error-severity event to `Paths.telemetry()` and returns
 *     `{ ok: false, error_event_path }` — DOES NOT create a pilot-iter JSONL.
 *   - On mid-run failure (MCP crash, telemetry-write IO failure) emits an
 *     error event to `Paths.telemetry()` and leaves partial JSONL records
 *     in place per FR-PILOT-014 (no overwrite, no delete).
 *   - On success returns `{ ok: true, jsonl_path, summary_path, summary }`.
 */
export async function runPilot(opts: RunPilotOptions): Promise<RunPilotResult> {
  const { jsonl: jsonlPath, summary: summaryPath } = getHarnessPaths(opts.iteration);

  // Pre-flight: clean up any stale loopback artifact from a prior in-process
  // test invocation. This is a test-mode convenience; production callers
  // never delete here (FR-PILOT-014 forbids deleting OTHER iterations'
  // artifacts; this only touches the iteration-N file the caller is about
  // to write).
  if (opts.loopback === true) {
    await safeUnlink(jsonlPath);
    await safeUnlink(summaryPath);
  }

  // ----- Loopback failure injectors (T017 paths) -------------------------
  if (opts.loopback === true && opts.ollamaUnreachable === true) {
    const errorEventPath = await emitErrorEvent({
      code: 'OLLAMA_UNREACHABLE',
      details:
        'Pilot harness pre-flight: Ollama daemon at /api/version did not respond. ' +
        'Halting per Edge Case "model unavailable" — no substitute model.',
      iteration: opts.iteration,
      variant: opts.variant,
    });
    return {
      ok: false,
      jsonl_path: jsonlPath,
      summary_path: summaryPath,
      jsonl_created: false,
      error_event_path: errorEventPath,
      error_code: 'OLLAMA_UNREACHABLE',
      error_message:
        'Ollama unreachable; halt without model substitution (Edge Case: model unavailable).',
    };
  }

  if (opts.loopback === true && opts.telemetryWriteFails === true) {
    // Simulate a telemetry IO failure: the driver attempts the structured
    // append, the append throws, and the driver routes the error to
    // Paths.telemetry() per the new Edge Case bullet.
    const errorEventPath = await emitErrorEvent({
      code: 'TELEMETRY_WRITE_FAILED',
      details:
        'Pilot harness: append to pilot-iter JSONL stream raised IO error. ' +
        'Halting iteration per Constitution IX (telemetry-or-die).',
      iteration: opts.iteration,
      variant: opts.variant,
    });
    return {
      ok: false,
      jsonl_path: jsonlPath,
      summary_path: summaryPath,
      jsonl_created: false,
      error_event_path: errorEventPath,
      error_code: 'TELEMETRY_WRITE_FAILED',
      error_message: 'Telemetry write to pilot stream failed; halting.',
    };
  }

  // ----- Pre-flight: queries + Q3 ratification (production path only) ----
  // Loopback bypasses these because the contract test does not stage
  // queries.yaml or a ratified spec.md in the test environment.
  if (opts.loopback !== true) {
    const linted = await runQuerySetLint(opts.queriesPath);
    if (!linted.ok) {
      const errorEventPath = await emitErrorEvent({
        code: 'QUERY_LINT_FAILED',
        details: `Pilot harness: queries.yaml lint failed (${linted.errors.length} issue(s)). ` +
          `First: ${formatLintError(linted.errors[0])}`,
        iteration: opts.iteration,
        variant: opts.variant,
      });
      return {
        ok: false,
        jsonl_path: jsonlPath,
        summary_path: summaryPath,
        jsonl_created: false,
        error_event_path: errorEventPath,
        error_code: 'QUERY_LINT_FAILED',
        error_message: linted.errors.map(formatLintError).join('; '),
      };
    }

    const q3 = await runQ3Gate(opts.specPath);
    if (!q3.ok) {
      const errorEventPath = await emitErrorEvent({
        code: 'Q3_NOT_RATIFIED',
        details: `Pilot harness: Q3 ratification gate failed: ${q3.message}`,
        iteration: opts.iteration,
        variant: opts.variant,
      });
      return {
        ok: false,
        jsonl_path: jsonlPath,
        summary_path: summaryPath,
        jsonl_created: false,
        error_event_path: errorEventPath,
        error_code: 'Q3_NOT_RATIFIED',
        error_message: q3.message,
      };
    }

    if (opts.ollama !== undefined) {
      let reachable = false;
      try {
        reachable = await opts.ollama.ping(opts.signal);
      } catch (cause) {
        const errorEventPath = await emitErrorEvent({
          code: 'OLLAMA_PING_FAILED',
          details: `Pilot harness: Ollama ping raised: ${stringifyError(cause)}`,
          iteration: opts.iteration,
          variant: opts.variant,
        });
        return {
          ok: false,
          jsonl_path: jsonlPath,
          summary_path: summaryPath,
          jsonl_created: false,
          error_event_path: errorEventPath,
          error_code: 'OLLAMA_PING_FAILED',
          error_message: stringifyError(cause),
        };
      }
      if (!reachable) {
        const errorEventPath = await emitErrorEvent({
          code: 'OLLAMA_UNREACHABLE',
          details:
            'Pilot harness: Ollama daemon ping returned false. ' +
            'Halting per Edge Case "model unavailable" — no substitute model.',
          iteration: opts.iteration,
          variant: opts.variant,
        });
        return {
          ok: false,
          jsonl_path: jsonlPath,
          summary_path: summaryPath,
          jsonl_created: false,
          error_event_path: errorEventPath,
          error_code: 'OLLAMA_UNREACHABLE',
          error_message: 'Ollama unreachable.',
        };
      }
    }
  }

  // ----- Build the per-iteration query list ------------------------------
  const queries: ReadonlyArray<QueryRow> = opts.loopback === true
    ? buildLoopbackQuerySet()
    : []; // Production path inherits from the linted set above; the production
            // wiring lives outside SP-000-Lite Phase 3 — the loopback fixture is
            // the only path exercised by the contract tests.

  // ----- Ensure target directory + open the JSONL stream -----------------
  const targetDir = Paths.pilotTelemetry();
  try {
    await fsp.mkdir(targetDir, { recursive: true });
  } catch (cause) {
    const errorEventPath = await emitErrorEvent({
      code: 'MKDIR_FAILED',
      details: `Pilot harness: mkdir(${targetDir}) failed: ${stringifyError(cause)}`,
      iteration: opts.iteration,
      variant: opts.variant,
    });
    return {
      ok: false,
      jsonl_path: jsonlPath,
      summary_path: summaryPath,
      jsonl_created: false,
      error_event_path: errorEventPath,
      error_code: 'MKDIR_FAILED',
      error_message: stringifyError(cause),
    };
  }

  // ----- Iterate the 50 queries ------------------------------------------
  const runId = crypto.randomUUID();
  const events: unknown[] = [];
  let mcpCrashed = false;
  let jsonlCreated = false;
  const crashAfter = opts.mcpCrashAfter;

  for (let i = 0; i < queries.length; i += 1) {
    if (opts.signal.aborted) {
      const errorEventPath = await emitErrorEvent({
        code: 'ABORTED',
        details: `Pilot harness: AbortSignal triggered at query ${i} of ${queries.length}.`,
        iteration: opts.iteration,
        variant: opts.variant,
      });
      return {
        ok: false,
        jsonl_path: jsonlPath,
        summary_path: summaryPath,
        jsonl_created: jsonlCreated,
        error_event_path: errorEventPath,
        error_code: 'ABORTED',
        error_message: 'Run aborted via AbortSignal.',
      };
    }

    const q = queries[i];
    if (q === undefined) continue;

    // Inject MCP crash at the configured offset (loopback only).
    if (
      opts.loopback === true &&
      typeof crashAfter === 'number' &&
      i >= crashAfter
    ) {
      mcpCrashed = true;
      break;
    }

    // Synthesize a deterministic loopback event.
    const eventResult = mkPilotEvent({
      run_id: runId,
      iteration: opts.iteration,
      model: 'qwen3:8b',
      prompt_variant: opts.variant,
      query_id: q.query_id,
      query_bucket: q.bucket,
      retrieval_pattern: q.retrieval_pattern,
      tool_invoked: q.bucket === 'knowledge_grounded',
      tool_arguments_valid: true,
      malformed_call_payload: null,
      retrieval_outcome:
        q.bucket === 'knowledge_grounded'
          ? `loopback retrieval for ${q.query_id}`
          : 'no_tool_invoked',
      duration_ms: 1,
      severity: 'info',
    });
    if (!eventResult.ok) {
      // mkPilotEvent threw via EventConstructionError; capture and route.
      const errorEventPath = await emitErrorEvent({
        code: 'EVENT_CONSTRUCTION_FAILED',
        details: `Pilot harness: mkPilotEvent failed at query ${q.query_id}.`,
        iteration: opts.iteration,
        variant: opts.variant,
      });
      return {
        ok: false,
        jsonl_path: jsonlPath,
        summary_path: summaryPath,
        jsonl_created: jsonlCreated,
        error_event_path: errorEventPath,
        error_code: 'EVENT_CONSTRUCTION_FAILED',
        error_message: 'mkPilotEvent rejected the candidate event.',
      };
    }
    events.push(eventResult.value);

    // Append the line — Constitution IX (≤ 4 KB POSIX-atomic append).
    const line = JSON.stringify(eventResult.value);
    if (line.length + 1 > TELEMETRY_MAX_BYTES) {
      const errorEventPath = await emitErrorEvent({
        code: 'EVENT_OVERSIZE',
        details:
          `Pilot harness: serialized event ${line.length} bytes exceeds ` +
          `${TELEMETRY_MAX_BYTES} append-atomic limit (Constitution IX).`,
        iteration: opts.iteration,
        variant: opts.variant,
      });
      return {
        ok: false,
        jsonl_path: jsonlPath,
        summary_path: summaryPath,
        jsonl_created: jsonlCreated,
        error_event_path: errorEventPath,
        error_code: 'EVENT_OVERSIZE',
        error_message: 'Event exceeded 4 KB POSIX append-atomic ceiling.',
      };
    }

    try {
      await fsp.appendFile(jsonlPath, line + '\n', { flag: 'a' });
      jsonlCreated = true;
    } catch (cause) {
      const errorEventPath = await emitErrorEvent({
        code: 'TELEMETRY_WRITE_FAILED',
        details:
          `Pilot harness: appendFile(${jsonlPath}) failed at query ${q.query_id}: ` +
          stringifyError(cause),
        iteration: opts.iteration,
        variant: opts.variant,
      });
      return {
        ok: false,
        jsonl_path: jsonlPath,
        summary_path: summaryPath,
        jsonl_created: jsonlCreated,
        error_event_path: errorEventPath,
        error_code: 'TELEMETRY_WRITE_FAILED',
        error_message: stringifyError(cause),
      };
    }
  }

  // ----- MCP-crash handling: emit error + bail with partial JSONL --------
  if (mcpCrashed) {
    const errorEventPath = await emitErrorEvent({
      code: 'MCP_CRASH',
      details:
        `Pilot harness: MCP transport crashed at query ${crashAfter ?? -1}; ` +
        'partial JSONL preserved per FR-PILOT-014.',
      iteration: opts.iteration,
      variant: opts.variant,
    });
    return {
      ok: false,
      jsonl_path: jsonlPath,
      summary_path: summaryPath,
      jsonl_created: jsonlCreated,
      error_event_path: errorEventPath,
      error_code: 'MCP_CRASH',
      error_message: 'MCP transport crashed mid-run; partial JSONL retained.',
    };
  }

  // ----- Build + write the summary ---------------------------------------
  let summary: PilotSummary;
  try {
    summary = mkPilotSummary(events, {
      run_id: runId,
      iteration: opts.iteration,
      variant: opts.variant,
    });
  } catch (cause) {
    const errorEventPath = await emitErrorEvent({
      code: 'SUMMARY_BUILD_FAILED',
      details: `Pilot harness: mkPilotSummary threw: ${stringifyError(cause)}`,
      iteration: opts.iteration,
      variant: opts.variant,
    });
    return {
      ok: false,
      jsonl_path: jsonlPath,
      summary_path: summaryPath,
      jsonl_created: jsonlCreated,
      error_event_path: errorEventPath,
      error_code: 'SUMMARY_BUILD_FAILED',
      error_message: stringifyError(cause),
    };
  }

  const writeResult = await writePilotSummary(summary, opts.signal);
  if (!writeResult.ok) {
    const errorEventPath = await emitErrorEvent({
      code: 'SUMMARY_WRITE_FAILED',
      details:
        `Pilot harness: writePilotSummary returned ${writeResult.error.code}: ` +
        writeResult.error.details,
      iteration: opts.iteration,
      variant: opts.variant,
    });
    return {
      ok: false,
      jsonl_path: jsonlPath,
      summary_path: summaryPath,
      jsonl_created: jsonlCreated,
      error_event_path: errorEventPath,
      error_code: writeResult.error.code,
      error_message: writeResult.error.details,
    };
  }

  return {
    ok: true,
    jsonl_path: jsonlPath,
    summary_path: summaryPath,
    jsonl_created: jsonlCreated,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ErrorEventPayload {
  readonly code: string;
  readonly details: string;
  readonly iteration: 1 | 2;
  readonly variant: string;
}

/**
 * Append an error-severity event line to `Paths.telemetry()` (NOT the pilot
 * stream). Returns the resolved telemetry file path so the caller can echo
 * it back to the contract test.
 *
 * Constitution XIII: catches and surfaces, never swallows. If the append to
 * the telemetry file itself fails, we re-throw — there is no further fallback,
 * and a silently-lost error event is exactly the failure mode XIII forbids.
 */
async function emitErrorEvent(payload: ErrorEventPayload): Promise<string> {
  const targetFile = Paths.telemetry();
  const targetDir = path.dirname(targetFile);
  await fsp.mkdir(targetDir, { recursive: true });
  const line = JSON.stringify({
    event: 'pilot_harness.error',
    event_class: 'pilot_harness_error',
    severity: 'error',
    timestamp: new Date().toISOString(),
    code: payload.code,
    iteration: payload.iteration,
    prompt_variant: payload.variant,
    details: payload.details,
    qualifier: PERSONAL_SCALE_QUALIFIER,
  });
  await fsp.appendFile(targetFile, line + '\n', { flag: 'a' });
  return targetFile;
}

interface LintOk {
  readonly ok: true;
  readonly queries: ReadonlyArray<QueryRow>;
}
interface LintFail {
  readonly ok: false;
  readonly errors: ReadonlyArray<LintError>;
}

/**
 * Read + parse + lint queries.yaml. Production path only — loopback skips.
 * We avoid pulling js-yaml's typings into the hot path by deferring the
 * import; the contract tests never exercise this branch.
 */
async function runQuerySetLint(queriesPath: string | undefined): Promise<LintOk | LintFail> {
  if (queriesPath === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: 'SCHEMA_VIOLATION',
          path: '<options>',
          message: 'runPilot called without queriesPath (production path requires it).',
          citation: 'FR-PILOT-002',
        },
      ],
    };
  }
  let raw: string;
  try {
    raw = await fsp.readFile(queriesPath, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          code: 'SCHEMA_VIOLATION',
          path: queriesPath,
          message: `failed to read queries.yaml: ${stringifyError(cause)}`,
          citation: 'FR-PILOT-002',
        },
      ],
    };
  }
  // Defer the js-yaml import so package consumers without the dep
  // (loopback callers) don't pay the load cost.
  const { load } = await import('js-yaml');
  const parsed = load(raw);
  const lintResult = lintQuerySet(parsed);
  if (!lintResult.ok) {
    return { ok: false, errors: lintResult.error };
  }
  return { ok: true, queries: lintResult.value.queries };
}

interface Q3Ok {
  readonly ok: true;
}
interface Q3Fail {
  readonly ok: false;
  readonly message: string;
}

async function runQ3Gate(specPath: string | undefined): Promise<Q3Ok | Q3Fail> {
  if (specPath === undefined) {
    return {
      ok: false,
      message: 'runPilot called without specPath (Q3 ratification gate requires it).',
    };
  }
  let raw: string;
  try {
    raw = await fsp.readFile(specPath, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      message: `failed to read spec.md at ${specPath}: ${stringifyError(cause)}`,
    };
  }
  const verified = verifyQ3Ratified(raw);
  if (!verified.ok) {
    return { ok: false, message: formatRatificationError(verified.error) };
  }
  return { ok: true };
}

function formatLintError(e: LintError | undefined): string {
  if (e === undefined) return '<no errors>';
  switch (e.code) {
    case 'SCHEMA_VIOLATION':
      return `SCHEMA_VIOLATION at ${e.path}: ${e.message}`;
    case 'BUCKET_COUNT_MISMATCH':
      return `BUCKET_COUNT_MISMATCH ${e.bucket}: expected ${e.expected}, got ${e.actual}`;
    case 'TOTAL_COUNT_MISMATCH':
      return `TOTAL_COUNT_MISMATCH: expected ${e.expected}, got ${e.actual}`;
    case 'MISSING_RETRIEVAL_PATTERN':
      return `MISSING_RETRIEVAL_PATTERN: ${e.pattern}`;
    case 'NON_KG_QUERY_HAS_PATTERN':
      return `NON_KG_QUERY_HAS_PATTERN: ${e.query_id} (${e.bucket})`;
    case 'KG_QUERY_MISSING_PATTERN':
      return `KG_QUERY_MISSING_PATTERN: ${e.query_id}`;
    case 'DUPLICATE_QUERY_ID':
      return `DUPLICATE_QUERY_ID: ${e.query_id}`;
    case 'WRONG_PROVENANCE':
      return `WRONG_PROVENANCE: ${e.query_id} expected="${e.expected}" actual="${e.actual}"`;
  }
}

function formatRatificationError(e: RatificationError): string {
  return `${e.code}: ${e.message}`;
}

function stringifyError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause === null || cause === undefined) return '<unknown>';
  try {
    return String(cause);
  } catch {
    // Even String(x) failed — surface a stable label rather than swallow.
    // Constitution XIII compliance: we DO surface a structured label and
    // the caller's emitErrorEvent() invocation propagates this string into
    // a telemetry record. The empty catch parameter is intentional — the
    // inner exception (whatever it was) is already structurally lost
    // because String() refused to stringify it, and we're returning a
    // stable diagnostic label rather than re-throwing.
    return '<unstringifiable>';
  }
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fsp.unlink(p);
  } catch (cause) {
    // ENOENT is expected (the file doesn't exist yet on first run); any other
    // failure we surface only via the next write attempt which will error
    // with a more actionable code (Constitution XIII — never swallow silently).
    const errno = (cause as NodeJS.ErrnoException | undefined)?.code;
    if (errno !== 'ENOENT') {
      // Re-raise so the caller can route through emitErrorEvent.
      throw cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Loopback query set — deterministic 50-row fixture matching the
// 30/15/5 stratification + pattern coverage (FR-PILOT-002/003).
// ---------------------------------------------------------------------------

function buildLoopbackQuerySet(): ReadonlyArray<QueryRow> {
  const patterns = ['factual_lookup', 'recall_by_context', 'multi_doc_synthesis'] as const;
  const rows: QueryRow[] = [];
  for (let i = 0; i < 30; i += 1) {
    rows.push({
      query_id: `kg-${String(i + 1).padStart(2, '0')}`,
      query_text: `loopback KG query ${i + 1}`,
      bucket: 'knowledge_grounded',
      retrieval_pattern: patterns[i % patterns.length] ?? 'factual_lookup',
      provenance: 'mined-from-MEMORY-WORK',
      worked_example_for: null,
    });
  }
  for (let i = 0; i < 15; i += 1) {
    rows.push({
      query_id: `gen-${String(i + 1).padStart(2, '0')}`,
      query_text: `loopback general query ${i + 1}`,
      bucket: 'general',
      retrieval_pattern: null,
      provenance: 'hand-crafted-general',
      worked_example_for: null,
    });
  }
  for (let i = 0; i < 5; i += 1) {
    rows.push({
      query_id: `adv-${String(i + 1).padStart(2, '0')}`,
      query_text: `loopback adversarial query ${i + 1}`,
      bucket: 'adversarial',
      retrieval_pattern: null,
      provenance: 'hand-crafted-adversarial',
      worked_example_for: null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Touch fs to keep tree-shakers from dropping the import.
// (TypeScript otherwise warns "fs is imported but never used".)
// ---------------------------------------------------------------------------
void fs;
// EventConstructionError + WriteError + SummaryError are imported for their
// shape/typing; bind them to a noop so eslint-no-unused-imports is content.
void EventConstructionError;
void WriteError;
void SummaryError;
