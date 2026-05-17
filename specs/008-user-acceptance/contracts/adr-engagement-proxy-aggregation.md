# ADR-017 — Engagement-Proxy Aggregation: Window Semantics, Counting Contract, C-028 Threshold, KILL Signal, Report JSON Schema

**Feature**: 008-user-acceptance
**Date**: 2026-05-17
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none
**Related ADRs**: ADR-016 (acceptance-event definition / `corpus accept` CLI); SP-005 SearchOutput / SearchQueryEvent contracts (unchanged); SP-003 telemetry layer (rotation + append discipline)

## Context

The SP-008 sprint exit criterion (SPRINT-PLAN.yaml SP-008 line 248 verbatim) is `maya_persona_week_1_engagement_proxy_at_least_5_corpus_find_queries_in_7d_with_at_least_1_acceptance_event_per_c_028`; the rollback criterion (line 253 verbatim) is `week_1_engagement_proxy_below_3_queries_in_7d_after_dogfood_period` → "rollback to Stage 4 recycle per C-028". The `corpus engagement-proxy report` CLI subcommand is the canonical Track A measurement instrument that produces the verdict.

Without ADR-017:

- The window semantics (what counts as "in the window") are undefined.
- The counting contract (how queries + acceptances are counted; how duplicates are handled) is undefined.
- The C-028 threshold computation (the AND between `queries_in_window >= 5` and `acceptance_events_in_window >= 1`) is undocumented at the contract level.
- The KILL signal threshold (`queries_in_window < 3`) and its relationship to non-KILL FAIL are undocumented.
- The informational aggregates (median + p95 latency, tier distribution, zero-result count, distinct query_hash count) and their non-gate-bearing nature are undocumented.
- The JSON report's Zod schema with `schema_version: 1` is undocumented.
- The rotated-log scan convention is undocumented.

This ADR codifies all of the above.

## Decision

### Window semantics

- **Window bounds**: `[since, until]` (inclusive on both ends) where:
  - `since: ISO-8601` — defaults to `now - 7d` when omitted (computed at parse time; UTC-normalized).
  - `until: ISO-8601` — defaults to `now` when omitted.
- **Filter**: For each Zod-parsed event read from the telemetry log, the event is **in the window** IFF `event.timestamp >= since AND event.timestamp <= until` (after both sides are normalized to UTC).
- **Clock skew + DST**: ISO-8601 timestamps carry UTC offset; the filter operates on UTC-normalized values; DST and operator clock-adjustments do not affect the count.
- **Future `until`**: accepted (the window is `[since, until]` whether or not `until` is in the past). Future events have not occurred yet; they simply don't appear in the log.
- **Invalid window** (`since > until` after defaults): throw `EngagementProxyWindowInvalidError` at the args-parser refine step; CLI exits non-zero before the scan begins.

### Counting contract

- **`queries_in_window`**: count of unique `engagement.corpus_find_invoked` events by `request_id` within the window. Deduplication by `request_id` is defense-in-depth (the find-handler emits exactly one event per invocation; duplicates would indicate a bug or a manual log edit). The aggregator's dedup is the second defense; the first defense is the find-handler's single-emit discipline.
- **`acceptance_events_in_window`**: count of unique `engagement.acceptance_event` events by `request_id` within the window. Deduplication by `request_id` is defense-in-depth (the `corpus accept` writer's duplicate-detection per ADR-016 is the first defense; the aggregator's dedup is the second).
- **Why count by `request_id` (not by line presence)**: per ADR-016, the writer guarantees at most ONE acceptance event per `request_id`. If a malicious / accidental log edit duplicates a line, the aggregator's dedup prevents the count from being inflated.

### C-028 threshold

- **`c028_threshold_met`**: `queries_in_window >= 5 AND acceptance_events_in_window >= 1`. **Both** conditions required (logical AND). Per FR-ENGAGEMENT-005 verbatim.
- **`verdict`**: `'PASS'` IFF `c028_threshold_met === true`; `'FAIL'` otherwise.
- **Constants emitted in JSON**: `c028_threshold: {min_queries: 5, min_acceptance_events: 1}` is emitted in the `--format=json` output as literal constants so downstream tooling sees the threshold the report enforces. The constants are NOT operator-tunable for v1 (per spec.md Out of Scope "Replacing C-028's ≥5/≥1 threshold with a tunable threshold").

### KILL signal threshold

