# Phase 1 — Data Model: User-Level Acceptance + Maya Week-1 Engagement-Proxy Gate (SP-008)

**Feature**: 008-user-acceptance
**Date**: 2026-05-17

This document formalizes the SP-008 entities, their fields, invariants, lifecycle, persistence paths, and their mapping into the existing SP-001..SP-007 substrate. It also enumerates the new telemetry event-class Zod schemas added additively to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts`.

**Schema delta: NONE.** SP-008 introduces ZERO new SQL tables and ZERO new `Paths.*` getters. The four new `engagement.*` event classes append to the existing `Paths.telemetry()` NDJSON log via the SP-003 atomic-append discipline. The operator-attested acceptance state is a forward-only append to the same telemetry log keyed by `request_id` (NOT a sidecar file; NOT a new SQL table — see research.md Decision B).

---

## Schema migration delta (verbatim — no SQL DDL; only Zod schema additions to packages/contracts/src/)

### `packages/contracts/src/engagement.ts` (NEW FILE)

Holds the seven new Zod schemas:

- `EngagementCorpusFindInvokedEventZodSchema` (Entity 1)
- `EngagementAcceptanceEventZodSchema` (Entity 2)
- `EngagementReportGeneratedEventZodSchema` (Entity 3)
- `EngagementReportTelemetryParseFailedEventZodSchema` (Entity 4)
- `EngagementProxyReportZodSchema` (Entity 5)
- `AcceptArgsZodSchema` (Entity 6)
- `EngagementProxyReportArgsZodSchema` (Entity 7)

### `packages/contracts/src/telemetry.ts` (EXTENDED)

The four new `engagement.*` event variants are added additively to the existing `TelemetryEvent` discriminated union. The pattern matches SP-007's 12-class additive addition:

```typescript
export const TelemetryEvent = z.discriminatedUnion('event', [
  // ... existing SP-001..SP-007 variants ...
  EngagementCorpusFindInvokedEvent,
  EngagementAcceptanceEvent,
  EngagementReportGeneratedEvent,
  EngagementReportTelemetryParseFailedEvent,
]);
```

The discriminated union remains exhaustive at TypeScript compile time. The four new event variants are also added to `SearchQueryEvent` via an additive OPTIONAL `request_id?: string` field (Decision A in research.md) — backward-compatible with existing emissions.

### `packages/contracts/src/errors.ts` (EXTENDED)

Five new typed errors:

- `EngagementProxyTelemetryParseError` — thrown by the scanner on a Zod-parse failure for a telemetry line; carries `line_number`, `error_message`, `telemetry_log_path`.
- `EngagementProxyWindowInvalidError` — thrown by the args parser on `since > until` or malformed ISO-8601; carries `since`, `until`, `reason`.
- `AcceptUnknownRequestIdError` — thrown by the acceptance-event writer when the supplied `request_id` has no matching `engagement.corpus_find_invoked` event in the telemetry log; carries `request_id`, `telemetry_log_path`.
- `AcceptZeroResultQueryError` — thrown by the acceptance-event writer when the matching find event has `result_count: 0`; carries `request_id`.
- `AcceptDuplicateRequestIdError` — **informational, NOT a failure** — used internally by the writer to signal the idempotent no-op path; the CLI catches it and prints `"already accepted: <request-id> at <ts>"` + exits 0.

### `packages/contracts/src/index.ts` (EXTENDED)

Re-exports the new engagement schemas + the new error classes so `packages/cli/` imports from `@llm-corpus/contracts` resolve.

### `Paths.telemetry()` — NDJSON log (NEW EVENT VARIANTS APPENDED; NO PATH CHANGE)

The existing `Paths.telemetry()` getter from SP-003 is reused. The four new event variants append to the same log via the existing `emitTelemetry()` helper. ZERO new write surfaces. ZERO new path-discovery requirements. The SP-003 atomic-append discipline (Constitution VIII + IX; ≤ 4 KB per line; rotation file-naming convention preserved) is the contract.

### SQL schema (`packages/storage/src/migrations/`) — UNCHANGED

ZERO DDL changes. SP-008 does NOT touch `documents`, `taxonomy_terms`, `embeddings`, `chunks`, `edges`, `documents_vec`, or any other SP-001..SP-007 table.

---

## Entity 1 — EngagementCorpusFindInvokedEvent

The per-`corpus.find`-invocation engagement-grade observability record. Emitted at the `corpus-find-tool` handler boundary (`packages/transport/src/corpus-find-tool.ts`) immediately after the existing SP-005 `search.query` event.

**Fields** (Zod-validated by `EngagementCorpusFindInvokedEventZodSchema` in `packages/contracts/src/engagement.ts`):

- `event: 'engagement.corpus_find_invoked'` — discriminator literal for the `TelemetryEvent` union.
- `timestamp: string (ISO-8601)` — wall-clock at handler-entry. UTC offset normalized for cross-window comparisons.
- `request_id: string (UUID v4)` — generated server-side at handler entry via `randomUUID()` (Decision A in research.md). Shared with the corresponding `search.query` event (the additive `request_id?` field on `SearchQueryEvent`) so forensic joins are possible.
- `query: string` — the original query text, **truncated to ≤ 1024 chars** per Constitution IX ≤ 4 KB-per-line discipline. Longer queries are truncated at the 1024-char boundary; `query_truncated: true` is set; `query_hash` is computed over the FULL untruncated text (not the truncation).
- `query_truncated?: boolean` — present and `true` ONLY when the query was longer than 1024 chars; absent (or `false`) otherwise. Schema default: absent.
- `query_hash: string (SHA-256-hex, 64 chars)` — **always present**. Computed over the FULL query text (NOT the truncated version). Used by the aggregator to compute `distinct_query_hashes` and to group duplicate queries.
- `result_count: number (integer, ≥ 0)` — from the SearchOutput's `result_count` field (SP-005 contract).
- `tier_used: 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep'` — closed enum matching the SP-006 `SEARCH_TIER_VALUES` from `packages/contracts/src/search-schemas.ts`. Per spec.md FR-ENGAGEMENT-001 (the spec uses `tier_0..tier_3` mnemonics — implementation note: emit the SP-006 canonical enum values for backward compat with existing `search.query` emissions + the `corpus://failures` resource).
- `duration_ms: number (integer, ≥ 0)` — wall-clock duration of the find-handler from entry to SearchOutput emit. Used by the aggregator for median + p95 latency aggregates.

