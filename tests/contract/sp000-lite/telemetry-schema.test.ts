// SP-000-Lite Phase 2 (T010) — contract test for the pilot telemetry-event
// schema.
//
// TDD: every assertion in this file that references `mkPilotEvent` MUST FAIL
// before Phase 3 (T022) lands. The Zod-schema assertions exercise the
// already-merged `NfrPilotEvent` (PREREQ-002) and pass today.
//
// Pilot Summary contract lives in summary-fields.test.ts.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T010
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-005
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature
//   - Constitution Principle IX (POSIX-atomic ≤ 4 KB) + Principle XIII

import { describe, it, expect } from 'vitest';
import { NfrPilotEvent, TELEMETRY_MAX_BYTES } from '@llm-corpus/contracts/telemetry';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_ISO = '2026-05-15T14:30:00.123Z';

/** Returns a fully-populated, valid nfr_008_pilot payload. */
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
    retrieval_outcome: 'corpus.find returned 3 results; top doc-c8cf6ea2',
    duration_ms: 1234,
    ...overrides,
  };
}

/**
 * Dynamic loader for the harness library. Returns `undefined` when the
 * exports don't yet exist (Phase 1/2 state), allowing tests to assert
 * `defined`-ness without breaking TypeScript compilation.
 */
async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe('SP-000-Lite T010 — nfr_008_pilot telemetry event (FR-PILOT-005)', () => {
  it('event serializes to JSON', () => {
    const e = validEvent();
    expect(() => JSON.stringify(e)).not.toThrow();
  });

  it('each event line stays ≤ TELEMETRY_MAX_BYTES (Constitution IX)', () => {
    const big = validEvent({
      malformed_call_payload: 'x'.repeat(2048),
      retrieval_outcome: 'y'.repeat(1024),
    });
    const line = JSON.stringify(big) + '\n';
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
  });

  it('Zod schema accepts a successful turn (severity=info, null payload)', () => {
    const r = NfrPilotEvent.safeParse(validEvent());
    expect(r.success).toBe(true);
  });

  it('Zod schema accepts a malformed-call turn (severity=warn, non-null payload)', () => {
    const r = NfrPilotEvent.safeParse(
      validEvent({
        severity: 'warn',
        tool_arguments_valid: false,
        malformed_call_payload: '{"args": "broken"',
      }),
    );
    expect(r.success).toBe(true);
  });

  it('Zod schema accepts a non-invocation turn (severity=info, tool_invoked=false)', () => {
    const r = NfrPilotEvent.safeParse(
      validEvent({
        tool_invoked: false,
        tool_arguments_valid: false,
        retrieval_pattern: null,
        query_bucket: 'general',
        query_id: 'g-001',
      }),
    );
    expect(r.success).toBe(true);
  });

  it('Zod schema rejects missing required field (tool_invoked)', () => {
    const e = validEvent();
    delete e.tool_invoked;
    const r = NfrPilotEvent.safeParse(e);
    expect(r.success).toBe(false);
  });

  it('Zod schema rejects wrong type on tool_invoked', () => {
    const r = NfrPilotEvent.safeParse(validEvent({ tool_invoked: 'true' }));
    expect(r.success).toBe(false);
  });

  it('Zod schema rejects oversized malformed_call_payload (> 2048 chars)', () => {
    const r = NfrPilotEvent.safeParse(
      validEvent({
        tool_arguments_valid: false,
        malformed_call_payload: 'z'.repeat(2049),
      }),
    );
    expect(r.success).toBe(false);
  });

  it('mkPilotEvent typed constructor is exported from @llm-corpus/pipeline (Phase 3 T022)', async () => {
    const mod = await loadHarness();
    expect(mod).toBeDefined();
    // Will be undefined until Phase 3 (T022) lands.
    expect(mod?.mkPilotEvent).toBeDefined();
    expect(typeof mod?.mkPilotEvent).toBe('function');
  });

  it('mkPilotEvent validates at construct time (throws on schema violation)', async () => {
    const mod = await loadHarness();
    const fn = mod?.mkPilotEvent as ((e: unknown) => unknown) | undefined;
    expect(fn).toBeDefined();
    if (fn) {
      expect(() => fn({ event_class: 'nfr_008_pilot' })).toThrow();
    }
  });
});