- **`kill_signal`**: `queries_in_window < 3`. Per SPRINT-PLAN.yaml line 253 verbatim: the KILL signal is the v1 KILL signal (rollback to Stage 4 recycle per C-028), NOT a sprint retry.
- **Constant emitted in JSON**: `kill_signal_threshold: {min_queries: 3}`. Not operator-tunable for v1.
- **Relationship to verdict**:
  - `verdict === 'FAIL' AND kill_signal === true` → low-engagement FAIL; surface SPRINT-PLAN.yaml rollback recommendation in `--format=text`; exit non-zero.
  - `verdict === 'FAIL' AND kill_signal === false` → non-KILL FAIL (the operator cleared the ≥3 floor but missed either the ≥5 query gate or the ≥1 acceptance gate); operator continues dogfood + retries; exit non-zero.
  - `verdict === 'PASS'` → `kill_signal === false` necessarily (PASS requires `queries_in_window >= 5 > 3`); exit 0.

### Verdict + KILL truth table

| `queries_in_window` | `acceptance_events_in_window` | `c028_threshold_met` | `kill_signal` | `verdict` | Exit code |
|---|---|---|---|---|---|
| 0 | 0 | false | **true** | FAIL | non-zero |
| 1 | 0 | false | **true** | FAIL | non-zero |
| 2 | 0 | false | **true** | FAIL | non-zero |
| 2 | 1 | false | **true** | FAIL | non-zero |
| 3 | 0 | false | false | FAIL | non-zero |
| 3 | 1 | false | false | FAIL | non-zero |
| 4 | 0 | false | false | FAIL | non-zero |
| 4 | 1 | false | false | FAIL | non-zero |
| 5 | 0 | false | false | FAIL | non-zero |
| 5 | 1 | **true** | false | **PASS** | 0 |
| 100 | 50 | **true** | false | **PASS** | 0 |

### Informational aggregates (non-gate-bearing)

Per FR-ENGAGEMENT-003 + FR-ENGAGEMENT-012, the report ALSO surfaces optional aggregates. These are **informational only**; they do NOT influence the verdict or the KILL signal:

