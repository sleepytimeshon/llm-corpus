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
  // --- SP-005 fields (PREREQ-004) ---
  // Optional with defaults so existing SP-003/SP-004 Policy literals continue
  // to parse unchanged; PolicySchema.parse() fills in v1 SP-005 defaults
  // (matching interactivePolicy semantics) when absent.
  /** Per-doc embed wall-clock cap (ms). */
  perDocEmbedTimeoutMs: z.number().int().min(1000).default(10_000),
  /** Per-doc index-stage wall-clock cap (ms). */
  perDocIndexTimeoutMs: z.number().int().min(500).default(5_000),
  /** Per-doc edges-build wall-clock cap (ms). */
  perDocEdgesBuildTimeoutMs: z.number().int().min(1000).default(15_000),
  /** Embedding HTTP call cap (ms). */
  embeddingHttpTimeoutMs: z.number().int().min(1000).default(10_000),
  /** Per-retriever SQL query cap (ms). */
  retrieverSqlTimeoutMs: z.number().int().min(500).default(5_000),
  /** Whole corpus.find budget (ms). */
  searchTotalTimeoutMs: z.number().int().min(1000).default(30_000),
  /** Per-retriever top-K (Decision C). */
  topKPerRetriever: z.number().int().min(1).max(256).default(64),
  // --- SP-006 fields (PREREQ-004 / Decision M) ---
  // Optional with defaults so existing SP-003/SP-004/SP-005 Policy literals
  // continue to parse unchanged; PolicySchema.parse() fills in v1 defaults
  // when absent. Recovery + tier policies are not policy-dependent in v1
  // (interactive and batch share the same defaults).
  /** Recovery scanner wall-clock cap before forced abort (ms). */
  recoveryScanTimeoutMs: z.number().int().min(1000).default(30_000),
  /** Tier-cascade aggregate budget (ms). */
  tierTotalBudgetMs: z.number().int().min(50).max(30_000).default(600),
  /** Tier 1 (BM25-only FTS5) per-call timeout (ms). */
  tierBm25TimeoutMs: z.number().int().min(1).max(10_000).default(5),
  /** Tier 2 (in-process CATALOG.md grep) per-call timeout (ms). */
  tierCatalogGrepTimeoutMs: z.number().int().min(1).max(10_000).default(50),
  /** Tier 3 (fs-grep subprocess) per-call timeout (ms). */
  tierFsGrepTimeoutMs: z.number().int().min(1).max(30_000).default(500),
  /** corpus://failures resource read wall-clock cap (ms). */
  failuresResourceTimeoutMs: z
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5_000),
  /** Minimum result count before the orchestrator falls through to the next tier. */
  minResultsForFallthrough: z.number().int().min(0).max(100).default(3),
  // --- SP-007 fields (PREREQ-004) ---
  // Optional with defaults so existing SP-003/SP-004/SP-005/SP-006 Policy
  // literals continue to parse unchanged. PolicySchema.parse() fills in the
  // SP-007 defaults when absent. The 90-second installBudgetMs is the
  // Constitution VII enforced ceiling per FR-INSTALL-002 + SC-007-034.
  /** Full `corpus init` 11-step pipeline budget (ms). */
  installBudgetMs: z.number().int().min(1000).max(600_000).default(90_000),
  /** `corpus init --smoke` step-12 sub-budget (ms). */
  smokeBudgetMs: z.number().int().min(1000).max(600_000).default(30_000),
  /** `corpus uninstall` active-daemon stop sub-budget (ms). */
  uninstallDaemonStopBudgetMs: z
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(2_000),
  /** `corpus init` step-8 OS firewall provisioning sub-budget (ms). */
  firewallProvisionBudgetMs: z
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(10_000),
  /** `corpus init` step-7 MCP-client config mutate sub-budget (ms). */
  mcpClientConfigMutateBudgetMs: z
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1_000),
  /** `corpus init` step-6 taxonomy seed INSERT sub-budget (ms). */
  seedInsertBudgetMs: z.number().int().min(100).max(60_000).default(1_000),
  /** `corpus init` step-3 XDG subtree mkdir sub-budget (ms). */
  xdgBringupBudgetMs: z.number().int().min(100).max(60_000).default(2_000),
  /** `corpus init` step-4 SQLite open + migrate + checkpoint sub-budget (ms). */
  sqliteSinglefileBudgetMs: z
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(10_000),
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
  // SP-005 (Decision L):
  perDocEmbedTimeoutMs: 10_000,
  perDocIndexTimeoutMs: 5_000,
  perDocEdgesBuildTimeoutMs: 15_000,
  embeddingHttpTimeoutMs: 10_000,
  retrieverSqlTimeoutMs: 5_000,
  searchTotalTimeoutMs: 30_000,
  topKPerRetriever: 64,
  // SP-006 (Decision M — same defaults for interactive + batch):
  recoveryScanTimeoutMs: 30_000,
  tierTotalBudgetMs: 600,
  tierBm25TimeoutMs: 5,
  tierCatalogGrepTimeoutMs: 50,
  tierFsGrepTimeoutMs: 500,
  failuresResourceTimeoutMs: 5_000,
  minResultsForFallthrough: 3,
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
  // SP-005 (Decision L):
  perDocEmbedTimeoutMs: 30_000,
  perDocIndexTimeoutMs: 10_000,
  perDocEdgesBuildTimeoutMs: 60_000,
  embeddingHttpTimeoutMs: 30_000,
  retrieverSqlTimeoutMs: 10_000,
  searchTotalTimeoutMs: 60_000,
  topKPerRetriever: 64,
  // SP-006 (Decision M — same defaults for interactive + batch):
  recoveryScanTimeoutMs: 30_000,
  tierTotalBudgetMs: 600,
  tierBm25TimeoutMs: 5,
  tierCatalogGrepTimeoutMs: 50,
  tierFsGrepTimeoutMs: 500,
  failuresResourceTimeoutMs: 5_000,
  minResultsForFallthrough: 3,
});

