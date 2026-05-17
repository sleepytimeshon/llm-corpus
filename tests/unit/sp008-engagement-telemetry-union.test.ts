// SP-008 T003 — Asserts the four new SP-008 `engagement.*` event variants
// participate in the `TelemetryEvent` discriminated union exported from
// packages/contracts/src/telemetry.ts, AND that pre-existing SP-001..SP-007
// variants still validate unchanged, AND that the additive `request_id?`
// field on `SearchQueryEvent` (Decision A) is backward-compatible.
//
// References:
//   - specs/008-user-acceptance/plan.md PREREQ-002, Decision A
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-004, SC-008-003,
//     SC-008-005
//   - Constitution Principles V, IX, XIII

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  TelemetryEvent,
  SearchQueryEvent,
  EgressAttemptedEvent,
  TELEMETRY_MAX_BYTES,
} from '../../packages/contracts/src/telemetry.js';

const VALID_UUID = 'e53d5aab-5e61-4c8f-b950-fd7b095756ed';
const SHA256_OF_FOO = createHash('sha256').update('foo').digest('hex');
const ISO_NOW = '2026-05-17T10:00:00Z';

describe('SP-008 PREREQ-002 — TelemetryEvent union includes engagement.* variants', () => {
  it('parses engagement.corpus_find_invoked via the union', () => {
    const r = TelemetryEvent.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 42,
    });
    expect(r.success).toBe(true);
  });

  it('parses engagement.acceptance_event via the union', () => {
    const r = TelemetryEvent.safeParse({
      event: 'engagement.acceptance_event',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
    });
    expect(r.success).toBe(true);
  });

  it('parses engagement.report_generated via the union', () => {
    const r = TelemetryEvent.safeParse({
      event: 'engagement.report_generated',
      timestamp: ISO_NOW,
      window: { since: ISO_NOW, until: ISO_NOW },
      verdict: 'PASS',
      queries_in_window: 5,
      acceptance_events_in_window: 1,
      kill_signal: false,
    });
    expect(r.success).toBe(true);
  });

  it('parses engagement.report_telemetry_parse_failed via the union', () => {
    const r = TelemetryEvent.safeParse({
      event: 'engagement.report_telemetry_parse_failed',
      timestamp: ISO_NOW,
      telemetry_log_path: '/path/to/telemetry.jsonl',
      error_message: 'malformed JSON',
    });
    expect(r.success).toBe(true);
  });
});

describe('SP-008 PREREQ-002 — backward compatibility', () => {
  it('parses an SP-005-era search.query WITHOUT request_id (Decision A backward-compat)', () => {
    const r = SearchQueryEvent.safeParse({
      event: 'search.query',
      timestamp: ISO_NOW,
      severity: 'info',
      outcome: 'success',
      query_hash: SHA256_OF_FOO,
      tier_used: 'hybrid',
      result_count: 3,
      signals_used: ['bm25', 'dense'],
      duration_ms: 42,
    });
    expect(r.success).toBe(true);
  });

  it('parses an SP-008-era search.query WITH request_id (Decision A forward-compat)', () => {
    const r = SearchQueryEvent.safeParse({
      event: 'search.query',
      timestamp: ISO_NOW,
      severity: 'info',
      outcome: 'success',
      query_hash: SHA256_OF_FOO,
      tier_used: 'hybrid',
      result_count: 3,
      signals_used: ['bm25', 'dense'],
      duration_ms: 42,
      request_id: VALID_UUID,
    });
    expect(r.success).toBe(true);
  });

  it('parses an SP-001-era egress.attempted unchanged', () => {
    const r = EgressAttemptedEvent.safeParse({
      event: 'egress.attempted',
      timestamp: ISO_NOW,
      primitive: 'net.Socket.connect',
      destination_host: '1.2.3.4',
      destination_port: 443,
      request_id: VALID_UUID,
    });
    expect(r.success).toBe(true);
  });
});

describe('SP-008 PREREQ-002 — Constitution IX size budget (≤ 4 KB per event)', () => {
  it('engagement.corpus_find_invoked with max-len query stays ≤ TELEMETRY_MAX_BYTES', () => {
    const q = 'a'.repeat(1024);
    const payload = {
      event: 'engagement.corpus_find_invoked' as const,
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: q,
      query_truncated: true,
      query_hash: SHA256_OF_FOO,
      result_count: 9999,
      tier_used: 'hybrid' as const,
      duration_ms: 999999,
    };
    const r = TelemetryEvent.safeParse(payload);
    expect(r.success).toBe(true);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
      TELEMETRY_MAX_BYTES,
    );
  });

  it('engagement.acceptance_event with max-len note stays ≤ TELEMETRY_MAX_BYTES', () => {
    const payload = {
      event: 'engagement.acceptance_event' as const,
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      acceptance_note: 'n'.repeat(512),
    };
    const r = TelemetryEvent.safeParse(payload);
    expect(r.success).toBe(true);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
      TELEMETRY_MAX_BYTES,
    );
  });

  it('engagement.report_telemetry_parse_failed with max-len error stays ≤ TELEMETRY_MAX_BYTES', () => {
    const payload = {
      event: 'engagement.report_telemetry_parse_failed' as const,
      timestamp: ISO_NOW,
      telemetry_log_path: '/var/lib/llm-corpus/state/telemetry.jsonl',
      line_number: 999999,
      error_message: 'x'.repeat(1024),
    };
    const r = TelemetryEvent.safeParse(payload);
    expect(r.success).toBe(true);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
      TELEMETRY_MAX_BYTES,
    );
  });
});
