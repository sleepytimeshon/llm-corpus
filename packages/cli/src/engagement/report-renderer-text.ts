// SP-008 T042 — text renderer for `corpus engagement-proxy report --format=text`.
//
// Includes the Constitution XVI Track A/B banner per SC-008-034 +
// FR-ENGAGEMENT-022:
//
//   ════════════════════════════════════════════════════════════════════════
//   Maya Week-1 Engagement-Proxy Report (per C-028)
//   Track B measurement — operator-dogfood verdict
//   Window: <since> .. <until>  (default: last 7 days)
//   ════════════════════════════════════════════════════════════════════════
//
// Followed by the verdict, the counts, the KILL signal status, the
// informational aggregates, and the parse-error count. On
// `kill_signal: true` the renderer adds the SPRINT-PLAN.yaml-recorded
// rollback recommendation ("Stage 4 recycle per C-028").
//
// References:
//   - specs/008-user-acceptance/tasks.md T042
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-022, SC-008-016,
//     SC-008-034
//   - Constitution Principle XVI

import type { EngagementProxyReport } from '@llm-corpus/contracts';
import type { WritableStream } from './report-renderer-json.js';

const BANNER_LINE =
  '═══════════════════════════════════════════════════════════════════════════';

export function renderReportText(
  payload: EngagementProxyReport,
  stdout: WritableStream,
): void {
  const lines: string[] = [];
  lines.push(BANNER_LINE);
  lines.push('Maya Week-1 Engagement-Proxy Report (per C-028)');
  lines.push('Track B measurement — operator-dogfood verdict');
  lines.push(
    `Window: ${payload.window.since} .. ${payload.window.until}  (default: last 7 days)`,
  );
  lines.push(BANNER_LINE);
  lines.push('');
  lines.push(`Verdict: ${payload.verdict}`);
  lines.push(`Queries in window:           ${payload.queries_in_window}`);
  lines.push(`Acceptance events in window: ${payload.acceptance_events_in_window}`);
  lines.push(`C-028 threshold met:         ${payload.c028_threshold_met}`);
  lines.push(`KILL signal:                 ${payload.kill_signal}`);
  lines.push(`Parse errors during scan:    ${payload.parse_errors_count}`);
  lines.push('');
  lines.push('Informational aggregates:');
  lines.push(
    `  median_latency_ms:    ${payload.informational.median_latency_ms}`,
  );
  lines.push(
    `  p95_latency_ms:       ${payload.informational.p95_latency_ms}`,
  );
  lines.push(`  zero_result_queries:  ${payload.informational.zero_result_queries}`);
  lines.push(
    `  distinct_query_hashes: ${payload.informational.distinct_query_hashes}`,
  );
  lines.push('  tier_distribution:');
  for (const [tier, count] of Object.entries(payload.informational.tier_distribution)) {
    lines.push(`    ${tier.padEnd(14)} ${count}`);
  }
  lines.push('');
  if (payload.kill_signal) {
    lines.push(
      'KILL signal detected — engagement floor below 3 queries. Recommendation: Stage 4 recycle per C-028.',
    );
  } else if (payload.verdict === 'FAIL') {
    lines.push(
      'FAIL (non-KILL) — engagement floor cleared but C-028 gate not met. Recommendation: continue dogfood + retry report.',
    );
  } else {
    lines.push('PASS — C-028 gate cleared.');
  }
  lines.push('');
  stdout.write(lines.join('\n'));
}