// ---------------------------------------------------------------------------
// SP-007 PREREQ-004 — install / uninstall policy literals.
//
// References:
//   - specs/007-install-first-run/plan.md PREREQ-004
//   - specs/007-install-first-run/spec.md FR-INSTALL-002, FR-INSTALL-013
//   - Constitution Principles VI, VII
//
// `installPolicy` is the interactive baseline for the `corpus init` 11-step
// pipeline + optional `--smoke` step 12. `uninstallPolicy` is the
// receipt-driven `corpus uninstall` flow. Both reuse `interactive`-style
// per-doc / per-stage timeouts (short, no-retry, progress-emitting) because
// install and uninstall are one-shot operator-driven invocations, never
// daemon-batched.

export const installPolicy: Policy = PolicySchema.parse({
  name: 'interactive',
  perDocTimeoutMs: 60_000,
  perStageTimeoutMs: 30_000,
  retryOnRetriableError: false,
  emitProgress: true,
  perDocClassifyTimeoutMs: 60_000,
  classifyRetryMaxAttempts: 1,
  consecutiveOllamaFailureBatchHaltThreshold: 3,
  installBudgetMs: 90_000,
  smokeBudgetMs: 30_000,
  uninstallDaemonStopBudgetMs: 2_000,
  firewallProvisionBudgetMs: 10_000,
  mcpClientConfigMutateBudgetMs: 1_000,
  seedInsertBudgetMs: 1_000,
  xdgBringupBudgetMs: 2_000,
  sqliteSinglefileBudgetMs: 10_000,
});

export const uninstallPolicy: Policy = PolicySchema.parse({
  name: 'interactive',
  perDocTimeoutMs: 60_000,
  perStageTimeoutMs: 30_000,
  retryOnRetriableError: false,
  emitProgress: true,
  perDocClassifyTimeoutMs: 60_000,
  classifyRetryMaxAttempts: 1,
  consecutiveOllamaFailureBatchHaltThreshold: 3,
  installBudgetMs: 90_000,
  smokeBudgetMs: 30_000,
  uninstallDaemonStopBudgetMs: 2_000,
  firewallProvisionBudgetMs: 10_000,
  mcpClientConfigMutateBudgetMs: 1_000,
  seedInsertBudgetMs: 1_000,
  xdgBringupBudgetMs: 2_000,
  sqliteSinglefileBudgetMs: 10_000,
});
