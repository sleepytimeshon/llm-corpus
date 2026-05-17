// SP-008 T054 — Constitution XVI Track A/B banner assertion.
//
// Per FR-ENGAGEMENT-022 + FR-ENGAGEMENT-023 + SC-008-034: the text
// rendering of `corpus engagement-proxy report --format=text` MUST
// include an explicit banner naming "Maya Week-1 engagement-proxy per
// C-028" AND labeling the verdict as a Track B measurement so the
// operator never conflates the code-track sprint close with the actual
// user-acceptance verdict.
//
// References:
//   - specs/008-user-acceptance/tasks.md T054
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-022,
//     FR-ENGAGEMENT-023, SC-008-034
//   - Constitution Principle XVI (Honest Sprint-Close)

import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { renderReportText } from '../../packages/cli/src/engagement/report-renderer-text.js';
import type { EngagementProxyReport } from '@llm-corpus/contracts';

function collectStdout(): {
  stream: Writable & { collected: string };
} {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as Writable & { collected: string };
  Object.defineProperty(stream, 'collected', {
    get(): string {
      return Buffer.concat(chunks).toString('utf8');
    },
  });
  return { stream };
}

const SAMPLE_REPORT: EngagementProxyReport = {
  schema_version: 1,
  window: {
    since: '2026-05-10T00:00:00.000Z',
    until: '2026-05-17T00:00:00.000Z',
  },
  queries_in_window: 5,
  acceptance_events_in_window: 1,
  verdict: 'PASS',
  c028_threshold_met: true,
  kill_signal: false,
  parse_errors_count: 0,
  informational: {
    median_latency_ms: 120,
    p95_latency_ms: 350,
    zero_result_queries: 0,
    distinct_query_hashes: 5,
    tier_distribution: {
      hybrid: 5,
      'bm25-only': 0,
      'catalog-grep': 0,
      'fs-grep': 0,
    },
  },
};

describe('SP-008 T054 — text-format report includes Track A/B banner per Constitution XVI', () => {
  it('names "Maya Week-1" and "C-028" and labels Track B verdict', () => {
    const { stream } = collectStdout();
    // The renderer writes synchronously via the WritableStream contract.
    // We adapt the WritableStream-typed parameter to the node Writable.
    renderReportText(SAMPLE_REPORT, stream as unknown as WritableStream);
    const out = stream.collected;
    expect(out).toContain('Maya Week-1');
    expect(out).toContain('C-028');
    expect(out).toContain('Track B');
  });

  it('PASS verdict body cites "C-028 gate cleared"', () => {
    const { stream } = collectStdout();
    renderReportText(SAMPLE_REPORT, stream as unknown as WritableStream);
    expect(stream.collected).toContain('PASS — C-028 gate cleared.');
  });

  it('KILL verdict cites "Stage 4 recycle per C-028"', () => {
    const killReport: EngagementProxyReport = {
      ...SAMPLE_REPORT,
      queries_in_window: 2,
      acceptance_events_in_window: 0,
      verdict: 'FAIL',
      c028_threshold_met: false,
      kill_signal: true,
    };
    const { stream } = collectStdout();
    renderReportText(killReport, stream as unknown as WritableStream);
    expect(stream.collected).toContain('Stage 4 recycle per C-028');
  });
});
