// SP-003 T071 — Pipeline policies.
// SP-004 PREREQ-004 — extended with classify-stage fields.
//
// References:
//   - specs/003-ingest-pipeline/plan.md Decision H (two named policies)
//   - specs/004-classifier/plan.md PREREQ-004
//   - specs/004-classifier/spec.md FR-CLASSIFY-009
//   - specs/004-classifier/research.md Decision D, Decision F
//   - Constitution VI (One Pipeline, Two Policies)
//   - specs/003-ingest-pipeline/data-model.md §"Validation Gate Config"
//
// Two named, Zod-validated Policy records. The drain orchestrator dispatches
// behavior off policy fields (timeouts, retry policy, progress emission).
// The SAME drain function is invoked by both interactive (CLI `corpus drain`)
// and batch (daemon-managed) callers.
//
// SP-004 adds three classify-stage fields per PREREQ-004:
//   - perDocClassifyTimeoutMs              — per-doc classify wall-clock cap
//   - classifyRetryMaxAttempts             — retry-once policy for SchemaInvalid
//   - consecutiveOllamaFailureBatchHaltThreshold — circuit-breaker threshold

import { z } from 'zod';

export const PolicySchema = z.object({
  /** Policy name — interactive | batch. */
  name: z.enum(['interactive', 'batch']),
  /** Per-document wall-clock timeout in milliseconds. */
  perDocTimeoutMs: z.number().int().min(1000),
  /** Per-stage (validate / hash / normalize / persist) timeout in ms. */
  perStageTimeoutMs: z.number().int().min(500),
  /** Retry once on retriable IngestError. */
  retryOnRetriableError: z.boolean(),
  /** Emit per-doc progress telemetry. */
  emitProgress: z.boolean(),
  // --- SP-004 fields (PREREQ-004) ---
  /** Per-doc classify wall-clock cap for the SP-004 classify-stage. */
  perDocClassifyTimeoutMs: z.number().int().min(1000),
  /** Retry-once policy for SchemaInvalid (Decision D). */
  classifyRetryMaxAttempts: z.number().int().min(0).max(3),
  /** Circuit-breaker threshold for `classify.batch_halted` (Decision F). */
  consecutiveOllamaFailureBatchHaltThreshold: z.number().int().min(1),
});
export type Policy = z.infer<typeof PolicySchema>;

/**
 * Interactive policy — used by the CLI `corpus drain` / `corpus reenrich`
 * one-shots. Shorter timeouts, no retry, progress emission for stdout.
 */
export const interactivePolicy: Policy = PolicySchema.parse({
  name: 'interactive',
  perDocTimeoutMs: 60_000,
  perStageTimeoutMs: 30_000,
  retryOnRetriableError: false,
  emitProgress: true,
  // SP-004:
  perDocClassifyTimeoutMs: 60_000,
  classifyRetryMaxAttempts: 1,
  consecutiveOllamaFailureBatchHaltThreshold: 3,
});

/**
 * Batch policy — used by the long-running `corpus daemon`. Longer timeouts,
 * one retry on retriable failures.
 */
export const batchPolicy: Policy = PolicySchema.parse({
  name: 'batch',
  perDocTimeoutMs: 300_000,
  perStageTimeoutMs: 120_000,
  retryOnRetriableError: true,
  emitProgress: false,
  // SP-004:
  perDocClassifyTimeoutMs: 300_000,
  classifyRetryMaxAttempts: 1,
  consecutiveOllamaFailureBatchHaltThreshold: 3,
});
