// SP-008 T034 — RED unit test that --format=json output Zod-validates
// against EngagementProxyReportZodSchema for all verdict cases.
//
// References:
//   - specs/008-user-acceptance/tasks.md T034 / T041
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-012, SC-008-019
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import {
  EngagementProxyReportZodSchema,
  ENGAGEMENT_C028_THRESHOLD,
  ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
} from '@llm-corpus/contracts';

const baseInformational = {
  median_latency_ms: 30,
  p95_latency_ms: 50,
  tier_distribution: {
    hybrid: 5,
    'bm25-only': 0,
    'catalog-grep': 0,
    'fs-grep': 0,
  },
  zero_result_queries: 0,
  distinct_query_hashes: 5,
};

const baseWindow = {
  since: '2026-05-03T00:00:00Z',
  until: '2026-05-10T00:00:00Z',
};

function buildReport(overrides: Record<string, unknown>): unknown {
  return {
    schema_version: 1,
    generated_at: '2026-05-10T12:00:00Z',
    window: baseWindow,
    queries_in_window: 5,
    acceptance_events_in_window: 1,
    c028_threshold_met: true,
    kill_signal: false,
    verdict: 'PASS',
    parse_errors_count: 0,
    informational: baseInformational,
    c028_threshold: ENGAGEMENT_C028_THRESHOLD,
    kill_signal_threshold: ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
    ...overrides,
  };
}

describe('SP-008 T034 — EngagementProxyReport JSON shape', () => {
  it('PASS case round-trips through Zod', () => {
    const report = buildReport({});
    const parsed = EngagementProxyReportZodSchema.parse(report);
    expect(parsed.verdict).toBe('PASS');
    expect(parsed.schema_version).toBe(1);
  });

  it('FAIL non-KILL (5q + 0a) round-trips', () => {
    const report = buildReport({
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      verdict: 'FAIL',
      informational: {
        ...baseInformational,
        distinct_query_hashes: 5,
      },
    });
    const parsed = EngagementProxyReportZodSchema.parse(report);
    expect(parsed.verdict).toBe('FAIL');
    expect(parsed.kill_signal).toBe(false);
  });

  it('FAIL KILL (2q + 0a) round-trips with null latency aggregates rejected — must be non-null since queries>0', () => {
    const report = buildReport({
      queries_in_window: 2,
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      kill_signal: true,
      verdict: 'FAIL',
      informational: {
        ...baseInformational,
        tier_distribution: { hybrid: 2, 'bm25-only': 0, 'catalog-grep': 0, 'fs-grep': 0 },
        distinct_query_hashes: 2,
      },
    });
    const parsed = EngagementProxyReportZodSchema.parse(report);
    expect(parsed.kill_signal).toBe(true);
  });

  it('Empty-log case (0q): latency aggregates MUST be null', () => {
    const report = buildReport({
      queries_in_window: 0,
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      kill_signal: true,
      verdict: 'FAIL',
      informational: {
        median_latency_ms: null,
        p95_latency_ms: null,
        tier_distribution: { hybrid: 0, 'bm25-only': 0, 'catalog-grep': 0, 'fs-grep': 0 },
        zero_result_queries: 0,
        distinct_query_hashes: 0,
      },
    });
    const parsed = EngagementProxyReportZodSchema.parse(report);
    expect(parsed.informational.median_latency_ms).toBeNull();
    expect(parsed.informational.p95_latency_ms).toBeNull();
  });

  it('rejects schema with mismatched verdict refine (PASS verdict but counts say FAIL)', () => {
    const bad = buildReport({
      acceptance_events_in_window: 0,
      c028_threshold_met: false,
      verdict: 'PASS', // wrong — should be FAIL
    });
    expect(() => EngagementProxyReportZodSchema.parse(bad)).toThrow();
  });

  it('rejects schema with mismatched kill_signal refine', () => {
    const bad = buildReport({
      queries_in_window: 5,
      kill_signal: true, // wrong — queries >= 3
    });
    expect(() => EngagementProxyReportZodSchema.parse(bad)).toThrow();
  });

  it('rejects null latency aggregates when queries > 0', () => {
    const bad = buildReport({
      informational: {
        ...baseInformational,
        median_latency_ms: null,
        p95_latency_ms: null,
      },
    });
    expect(() => EngagementProxyReportZodSchema.parse(bad)).toThrow();
  });
});