- `median_latency_ms: number | null` — median of `duration_ms` across the `engagement.corpus_find_invoked` events in the window. `null` if `queries_in_window === 0`.
- `p95_latency_ms: number | null` — p95 of `duration_ms`. `null` if `queries_in_window === 0`.
- `tier_distribution: {hybrid: number, 'bm25-only': number, 'catalog-grep': number, 'fs-grep': number}` — count of `tier_used` values across the in-window finds. Sums to `queries_in_window` if every event has a valid `tier_used` (always true by Entity 1's invariant).
- `zero_result_queries: number` — count of in-window finds with `result_count === 0`. `<= queries_in_window`.
- `distinct_query_hashes: number` — count of unique `query_hash` values in the window. `<= queries_in_window`.

### JSON report Zod schema

The `--format=json` output validates against `EngagementProxyReportZodSchema` exported from `packages/contracts/src/engagement.ts`:

```typescript
const EngagementProxyReportZodSchema = z.object({
  schema_version: z.literal(1),
  generated_at: ISO8601,
  window: z.object({ since: ISO8601, until: ISO8601 }).strict(),
  queries_in_window: z.number().int().nonnegative(),
  acceptance_events_in_window: z.number().int().nonnegative(),
  c028_threshold_met: z.boolean(),
  kill_signal: z.boolean(),
  verdict: z.enum(['PASS', 'FAIL']),
  parse_errors_count: z.number().int().nonnegative(),
  informational: z.object({
    median_latency_ms: z.number().nullable(),
    p95_latency_ms: z.number().nullable(),
    tier_distribution: z.object({
      'hybrid': z.number().int().nonnegative(),
      'bm25-only': z.number().int().nonnegative(),
      'catalog-grep': z.number().int().nonnegative(),
      'fs-grep': z.number().int().nonnegative(),
    }).strict(),
    zero_result_queries: z.number().int().nonnegative(),
    distinct_query_hashes: z.number().int().nonnegative(),
  }).strict(),
  c028_threshold: z.object({
    min_queries: z.literal(5),
    min_acceptance_events: z.literal(1),
  }).strict(),
  kill_signal_threshold: z.object({
    min_queries: z.literal(3),
  }).strict(),
}).strict();
```

The schema is `.strict()` end-to-end — unknown fields are rejected at parse time. `schema_version: 1` is the v1 literal; future v1.5+ MAY ship `schema_version: 2` with a downstream-tooling negotiation surface (the SP-007 InstallReceipt `schema_version` pattern).

### Text-format banner (Constitution XVI compliance)

The `--format=text` output (default) prints a Track A/B-aware header per SC-008-034:

```
═══════════════════════════════════════════════════════════════════════════
Maya Week-1 Engagement-Proxy Report (per C-028)
Track B measurement — operator-dogfood verdict
Window: <since> .. <until>  (default: last 7 days)
═══════════════════════════════════════════════════════════════════════════
```

Followed by the verdict, the counts, the KILL signal status, the informational aggregates, and on FAIL with `kill_signal === true` the SPRINT-PLAN.yaml-recorded rollback recommendation ("Stage 4 recycle per C-028"). On FAIL with `kill_signal === false`, the recommendation is "continue dogfood + retry report".

### Rotated-log scan convention

The SP-003 telemetry layer rotates the NDJSON log at a size threshold (rotation file-naming convention per SP-003 — typically `<basename>.<n>.jsonl` where `n` is a monotonic rotation counter). When `since` falls before the rotation event, the report scanner MUST scan BOTH the active log AND any rotated logs whose mtime falls within the window:

1. Enumerate the directory containing `Paths.telemetry()` for files matching the SP-003 rotation pattern.
2. For each candidate file, `stat()` its mtime; if mtime falls within `[since, until]`, include it in the scan list.
3. Scan files in chronological order (oldest rotated log first; active log last).
4. If the operator has post-pruned rotated logs (manual `rm`), the scanner emits a `engagement.report_telemetry_parse_failed`-equivalent warning ("rotated logs were missing from window; reported count may be a lower bound") AND increments `parse_errors_count`. The report STILL emits — it does NOT exit non-zero on missing rotated logs (per spec.md Edge Cases).

### Malformed-line handling

Per FR-ENGAGEMENT-003 + Entity 4 in data-model.md:

1. The scanner reads line-by-line via `readline`-on-stream (memory-bounded; one line at a time).
2. For each line: attempt `JSON.parse` → on failure, skip + emit `engagement.report_telemetry_parse_failed` + increment `parse_errors_count`.
3. On JSON-parse success: attempt Zod-parse against the `TelemetryEvent` discriminated union → on failure, skip + emit + increment.
4. On Zod-parse success: filter by `event ∈ {'engagement.corpus_find_invoked', 'engagement.acceptance_event'}` AND `timestamp ∈ [since, until]`.
5. Accumulate counts.
6. After scan: emit the verdict + the `parse_errors_count`. Operator interprets the count.

### AbortSignal + timeout

- The scanner accepts `signal: AbortSignal`.
- The CLI wraps the scan in `setTimeout(() => controller.abort('engagement_report_timeout'), timeout_ms) + clearTimeout(handle)` (NEVER `Promise.race(setTimeout)` — Constitution VII forbidden pattern). Default `timeout_ms = 30000` (30 seconds); operator-configurable via `--timeout=<ms>` in `[1, 600000]`.
- SIGINT propagates through the master AbortSignal; mid-scan abort exits non-zero with a clear-remediation stderr message ("scan timed out at line <N>; consider --timeout=<larger>").

### Audit emit

After the verdict is rendered to stdout, the CLI emits one `engagement.report_generated` event to `Paths.telemetry()` (Entity 3 in data-model.md) for forensic value. Future RETROSPECTIVE.md cross-references can query this event.

### Local-only

The report is local-only (Constitution I + spec.md FR-ENGAGEMENT-015). ZERO outbound network calls. ZERO telemetry shipping. ZERO remote aggregation.

### No MCP exposure

The report is CLI-only (Constitution III + spec.md FR-ENGAGEMENT-013). ZERO new MCP mutation surfaces. ZERO new MCP read surfaces. An MCP-resource form of the report (`corpus://engagement-proxy`) is FORBIDDEN per spec.md Out of Scope.

## Consequences

**Positive**:

- The aggregation contract is fully specified — Track A's tests can assert exactly what the report computes for known synthetic input.
- The verdict + KILL signal truth table is unambiguous; no operator ambiguity at end-of-window.
- The JSON report's `schema_version: 1` future-proofs downstream tooling for v1.5+ schema evolution.
- The rotated-log scan convention handles the operator's natural workload variance (the SP-003 rotation triggers naturally during a 7-day dogfood window).
- Constitution V (Zod boundaries) is preserved at every IO surface (line read + line write + JSON output).
- Constitution VII (cancellable + bounded IO) is preserved (AbortSignal + setTimeout/clearTimeout pattern).
- Constitution III (no MCP mutation surface) is preserved.
- Constitution XVI (Validation Honesty) is surfaced verbatim in the text-format banner.

**Negative**:

- The 30-second default timeout may be too aggressive on very large logs (> 100 MB); operator workaround via `--timeout=<ms>`. Documented in Risk Register R2 (plan.md).
- The C-028 thresholds (5/1) and KILL threshold (3) are NOT operator-tunable in v1; tuning is a Stage-3-Validate decision, not a Stage-5-Build decision (spec.md Out of Scope).
- The informational aggregates require the scanner to track per-event metadata (latency, tier, query_hash), which doubles the in-memory accumulator surface vs a counts-only report; deemed acceptable for typical telemetry log sizes.

**Neutral**:

- The report is read-only; running it repeatedly produces a fresh verdict for the named window without mutating state (other than the audit `engagement.report_generated` emit).
- The operator can re-run the report mid-window for an interim view; the official SP-008 verdict is the report run at end-of-window per spec.md Assumptions.

## Alternatives considered

- **Half-open window `[since, until)`** (exclude `until`): REJECTED for v1 — inclusive on both ends matches operator expectation ("from X to Y inclusive"); negligible behavioral difference for the timestamp-precision of millisecond-resolution ISO-8601.
- **Time-weighted or recency-weighted engagement metric**: REJECTED for v1 per spec.md Out of Scope. Flat-count within a window is the C-028 mitigation's literal requirement.
- **PASS requires `queries_in_window >= 5 OR acceptance_events_in_window >= 1`** (OR semantics): REJECTED. The C-028 mitigation literally requires both ("≥ 5 corpus.find queries in first 7 days of dogfooding + ≥ 1 acceptance event"). AND is the correct semantic.
- **`kill_signal` if `queries_in_window === 0` only** (zero-traffic KILL): REJECTED. The SPRINT-PLAN.yaml line 253 verbatim is `below_3_queries_in_7d` — the threshold is < 3, not == 0.
- **`kill_signal` independent of `acceptance_events_in_window`**: ACCEPTED (this is the chosen design per the truth table). The KILL signal measures engagement floor (operator is using the substrate); the acceptance gate measures quality (results were useful). Decoupling is correct.
- **Report exits 0 on FAIL**: REJECTED. PM-Review expects exit-code-as-verdict surface; FAIL → non-zero is the operator-script-friendly contract.
- **Report writes the JSON to a file by default** (vs stdout): REJECTED. Stdout is the Unix-pipe-friendly contract; operator pipes to a file: `corpus engagement-proxy report --format=json > report-$(date +%s).json`. The SP-007 InstallReceipt pattern (file write) does NOT apply — InstallReceipt is durable substrate state; the report is a transient view.
- **Report writes a copy of the full JSON to `Paths.state()/engagement-proxy-reports/<timestamp>.json`**: REJECTED by spec.md FR-ENGAGEMENT-014 (no new `Paths.*` getters; no new write surfaces). The audit emit of `engagement.report_generated` to the telemetry log is the substrate's audit surface; full JSON is the operator's responsibility to pipe to a file if forensic value is needed.
- **An MCP-resource form of the report (`corpus://engagement-proxy`)**: REJECTED by Constitution III + spec.md FR-ENGAGEMENT-013 + spec.md Out of Scope verbatim.
- **The report's deduplication by `request_id` is the FIRST defense** (drop the writer's duplicate-check from ADR-016): REJECTED. Defense-in-depth — the writer's check (ADR-016) provides operator-visible feedback ("already accepted at <ts>"); the aggregator's check is a backstop against log corruption or manual edits.

