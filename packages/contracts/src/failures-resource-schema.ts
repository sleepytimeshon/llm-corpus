// SP-006 T009 — Zod schemas for the corpus://failures MCP resource.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-009, FR-HARDEN-010
//   - specs/006-hardening/data-model.md §"Entity 2 / 6 / 7"
//   - Constitution Principle V (Schema-Enforced Structured Output)
//
// Read-only by construction: this module exports schemas only — no IO.
//
// SP-003 produces .error.json sidecars at Paths.failed(); SP-006 produces
// .recovery.error.json sidecars at the same path. Both glob into a single
// FailureEntry list with `sidecar_path` enriched at read time.

import { z } from 'zod';

const ISO8601 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

const DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);

const BoundedMessage = z.string().max(1024);

/**
 * Closed-vocabulary stage enum for FailureEntry. Extends the SP-003 stage
 * set with SP-006's `unrecoverable_orphan` variant produced by the recovery
 * scanner when a non-resumable orphan is detected.
 */
export const FAILURE_STAGE_VALUES = [
  'validation',
  'hash',
  'normalize',
  'persist',
  'classify',
  'embed',
  'index',
  'edges-build',
  'ingest',
  'unrecoverable_orphan',
] as const;

export const FailureStageZodSchema = z.enum(FAILURE_STAGE_VALUES);
export type FailureStage = z.infer<typeof FailureStageZodSchema>;

/**
 * Closed-vocabulary error_code enum for the FailuresErrorEnvelope.
 */
export const FAILURES_ERROR_CODES = [
  'validation_error',
  'index_locked',
  'server_initializing',
  'internal_error',
] as const;

export const FailuresErrorCodeZodSchema = z.enum(FAILURES_ERROR_CODES);
export type FailuresErrorCode = z.infer<typeof FailuresErrorCodeZodSchema>;

/**
 * FailureEntry — one row in the corpus://failures response. Mirrors the
 * SP-003 sidecar shape verbatim PLUS the SP-006-added `sidecar_path` field
 * so operators can `rm <path>` after triaging.
 */
export const FailureEntryZodSchema = z
  .object({
    doc_id: DocId.nullable(),
    stage: FailureStageZodSchema,
    error_code: z.string().max(128),
    message: BoundedMessage,
    timestamp: ISO8601,
    retriable: z.boolean(),
    sidecar_path: z.string().min(1).max(4096),
  })
  .strict();
export type FailureEntry = z.infer<typeof FailureEntryZodSchema>;

/**
 * FailuresQuery — parsed query parameters for corpus://failures.
 *
 * Strict mode → unknown keys produce a validation_error envelope at the
 * resource-handler boundary. Defaults: limit=50, offset=0.
 */
export const FailuresQueryZodSchema = z
  .object({
    stage: FailureStageZodSchema.optional(),
    since: ISO8601.optional(),
    limit: z.number().int().min(1).max(1000).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .strict();
export type FailuresQuery = z.infer<typeof FailuresQueryZodSchema>;

/**
 * FailuresResourceResponse — the corpus://failures resource payload.
 * `schema_version: 1` is the v1 literal; SP-007+ may add `2`.
 */
export const FailuresResourceResponseZodSchema = z
  .object({
    entries: z.array(FailureEntryZodSchema),
    total_count: z.number().int().nonnegative(),
    returned_count: z.number().int().nonnegative(),
    schema_version: z.literal(1),
  })
  .strict();
export type FailuresResourceResponse = z.infer<
  typeof FailuresResourceResponseZodSchema
>;

/**
 * FailuresErrorEnvelope — returned inside the standard resource response
 * shape (NOT as a transport-level error) per FR-HARDEN-010, mirroring the
 * SP-005 SearchErrorEnvelope idiom.
 */
export const FailuresErrorEnvelopeZodSchema = z
  .object({
    error_code: FailuresErrorCodeZodSchema,
    message: BoundedMessage,
    hint: z.string().max(1024),
  })
  .strict();
export type FailuresErrorEnvelope = z.infer<
  typeof FailuresErrorEnvelopeZodSchema
>;
