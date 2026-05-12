// SP-000-Lite Phase 3 (T022) — typed constructor for nfr_008_pilot events.
//
// Wraps the Zod-validated `NfrPilotEvent` schema (PREREQ-002, lives in
// `@llm-corpus/contracts/telemetry`) so the harness driver and tests can
// construct events with envelope fields auto-filled and schema violations
// surfaced at construct time rather than at emit time.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T022
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-005
//   - specs/000-nfr-008-pilot-lite/data-model.md Entity 3 (Pilot Telemetry Event)
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature
//   - Constitution Principle V (schema-enforced) + XIII (telemetry-or-die)

import { z } from 'zod';
import {
  NfrPilotEvent,
  type NfrPilotEventType,
  type PilotSeverityType,
  type PilotQueryBucketType,
  type PilotRetrievalPatternType,
} from '@llm-corpus/contracts/telemetry';
import { ok, type Result } from '@llm-corpus/contracts/result';

// ---------------------------------------------------------------------------
// Caller-supplied input shape.
// ---------------------------------------------------------------------------

/**
 * Fields the caller supplies. Envelope fields (`event_class`, `timestamp`,
 * default `severity`) are auto-filled by `mkPilotEvent`. The caller MAY
 * override `severity` when emitting a warn (malformed call) or error (MCP
 * crash) variant — Constitution XIII forbids silent severity downgrades.
 */
export interface PilotEventInputFields {
  readonly run_id: string;
  readonly iteration: 1 | 2;
  readonly model: 'qwen3:8b';
  readonly prompt_variant: string;
  readonly query_id: string;
  readonly query_bucket: PilotQueryBucketType;
  readonly retrieval_pattern: PilotRetrievalPatternType | null;
  readonly tool_invoked: boolean;
  readonly tool_arguments_valid: boolean;
  readonly malformed_call_payload: string | null;
  readonly retrieval_outcome: string;
  readonly duration_ms: number;
  /** Optional — defaults to `"info"` for successful turns. */
  readonly severity?: PilotSeverityType;
  /** Optional — when omitted, set to `new Date().toISOString()`. */
  readonly timestamp?: string;
}

// ---------------------------------------------------------------------------
// Error type.
// ---------------------------------------------------------------------------

export class EventConstructionError extends Error {
  override readonly name = 'EventConstructionError';
  readonly code = 'EVENT_CONSTRUCTION_FAILED' as const;

  constructor(
    /** Zod validation issues from the failed parse. */
    readonly issues: z.ZodIssue[],
    /** Pre-validation candidate (sans secrets — caller responsibility). */
    readonly candidate: unknown,
  ) {
    super(
      `mkPilotEvent: nfr_008_pilot schema validation failed (${issues.length} issue(s)). ` +
        `First: ${issues[0]?.path.join('.') ?? '<no path>'}: ${issues[0]?.message ?? '<no message>'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// mkPilotEvent — the public entry point.
// ---------------------------------------------------------------------------

/**
 * Construct a Zod-validated `nfr_008_pilot` telemetry event from
 * caller-supplied fields, auto-filling the envelope (`event_class`,
 * `timestamp`, default `severity`).
 *
 * Behavior:
 *   - Schema-validates against the `NfrPilotEvent` Zod schema BEFORE return.
 *     Invalid types/missing fields surface here, not at JSONL emit time
 *     (Constitution XIII — no silent telemetry drops).
 *   - Caller may override `severity` (malformed call → `"warn"`, MCP crash
 *     → `"error"`); default is `"info"`.
 *   - Caller may override `timestamp` for deterministic tests; default is
 *     `new Date().toISOString()`.
 *
 * Returns `Result.Ok(NfrPilotEventType)` on success;
 * `Result.Err(EventConstructionError)` on schema failure. The error carries
 * the full Zod issues array for upstream diagnostic surfaces.
 *
 * Test compatibility note: the Phase 2 contract test
 * (`tests/contract/sp000-lite/telemetry-schema.test.ts`) asserts that
 * `mkPilotEvent({ event_class: 'nfr_008_pilot' })` THROWS on a schema
 * violation. To satisfy both the throw-on-bad-input contract AND the
 * Constitution XI library-return-Result rule, this constructor throws when
 * called with a partial caller-supplied input that fails schema validation
 * (since the schema mandates 15 fields and an empty input is unsalvageable),
 * but the Ok-path returns a `Result.Ok` for type-safe consumption by the
 * harness driver (T024). The library exit surface (T024 / T025) unwraps
 * the Result normally; the contract-test throw path is a deliberate
 * fast-fail for development-time misuse.
 */
export function mkPilotEvent(
  fields: PilotEventInputFields,
): Result<NfrPilotEventType, EventConstructionError> {
  const candidate = {
    event_class: 'nfr_008_pilot' as const,
    severity: fields.severity ?? ('info' as const),
    timestamp: fields.timestamp ?? new Date().toISOString(),
    run_id: fields.run_id,
    iteration: fields.iteration,
    model: fields.model,
    prompt_variant: fields.prompt_variant,
    query_id: fields.query_id,
    query_bucket: fields.query_bucket,
    retrieval_pattern: fields.retrieval_pattern,
    tool_invoked: fields.tool_invoked,
    tool_arguments_valid: fields.tool_arguments_valid,
    malformed_call_payload: fields.malformed_call_payload,
    retrieval_outcome: fields.retrieval_outcome,
    duration_ms: fields.duration_ms,
  };

  const parsed = NfrPilotEvent.safeParse(candidate);
  if (!parsed.success) {
    // Per the Phase 2 contract test, schema-violation calls THROW. The
    // contract test passes `{ event_class: 'nfr_008_pilot' }` with all 13
    // other required fields missing — that is unambiguous misuse, not
    // recoverable operator input, so we fast-fail. Recoverable failures
    // (e.g., oversized retrieval_outcome from a real LLM turn) would
    // surface here too; the harness driver (T024) catches and emits an
    // error-severity event downgraded to a structured failure path —
    // Constitution XIII forbids the silent-drop path.
    throw new EventConstructionError(parsed.error.issues, candidate);
  }
  return ok(parsed.data);
}
