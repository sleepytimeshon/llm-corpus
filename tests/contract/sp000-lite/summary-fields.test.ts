// SP-000-Lite Phase 2 (T014, summary fields) — Pilot Summary schema contract.
//
// Asserts that mkPilotSummary(events, runMeta) produces the FR-PILOT-013
// fields: `summary_schema_version`, `headline_n`, `bucket_counts`,
// `bucket_invocations`, `bucket_rates`, `pattern_invocations`,
// `malformed_call_count_kg`, `malformed_call_rate_kg`, `soft_threshold_flag`.
//
// Soft-threshold semantics (FR-PILOT-013):
//   - malformed_call_count_kg > 10 → flag=true
//   - malformed_call_count_kg ≤ 10 → flag=false
//   - Binary exit decision remains parameterized on headline_n alone; the
//     flag never triggers auto-escalation.
//
// TDD: `mkPilotSummary` is not exported in Phase 1; assertions fail at
// runtime until Phase 3 (T023) lands.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T015 (co-located in telemetry-schema)
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-013
//   - specs/000-nfr-008-pilot-lite/data-model.md Entity 1 (Pilot Summary)
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature

import { describe, it, expect } from 'vitest';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_ISO = '2026-05-15T14:30:00.123Z';

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_class: 'nfr_008_pilot',
    severity: 'info',
    timestamp: VALID_ISO,
    run_id: VALID_UUID,
    iteration: 1,
    model: 'qwen3:8b',
    prompt_variant: 'v1',
    query_id: 'kg-001',
    query_bucket: 'knowledge_grounded',
    retrieval_pattern: 'factual_lookup',
    tool_invoked: true,
    tool_arguments_valid: true,
    malformed_call_payload: null,
    retrieval_outcome: 'corpus.find returned 3 results',
    duration_ms: 1234,
    ...overrides,
  };
}

