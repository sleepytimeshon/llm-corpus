// T002 — Contract test for PREREQ-002 (nfr_008_pilot Zod schema).
//
// Verifies that the nfr_008_pilot event class is registered in
// packages/contracts/src/telemetry.ts with all 15 FR-PILOT-005 fields at
// their spec'd types, and that the schema accepts well-formed payloads while
// rejecting malformed ones (wrong type, missing field, oversized string, etc.).
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T002 / T004
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-005
//   - Architect AUDIT-001 fix: retrieval_outcome.max(1024)
//   - Constitution Principle XIII (Telemetry-or-Die, schema-enforced)
//
// TDD: this test MUST FAIL before T004 (the implementation) lands.

import { describe, it, expect } from 'vitest';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_ISO = '2026-05-15T14:30:00.123Z';

/** Returns a fully-populated, valid nfr_008_pilot payload. */
function validPayload(): Record<string, unknown> {
  return {
    event_class: 'nfr_008_pilot',
    severity: 'info',
    timestamp: VALID_ISO,
    run_id: VALID_UUID,
    iteration: 1,
    model: 'qwen3:8b',
    prompt_variant: 'v1',
    query_id: 'q-kg-001',
    query_bucket: 'knowledge_grounded',
    retrieval_pattern: 'factual_lookup',
    tool_invoked: true,
    tool_arguments_valid: true,
    malformed_call_payload: null,
    retrieval_outcome: 'corpus.find returned 3 results; top doc-c8cf6ea2',
    duration_ms: 1234,
  };
}

describe('PREREQ-002 — nfr_008_pilot Zod schema (contract)', () => {
  it('NfrPilotEvent is exported from packages/contracts/src/telemetry.ts', async () => {
    const mod = (await import('./telemetry.js')) as unknown as Record<string, unknown>;
    expect(mod.NfrPilotEvent).toBeDefined();
    // Must look like a Zod schema — has safeParse.
    const schema = mod.NfrPilotEvent as { safeParse?: (v: unknown) => unknown };
    expect(typeof schema.safeParse).toBe('function');
  });

  it('accepts a well-formed payload (all 15 fields populated)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const result = NfrPilotEvent.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('accepts iteration = 2', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.iteration = 2;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(true);
  });

  it('accepts null retrieval_pattern (general / adversarial buckets)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.query_bucket = 'general';
    p.retrieval_pattern = null;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(true);
  });

  it('accepts non-null malformed_call_payload (string up to 2048 chars)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.tool_arguments_valid = false;
    p.malformed_call_payload = 'x'.repeat(2048);
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(true);
  });

  it('rejects event_class != "nfr_008_pilot"', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.event_class = 'something_else';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects wrong type on tool_invoked (string instead of boolean)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.tool_invoked = 'true';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects wrong type on tool_arguments_valid (number instead of boolean)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.tool_arguments_valid = 1;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects missing required field (model)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    delete p.model;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects missing required field (run_id)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    delete p.run_id;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects model != "qwen3:8b"', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.model = 'qwen2.5:7b';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects iteration not in {1, 2}', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.iteration = 3;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects malformed_call_payload longer than 2048 chars', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.tool_arguments_valid = false;
    p.malformed_call_payload = 'x'.repeat(2049);
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects retrieval_outcome longer than 1024 chars (AUDIT-001 fix)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.retrieval_outcome = 'x'.repeat(1025);
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('accepts retrieval_outcome of exactly 1024 chars (boundary)', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.retrieval_outcome = 'x'.repeat(1024);
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(true);
  });

  it('rejects invalid query_bucket value', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.query_bucket = 'made_up_bucket';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('accepts all three valid query_bucket values', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    for (const bucket of ['knowledge_grounded', 'general', 'adversarial']) {
      const p = validPayload();
      p.query_bucket = bucket;
      if (bucket !== 'knowledge_grounded') {
        p.retrieval_pattern = null;
      }
      const result = NfrPilotEvent.safeParse(p);
      expect(result.success).toBe(true);
    }
  });

  it('accepts all three valid retrieval_pattern values', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    for (const pat of ['factual_lookup', 'recall_by_context', 'multi_doc_synthesis']) {
      const p = validPayload();
      p.retrieval_pattern = pat;
      const result = NfrPilotEvent.safeParse(p);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid retrieval_pattern value', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.retrieval_pattern = 'random_pattern';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity value', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.severity = 'fatal';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects negative duration_ms', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.duration_ms = -1;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer duration_ms', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.duration_ms = 12.5;
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID run_id', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.run_id = 'not-a-uuid';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects malformed ISO-8601 timestamp', async () => {
    const { NfrPilotEvent } = await import('./telemetry.js');
    const p = validPayload();
    p.timestamp = '2026-05-15 14:30:00';
    const result = NfrPilotEvent.safeParse(p);
    expect(result.success).toBe(false);
  });
});
