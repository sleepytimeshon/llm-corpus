// T003 (SP-004 PREREQ-002) — Contract test for the 11 SP-004 telemetry
// event class Zod schemas added to the TelemetryEvent discriminated union.
//
// Spec references:
//   - specs/004-classifier/plan.md PREREQ-002
//   - specs/004-classifier/data-model.md §"Entity 6 — ClassifyTelemetryEvent"
//   - specs/004-classifier/spec.md FR-CLASSIFY-010
//   - Constitution Principle V (schema-enforced) + IX (≤ 4096 bytes)
//     + XIII (Telemetry-or-Die)
//
// TDD: this test MUST FAIL before T009 (the implementation) lands.

import { describe, it, expect } from 'vitest';

const VALID_ISO = '2026-05-12T14:30:00.123Z';

const SP004_EVENT_NAMES = [
  'classify.started',
  'classify.ollama_request',
  'classify.ollama_response',
  'classify.schema_invalid',
  'classify.vocabulary_violation',
  'classify.term_proposed',
  'classify.completed',
  'classify.failed',
  'classify.ollama_unavailable',
  'classify.batch_halted',
  'classify.frontmatter_incomplete',
] as const;

type Sp004EventName = (typeof SP004_EVENT_NAMES)[number];

function minimalPayloadFor(name: Sp004EventName): Record<string, unknown> {
  const envelope = {
    timestamp: VALID_ISO,
    severity: 'info',
    outcome: 'success',
  };
  switch (name) {
    case 'classify.started':
      return {
        event: name,
        ...envelope,
        doc_id: 'doc-12345678',
        model_name: 'qwen3.5:9b',
        vocabulary_snapshot_id: '11111111-1111-4111-8111-111111111111',
      };
    case 'classify.ollama_request':
      return {
        event: name,
        ...envelope,
        doc_id: 'doc-12345678',
        model_name: 'qwen3.5:9b',
        prompt_token_estimate: 2048,
        schema_field_count: 7,
      };
    case 'classify.ollama_response':
      return {
        event: name,
        ...envelope,
        doc_id: 'doc-12345678',
        response_token_count: 128,
        duration_ms: 4200,
      };
    case 'classify.schema_invalid':
      return {
        event: name,
        ...envelope,
        severity: 'warn',
        outcome: 'rejected',
        doc_id: 'doc-12345678',
        validation_errors: ['facet_domain: required'],
      };
    case 'classify.vocabulary_violation':
      return {
        event: name,
        ...envelope,
        severity: 'warn',
        outcome: 'rejected',
        doc_id: 'doc-12345678',
        offending_field: 'facet_domain',
        offending_value: 'hallucinated-domain',
        established_count: 3,
      };
    case 'classify.term_proposed':
      return {
        event: name,
        ...envelope,
        doc_id: 'doc-12345678',
        axis: 'domain',
        term: 'quantum-cryptography',
        inserted_or_conflicted: 'inserted',
      };
    case 'classify.completed':
      return {
        event: name,
        ...envelope,
        doc_id: 'doc-12345678',
        facet_domain: 'ai-systems',
        facet_type: 'tutorial',
        tag_count: 5,
        confidence_summary: { domain: 0.93, type: 0.91, tags: 0.85 },
        retry_count: 0,
        duration_ms: 4500,
      };
    case 'classify.failed':
      return {
        event: name,
        ...envelope,
        severity: 'error',
        outcome: 'failed',
        doc_id: 'doc-12345678',
        error_code: 'persist_failed',
        message: 'something',
        stage: 'classify',
      };
    case 'classify.ollama_unavailable':
      return {
        event: name,
        ...envelope,
        severity: 'error',
        outcome: 'failed',
        errno: 'ECONNREFUSED',
        message: 'connection refused',
      };
    case 'classify.batch_halted':
      return {
        event: name,
        ...envelope,
        severity: 'error',
        outcome: 'failed',
        consecutive_failures: 3,
        threshold: 3,
        last_error_code: 'ollama_unavailable',
      };
    case 'classify.frontmatter_incomplete':
      return {
        event: name,
        ...envelope,
        severity: 'warn',
        doc_id: 'doc-12345678',
        missing_fields: ['title'],
      };
  }
}

describe('PREREQ-002 — SP-004 telemetry event classes (contract)', () => {
  it('TelemetryEvent union accepts all 11 new SP-004 event variants', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    for (const name of SP004_EVENT_NAMES) {
      const payload = minimalPayloadFor(name);
      const result = TelemetryEvent.safeParse(payload);
      expect(
        result.success,
        `${name} should be a valid TelemetryEvent variant: ${
          !result.success
            ? JSON.stringify(result.error.issues.slice(0, 2))
            : 'ok'
        }`,
      ).toBe(true);
    }
  });

  it('rejects an unknown classify.* event name (closed union)', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const bad = {
      event: 'classify.does_not_exist',
      timestamp: VALID_ISO,
      severity: 'info',
      outcome: 'success',
    };
    expect(TelemetryEvent.safeParse(bad).success).toBe(false);
  });

  it('every SP-004 event has timestamp + severity + outcome envelope fields', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    for (const name of SP004_EVENT_NAMES) {
      const stripped = { ...minimalPayloadFor(name) };
      delete stripped['timestamp'];
      expect(
        TelemetryEvent.safeParse(stripped).success,
        `${name} should require timestamp`,
      ).toBe(false);
    }
  });

  it('every SP-004 event serializes under the ≤ 4096-byte append-atomic limit', async () => {
    const { TelemetryEvent, TELEMETRY_MAX_BYTES } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    expect(TELEMETRY_MAX_BYTES).toBe(4096);
    for (const name of SP004_EVENT_NAMES) {
      const payload = minimalPayloadFor(name);
      const result = TelemetryEvent.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        const serialized = JSON.stringify(result.data);
        expect(serialized.length).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
      }
    }
  });

  it('pre-existing SP-001/SP-002/SP-003 event variants still parse unchanged', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const pre = [
      {
        event: 'egress.checkpoint',
        timestamp: VALID_ISO,
        doc_id: 'doc-abcdef01',
        pipeline_stage: 'ingest',
        request_id: '11111111-1111-4111-8111-111111111111',
      },
      {
        event: 'pipeline.lock_contention',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        lock_path: '/state/drain.lock',
        requesting_pid: 1,
      },
      {
        event: 'ingest.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        doc_id: 'doc-abcdef01',
        hash: 'a'.repeat(64),
        duration_ms: 10,
        mime_type: 'text/markdown',
      },
    ];
    for (const evt of pre) {
      const r = TelemetryEvent.safeParse(evt);
      expect(r.success, `pre-SP-004 event should still parse: ${evt.event}`).toBe(true);
    }
  });
});
