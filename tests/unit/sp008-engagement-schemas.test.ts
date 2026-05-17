// SP-008 T002 — Zod round-trip tests for the seven new SP-008 schemas in
// packages/contracts/src/engagement.ts (Entities 1-7).
//
// Authored Phase 2 (RED) — turned GREEN by T006 (engagement.ts implementation
// also Phase 2). Verifies the schema shape contracts the entire SP-008
// engagement-proxy surface relies on.
//
// References:
//   - specs/008-user-acceptance/data-model.md Entities 1-7
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-004, FR-ENGAGEMENT-012,
//     FR-ENGAGEMENT-018, SC-008-002, SC-008-019, SC-008-030
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  EngagementCorpusFindInvokedEventZodSchema,
  EngagementAcceptanceEventZodSchema,
  EngagementReportGeneratedEventZodSchema,
  EngagementReportTelemetryParseFailedEventZodSchema,
  EngagementProxyReportZodSchema,
  AcceptArgsZodSchema,
  EngagementProxyReportArgsZodSchema,
  ENGAGEMENT_C028_THRESHOLD,
  ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
} from '../../packages/contracts/src/engagement.js';

const VALID_UUID = 'e53d5aab-5e61-4c8f-b950-fd7b095756ed';
const VALID_UUID_2 = '6ef2c3e0-9ec2-45e4-a21b-b2effaeb33d5';
const SHA256_OF_FOO = createHash('sha256').update('foo').digest('hex');

const ISO_NOW = '2026-05-17T10:00:00Z';
const ISO_LATER = '2026-05-17T11:00:00Z';

describe('SP-008 Entity 1 — EngagementCorpusFindInvokedEventZodSchema', () => {
  it('round-trips a well-formed event (untruncated query)', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 3,
      tier_used: 'hybrid',
      duration_ms: 42,
    });
    expect(r.success).toBe(true);
  });

  it('accepts query_truncated:true when length is exactly 1024', () => {
    const q = 'a'.repeat(1024);
    const hash = createHash('sha256').update(q + 'xx').digest('hex');
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: q,
      query_truncated: true,
      query_hash: hash,
      result_count: 1,
      tier_used: 'bm25-only',
      duration_ms: 10,
    });
    expect(r.success).toBe(true);
  });

  it('rejects query length > 1024 chars (truncation enforced at schema)', () => {
    const q = 'a'.repeat(1025);
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: q,
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 10,
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-UUID request_id', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: 'NOT-A-UUID',
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 10,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown tier_used', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'unknown-tier',
      duration_ms: 10,
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative result_count', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: -1,
      tier_used: 'hybrid',
      duration_ms: 10,
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative duration_ms', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: -1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed timestamp', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: 'not-an-iso8601',
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 10,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed query_hash (non-hex / wrong length)', () => {
    const r = EngagementCorpusFindInvokedEventZodSchema.safeParse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: 'short-hex',
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 10,
    });
    expect(r.success).toBe(false);
  });
});