**Persistence**:

- Appended to `Paths.telemetry()` via `emitTelemetry()` (SP-003 atomic-append; Constitution VIII + IX; ≤ 4 KB per line).
- Rotated by SP-003 telemetry rotation policy (size-threshold + file-naming convention preserved). The report scanner reads BOTH the active log AND any rotated logs whose mtime falls in the window.

**Lifecycle**:

1. **Emit** (find-handler boundary): The wrapped find-handler generates `request_id: randomUUID()`, captures `timestamp = now()`, runs the existing SP-005 retriever (which emits `search.query` with the same `request_id`), captures `result_count` + `tier_used` + `duration_ms`, computes `query_hash`, builds the event payload, emits.
2. **Read** (report scanner): The scanner iterates the active + rotated logs line-by-line, Zod-parses each line, filters by `event === 'engagement.corpus_find_invoked'` AND `timestamp ∈ [since, until]`, counts.
3. **Aggregate** (report aggregator): Computes `queries_in_window` (count of unique `engagement.corpus_find_invoked` events by `request_id` — deduplication is defense-in-depth; in practice every find emits exactly one). Computes informational aggregates (median + p95 latency from `duration_ms`; tier distribution from `tier_used`; zero-result count from `result_count === 0`; `distinct_query_hashes` from `query_hash`).

**Invariants**:

- `request_id` is generated server-side via `randomUUID()`; collision-free for the substrate's lifetime.
- `query_hash` is computed over the FULL query (NOT the truncated version) so duplicate-query grouping is correct.
- `query_truncated: true` IMPLIES `query.length === 1024`.
- `query_truncated` absent OR `false` IMPLIES `query.length <= 1024` AND `query` equals the original input.
- `tier_used` is one of the four SP-006 canonical tier values (the enum is closed).
- `result_count ≥ 0`. A zero-result query is valid (emits the event with `result_count: 0`) and is counted by the aggregator as a query (NOT as an acceptance event).
- Per Constitution IX: total event size ≤ 4096 bytes (the 1024-char `query` cap + the 64-char `query_hash` + the other fields are well under).

