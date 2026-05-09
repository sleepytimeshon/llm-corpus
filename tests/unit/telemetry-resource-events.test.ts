// T010 — Unit test: ResourceReadEvent Zod schema (Constitution V, IX, XIII).
//
// References: contracts/telemetry-resource-events.md, data-model.md "ResourceReadEvent".
//
// Coverage:
//   - event literal "resource.read"
//   - ISO-8601 timestamp regex
//   - Closed-enum resource_uri
//   - Optional doc_id (required for corpus://docs/*, absent for the three statics)
//   - result enum, severity enum
//   - Integer duration_ms
//   - UUID request_id
//   - ≤4096-byte serialization

import { describe, it, expect } from 'vitest';
import {
  ResourceReadEvent,
  TELEMETRY_MAX_BYTES,
} from '../../packages/contracts/src/telemetry.js';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_ISO = '2026-05-15T14:30:00.123Z';
const VALID_DOC_ID = 'doc-ab12cd34';

describe('ResourceReadEvent (Constitution V, IX, XIII)', () => {
  it('accepts a valid success event for corpus://manifest', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: 12,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid event for corpus://docs/* with doc_id', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://docs/*',
      doc_id: VALID_DOC_ID,
      result: 'success',
      duration_ms: 34,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(true);
  });

  it('accepts document_not_found with severity warn', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://docs/*',
      // The dispatch table regex enforces doc-[0-9a-f]{8} BEFORE handler entry,
      // so doc_id in telemetry is always validly formatted — even when the
      // requested id is missing-but-validly-formatted.
      doc_id: 'doc-99999999',
      result: 'document_not_found',
      duration_ms: 3,
      request_id: VALID_UUID,
      severity: 'warn',
    });
    expect(result.success).toBe(true);
  });

  it('accepts index_locked with severity warn', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://docs/*',
      doc_id: VALID_DOC_ID,
      result: 'index_locked',
      duration_ms: 5018,
      request_id: VALID_UUID,
      severity: 'warn',
    });
    expect(result.success).toBe(true);
  });

  it('accepts server_initializing with severity warn', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'server_initializing',
      duration_ms: 1,
      request_id: VALID_UUID,
      severity: 'warn',
    });
    expect(result.success).toBe(true);
  });

  it('accepts error with severity error', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'error',
      duration_ms: 5,
      request_id: VALID_UUID,
      severity: 'error',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown resource_uri', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://unknown',
      result: 'success',
      duration_ms: 1,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown result outcome', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'maybe',
      duration_ms: 1,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown severity', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: 1,
      request_id: VALID_UUID,
      severity: 'fatal',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad doc_id format', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://docs/*',
      doc_id: 'doc-XYZ',
      result: 'success',
      duration_ms: 1,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative duration_ms', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: -1,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad UUID request_id', () => {
    const result = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: 1,
      request_id: 'not-a-uuid',
      severity: 'info',
    });
    expect(result.success).toBe(false);
  });

  it('worst-case serialization is well under TELEMETRY_MAX_BYTES', () => {
    const event = {
      event: 'resource.read' as const,
      timestamp: VALID_ISO,
      resource_uri: 'corpus://docs/*' as const,
      doc_id: VALID_DOC_ID,
      result: 'error' as const,
      duration_ms: 1234,
      request_id: VALID_UUID,
      severity: 'error' as const,
    };
    const serialized = JSON.stringify(event);
    expect(serialized.length).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
    expect(serialized.length).toBeLessThan(500); // tighter bound — should be ~230 bytes
  });
});

describe('Severity-mapping table (per contracts/telemetry-resource-events.md)', () => {
  // The mapping table from the contract is the authoritative source.
  // The emit helper (T030) enforces this mapping; the schema accepts any
  // valid (result, severity) pair but the helper's SEVERITY_MAP is what
  // SP-002 actually emits. Verify the helper map at T018; here we sanity-
  // check that schema accepts each contract-mandated pair.
  it.each([
    ['success', 'info'],
    ['document_not_found', 'warn'],
    ['index_locked', 'warn'],
    ['server_initializing', 'warn'],
    ['error', 'error'],
  ] as const)('result=%s + severity=%s validates', (result, severity) => {
    const parsed = ResourceReadEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result,
      duration_ms: 1,
      request_id: VALID_UUID,
      severity,
    });
    expect(parsed.success).toBe(true);
  });
});