describe('SP-008 Entity 2 — EngagementAcceptanceEventZodSchema', () => {
  it('round-trips a well-formed event without note', () => {
    const r = EngagementAcceptanceEventZodSchema.safeParse({
      event: 'engagement.acceptance_event',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
    });
    expect(r.success).toBe(true);
  });

  it('round-trips with note at exactly 512 chars', () => {
    const r = EngagementAcceptanceEventZodSchema.safeParse({
      event: 'engagement.acceptance_event',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      acceptance_note: 'x'.repeat(512),
    });
    expect(r.success).toBe(true);
  });

  it('rejects note > 512 chars', () => {
    const r = EngagementAcceptanceEventZodSchema.safeParse({
      event: 'engagement.acceptance_event',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      acceptance_note: 'x'.repeat(513),
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-UUID request_id', () => {
    const r = EngagementAcceptanceEventZodSchema.safeParse({
      event: 'engagement.acceptance_event',
      timestamp: ISO_NOW,
      request_id: 'NOT-A-UUID',
    });
    expect(r.success).toBe(false);
  });
});

describe('SP-008 Entity 3 — EngagementReportGeneratedEventZodSchema', () => {
  it('round-trips a PASS report-generated event', () => {
    const r = EngagementReportGeneratedEventZodSchema.safeParse({
      event: 'engagement.report_generated',
      timestamp: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      verdict: 'PASS',
      queries_in_window: 5,
      acceptance_events_in_window: 1,
      kill_signal: false,
    });
    expect(r.success).toBe(true);
  });

  it('round-trips a FAIL (KILL) report-generated event', () => {
    const r = EngagementReportGeneratedEventZodSchema.safeParse({
      event: 'engagement.report_generated',
      timestamp: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      verdict: 'FAIL',
      queries_in_window: 1,
      acceptance_events_in_window: 0,
      kill_signal: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown verdict', () => {
    const r = EngagementReportGeneratedEventZodSchema.safeParse({
      event: 'engagement.report_generated',
      timestamp: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      verdict: 'MAYBE',
      queries_in_window: 5,
      acceptance_events_in_window: 1,
      kill_signal: false,
    });
    expect(r.success).toBe(false);
  });
});

describe('SP-008 Entity 4 — EngagementReportTelemetryParseFailedEventZodSchema', () => {
  it('round-trips with optional line_number absent', () => {
    const r = EngagementReportTelemetryParseFailedEventZodSchema.safeParse({
      event: 'engagement.report_telemetry_parse_failed',
      timestamp: ISO_NOW,
      telemetry_log_path: '/path/to/telemetry.jsonl',
      error_message: 'unexpected token in JSON',
    });
    expect(r.success).toBe(true);
  });

  it('round-trips with optional line_number = 42', () => {
    const r = EngagementReportTelemetryParseFailedEventZodSchema.safeParse({
      event: 'engagement.report_telemetry_parse_failed',
      timestamp: ISO_NOW,
      telemetry_log_path: '/path/to/telemetry.jsonl',
      line_number: 42,
      error_message: 'unexpected token in JSON',
    });
    expect(r.success).toBe(true);
  });

  it('rejects line_number < 1', () => {
    const r = EngagementReportTelemetryParseFailedEventZodSchema.safeParse({
      event: 'engagement.report_telemetry_parse_failed',
      timestamp: ISO_NOW,
      telemetry_log_path: '/path/to/telemetry.jsonl',
      line_number: 0,
      error_message: 'm',
    });
    expect(r.success).toBe(false);
  });

  it('rejects error_message > 1024 chars', () => {
    const r = EngagementReportTelemetryParseFailedEventZodSchema.safeParse({
      event: 'engagement.report_telemetry_parse_failed',
      timestamp: ISO_NOW,
      telemetry_log_path: '/path/to/telemetry.jsonl',
      error_message: 'x'.repeat(1025),
    });
    expect(r.success).toBe(false);
  });
});

describe('SP-008 Entity 5 — EngagementProxyReportZodSchema', () => {
  function passReport() {
    return {
      schema_version: 1 as const,
      generated_at: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      queries_in_window: 5,
      acceptance_events_in_window: 1,
      c028_threshold_met: true,
      kill_signal: false,
      verdict: 'PASS' as const,
      parse_errors_count: 0,
      informational: {
        median_latency_ms: 42,
        p95_latency_ms: 100,
        tier_distribution: {
          hybrid: 4,
          'bm25-only': 1,
          'catalog-grep': 0,
          'fs-grep': 0,
        },
        zero_result_queries: 0,
        distinct_query_hashes: 5,
      },
      c028_threshold: ENGAGEMENT_C028_THRESHOLD,
      kill_signal_threshold: ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
    };
  }

  function killReport() {
    return {
      schema_version: 1 as const,
      generated_at: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      queries_in_window: 2,
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      kill_signal: true,
      verdict: 'FAIL' as const,
      parse_errors_count: 0,
      informational: {
        median_latency_ms: 30,
        p95_latency_ms: 35,
        tier_distribution: {
          hybrid: 2,
          'bm25-only': 0,
          'catalog-grep': 0,
          'fs-grep': 0,
        },
        zero_result_queries: 0,
        distinct_query_hashes: 2,
      },
      c028_threshold: ENGAGEMENT_C028_THRESHOLD,
      kill_signal_threshold: ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
    };
  }

  it('round-trips a PASS report', () => {
    const r = EngagementProxyReportZodSchema.safeParse(passReport());
    expect(r.success).toBe(true);
  });

  it('round-trips a FAIL (KILL) report', () => {
    const r = EngagementProxyReportZodSchema.safeParse(killReport());
    expect(r.success).toBe(true);
  });

  it('round-trips zero-queries case with null latency aggregates', () => {
    const r = EngagementProxyReportZodSchema.safeParse({
      schema_version: 1,
      generated_at: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      queries_in_window: 0,
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      kill_signal: true,
      verdict: 'FAIL',
      parse_errors_count: 0,
      informational: {
        median_latency_ms: null,
        p95_latency_ms: null,
        tier_distribution: {
          hybrid: 0,
          'bm25-only': 0,
          'catalog-grep': 0,
          'fs-grep': 0,
        },
        zero_result_queries: 0,
        distinct_query_hashes: 0,
      },
      c028_threshold: ENGAGEMENT_C028_THRESHOLD,
      kill_signal_threshold: ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
    });
    expect(r.success).toBe(true);
  });

  it('rejects schema_version !== 1', () => {
    const bad = { ...passReport(), schema_version: 2 as unknown as 1 };
    const r = EngagementProxyReportZodSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects since > until refine', () => {
    const bad = {
      ...passReport(),
      window: { since: ISO_LATER, until: ISO_NOW },
    };
    const r = EngagementProxyReportZodSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects verdict='PASS' when c028 thresholds NOT met (refine)", () => {
    const bad = { ...passReport(), acceptance_events_in_window: 0 };
    const r = EngagementProxyReportZodSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects kill_signal=true when queries_in_window >= 3 (refine)', () => {
    const bad = { ...passReport(), kill_signal: true };
    const r = EngagementProxyReportZodSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects zero_result_queries > queries_in_window (refine)', () => {
    const bad = passReport();
    bad.informational.zero_result_queries = 99;
    const r = EngagementProxyReportZodSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects c028_threshold literal mismatch', () => {
    const bad = {
      ...passReport(),
      c028_threshold: { min_queries: 9, min_acceptance_events: 1 },
    };
    const r = EngagementProxyReportZodSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects non-null latency aggregates when queries_in_window === 0 (refine)', () => {
    const r = EngagementProxyReportZodSchema.safeParse({
      schema_version: 1,
      generated_at: ISO_LATER,
      window: { since: ISO_NOW, until: ISO_LATER },
      queries_in_window: 0,
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      kill_signal: true,
      verdict: 'FAIL',
      parse_errors_count: 0,
      informational: {
        median_latency_ms: 42,
        p95_latency_ms: 50,
        tier_distribution: {
          hybrid: 0,
          'bm25-only': 0,
          'catalog-grep': 0,
          'fs-grep': 0,
        },
        zero_result_queries: 0,
        distinct_query_hashes: 0,
      },
      c028_threshold: ENGAGEMENT_C028_THRESHOLD,
      kill_signal_threshold: ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
    });
    expect(r.success).toBe(false);
  });
});

describe('SP-008 Entity 6 — AcceptArgsZodSchema', () => {
  it('round-trips request_id only', () => {
    const r = AcceptArgsZodSchema.safeParse({ request_id: VALID_UUID });
    expect(r.success).toBe(true);
  });

  it('round-trips request_id + note (trimmed)', () => {
    const r = AcceptArgsZodSchema.safeParse({
      request_id: VALID_UUID,
      note: 'useful',
    });
    expect(r.success).toBe(true);
  });

  it('accepts note at exactly 512 chars', () => {
    const r = AcceptArgsZodSchema.safeParse({
      request_id: VALID_UUID,
      note: 'x'.repeat(512),
    });
    expect(r.success).toBe(true);
  });

  it('rejects note > 512 chars', () => {
    const r = AcceptArgsZodSchema.safeParse({
      request_id: VALID_UUID,
      note: 'x'.repeat(513),
    });
    expect(r.success).toBe(false);
  });

  it('rejects note with leading whitespace (refine: must be trimmed)', () => {
    const r = AcceptArgsZodSchema.safeParse({
      request_id: VALID_UUID,
      note: ' useful',
    });
    expect(r.success).toBe(false);
  });

  it('rejects note with trailing whitespace', () => {
    const r = AcceptArgsZodSchema.safeParse({
      request_id: VALID_UUID,
      note: 'useful ',
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-UUID request_id', () => {
    const r = AcceptArgsZodSchema.safeParse({ request_id: 'NOT-A-UUID' });
    expect(r.success).toBe(false);
  });

  it('rejects missing request_id', () => {
    const r = AcceptArgsZodSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('SP-008 Entity 7 — EngagementProxyReportArgsZodSchema', () => {
  it('round-trips well-formed args', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: ISO_NOW,
      until: ISO_LATER,
      format: 'json',
      telemetry_log: '/path/to/telemetry.jsonl',
      timeout_ms: 30000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects since > until', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: ISO_LATER,
      until: ISO_NOW,
      format: 'text',
      telemetry_log: '/path/to/telemetry.jsonl',
      timeout_ms: 30000,
    });
    expect(r.success).toBe(false);
  });

  it('rejects timeout_ms < 1', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: ISO_NOW,
      until: ISO_LATER,
      format: 'text',
      telemetry_log: '/path/to/telemetry.jsonl',
      timeout_ms: 0,
    });
    expect(r.success).toBe(false);
  });

  it('rejects timeout_ms > 600000', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: ISO_NOW,
      until: ISO_LATER,
      format: 'text',
      telemetry_log: '/path/to/telemetry.jsonl',
      timeout_ms: 600001,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown format', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: ISO_NOW,
      until: ISO_LATER,
      format: 'yaml',
      telemetry_log: '/path/to/telemetry.jsonl',
      timeout_ms: 30000,
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty telemetry_log path', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: ISO_NOW,
      until: ISO_LATER,
      format: 'text',
      telemetry_log: '',
      timeout_ms: 30000,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed ISO-8601 since', () => {
    const r = EngagementProxyReportArgsZodSchema.safeParse({
      since: 'yesterday',
      until: ISO_LATER,
      format: 'text',
      telemetry_log: '/path/to/telemetry.jsonl',
      timeout_ms: 30000,
    });
    expect(r.success).toBe(false);
  });
});

describe('SP-008 threshold literal constants', () => {
  it('ENGAGEMENT_C028_THRESHOLD matches FR-ENGAGEMENT-005', () => {
    expect(ENGAGEMENT_C028_THRESHOLD).toEqual({
      min_queries: 5,
      min_acceptance_events: 1,
    });
  });

  it('ENGAGEMENT_KILL_SIGNAL_THRESHOLD matches FR-ENGAGEMENT-005', () => {
    expect(ENGAGEMENT_KILL_SIGNAL_THRESHOLD).toEqual({ min_queries: 3 });
  });
});
