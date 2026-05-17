// SP-008 T040 — pure verdict computer.
//
// Given aggregated counts:
//   - c028_threshold_met = queries_in_window >= 5 AND acceptance_events_in_window >= 1
//   - kill_signal       = queries_in_window < 3
//   - verdict           = c028_threshold_met ? 'PASS' : 'FAIL'
//
// References:
//   - specs/008-user-acceptance/tasks.md T040
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-005
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     (ADR-017)
//   - Constitution Principle V

import {
  ENGAGEMENT_C028_THRESHOLD,
  ENGAGEMENT_KILL_SIGNAL_THRESHOLD,
} from '@llm-corpus/contracts';

export interface VerdictInput {
  readonly queries_in_window: number;
  readonly acceptance_events_in_window: number;
}

export interface VerdictOutput {
  readonly verdict: 'PASS' | 'FAIL';
  readonly c028_threshold_met: boolean;
  readonly kill_signal: boolean;
}

export function computeVerdict(input: VerdictInput): VerdictOutput {
  const c028_threshold_met =
    input.queries_in_window >= ENGAGEMENT_C028_THRESHOLD.min_queries &&
    input.acceptance_events_in_window >=
      ENGAGEMENT_C028_THRESHOLD.min_acceptance_events;
  const kill_signal =
    input.queries_in_window < ENGAGEMENT_KILL_SIGNAL_THRESHOLD.min_queries;
  return {
    c028_threshold_met,
    kill_signal,
    verdict: c028_threshold_met ? 'PASS' : 'FAIL',
  };
}
