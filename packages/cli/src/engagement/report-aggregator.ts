// SP-008 T039 — pure report aggregator.
//
// Given the filtered event stream from telemetry-log-scanner (T038),
// computes per data-model.md Entity 5:
//   - queries_in_window: unique engagement.corpus_find_invoked by request_id
//   - acceptance_events_in_window: unique engagement.acceptance_event by request_id
//   - informational.median_latency_ms / p95_latency_ms (null if 0 queries)
//   - informational.tier_distribution
//   - informational.zero_result_queries
//   - informational.distinct_query_hashes
//
// Pure function (deterministic input → deterministic output). ZERO IO.
//
// References:
//   - specs/008-user-acceptance/tasks.md T039
//   - specs/008-user-acceptance/data-model.md Entity 5
//   - Constitution Principle V

import type {
  EngagementCorpusFindInvokedEvent,
  EngagementAcceptanceEvent,
  EngagementTierDistribution,
} from '@llm-corpus/contracts';

export type EventLike =
  | EngagementCorpusFindInvokedEvent
  | EngagementAcceptanceEvent;

export interface AggregatedReport {
  queries_in_window: number;
  acceptance_events_in_window: number;
  informational: {
    median_latency_ms: number | null;
    p95_latency_ms: number | null;
    tier_distribution: EngagementTierDistribution;
    zero_result_queries: number;
    distinct_query_hashes: number;
  };
}

function percentile(sortedAsc: readonly number[], p: number): number {
  // Linear-interpolation percentile (vitest-friendly definition).
  if (sortedAsc.length === 0) {
    // Caller guards; defensive.
    return 0;
  }
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function aggregateReport(events: readonly EventLike[]): AggregatedReport {
  // Dedup by request_id per ADR-017.
  const findByRequestId = new Map<string, EngagementCorpusFindInvokedEvent>();
  const acceptByRequestId = new Map<string, EngagementAcceptanceEvent>();
  for (const e of events) {
    if (e.event === 'engagement.corpus_find_invoked') {
      if (!findByRequestId.has(e.request_id)) {
        findByRequestId.set(e.request_id, e);
      }
    } else if (e.event === 'engagement.acceptance_event') {
      if (!acceptByRequestId.has(e.request_id)) {
        acceptByRequestId.set(e.request_id, e);
      }
    }
  }

  const finds = Array.from(findByRequestId.values());
  const queries_in_window = finds.length;
  const acceptance_events_in_window = acceptByRequestId.size;

  // Latency aggregates — null when queries_in_window === 0.
  let median_latency_ms: number | null = null;
  let p95_latency_ms: number | null = null;
  if (queries_in_window > 0) {
    const sorted = finds.map((f) => f.duration_ms).sort((a, b) => a - b);
    median_latency_ms = percentile(sorted, 50);
    p95_latency_ms = percentile(sorted, 95);
  }

  // Tier distribution — closed enum.
  const tier_distribution: EngagementTierDistribution = {
    hybrid: 0,
    'bm25-only': 0,
    'catalog-grep': 0,
    'fs-grep': 0,
  };
  for (const f of finds) {
    tier_distribution[f.tier_used] += 1;
  }

  // Zero-result count.
  const zero_result_queries = finds.filter((f) => f.result_count === 0).length;

  // Distinct query_hashes.
  const distinctHashes = new Set<string>();
  for (const f of finds) {
    distinctHashes.add(f.query_hash);
  }
  const distinct_query_hashes = distinctHashes.size;

  return {
    queries_in_window,
    acceptance_events_in_window,
    informational: {
      median_latency_ms,
      p95_latency_ms,
      tier_distribution,
      zero_result_queries,
      distinct_query_hashes,
    },
  };
}
