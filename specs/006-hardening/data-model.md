# Phase 1 — Data Model: Production Hardening (Recovery + Failures Resource + Tier Fallthrough)

**Feature**: 006-hardening
**Date**: 2026-05-13

This document formalizes the SP-006 entities, their fields, invariants, lifecycle, persistence paths, and their mapping into the existing SP-001..SP-005 substrate. It also enumerates the new telemetry event-class Zod schemas added to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts`.

**Schema delta: NONE.** SP-006 introduces ZERO new SQL tables. The recovery scanner reads `Paths.telemetry()` JSONL (existing). The `corpus://failures` resource reads `Paths.failed()/*.error.json` sidecars (existing — SP-003-written). The tier-fallthrough cascade reads SP-005's `documents_fts` (Tier 1), reads the new `Paths.data() + '/CATALOG.md'` flat file (Tier 2 — flat-file mirror, NOT a SQL table), and reads `Paths.docs()/**/*.md` body files (Tier 3). The `SearchHit` shape from SP-005 is extended ADDITIVELY with a `tier_used` enum field.

---

## Schema migration delta (verbatim — no SQL DDL; the additive contracts shape changes are listed below)

### `Paths.data() + '/CATALOG.md'` (flat-file index — NEW)

Format: one line per indexed document.

```
<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>
```

**Invariants**:
- One line per `doc_id`. Appended at SP-005 index-stage time (AFTER the SQL transaction commits — Constitution VIII transactional unit is the SQL writes; CATALOG.md is a flat-file mirror like the SP-004 body-file frontmatter rewrite).
- Atomic append via `withTempDir + fs.appendFile` — partial writes are forbidden permitted state.
- Codepoint-safe truncation of the summary to first 200 chars (preserves grapheme clusters).
- The `|` delimiter is escaped from input fields (replaced with `‖` U+2016 if present in title/summary).
- File location: `Paths.data() + '/CATALOG.md'`.
- If absent (legacy DB pre-SP-006-migration), Tier 2 emits `search.tier_skipped` and falls through to Tier 3.

### `Paths.failed() + '/<doc-id>.recovery.error.json'` (recovery sidecar — NEW)

JSON shape mirroring the SP-003 verbatim sidecar shape:

```json
{
  "doc_id": "doc-XXXXXXXX",
  "stage": "ingest|classify|embed|index|edges-build",
  "error_code": "unrecoverable_orphan",
  "message": "<diagnostic e.g., 'inbox file deleted during kill window'>",
  "timestamp": "<ISO-8601 scan-time>",
  "retriable": false
}
```

**Invariants**:
- Same on-disk shape as the SP-003 `.error.json` sidecars — `error_code='unrecoverable_orphan'` is the SP-006-specific value.
- One sidecar per non-resumable orphan; idempotent re-write produces the same content.
- Discovered by the `corpus://failures` resource handler (same glob pattern: `Paths.failed() + '/*.error.json'` AND `Paths.failed() + '/*.recovery.error.json'`).

### `SearchHitZodSchema` (extended additively from SP-005)

```typescript
// SP-005 (existing):
SearchHitZodSchema = z.object({
  uri: z.string().regex(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/),
  score: z.number(),
  title: z.string(),
  facet_domain: z.string(),
  facet_type: z.enum(FACET_TYPE_VALUES),
  tags: z.array(z.string()),
  snippet: z.string().max(400),
  // SP-006 added field (REQUIRED in SP-006+; consumers ignoring unknown fields unaffected):
  tier_used: z.enum(['hybrid', 'bm25-only', 'catalog-grep', 'fs-grep']),
}).strict();
```

The SP-005 `SearchOutputZodSchema`'s `tier_used` field is updated from `z.literal('hybrid')` to `z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])`. This is the DEEPEST tier that produced any hit (i.e., `'fs-grep'` if Tier 3 contributed, else `'catalog-grep'`, else `'bm25-only'`, else `'hybrid'`).

---

## Entity 1 — RecoveryOrphan

An in-memory record produced by the recovery scanner per detected orphan. Lives only during the scan; never persisted.

**Fields**:

