// SP-008 T006 — Zod contract surface for the SP-008 user-acceptance +
// Maya-week-1 engagement-proxy feature. PREREQ-001 of plan.md.
//
// References:
//   - specs/008-user-acceptance/data-model.md Entities 1-7
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-001..024,
//     SC-008-001..034
//   - specs/008-user-acceptance/contracts/adr-acceptance-event-definition.md
//     (ADR-016)
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     (ADR-017)
//   - specs/008-user-acceptance/plan.md Decisions A / B / C / D
//   - Constitution Principles V (Schema-Enforced Structured Output),
//     IX (≤4 KB append atomicity), XIII (Telemetry-or-Die)
//
// Zero IO. Pure schema surface. Re-exported from
// packages/contracts/src/index.ts so downstream packages can
// `import { EngagementProxyReportZodSchema } from '@llm-corpus/contracts'`.
//
// Pattern parity with SP-007's install-schemas.ts.

import { z } from 'zod';

// ---- Shared primitives ----

/** ISO-8601 timestamp regex (mirrors the SP-001 envelope convention). */
const ISO8601 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

/**
 * UUID v4 regex per data-model.md Entity 6. Lowercase + uppercase tolerated;
 * verbatim from the data-model.md entity definition.
 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUIDv4 = z.string().regex(UUID_V4_REGEX);

/** SHA-256 hex digest (64 chars). */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Closed-vocabulary search-tier enum. Duplicated literally from
 * `search-schemas.ts` SEARCH_TIER_VALUES — this file MUST stay decoupled from
 * the SP-005 retrieval surface so the engagement contract evolves
 * independently. The two enums are intentionally kept in lockstep at the
 * value level (per data-model.md Entity 1 "tier_used closed enum matching
 * SP-006 SEARCH_TIER_VALUES").
 */
export const EngagementSearchTierZodSchema = z.enum([
  'hybrid',
  'bm25-only',
  'catalog-grep',
  'fs-grep',
]);
export type EngagementSearchTier = z.infer<typeof EngagementSearchTierZodSchema>;

// ============================================================================
// Entity 1 — EngagementCorpusFindInvokedEvent
// ============================================================================

/**
 * Per-`corpus.find`-invocation observability record. Emitted at the
 * `corpus-find-tool` handler boundary immediately after the existing SP-005
 * `search.query` event (Decision A — additive after the existing emit).
 *
 * Invariants (from data-model.md Entity 1):
 *   - `request_id` server-generated via `randomUUID()`; shared with the
 *     corresponding `search.query` event via that event's additive
 *     `request_id?` field.
 *   - `query_hash` ALWAYS present (computed over the FULL untruncated text).
 *   - `query_truncated: true` IFF `query.length === 1024`.
 *   - `result_count >= 0`; zero-result queries STILL emit this event
 *     (counted as a query by the aggregator, but cannot be the target of
 *     `corpus accept` per FR-ENGAGEMENT-002).
 *   - Total event size ≤ 4096 bytes (Constitution IX).
 */
export const EngagementCorpusFindInvokedEventZodSchema = z
  .object({
    event: z.literal('engagement.corpus_find_invoked'),
    timestamp: ISO8601,
    request_id: UUIDv4,
    query: z.string().max(1024),
    query_truncated: z.boolean().optional(),
    query_hash: Sha256Hex,
    result_count: z.number().int().nonnegative(),
    tier_used: EngagementSearchTierZodSchema,
    duration_ms: z.number().int().nonnegative(),
  })
  .strict();
export type EngagementCorpusFindInvokedEvent = z.infer<
  typeof EngagementCorpusFindInvokedEventZodSchema
>;

// ============================================================================
// Entity 2 — EngagementAcceptanceEvent
// ============================================================================

/**
 * Operator's explicit attestation that a `corpus.find` invocation's results
 * were useful. Emitted by the `corpus accept <request-id>` CLI subcommand
 * (ADR-016).
 *
 * Invariants (from data-model.md Entity 2):
 *   - `request_id` MUST match a prior `engagement.corpus_find_invoked` event
 *     with `result_count >= 1` (enforced by the writer, not the schema).
 *   - At most ONE acceptance per `request_id` in the telemetry log
 *     (enforced by the writer's duplicate-detection + aggregator dedup).
 *   - `acceptance_note` is ≤ 512 chars (enforced at Zod parse time).
 */
export const EngagementAcceptanceEventZodSchema = z
  .object({
    event: z.literal('engagement.acceptance_event'),
    timestamp: ISO8601,
    request_id: UUIDv4,
    acceptance_note: z.string().max(512).optional(),
  })
  .strict();
export type EngagementAcceptanceEvent = z.infer<
  typeof EngagementAcceptanceEventZodSchema
>;

// ============================================================================
// Entity 3 — EngagementReportGeneratedEvent
// ============================================================================

/**
 * Audit record of a `corpus engagement-proxy report` invocation. Emitted by
 * the report CLI on every successful report generation.
 *
 * Invariants (from data-model.md Entity 3):
 *   - `since <= until` (the report's args parser enforces).
 *   - `verdict === 'PASS'` IFF
 *     `queries_in_window >= 5 AND acceptance_events_in_window >= 1`.
 *   - `kill_signal === true` IFF `queries_in_window < 3`.
 */
export const EngagementReportGeneratedEventZodSchema = z
  .object({
    event: z.literal('engagement.report_generated'),
    timestamp: ISO8601,
    window: z
      .object({
        since: ISO8601,
        until: ISO8601,
      })
      .strict(),
    verdict: z.enum(['PASS', 'FAIL']),
    queries_in_window: z.number().int().nonnegative(),
    acceptance_events_in_window: z.number().int().nonnegative(),
    kill_signal: z.boolean(),
  })
  .strict();
export type EngagementReportGeneratedEvent = z.infer<
  typeof EngagementReportGeneratedEventZodSchema
>;

// ============================================================================
// Entity 4 — EngagementReportTelemetryParseFailedEvent
// ============================================================================

/**
 * Defensive observability event emitted when the report's scanner encounters
 * a malformed telemetry-log line. Emitted in addition to the line being
 * skipped + counted in `parse_errors_count`.
 *
 * Per Constitution XIII: every parse failure emits this event (no silent
 * swallowing). Per Constitution IX: event size ≤ 4096 bytes.
 */
export const EngagementReportTelemetryParseFailedEventZodSchema = z
  .object({
    event: z.literal('engagement.report_telemetry_parse_failed'),
    timestamp: ISO8601,
    telemetry_log_path: z.string().min(1),
    line_number: z.number().int().min(1).optional(),
    error_message: z.string().max(1024),
  })
  .strict();
export type EngagementReportTelemetryParseFailedEvent = z.infer<
  typeof EngagementReportTelemetryParseFailedEventZodSchema
>;

// ============================================================================
// Entity 5 — EngagementProxyReport
// ============================================================================

/**
 * Closed list of tier keys for `informational.tier_distribution`. Mirrors
 * SP-006 `SEARCH_TIER_VALUES` exactly. The schema uses a `.strict()` object
 * keyed on each tier so the contract is closed (defense-in-depth — queries
 * with unknown `tier_used` cannot appear in a well-formed event).
 */
export const EngagementTierDistributionZodSchema = z
  .object({
    hybrid: z.number().int().nonnegative(),
    'bm25-only': z.number().int().nonnegative(),
    'catalog-grep': z.number().int().nonnegative(),
    'fs-grep': z.number().int().nonnegative(),
  })
  .strict();
export type EngagementTierDistribution = z.infer<
  typeof EngagementTierDistributionZodSchema
>;

/** Literal C-028 threshold constants emitted with every report. */
export const ENGAGEMENT_C028_THRESHOLD = {
  min_queries: 5,
  min_acceptance_events: 1,
} as const;

/** Literal kill-signal threshold constant emitted with every report. */
export const ENGAGEMENT_KILL_SIGNAL_THRESHOLD = {
  min_queries: 3,
} as const;

/**
 * The JSON form of `corpus engagement-proxy report --format=json`.
 * Zod-validated at emit time (defense-in-depth per Constitution V).
 *
 * Invariants (from data-model.md Entity 5):
 *   - `schema_version === 1` for SP-008.
 *   - `verdict === 'PASS'` IFF `c028_threshold_met === true`.
 *   - `kill_signal === true` IFF `queries_in_window < 3`.
 *   - `informational.zero_result_queries <= queries_in_window`.
 *   - `informational.distinct_query_hashes <= queries_in_window`.
 *   - `*_latency_ms` is `null` when `queries_in_window === 0`.
 *   - The `c028_threshold` + `kill_signal_threshold` literals match the
 *     compile-time constants above so downstream tooling sees what
 *     threshold the report enforces.
 */
export const EngagementProxyReportZodSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: ISO8601,
    window: z
      .object({
        since: ISO8601,
        until: ISO8601,
      })
      .strict(),
    queries_in_window: z.number().int().nonnegative(),
    acceptance_events_in_window: z.number().int().nonnegative(),
    c028_threshold_met: z.boolean(),
    kill_signal: z.boolean(),
    verdict: z.enum(['PASS', 'FAIL']),
    parse_errors_count: z.number().int().nonnegative(),
    informational: z
      .object({
        median_latency_ms: z.number().nonnegative().nullable(),
        p95_latency_ms: z.number().nonnegative().nullable(),
        tier_distribution: EngagementTierDistributionZodSchema,
        zero_result_queries: z.number().int().nonnegative(),
        distinct_query_hashes: z.number().int().nonnegative(),
      })
      .strict(),
    c028_threshold: z
      .object({
        min_queries: z.literal(ENGAGEMENT_C028_THRESHOLD.min_queries),
        min_acceptance_events: z.literal(
          ENGAGEMENT_C028_THRESHOLD.min_acceptance_events,
        ),
      })
      .strict(),
    kill_signal_threshold: z
      .object({
        min_queries: z.literal(ENGAGEMENT_KILL_SIGNAL_THRESHOLD.min_queries),
      })
      .strict(),
  })
  .strict()
  .refine(
    (r) => r.window.since <= r.window.until,
    'window.since must be <= window.until',
  )
  .refine(
    (r) => r.informational.zero_result_queries <= r.queries_in_window,
    'informational.zero_result_queries must be <= queries_in_window',
  )
  .refine(
    (r) => r.informational.distinct_query_hashes <= r.queries_in_window,
    'informational.distinct_query_hashes must be <= queries_in_window',
  )
  .refine(
    (r) =>
      (r.verdict === 'PASS') ===
      (r.queries_in_window >= ENGAGEMENT_C028_THRESHOLD.min_queries &&
        r.acceptance_events_in_window >=
          ENGAGEMENT_C028_THRESHOLD.min_acceptance_events),
    "verdict='PASS' must equal (queries_in_window>=5 AND acceptance_events_in_window>=1)",
  )
  .refine(
    (r) =>
      r.kill_signal ===
      (r.queries_in_window < ENGAGEMENT_KILL_SIGNAL_THRESHOLD.min_queries),
    'kill_signal must equal (queries_in_window < 3)',
  )
  .refine(
    (r) =>
      r.queries_in_window > 0
        ? r.informational.median_latency_ms !== null &&
          r.informational.p95_latency_ms !== null
        : r.informational.median_latency_ms === null &&
          r.informational.p95_latency_ms === null,
    'latency aggregates must be non-null IFF queries_in_window > 0',
  );