async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe('SP-000-Lite (summary fields) — FR-PILOT-013', () => {
  it('mkPilotSummary is exported from @llm-corpus/pipeline (Phase 3 T023)', async () => {
    const mod = await loadHarness();
    expect(mod).toBeDefined();
    expect(mod?.mkPilotSummary).toBeDefined();
    expect(typeof mod?.mkPilotSummary).toBe('function');
  });

  it('summary carries summary_schema_version 1.0.0 and full bucket counts', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    expect(mk).toBeDefined();
    if (!mk) return;
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 30; i += 1) events.push(validEvent({ query_id: `kg-${i}` }));
    for (let i = 0; i < 15; i += 1)
      events.push(
        validEvent({
          query_id: `g-${i}`,
          query_bucket: 'general',
          retrieval_pattern: null,
          tool_invoked: false,
          tool_arguments_valid: false,
        }),
      );
    for (let i = 0; i < 5; i += 1)
      events.push(
        validEvent({
          query_id: `adv-${i}`,
          query_bucket: 'adversarial',
          retrieval_pattern: null,
          tool_invoked: false,
          tool_arguments_valid: false,
        }),
      );
    const summary = mk(events, { run_id: VALID_UUID, iteration: 1, variant: 'v1' });
    expect(summary.summary_schema_version).toBe('1.0.0');
    expect(summary.bucket_counts).toEqual({
      knowledge_grounded: 30,
      general: 15,
      adversarial: 5,
    });
  });

  it('headline_n equals bucket_invocations.knowledge_grounded', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    if (!mk) {
      expect(mk).toBeDefined();
      return;
    }
    const events: Array<Record<string, unknown>> = [];
    // 18 KG invocations, 12 KG non-invocations.
    for (let i = 0; i < 18; i += 1)
      events.push(validEvent({ query_id: `kg-${i}`, tool_invoked: true }));
    for (let i = 0; i < 12; i += 1)
      events.push(
        validEvent({
          query_id: `kg-x-${i}`,
          tool_invoked: false,
          tool_arguments_valid: false,
        }),
      );
    const summary = mk(events, { run_id: VALID_UUID, iteration: 1, variant: 'v1' });
    expect(summary.headline_n).toBe(
      (summary.bucket_invocations as Record<string, number>).knowledge_grounded,
    );
    expect(summary.headline_n).toBe(18);
  });

  it('malformed_call_rate_kg == malformed_call_count_kg / 30 (KG bucket size)', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    if (!mk) {
      expect(mk).toBeDefined();
      return;
    }
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 24; i += 1)
      events.push(validEvent({ query_id: `kg-${i}`, tool_invoked: true }));
    for (let i = 0; i < 6; i += 1)
      events.push(
        validEvent({
          severity: 'warn',
          query_id: `kg-bad-${i}`,
          tool_invoked: true,
          tool_arguments_valid: false,
          malformed_call_payload: 'bad',
        }),
      );
    const summary = mk(events, { run_id: VALID_UUID, iteration: 1, variant: 'v1' });
    expect(summary.malformed_call_count_kg).toBe(6);
    expect(summary.malformed_call_rate_kg).toBeCloseTo(6 / 30, 6);
  });

  it('soft_threshold_flag fires when malformed_call_count_kg > 10', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    if (!mk) {
      expect(mk).toBeDefined();
      return;
    }
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 12; i += 1)
      events.push(
        validEvent({
          severity: 'warn',
          query_id: `kg-bad-${i}`,
          tool_invoked: true,
          tool_arguments_valid: false,
          malformed_call_payload: 'bad',
        }),
      );
    const summary = mk(events, { run_id: VALID_UUID, iteration: 1, variant: 'v1' });
    expect(summary.malformed_call_count_kg).toBe(12);
    expect(summary.soft_threshold_flag).toBe(true);
  });

  it('soft_threshold_flag does NOT fire at exactly 10 malformed', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    if (!mk) {
      expect(mk).toBeDefined();
      return;
    }
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 10; i += 1)
      events.push(
        validEvent({
          severity: 'warn',
          query_id: `kg-bad-${i}`,
          tool_invoked: true,
          tool_arguments_valid: false,
          malformed_call_payload: 'bad',
        }),
      );
    const summary = mk(events, { run_id: VALID_UUID, iteration: 1, variant: 'v1' });
    expect(summary.malformed_call_count_kg).toBe(10);
    expect(summary.soft_threshold_flag).toBe(false);
  });

  it('pattern_invocations carries integer counts for all three retrieval patterns', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    if (!mk) {
      expect(mk).toBeDefined();
      return;
    }
    const summary = mk(
      [
        validEvent({ retrieval_pattern: 'factual_lookup', tool_invoked: true }),
        validEvent({ retrieval_pattern: 'recall_by_context', tool_invoked: true }),
        validEvent({ retrieval_pattern: 'multi_doc_synthesis', tool_invoked: true }),
      ],
      { run_id: VALID_UUID, iteration: 1, variant: 'v1' },
    );
    const pi = summary.pattern_invocations as Record<string, number>;
    expect(typeof pi.factual_lookup).toBe('number');
    expect(typeof pi.recall_by_context).toBe('number');
    expect(typeof pi.multi_doc_synthesis).toBe('number');
  });

  it('malformed_call_count_kg ≤ bucket_invocations.knowledge_grounded (invariant)', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    if (!mk) {
      expect(mk).toBeDefined();
      return;
    }
    const events: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i += 1)
      events.push(validEvent({ query_id: `kg-${i}`, tool_invoked: true }));
    for (let i = 0; i < 3; i += 1)
      events.push(
        validEvent({
          severity: 'warn',
          query_id: `kg-bad-${i}`,
          tool_invoked: true,
          tool_arguments_valid: false,
          malformed_call_payload: 'bad',
        }),
      );
    const summary = mk(events, { run_id: VALID_UUID, iteration: 1, variant: 'v1' });
    const inv = (summary.bucket_invocations as Record<string, number>).knowledge_grounded;
    expect(summary.malformed_call_count_kg as number).toBeLessThanOrEqual(inv);
  });
});