- `doc_id: string | null` — the document ID parsed from the orphan's `*.started` event payload. May be `null` for pre-persist orphans (e.g., an ingest validation orphan before a doc_id was assigned).
- `stage: 'ingest' | 'classify' | 'embed' | 'index' | 'edges-build'` — the sub-stage that started without a matching completed/failed event.
- `started_ts: string (ISO-8601)` — the timestamp of the `*.started` event.
- `last_seen_ts: string (ISO-8601)` — the timestamp of the last related event in the daemon-session log (e.g., a `*.attempt` event if the stage tried multiple times).
- `inbox_file?: string` — for `stage='ingest'` orphans, the inbox filename derived from the orphan's metadata. Used by the resumability matrix to check whether the file still exists at `Paths.inbox() + '/' + inbox_file`.
- `resumable: boolean` — set by the resumability matrix; `true` if the orphan can be re-queued; `false` otherwise.
- `unresumable_reason?: string` — diagnostic for non-resumable cases (e.g., `'inbox file absent'`).

**Lifecycle**:

1. **Scan**: `recovery-scanner.ts` reads `Paths.telemetry()` JSONL backwards from end-of-file to the most-recent `daemon.started` marker, parses each line, builds a `(doc_id, stage) → {started_ts, last_seen_ts, inbox_file?}` map. The map's entries that lack a matching `*.completed` / `*.failed` are emitted as RecoveryOrphan records.
2. **Classify**: `recovery-resumability.ts` consumes each RecoveryOrphan and sets `resumable: boolean` via the resumability-matrix dispatch (Decision B):
   - `stage='ingest'` + `inbox_file present at Paths.inbox()` → `resumable: true`
   - `stage='ingest'` + `inbox_file absent` → `resumable: false, unresumable_reason='ingest file missing'`
   - `stage in ('classify','embed','index','edges-build')` → `resumable: true` (all idempotent transitions per Constitution X)
3. **Dispatch**: Resumable orphans are routed to the existing SP-003 → SP-005 stages via the daemon's normal queue surfaces. Non-resumable orphans get a `.recovery.error.json` sidecar.

**Invariants**:

- A `recovery.orphan_found` event fires for every RecoveryOrphan during scan.
- A `recovery.resumed` event fires for every resumable RecoveryOrphan during dispatch.
- A `recovery.aborted` event fires for every non-resumable RecoveryOrphan during dispatch.
- The RecoveryOrphan record is never persisted to disk (it's a transient scan artifact). The downstream effects (re-queue events, sidecar files) ARE persisted.

---

## Entity 2 — FailureEntry

The on-the-wire shape of each entry in the `corpus://failures` resource response. Consumed by MCP-aware agents.

**Fields**:

- `doc_id: string | null` — same as SP-003.
- `stage: 'validation' | 'hash' | 'normalize' | 'persist' | 'classify' | 'embed' | 'index' | 'edges-build' | 'unrecoverable_orphan'` — closed enum extending the SP-003 stage enum with SP-006's `unrecoverable_orphan` value.
- `error_code: string` — bounded string; the SP-003-written error code.
- `message: string` — bounded ≤ 1024 chars (Constitution V).
- `timestamp: string (ISO-8601)` — the sidecar's `timestamp` field verbatim.
- `retriable: boolean` — the SP-003-written retriable flag.
- `sidecar_path: string` — SP-006-added; the absolute path under `Paths.failed()` so operators can `rm` after triaging.

**Persistence**:

- On disk: `Paths.failed() + '/<doc-id>.error.json'` (SP-003 sidecars) AND `Paths.failed() + '/<doc-id>.recovery.error.json'` (SP-006 recovery sidecars). The resource handler globs both patterns.
- In response: `entries: FailureEntry[]` with the SP-006 enriched shape.

**Lifecycle**:

1. **Write** (SP-003 / SP-006 — outside resource scope): a pipeline stage failure produces a `.error.json` sidecar via `failure-lane.ts` (SP-003); a recovery scan produces a `.recovery.error.json` sidecar (SP-006).
2. **Read** (SP-006 — resource scope): `failures-resource-adapter.ts` globs both patterns, parses each per the FailureEntryZodSchema, filters by `?stage=` + `?since=`, sorts descending by `timestamp`, paginates by `?limit=` + `?offset=`, returns.
3. **Delete** (out of scope): operator manually `rm` after triaging. SP-006 ships no auto-deletion.

**Invariants**:

- The `sidecar_path` is ALWAYS within `Paths.failed()` (Constitution XIV; no escape).
- Malformed sidecars are skipped from the response with a `failures.sidecar_parse_failed` event (per-sidecar graceful degradation).
- The total count `total_count` is the post-filter, pre-pagination count; `returned_count` is `min(total_count - offset, limit)`.
- The response carries `schema_version: 1` (FR-HARDEN-009).

---

## Entity 3 — TierResult

An internal-only record per tier in the fallthrough cascade. Lives only during a `corpus.find` invocation; never persisted.

**Fields**:

- `tier: 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep'` — which tier produced this result set.
- `hits: SearchHit[]` — the SearchHits this tier produced; each hit's `tier_used` field is pre-set to `tier`.
- `elapsed_ms: number` — wall-clock for this tier's execution.
- `outcome: 'completed' | 'skipped' | 'failed' | 'aborted'` — `'completed'` if hits were produced (may be 0); `'skipped'` if the tier's prerequisites were absent (e.g., CATALOG.md missing); `'failed'` if the tier errored (e.g., grep ENOENT); `'aborted'` if AbortSignal fired.
- `error?: string` — diagnostic for `failed` outcomes.

**Lifecycle**:

1. **Spawn**: The tier-orchestrator calls `tier.search(query, {topK, filters, signal, deadline})` and awaits the TierResult.
2. **Merge**: TierResult records from successive tiers are merged by the orchestrator; deduplication by `doc_id` (a hit produced by Tier 0 takes precedence over a hit produced by Tier 1, etc. — preserves the higher-tier ordering).
3. **Promote**: After the cascade exits (either reached `min_results` or budget exhausted), the orchestrator emits the final SearchHit list with per-hit `tier_used` values and emits the cascade-level `search.completed` event with `tier_used` set to the deepest tier that contributed.

**Invariants**:

- Each TierResult's `hits[]` carries `tier_used: tier` consistently (the orchestrator does not relabel hits).
- TierResult's `elapsed_ms` is per-tier (not cumulative); the cascade's total wall-clock is the sum.
- Aborted TierResults have `hits: []` and `outcome: 'aborted'`.

---

## Entity 4 — TierFallthroughTelemetry

One of the FR-HARDEN-019 event classes. Validated against the existing `TelemetryEvent` Zod discriminated union (additive variants).

**Variants**:

### `search.tier_fallthrough` event

```typescript
{
  event: 'search.tier_fallthrough',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  from_tier: 'hybrid' | 'bm25-only' | 'catalog-grep',
  to_tier: 'bm25-only' | 'catalog-grep' | 'fs-grep',
  reason: 'below_min_results' | 'tier_failed',
  hits_before_fallthrough: number,
}
```

### `search.tier_skipped` event

```typescript
{
  event: 'search.tier_skipped',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'success',  // skipped is not a failure
  tier: 'catalog-grep' | 'fs-grep',
  reason: 'catalog_missing' | 'grep_unavailable',
}
```

### `search.tier_failed` event

```typescript
{
  event: 'search.tier_failed',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'failure',
  tier: 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep',
  errno?: string,
  error_code?: string,
  duration_ms: number,
}
```

### `search.tier_budget_exceeded` event

```typescript
{
  event: 'search.tier_budget_exceeded',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'success',  // partial results still returned
  budget_ms: number,
  actual_ms: number,
  tiers_attempted: ('hybrid'|'bm25-only'|'catalog-grep'|'fs-grep')[],
  final_hit_count: number,
}
```

### Updated `search.completed` event (SP-005 extension)

```typescript
{
  event: 'search.completed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  duration_ms: number,
  result_count: number,
  query_hash: string,                    // SP-005 inherited
  // SP-006 update: tier_used was z.literal('hybrid'); now z.enum([...])
  tier_used: 'hybrid' | 'bm25-only' | 'catalog-grep' | 'fs-grep',
  signals_used: string[],
}
```

---

## Entity 5 — RecoveryTelemetry

One of the FR-HARDEN-005 event classes. Validated against the existing `TelemetryEvent` Zod discriminated union.

**Variants**:

### `recovery.scan_started` event

```typescript
{
  event: 'recovery.scan_started',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  daemon_session_start_ts: ISO8601,  // the most-recent prior daemon.started marker; null if none
}
```

### `recovery.scan_completed` event

```typescript
{
  event: 'recovery.scan_completed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  duration_ms: number,
  resumed_count: number,
  aborted_count: number,
  daemon_session_start_ts: ISO8601,
}
```

### `recovery.scan_skipped` event

```typescript
{
  event: 'recovery.scan_skipped',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  reason: 'no_prior_session' | 'lock_contention',
}
```

### `recovery.scan_reentry` event

```typescript
{
  event: 'recovery.scan_reentry',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'success',
  prior_scan_start_ts: ISO8601,  // the unfinished scan's start timestamp
}
```

### `recovery.orphan_found` event

```typescript
{
  event: 'recovery.orphan_found',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  doc_id: string | null,
  stage: 'ingest' | 'classify' | 'embed' | 'index' | 'edges-build',
  started_ts: ISO8601,
}
```

### `recovery.resumed` event

```typescript
{
  event: 'recovery.resumed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  doc_id: string,
  stage: 'ingest' | 'classify' | 'embed' | 'index' | 'edges-build',
}
```

### `recovery.aborted` event

```typescript
{
  event: 'recovery.aborted',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'failure',
  doc_id: string | null,
  stage: 'ingest' | 'classify' | 'embed' | 'index' | 'edges-build',
  reason: string,  // e.g., 'ingest file missing'
}
```

### `recovery.telemetry_parse_failed` event

```typescript
{
  event: 'recovery.telemetry_parse_failed',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'failure',
  line_offset: number,  // byte offset of the malformed line
  error: string,
}
```

### `recovery.aborted_scan` event

```typescript
{
  event: 'recovery.aborted_scan',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'failure',
  reason: 'abort_signal' | 'timeout',
}
```

### `failures.sidecar_parse_failed` event

```typescript
{
  event: 'failures.sidecar_parse_failed',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'failure',
  sidecar_path: string,
  error: string,
}
```

---

## Entity 6 — FailuresResourceResponse

The full shape of the `corpus://failures` resource response. Validated via `FailuresResourceResponseZodSchema`.

**Fields**:

- `entries: FailureEntry[]` — the paginated, post-filter entries.
- `total_count: number (int)` — the post-filter, pre-pagination count.
- `returned_count: number (int)` — `min(total_count - offset, limit)`.
- `schema_version: 1` — literal for v1.

**Invariants**:

- `returned_count === entries.length`.
- `returned_count <= limit`.
- `total_count >= returned_count`.
- `schema_version` is `z.literal(1)` in v1; future SP-007+ may add `2`.

---

## Entity 7 — FailuresResourceQuery

The parsed query parameters of the `corpus://failures` resource. Validated via `FailuresQueryZodSchema`.

**Fields**:

- `stage?: 'validation' | 'hash' | 'normalize' | 'persist' | 'classify' | 'embed' | 'index' | 'edges-build' | 'unrecoverable_orphan'` — closed enum.
- `since?: string (ISO-8601)` — only entries with `timestamp >= since` included.
- `limit: number (int, default 50, range [1, 1000])` — pagination size.
- `offset: number (int, default 0, range [0, ∞))` — pagination offset.

**Validation**:

- Strict mode (unknown keys → `validation_error` envelope).
- `stage` must be in the closed enum or absent.
- `since` must be valid ISO-8601 or absent.
- `limit` and `offset` bounded as above.

---

## Entity 8 — CatalogLine

A single line in `Paths.data() + '/CATALOG.md'`.

**Format**:

```
<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>
```

**Fields** (parsed from the line):

- `doc_id: string (regex /^doc-[0-9a-f]{8}$/)`
- `title: string` (max 200 chars; `|` and `‖` escapes applied)
- `facet_domain: string`
- `facet_type: enum` (one of FACET_TYPE_VALUES)
- `summary_preview: string` (max 200 chars; codepoint-safe truncated)

**Invariants**:

- One line per indexed document. Written at SP-005 index-stage time, post-COMMIT.
- The `|` delimiter is escaped from input fields (replaced with `‖` U+2016).
- Codepoint-safe truncation preserves grapheme clusters.
- File is append-only at index time; regenerated wholesale by `corpus reindex` (SP-006-extended).

---

## State machine: recovery orphan resolution

```
[telemetry log read]
     ↓
[(*.started without *.completed) detected per (doc_id, stage)]
     ↓
[RecoveryOrphan record]
     ↓
[resumability matrix dispatch]
       ├── stage='ingest' + inbox_file present → resumable
       ├── stage='ingest' + inbox_file absent → non-resumable
       └── stage in ('classify','embed','index','edges-build') → resumable
     ↓
       ├── resumable=true → [re-queue into existing pipeline stage]
       │                       ↓
       │                   [recovery.resumed event]
       │
       └── resumable=false → [write .recovery.error.json sidecar at Paths.failed()]
                              ↓
                          [recovery.aborted event]
```

---

## State machine: tier fallthrough cascade

```
[corpus.find(query) called]
     ↓
[Tier 0 hybrid retriever runs (SP-005 unchanged)]
     ↓
[Tier 0 produces N hits]
     ↓
       ├── N >= min_results → return; tier_used='hybrid'
       └── N < min_results  → fall to Tier 1 (search.tier_fallthrough event)
     ↓
[Tier 1 BM25-only runs against documents_fts]
     ↓
[Tier 1 produces M hits; merge with Tier 0 hits (dedup by doc_id)]
     ↓
       ├── merged count >= min_results → return; tier_used='bm25-only'
       └── still < min_results → fall to Tier 2 (search.tier_fallthrough)
     ↓
[Tier 2 in-process grep over CATALOG.md runs]
     ↓
       ├── CATALOG.md absent → search.tier_skipped; fall through to Tier 3
       └── CATALOG.md present → Tier 2 produces K hits; merge with prior
     ↓
       ├── merged count >= min_results → return; tier_used='catalog-grep'
       └── still < min_results → fall to Tier 3 (search.tier_fallthrough)
     ↓
[Tier 3 runTool('grep', ['-rn','-l','--include=*.md', <pattern>, Paths.docs()]) runs]
     ↓
       ├── grep ENOENT → search.tier_failed; return partial set
       └── grep success → Tier 3 produces L hits; merge with prior
     ↓
[return final SearchHit[] with per-hit tier_used + cascade-level tier_used]
```

---

## Telemetry class registry (SP-006 additions)

The full list of new SP-006 event classes added to the `TelemetryEvent` discriminated union:

**Recovery (9 classes)**:

- `recovery.scan_started`
- `recovery.scan_completed`
- `recovery.scan_skipped`
- `recovery.scan_reentry`
- `recovery.orphan_found`
- `recovery.resumed`
- `recovery.aborted`
- `recovery.telemetry_parse_failed`
- `recovery.aborted_scan`

**Failures resource (1 class)**:

- `failures.sidecar_parse_failed`

**Tier fallthrough (4 classes + 1 updated)**:

- `search.tier_fallthrough`
- `search.tier_skipped`
- `search.tier_failed`
- `search.tier_budget_exceeded`
- `search.completed` (UPDATED — `tier_used` field changed from `z.literal('hybrid')` to `z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])`)

**Total**: 14 new classes + 1 updated class. All ≤ 4096 bytes serialized (Constitution IX). All Zod-validated round-trip in `tests/unit/telemetry-sp006-classes.test.ts`.

---

## XDG Paths surface (SP-006 reuses; ZERO new bases)

- `Paths.failed()` — recovery sidecars + failures resource source.
- `Paths.telemetry()` — recovery scanner JSONL.
- `Paths.docs()` — Tier 3 grep target.
- `Paths.data()` — CATALOG.md location.
- `Paths.drainLock()` — recovery serialization point.
- `Paths.inbox()` — recovery ingest-orphan resumability check.

Constitution XIV satisfied trivially: ZERO new XDG bases. The `paths-from-resolver-only` ESLint rule applies to all SP-006 source.

---

## Out-of-band data (NOT in this data model)

- **`recovery.scan_state` in-memory queue** — transient. Not persisted; if the daemon is killed during recovery, the new daemon's recovery scan re-discovers all orphans from the telemetry log (Scenario 5 of US1).
- **`tier-cascade` in-memory orchestrator state** — transient. Per `corpus.find` invocation. AbortController + per-tier deadlines.

These are documented for completeness but live entirely in process memory.