export type EngagementProxyReport = z.infer<
  typeof EngagementProxyReportZodSchema
>;

// ============================================================================
// Entity 6 — AcceptArgs
// ============================================================================

/**
 * Parsed arguments to `corpus accept <request-id> [--note <text>]`.
 *
 * Invariants (from data-model.md Entity 6):
 *   - `request_id` matches the UUID v4 format.
 *   - `note` is ≤ 512 chars trimmed (Zod refines reject leading/trailing
 *     whitespace post-trim).
 */
export const AcceptArgsZodSchema = z
  .object({
    request_id: UUIDv4,
    note: z
      .string()
      .max(512)
      .refine((s) => s === s.trim(), {
        message: 'note must be trimmed (no leading/trailing whitespace)',
      })
      .optional(),
  })
  .strict();
export type AcceptArgs = z.infer<typeof AcceptArgsZodSchema>;

// ============================================================================
// Entity 7 — EngagementProxyReportArgs
// ============================================================================

/**
 * Parsed arguments to
 * `corpus engagement-proxy report [--since=<ts>] [--until=<ts>]
 *   [--format=text|json] [--telemetry-log=<path>] [--timeout=<ms>]`.
 *
 * Defaults (computed by the args parser, NOT by Zod):
 *   - `since = now - 7d` UTC-normalized
 *   - `until = now`
 *   - `format = 'text'`
 *   - `telemetry_log = Paths.telemetry()`
 *   - `timeout_ms = 30000`
 *
 * Invariants (from data-model.md Entity 7):
 *   - `since <= until` (refined).
 *   - `format ∈ {'text', 'json'}`.
 *   - `timeout_ms ∈ [1, 600000]`.
 *   - `telemetry_log` (when supplied) is a non-empty path string; readability
 *     check happens at the scanner pre-flight, not at Zod parse time.
 */
export const EngagementProxyReportArgsZodSchema = z
  .object({
    since: ISO8601,
    until: ISO8601,
    format: z.enum(['text', 'json']),
    telemetry_log: z.string().min(1),
    timeout_ms: z.number().int().min(1).max(600000),
  })
  .strict()
  .refine((a) => a.since <= a.until, {
    message: 'since must be <= until',
    path: ['since'],
  });
export type EngagementProxyReportArgs = z.infer<
  typeof EngagementProxyReportArgsZodSchema
>;
