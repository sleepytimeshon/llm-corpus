// SP-008 T032 — RED unit test for `report-aggregator.ts`.
//
// Given a synthetic event stream, computes:
//   - queries_in_window (unique engagement.corpus_find_invoked by request_id)
//   - acceptance_events_in_window (unique engagement.acceptance_event by request_id)
//   - informational.median_latency_ms, p95_latency_ms (null when 0 queries)
//   - informational.tier_distribution
//   - informational.zero_result_queries
//   - informational.distinct_query_hashes
//
// References:
//   - specs/008-user-acceptance/tasks.md T032 / T039
//   - specs/008-user-acceptance/data-model.md Entity 5
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { aggregateReport } from '../../packages/cli/src/engagement/report-aggregator.js';
import type {
  EngagementCorpusFindInvokedEvent,
  EngagementAcceptanceEvent,
} from '@llm-corpus/contracts';

const findEvent = (
  id: string,
  ts: string,
  duration_ms: number,
  tier: EngagementCorpusFindInvokedEvent['tier_used'] = 'hybrid',
  result_count = 1,
  query_hash = 'a'.repeat(64),
): EngagementCorpusFindInvokedEvent => ({
  event: 'engagement.corpus_find_invoked',
  timestamp: ts,
  request_id: id,
  query: 'q',
  query_hash,
  result_count,
  tier_used: tier,
  duration_ms,
});

const acceptEvent = (id: string, ts: string): EngagementAcceptanceEvent => ({
  event: 'engagement.acceptance_event',
  timestamp: ts,
  request_id: id,
});

describe('SP-008 T032 — report-aggregator', () => {
  it('empty event stream: 0 queries / 0 acceptances; latency aggregates null', () => {
    const agg = aggregateReport([]);
    expect(agg.queries_in_window).toBe(0);
    expect(agg.acceptance_events_in_window).toBe(0);
    expect(agg.informational.median_latency_ms).toBeNull();
    expect(agg.informational.p95_latency_ms).toBeNull();
    expect(agg.informational.zero_result_queries).toBe(0);
    expect(agg.informational.distinct_query_hashes).toBe(0);
  });

  it('5 distinct find events + 1 acceptance event → 5 queries, 1 acceptance', () => {
    const events = [
      findEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T10:00:00Z', 10),
      findEvent('00000000-0000-4000-8000-000000000002', '2026-05-10T10:05:00Z', 20, 'bm25-only'),
      findEvent('00000000-0000-4000-8000-000000000003', '2026-05-10T10:10:00Z', 30, 'catalog-grep'),
      findEvent('00000000-0000-4000-8000-000000000004', '2026-05-10T10:15:00Z', 40, 'fs-grep', 0),
      findEvent('00000000-0000-4000-8000-000000000005', '2026-05-10T10:20:00Z', 50),
      acceptEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T10:25:00Z'),
    ];
    const agg = aggregateReport(events);
    expect(agg.queries_in_window).toBe(5);
    expect(agg.acceptance_events_in_window).toBe(1);
    expect(agg.informational.median_latency_ms).toBe(30);
    expect(agg.informational.p95_latency_ms).toBeGreaterThanOrEqual(40);
    expect(agg.informational.tier_distribution.hybrid).toBe(2);
    expect(agg.informational.tier_distribution['bm25-only']).toBe(1);
    expect(agg.informational.tier_distribution['catalog-grep']).toBe(1);
    expect(agg.informational.tier_distribution['fs-grep']).toBe(1);
    expect(agg.informational.zero_result_queries).toBe(1);
    expect(agg.informational.distinct_query_hashes).toBe(1);
  });

  it('duplicate find events by request_id deduplicate (defense-in-depth)', () => {
    const events = [
      findEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T10:00:00Z', 10),
      findEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T10:00:00Z', 10),
    ];
    const agg = aggregateReport(events);
    expect(agg.queries_in_window).toBe(1);
  });

  it('duplicate acceptance events by request_id deduplicate', () => {
    const events = [
      findEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T10:00:00Z', 10),
      acceptEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T11:00:00Z'),
      acceptEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T12:00:00Z'),
    ];
    const agg = aggregateReport(events);
    expect(agg.acceptance_events_in_window).toBe(1);
  });

  it('distinct query_hashes counted independently of request_id', () => {
    const events = [
      findEvent('00000000-0000-4000-8000-000000000001', '2026-05-10T10:00:00Z', 10, 'hybrid', 1, 'a'.repeat(64)),
      findEvent('00000000-0000-4000-8000-000000000002', '2026-05-10T10:05:00Z', 20, 'hybrid', 1, 'a'.repeat(64)),
      findEvent('00000000-0000-4000-8000-000000000003', '2026-05-10T10:10:00Z', 30, 'hybrid', 1, 'b'.repeat(64)),
    ];
    const agg = aggregateReport(events);
    expect(agg.informational.distinct_query_hashes).toBe(2);
  });
});
