// SP-008 T033 — RED unit test for `verdict-computer.ts`.
//
// Truth table cases per FR-ENGAGEMENT-005:
//   (i) PASS:        5q + 1a → verdict=PASS, c028=true, kill=false
//  (ii) FAIL non-K:  5q + 0a → verdict=FAIL, c028=false, kill=false
// (iii) FAIL KILL:   2q + 0a → verdict=FAIL, c028=false, kill=true
//  (iv) FAIL non-K:  3q + 0a → verdict=FAIL, c028=false, kill=false
//   (v) FAIL KILL empty: 0q + 0a → verdict=FAIL, kill=true
//
// References:
//   - specs/008-user-acceptance/tasks.md T033 / T040
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-003, FR-ENGAGEMENT-005,
//     SC-008-015..017
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../../packages/cli/src/engagement/verdict-computer.js';

describe('SP-008 T033 — verdict-computer truth table', () => {
  it('PASS: 5 queries + 1 acceptance', () => {
    const v = computeVerdict({ queries_in_window: 5, acceptance_events_in_window: 1 });
    expect(v.verdict).toBe('PASS');
    expect(v.c028_threshold_met).toBe(true);
    expect(v.kill_signal).toBe(false);
  });

  it('FAIL non-KILL: 5 queries + 0 acceptance', () => {
    const v = computeVerdict({ queries_in_window: 5, acceptance_events_in_window: 0 });
    expect(v.verdict).toBe('FAIL');
    expect(v.c028_threshold_met).toBe(false);
    expect(v.kill_signal).toBe(false);
  });

  it('FAIL KILL: 2 queries + 0 acceptance', () => {
    const v = computeVerdict({ queries_in_window: 2, acceptance_events_in_window: 0 });
    expect(v.verdict).toBe('FAIL');
    expect(v.kill_signal).toBe(true);
  });

  it('FAIL non-KILL: 3 queries + 0 acceptance (≥3 floor cleared but <5 gate)', () => {
    const v = computeVerdict({ queries_in_window: 3, acceptance_events_in_window: 0 });
    expect(v.verdict).toBe('FAIL');
    expect(v.kill_signal).toBe(false);
  });

  it('FAIL KILL: 0 queries + 0 acceptance (empty log)', () => {
    const v = computeVerdict({ queries_in_window: 0, acceptance_events_in_window: 0 });
    expect(v.verdict).toBe('FAIL');
    expect(v.kill_signal).toBe(true);
  });

  it('FAIL KILL even with acceptance present if queries < 3', () => {
    const v = computeVerdict({ queries_in_window: 2, acceptance_events_in_window: 1 });
    expect(v.verdict).toBe('FAIL');
    expect(v.kill_signal).toBe(true);
  });
});
