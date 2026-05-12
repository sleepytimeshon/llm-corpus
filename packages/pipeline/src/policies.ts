// SP-003 T071 — Pipeline policies.
//
// References:
//   - specs/003-ingest-pipeline/plan.md Decision H (two named policies)
//   - Constitution VI (One Pipeline, Two Policies)
//   - specs/003-ingest-pipeline/data-model.md §"Validation Gate Config"
//
// Two named, Zod-validated Policy records. The drain orchestrator dispatches
// behavior off policy fields (timeouts, retry policy, progress emission).
// The SAME drain function is invoked by both interactive (CLI `corpus drain`)
// and batch (daemon-managed) callers.

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
});
export type Policy = z.infer<typeof PolicySchema>;

/**
 * Interactive policy — used by the CLI `corpus drain` one-shot. Shorter
 * timeouts, no retry, progress emission for stdout reporting.
 */
export const interactivePolicy: Policy = PolicySchema.parse({
  name: 'interactive',
  perDocTimeoutMs: 60_000,
  perStageTimeoutMs: 30_000,
  retryOnRetriableError: false,
  emitProgress: true,
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
});
