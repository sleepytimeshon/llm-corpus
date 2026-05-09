// T011 — Unit test: assert the EgressEvent → TelemetryEvent rename is additive.
//
// SP-001 callers import `EgressEvent` from `@llm-corpus/contracts`. SP-002
// renames the discriminated union to `TelemetryEvent` AND keeps `EgressEvent`
// as a deprecated alias for backward compatibility. The new `resource.read`
// event variant joins the union.
//
// References: contracts/telemetry-resource-events.md §"Discriminated union extension"

import { describe, it, expect } from 'vitest';
import {
  EgressEvent,
  TelemetryEvent,
} from '../../packages/contracts/src/telemetry.js';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_ISO = '2026-05-15T14:30:00.123Z';
const VALID_DOC_ID = 'doc-ab12cd34';

describe('EgressEvent → TelemetryEvent rename (T011 / additive)', () => {
  it('legacy EgressEvent name still exports (deprecated alias)', () => {
    expect(EgressEvent).toBeDefined();
    // The alias points at the same schema object as TelemetryEvent.
    expect(EgressEvent).toBe(TelemetryEvent);
  });

  it('TelemetryEvent parses egress.attempted', () => {
    const result = TelemetryEvent.safeParse({
      event: 'egress.attempted',
      timestamp: VALID_ISO,
      primitive: 'undici.Dispatcher',
      destination_host: 'example.com',
      destination_port: 443,
      request_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('TelemetryEvent parses egress.blocked', () => {
    const result = TelemetryEvent.safeParse({
      event: 'egress.blocked',
      timestamp: VALID_ISO,
      primitive: 'net.Socket.connect',
      destination_host: '8.8.8.8',
      destination_port: 53,
      result: 'blocked',
      blocked_at: 'in_process_hook',
      request_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('TelemetryEvent parses egress.checkpoint', () => {
    const result = TelemetryEvent.safeParse({
      event: 'egress.checkpoint',
      timestamp: VALID_ISO,
      doc_id: VALID_DOC_ID,
      pipeline_stage: 'find',
      request_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('TelemetryEvent parses the NEW resource.read variant', () => {
    const result = TelemetryEvent.safeParse({
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

  it('legacy EgressEvent alias parses the NEW resource.read variant too', () => {
    // Backward-compat: SP-001 callers can keep using EgressEvent and the
    // SP-002 surface is reachable through it.
    const result = EgressEvent.safeParse({
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://docs/*',
      doc_id: VALID_DOC_ID,
      result: 'success',
      duration_ms: 5,
      request_id: VALID_UUID,
      severity: 'info',
    });
    expect(result.success).toBe(true);
  });

  it('TelemetryEvent rejects unknown event discriminant', () => {
    const result = TelemetryEvent.safeParse({
      event: 'something.else',
      timestamp: VALID_ISO,
      request_id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });
});