## Compliance / verification

- **Tests**:
  - `tests/unit/engagement-telemetry-scanner.test.ts` — line-by-line parsing + Zod-validate + malformed-line skip + AbortSignal abort + timeout
  - `tests/unit/engagement-report-aggregator.test.ts` — synthetic event stream → exact aggregated counts + informational
  - `tests/unit/engagement-report-verdict.test.ts` — truth table coverage (PASS, FAIL non-KILL × 2 cases, FAIL KILL × 2 cases, empty-log)
  - `tests/unit/engagement-report-json-shape.test.ts` — Zod round-trip for `EngagementProxyReportZodSchema` on all five verdict cases
  - `tests/unit/engagement-report-cli-args.test.ts` — defaults applied + invalid window rejected + future `--until` accepted
  - `packages/cli/test/engagement-proxy-e2e.test.ts` — C-046 end-to-end smoke with PASS verdict assertion
- **Telemetry**: 2 event classes (`engagement.report_generated` audit emit; `engagement.report_telemetry_parse_failed` defensive). Each Zod-validated against the `TelemetryEvent` discriminated union.
- **Lint**:
  - `no-process-exit-in-libs` (Constitution XI) over `packages/cli/src/engagement/*.ts`; `process.exit` only in `packages/cli/src/engagement-proxy-command.ts`.
  - `no-promise-race-settimeout` (Constitution VII) — scoped over SP-008 source.
  - `paths-from-resolver-only` (Constitution XIV) — verifies the scanner reads `Paths.telemetry()` not a string literal.
- **Trigger to revisit**: operator demand for a tunable C-028 threshold (would require a Stage-3-Validate revisit, not an ADR-017 superseder); operator demand for time-weighted metrics; operator demand for an MCP-resource form (would be a Constitution III amendment + a sibling ADR); shipping of v1.5+ per-client telemetry surfaces that produce auto-detected acceptance events (would extend the aggregator's filter to include the new event class, not supersede ADR-017).
