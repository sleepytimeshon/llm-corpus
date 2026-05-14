// SP-006 T003 — Contract test for the 14 SP-006 telemetry event classes
// (9 recovery.* + 1 failures.sidecar_parse_failed + 4 search.tier_*).
//
// Spec drift note (T003): tasks.md originally said "13" new classes; the
// data-model.md Entity 4 + Entity 5 + failures.sidecar_parse_failed enumerate
// 14 classes. Implement 14. See spec-drift section of the SP-006 tasks.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-005, FR-HARDEN-019
//   - specs/006-hardening/data-model.md §"Entity 4" + §"Entity 5"
//   - Constitution Principles I, V, IX, XIII

import { describe, it, expect } from 'vitest';
import {
  TelemetryEvent,
  TELEMETRY_MAX_BYTES,
} from '../../packages/contracts/src/telemetry.js';

const now = '2026-05-13T10:00:00Z';
const docId = 'doc-deadbeef';
const queryHash = '0'.repeat(64);

// ---- 9 recovery.* events ----
const RECOVERY_EVENTS: ReadonlyArray<unknown> = [
  {
    event: 'recovery.scan_started',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    daemon_session_start_ts: now,
  },
  {
    event: 'recovery.scan_completed',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    duration_ms: 123,
    resumed_count: 3,
    aborted_count: 1,
    daemon_session_start_ts: now,
  },
  {
    event: 'recovery.scan_skipped',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    reason: 'no_prior_session',
  },
  {
    event: 'recovery.scan_reentry',
    timestamp: now,
    severity: 'warn',
    outcome: 'success',
    prior_scan_start_ts: now,
  },
  {
    event: 'recovery.orphan_found',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    stage: 'classify',
    started_ts: now,
  },
  {
    event: 'recovery.resumed',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    stage: 'embed',
  },
  {
    event: 'recovery.aborted',
    timestamp: now,
    severity: 'warn',
    outcome: 'failed',
    doc_id: docId,
    stage: 'ingest',
    reason: 'ingest file missing',
  },
  {
    event: 'recovery.telemetry_parse_failed',
    timestamp: now,
    severity: 'warn',
    outcome: 'failed',
    line_offset: 12345,
    error: 'Unexpected token at position 5',
  },
  {
    event: 'recovery.aborted_scan',
    timestamp: now,
    severity: 'warn',
    outcome: 'failed',
    reason: 'abort_signal',
  },
];

// ---- 1 failures.sidecar_parse_failed event ----
const FAILURES_EVENTS: ReadonlyArray<unknown> = [
  {
    event: 'failures.sidecar_parse_failed',
    timestamp: now,
    severity: 'warn',
    outcome: 'failed',
    sidecar_path: '/var/lib/corpus/failed/doc-bad.error.json',
    error: 'Unexpected end of JSON input',
  },
];

// ---- 4 search.tier_* events ----
const TIER_EVENTS: ReadonlyArray<unknown> = [
  {
    event: 'search.tier_fallthrough',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    from_tier: 'hybrid',
    to_tier: 'bm25-only',
    reason: 'below_min_results',
    hits_before_fallthrough: 2,
  },
  {
    event: 'search.tier_skipped',
    timestamp: now,
    severity: 'warn',
    outcome: 'success',
    tier: 'catalog-grep',
    reason: 'catalog_missing',
  },
  {
    event: 'search.tier_failed',
    timestamp: now,
    severity: 'warn',
    outcome: 'failed',
    tier: 'fs-grep',
    errno: 'ENOENT',
    duration_ms: 5,
  },
  {
    event: 'search.tier_budget_exceeded',
    timestamp: now,
    severity: 'warn',
    outcome: 'success',
    budget_ms: 600,
    actual_ms: 612,
    tiers_attempted: ['hybrid', 'bm25-only', 'catalog-grep', 'fs-grep'],
    final_hit_count: 3,
  },
];

const ALL_SP006_EVENTS = [
  ...RECOVERY_EVENTS,
  ...FAILURES_EVENTS,
  ...TIER_EVENTS,
];

describe('PREREQ-002 — SP-006 telemetry event classes (14 total)', () => {
  it('exactly 14 SP-006 fixture events', () => {
    expect(ALL_SP006_EVENTS).toHaveLength(14);
  });

  it('every SP-006 event round-trips through TelemetryEvent', () => {
    for (const ev of ALL_SP006_EVENTS) {
      const r = TelemetryEvent.safeParse(ev);
      if (!r.success) {
        // Diagnostic: surface the offending event when this assertion fails.
        console.error('Failed event:', ev, r.error.issues);
      }
      expect(r.success).toBe(true);
    }
  });

  it('every SP-006 event serializes within Constitution IX 4096-byte budget', () => {
    for (const ev of ALL_SP006_EVENTS) {
      const json = JSON.stringify(ev);
      expect(json.length).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
    }
  });
});

describe('PREREQ-002 — SP-005 search events updated for SP-006 tier enum', () => {
  it('search.completed accepts updated tier_used enum: bm25-only', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.completed',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      result_count: 7,
      duration_ms: 12,
      tier_used: 'bm25-only',
      signals_used: ['bm25'],
    });
    expect(r.success).toBe(true);
  });

  it('search.completed accepts updated tier_used enum: catalog-grep', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.completed',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      result_count: 1,
      duration_ms: 50,
      tier_used: 'catalog-grep',
      signals_used: [],
    });
    expect(r.success).toBe(true);
  });

  it('search.completed accepts updated tier_used enum: fs-grep', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.completed',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      result_count: 0,
      duration_ms: 500,
      tier_used: 'fs-grep',
      signals_used: [],
    });
    expect(r.success).toBe(true);
  });

  it('search.completed accepts tier_used: hybrid (backward compat)', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.completed',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      result_count: 10,
      duration_ms: 80,
      tier_used: 'hybrid',
      signals_used: ['bm25', 'dense', 'graph', 'confidence'],
    });
    expect(r.success).toBe(true);
  });

  it('search.completed rejects unknown tier_used value', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.completed',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      result_count: 0,
      duration_ms: 1,
      tier_used: 'made-up-tier',
      signals_used: [],
    });
    expect(r.success).toBe(false);
  });

  it('search.query (SP-005 — also widened) accepts bm25-only tier_used', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.query',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      tier_used: 'bm25-only',
      result_count: 5,
      signals_used: ['bm25'],
      duration_ms: 4,
    });
    expect(r.success).toBe(true);
  });
});

describe('PREREQ-002 — SP-006 event field validation', () => {
  it('recovery.scan_skipped rejects unknown reason', () => {
    const r = TelemetryEvent.safeParse({
      event: 'recovery.scan_skipped',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      reason: 'just_because',
    });
    expect(r.success).toBe(false);
  });

  it('search.tier_fallthrough rejects invalid from_tier', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.tier_fallthrough',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      from_tier: 'fs-grep', // not a valid from_tier
      to_tier: 'bm25-only',
      reason: 'below_min_results',
      hits_before_fallthrough: 0,
    });
    expect(r.success).toBe(false);
  });

  it('recovery.orphan_found accepts doc_id: null (pre-persist orphan)', () => {
    const r = TelemetryEvent.safeParse({
      event: 'recovery.orphan_found',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      doc_id: null,
      stage: 'ingest',
      started_ts: now,
    });
    expect(r.success).toBe(true);
  });
});