---

## Entity 2 — EngagementAcceptanceEvent

The operator's explicit attestation that a `corpus.find` invocation's results were useful. Emitted by the `corpus accept` CLI subcommand (the D2 acceptance-event-definition decision per spec.md Clarifications Block Decision 1 + ADR-016).

**Fields** (Zod-validated by `EngagementAcceptanceEventZodSchema`):

- `event: 'engagement.acceptance_event'` — discriminator literal.
- `timestamp: string (ISO-8601)` — `accepted_at` wall-clock at the moment of the `corpus accept` invocation.
- `request_id: string (UUID v4)` — matches a prior `engagement.corpus_find_invoked` event's `request_id`. This is the foreign-key relationship between the find invocation and the operator's attestation.
- `acceptance_note?: string` — operator-supplied free-text rationale (≤ 512 chars; truncated at the Zod boundary — rejected at parse time if oversize per FR-ENGAGEMENT-002). Absent if the operator did not pass `--note`. For the operator's own forensic value only; does NOT influence the metric.

**Persistence**:

- Appended to `Paths.telemetry()` via `emitTelemetry()` (same write surface as Entity 1).
- Append-only forever. No GC. The operator's audit trail is permanent.

**Lifecycle**:

1. **Capture request_id** (operator action): Operator tails `Paths.telemetry()`, finds the `engagement.corpus_find_invoked` event for a useful query, copies the `request_id`.
2. **Invoke** (operator): Operator runs `corpus accept <request-id> [--note "<text>"]`.
3. **Validate** (acceptance-event-writer): The writer (i) Zod-parses argv against `AcceptArgsZodSchema`; (ii) scans the telemetry log for the matching `engagement.corpus_find_invoked` event by `request_id`; if absent → throw `AcceptUnknownRequestIdError` → CLI exits non-zero; (iii) verifies `result_count ≥ 1`; if zero → throw `AcceptZeroResultQueryError` → CLI exits non-zero; (iv) scans for a prior `engagement.acceptance_event` with the same `request_id`; if present → throw `AcceptDuplicateRequestIdError` (informational) → CLI prints "already accepted: <id> at <ts>" + exits 0; (v) emits the new event via `emitTelemetry()`.
4. **Read** (report scanner): Same scan path as Entity 1; filtered by `event === 'engagement.acceptance_event'`.
5. **Aggregate** (report aggregator): Computes `acceptance_events_in_window` (count of unique `engagement.acceptance_event` events by `request_id` — deduplication via the Step 3.iv check is defense-in-depth; the aggregator's dedup is the second defense).

**Invariants**:

- `request_id` MUST match a prior `engagement.corpus_find_invoked` event with `result_count ≥ 1`. Enforced by the writer (Steps 3.ii + 3.iii).
- At most ONE `engagement.acceptance_event` per `request_id` in the telemetry log. Enforced by the writer's duplicate-detection (Step 3.iv) + the aggregator's dedup (Step 5).
- `acceptance_note` is ≤ 512 chars. Enforced at Zod parse time.
- Per Constitution IX: total event size ≤ 4096 bytes (well under with the 512-char note cap).
- `corpus accept` does NOT enforce a temporal window on the accepted query's age — the operator may accept any past `request_id` from the telemetry log (per spec.md Edge Cases).

---

## Entity 3 — EngagementReportGeneratedEvent

The audit record of a `corpus engagement-proxy report` invocation. Emitted by the report CLI on every successful report generation.

**Fields** (Zod-validated by `EngagementReportGeneratedEventZodSchema`):

- `event: 'engagement.report_generated'` — discriminator literal.
- `timestamp: string (ISO-8601)` — wall-clock at report-generation completion.
- `window: {since: string (ISO-8601), until: string (ISO-8601)}` — the requested window bounds.
- `verdict: 'PASS' | 'FAIL'` — the C-028 verdict.
- `queries_in_window: number (integer, ≥ 0)` — the count of `engagement.corpus_find_invoked` events in the window.
- `acceptance_events_in_window: number (integer, ≥ 0)` — the count of `engagement.acceptance_event` events in the window.
- `kill_signal: boolean` — `queries_in_window < 3` per FR-ENGAGEMENT-005.

**Persistence**:

- Appended to `Paths.telemetry()` via `emitTelemetry()` on every report generation.
- Provides a forensic audit trail of who ran the report when + what they saw.

**Lifecycle**:

1. **Emit** (report CLI completion): After the verdict is computed AND rendered to stdout, the CLI emits this event to the telemetry log.
2. **Read** (future audits): Operators (or post-v1 tooling) can query the telemetry log for "when was the report run and what verdict did it produce" — useful for the SP-008 RETROSPECTIVE.md cross-reference.

**Invariants**:

- One emission per report invocation.
- `since <= until` (the report's args parser enforces; an invalid window throws `EngagementProxyWindowInvalidError` before the report runs).
- `verdict === 'PASS'` IFF (`queries_in_window >= 5` AND `acceptance_events_in_window >= 1`).
- `kill_signal === true` IFF `queries_in_window < 3`.

---

## Entity 4 — EngagementReportTelemetryParseFailedEvent

A defensive observability event emitted when the report's scanner encounters a malformed telemetry-log line. Emitted in addition to the line being skipped + counted in `parse_errors_count`.

**Fields** (Zod-validated by `EngagementReportTelemetryParseFailedEventZodSchema`):

- `event: 'engagement.report_telemetry_parse_failed'` — discriminator literal.
- `timestamp: string (ISO-8601)` — wall-clock at scanner detection.
- `telemetry_log_path: string` — the absolute path to the log file being scanned (either `Paths.telemetry()` or a rotated log path).
- `line_number?: number (integer, ≥ 1)` — the 1-based line index of the malformed line within the log file (absent if the scanner cannot determine the line — e.g., a binary corruption mid-file).
- `error_message: string` — ≤ 1024 chars; the Zod-formatted error or NDJSON parse error.

**Persistence**:

- Appended to `Paths.telemetry()` via `emitTelemetry()` on each detection.
- Note the recursive concern: emitting telemetry while scanning telemetry. Per the SP-003 atomic-append discipline, concurrent reads + writes are tolerated; the scanner's view of "events in the window" reflects the state at scan-start (subsequent appends, including these defensive events, are not re-scanned). No infinite loop.

**Lifecycle**:

1. **Detect** (scanner): A line fails Zod parse OR JSON parse OR exceeds the line-length cap.
2. **Skip + Count**: The line is NOT counted toward any metric; `parse_errors_count` is incremented in the report's accumulator.
3. **Emit**: The event is appended to the telemetry log via `emitTelemetry()`.
4. **Continue**: Scanner advances to the next line.

**Invariants**:

- Per Constitution XIII: every parse failure emits this event (no silent swallowing).
- `error_message` is ≤ 1024 chars (truncated for Constitution IX size budget).
- Per Constitution IX: total event size ≤ 4096 bytes.

---

## Entity 5 — EngagementProxyReport

The JSON form of the `corpus engagement-proxy report --format=json` output. Zod-validated at emit time against `EngagementProxyReportZodSchema`. This is the report CLI's structured output — consumed by downstream tooling (the post-`/speckit-tasks` quickstart pipes it to `jq`).

**Fields** (Zod-validated by `EngagementProxyReportZodSchema`):

- `schema_version: 1` — literal for v1; future v1.5+ may ship `2`. Pattern matches SP-007's InstallReceipt `schema_version` field.
- `generated_at: string (ISO-8601)` — wall-clock at report generation.
- `window: {since: string (ISO-8601), until: string (ISO-8601)}` — the requested window bounds (defaults applied if operator omitted: since = now-7d, until = now).
- `queries_in_window: number (integer, ≥ 0)` — see Entity 1 lifecycle Step 3.
- `acceptance_events_in_window: number (integer, ≥ 0)` — see Entity 2 lifecycle Step 5.
- `c028_threshold_met: boolean` — `queries_in_window >= 5 AND acceptance_events_in_window >= 1`.
- `kill_signal: boolean` — `queries_in_window < 3`.
- `verdict: 'PASS' | 'FAIL'` — `c028_threshold_met ? 'PASS' : 'FAIL'`.
- `parse_errors_count: number (integer, ≥ 0)` — count of malformed telemetry lines skipped during the scan.
- `informational: {median_latency_ms: number | null, p95_latency_ms: number | null, tier_distribution: {hybrid: number, 'bm25-only': number, 'catalog-grep': number, 'fs-grep': number}, zero_result_queries: number, distinct_query_hashes: number}` — informational aggregates per FR-ENGAGEMENT-003. The `*_latency_ms` fields are `null` if `queries_in_window === 0` (no data to aggregate).
- `c028_threshold: {min_queries: 5, min_acceptance_events: 1}` — literal constants from FR-ENGAGEMENT-005; emitted so downstream tooling sees what threshold the report enforces.
- `kill_signal_threshold: {min_queries: 3}` — literal constant; same rationale.

**Persistence**:

- Stdout-only when `--format=json` is requested.
- A copy of the verdict + `queries_in_window` + `acceptance_events_in_window` + `kill_signal` is emitted as `engagement.report_generated` to the telemetry log (Entity 3); the full JSON report is NOT persisted by the substrate (the operator pipes to a file if desired: `corpus engagement-proxy report --format=json > report-$(date +%s).json`).

**Lifecycle**:

1. **Compute** (report aggregator): Accumulates all fields during the scan.
2. **Validate** (renderer): The JSON renderer Zod-validates the assembled report against `EngagementProxyReportZodSchema` BEFORE emitting to stdout (defense-in-depth — defensive serialization per Constitution V).
3. **Emit**: Stdout receives the JSON. The text-format renderer (per `--format=text`) produces a human-readable version of the same data + the Constitution XVI banner.
4. **Audit emit**: The CLI emits Entity 3 (`engagement.report_generated`) to the telemetry log.

**Invariants**:

- `schema_version === 1` for SP-008.
- `verdict === 'PASS'` IFF `c028_threshold_met === true`.
- `kill_signal === true` IFF `queries_in_window < 3`.
- `parse_errors_count >= 0`; non-zero implies operator should investigate telemetry log integrity.
- `informational.tier_distribution` sums to ≤ `queries_in_window` (queries with unknown `tier_used` are NOT counted in the distribution; this is impossible if the find-handler emits correctly per Entity 1, but the schema is defensive).
- `informational.zero_result_queries <= queries_in_window`.
- `informational.distinct_query_hashes <= queries_in_window`.

---

## Entity 6 — AcceptArgs

The parsed arguments to `corpus accept <request-id> [--note <text>]`. Zod-validated at argv-parse time.

**Fields** (Zod-validated by `AcceptArgsZodSchema`):

- `request_id: string (UUID v4)` — required positional. Validated against the UUID v4 regex (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`).
- `note?: string` — optional via `--note <text>`. Max length 512 chars. Trimmed of leading/trailing whitespace.

**Persistence**:

- In-memory only. Lives during the `corpus accept` invocation; never persisted.

**Lifecycle**:

1. **Parse** (accept-args-parser): Reads `process.argv`, applies Zod, throws on validation failure. The CLI catches the throw and emits `install.step_failed`-equivalent telemetry (TBD: a SP-008-specific `accept.args_invalid` event could be added if needed; for v1 the existing telemetry-or-die catch-all handles it).
2. **Dispatch**: Pass to acceptance-event-writer.

**Invariants**:

- `request_id` matches the UUID v4 format.
- `note` is ≤ 512 chars trimmed.

---

## Entity 7 — EngagementProxyReportArgs

The parsed arguments to `corpus engagement-proxy report [--since=<ts>] [--until=<ts>] [--format=text|json] [--telemetry-log=<path>] [--timeout=<ms>]`. Zod-validated at argv-parse time.

**Fields** (Zod-validated by `EngagementProxyReportArgsZodSchema`):

- `since?: string (ISO-8601)` — optional. Default: `now - 7d` (computed at parse time; UTC-normalized).
- `until?: string (ISO-8601)` — optional. Default: `now` (computed at parse time).
- `format?: 'text' | 'json'` — optional. Default: `'text'`.
- `telemetry_log?: string` — optional. Default: `Paths.telemetry()`. When supplied, MUST exist + be readable (validated by the Zod refine + the scanner pre-flight).
- `timeout_ms?: number (integer, [1, 600000])` — optional. Default: `30000` (30 seconds).

**Persistence**:

- In-memory only.

**Lifecycle**:

1. **Parse** (engagement-proxy-report-args-parser): Reads `process.argv`, applies Zod, computes defaults, throws on validation failure.
2. **Validate window** (refine): If `since > until` (after defaults), throws `EngagementProxyWindowInvalidError`.
3. **Dispatch**: Pass to telemetry-log-scanner + report-aggregator.

**Invariants**:

- `since <= until` (after defaults).
- `format` ∈ `{'text', 'json'}`.
- `timeout_ms` ∈ `[1, 600000]` (1 ms to 10 minutes; prevents pathological abuse).
- `telemetry_log` (when supplied) is an absolute path to a readable file.

---

## Telemetry event registration table

| Event class | Emitter | Listener | Persistence | Constitution binding |
|---|---|---|---|---|
| `engagement.corpus_find_invoked` (Entity 1) | `packages/transport/src/corpus-find-tool.ts` (wrapped find-handler) | `packages/cli/src/engagement/telemetry-log-scanner.ts` | `Paths.telemetry()` NDJSON | V, IX, XIII |
| `engagement.acceptance_event` (Entity 2) | `packages/cli/src/engagement/acceptance-event-writer.ts` | `packages/cli/src/engagement/telemetry-log-scanner.ts` | `Paths.telemetry()` NDJSON | V, X, XIII |
| `engagement.report_generated` (Entity 3) | `packages/cli/src/engagement-proxy-command.ts` | (audit-only; future RETROSPECTIVE.md cross-ref) | `Paths.telemetry()` NDJSON | V, XIII |
| `engagement.report_telemetry_parse_failed` (Entity 4) | `packages/cli/src/engagement/telemetry-log-scanner.ts` | (audit-only; surfaces in `parse_errors_count`) | `Paths.telemetry()` NDJSON | V, XIII |

All four events flow through the existing `emitTelemetry()` helper (Constitution VIII + IX preserved); ZERO new write surfaces.

---

## Cross-entity relationships

```
EngagementCorpusFindInvokedEvent (Entity 1)
    │
    │ request_id (foreign-key)
    ▼
EngagementAcceptanceEvent (Entity 2)
    │
    │ scanned by
    ▼
TelemetryLogScanner (helper)
    │
    │ produces filtered event stream
    ▼
ReportAggregator (helper)
    │
    │ produces aggregated counts + informational
    ▼
VerdictComputer (helper)
    │
    │ produces verdict + kill_signal
    ▼
EngagementProxyReport (Entity 5)
    │
    │ emit-audit via
    ▼
EngagementReportGeneratedEvent (Entity 3)
```

Independent emit-path for Entity 4:

```
TelemetryLogScanner (helper)
    │
    │ encounters malformed line
    ▼
EngagementReportTelemetryParseFailedEvent (Entity 4)
    │ (also: incremented in parse_errors_count on the in-flight report)
```

---

## Backward compatibility note

The four new `engagement.*` event variants are additive to the `TelemetryEvent` discriminated union; the SP-001..SP-007 event variants are unchanged. Existing log lines remain valid; existing emitters do not need to be updated.

The additive `request_id?: string` field on `SearchQueryEvent` (Decision A in research.md) is OPTIONAL and backward-compatible — SP-005-era emissions without the field still validate; SP-008-era emissions populate the field via the new shared-`request_id` find-handler wrapping. The aggregator does NOT depend on `SearchQueryEvent.request_id`; it reads `engagement.corpus_find_invoked` directly.

ZERO breaking changes to the SP-001..SP-007 substrate.
