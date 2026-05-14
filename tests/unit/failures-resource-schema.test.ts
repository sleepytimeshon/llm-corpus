// SP-006 T002 — Contract test for the corpus://failures Zod schemas.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-009, FR-HARDEN-010
//   - specs/006-hardening/data-model.md §"Entity 2 / 6 / 7"
//   - Constitution Principle V (Schema-Enforced Structured Output)

import { describe, it, expect } from 'vitest';
import {
  FailureEntryZodSchema,
  FailuresQueryZodSchema,
  FailuresResourceResponseZodSchema,
  FailuresErrorEnvelopeZodSchema,
} from '../../packages/contracts/src/failures-resource-schema.js';

const isoTimestamp = '2026-05-13T10:00:00Z';
const sidecarPath = '/home/shonrs/.local/share/corpus/failed/doc-deadbeef.error.json';

describe('PREREQ-001 — FailureEntryZodSchema', () => {
  it('accepts SP-003-shape verbatim entry with sidecar_path added', () => {
    const entry = {
      doc_id: 'doc-deadbeef',
      stage: 'classify',
      error_code: 'schema_invalid',
      message: 'Ollama returned invalid JSON',
      timestamp: isoTimestamp,
      retriable: true,
      sidecar_path: sidecarPath,
    };
    const r = FailureEntryZodSchema.safeParse(entry);
    expect(r.success).toBe(true);
  });

  it('accepts the unrecoverable_orphan stage value (SP-006 extension)', () => {
    const r = FailureEntryZodSchema.safeParse({
      doc_id: 'doc-deadbeef',
      stage: 'unrecoverable_orphan',
      error_code: 'unrecoverable_orphan',
      message: 'ingest file missing',
      timestamp: isoTimestamp,
      retriable: false,
      sidecar_path: sidecarPath,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown stage values (closed enum)', () => {
    const r = FailureEntryZodSchema.safeParse({
      doc_id: 'doc-deadbeef',
      stage: 'fictitious_stage',
      error_code: 'persist_failed',
      message: 'oops',
      timestamp: isoTimestamp,
      retriable: false,
      sidecar_path: sidecarPath,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed timestamp (non-ISO-8601)', () => {
    const r = FailureEntryZodSchema.safeParse({
      doc_id: 'doc-deadbeef',
      stage: 'persist',
      error_code: 'persist_failed',
      message: 'oops',
      timestamp: 'yesterday',
      retriable: false,
      sidecar_path: sidecarPath,
    });
    expect(r.success).toBe(false);
  });

  it('rejects message > 1024 chars (Constitution V)', () => {
    const r = FailureEntryZodSchema.safeParse({
      doc_id: 'doc-deadbeef',
      stage: 'persist',
      error_code: 'persist_failed',
      message: 'x'.repeat(1025),
      timestamp: isoTimestamp,
      retriable: false,
      sidecar_path: sidecarPath,
    });
    expect(r.success).toBe(false);
  });

  it('accepts doc_id as null (pre-persist orphan)', () => {
    const r = FailureEntryZodSchema.safeParse({
      doc_id: null,
      stage: 'validation',
      error_code: 'filename_sanity_failed',
      message: 'null byte',
      timestamp: isoTimestamp,
      retriable: false,
      sidecar_path: sidecarPath,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict mode)', () => {
    const r = FailureEntryZodSchema.safeParse({
      doc_id: 'doc-deadbeef',
      stage: 'persist',
      error_code: 'persist_failed',
      message: 'oops',
      timestamp: isoTimestamp,
      retriable: false,
      sidecar_path: sidecarPath,
      extra_field: 'nope',
    });
    expect(r.success).toBe(false);
  });
});

describe('PREREQ-001 — FailuresQueryZodSchema', () => {
  it('accepts {stage, limit} with offset default = 0', () => {
    const r = FailuresQueryZodSchema.safeParse({ stage: 'classify', limit: 5 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.offset).toBe(0);
    }
  });

  it('accepts empty query with limit=50 / offset=0 defaults', () => {
    const r = FailuresQueryZodSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(50);
      expect(r.data.offset).toBe(0);
    }
  });

  it('rejects unknown query keys (strict)', () => {
    const r = FailuresQueryZodSchema.safeParse({ stage: 'classify', foo: 'bar' });
    expect(r.success).toBe(false);
  });

  it('rejects limit < 1', () => {
    const r = FailuresQueryZodSchema.safeParse({ limit: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects limit > 1000', () => {
    const r = FailuresQueryZodSchema.safeParse({ limit: 1001 });
    expect(r.success).toBe(false);
  });

  it('rejects malformed since', () => {
    const r = FailuresQueryZodSchema.safeParse({ since: 'last week' });
    expect(r.success).toBe(false);
  });

  it('accepts since ISO-8601 timestamp', () => {
    const r = FailuresQueryZodSchema.safeParse({ since: isoTimestamp });
    expect(r.success).toBe(true);
  });

  it('rejects unknown stage value', () => {
    const r = FailuresQueryZodSchema.safeParse({ stage: 'made_up' });
    expect(r.success).toBe(false);
  });

  it('rejects offset < 0', () => {
    const r = FailuresQueryZodSchema.safeParse({ offset: -1 });
    expect(r.success).toBe(false);
  });
});

describe('PREREQ-001 — FailuresResourceResponseZodSchema', () => {
  it('accepts empty response with schema_version: 1', () => {
    const r = FailuresResourceResponseZodSchema.safeParse({
      entries: [],
      total_count: 0,
      returned_count: 0,
      schema_version: 1,
    });
    expect(r.success).toBe(true);
  });

  it('rejects schema_version: 2 (v1 literal)', () => {
    const r = FailuresResourceResponseZodSchema.safeParse({
      entries: [],
      total_count: 0,
      returned_count: 0,
      schema_version: 2,
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed entries[]', () => {
    const r = FailuresResourceResponseZodSchema.safeParse({
      entries: [{ doc_id: 123 }],
      total_count: 1,
      returned_count: 1,
      schema_version: 1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const r = FailuresResourceResponseZodSchema.safeParse({
      entries: [],
      total_count: 0,
      returned_count: 0,
      schema_version: 1,
      extra: 'no',
    });
    expect(r.success).toBe(false);
  });

  it('accepts response with a valid FailureEntry inside entries[]', () => {
    const r = FailuresResourceResponseZodSchema.safeParse({
      entries: [
        {
          doc_id: 'doc-deadbeef',
          stage: 'classify',
          error_code: 'schema_invalid',
          message: 'm',
          timestamp: isoTimestamp,
          retriable: true,
          sidecar_path: sidecarPath,
        },
      ],
      total_count: 1,
      returned_count: 1,
      schema_version: 1,
    });
    expect(r.success).toBe(true);
  });
});

describe('PREREQ-001 — FailuresErrorEnvelopeZodSchema', () => {
  it('accepts validation_error envelope', () => {
    const r = FailuresErrorEnvelopeZodSchema.safeParse({
      error_code: 'validation_error',
      message: 'unknown stage',
      hint: 'use one of: ingest, classify, embed, index, edges-build',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown error_code', () => {
    const r = FailuresErrorEnvelopeZodSchema.safeParse({
      error_code: 'made_up',
      message: 'm',
      hint: 'h',
    });
    expect(r.success).toBe(false);
  });

  it('rejects message > 1024 chars', () => {
    const r = FailuresErrorEnvelopeZodSchema.safeParse({
      error_code: 'validation_error',
      message: 'x'.repeat(1025),
      hint: 'h',
    });
    expect(r.success).toBe(false);
  });

  it('rejects hint > 1024 chars', () => {
    const r = FailuresErrorEnvelopeZodSchema.safeParse({
      error_code: 'validation_error',
      message: 'm',
      hint: 'x'.repeat(1025),
    });
    expect(r.success).toBe(false);
  });
});
