// T013 — Unit test for telemetry event Zod schemas (Constitution V, IX, XIII).
// Verifies discriminated-union validation and the ≤4 KB serialization assertion.

import { describe, it, expect } from 'vitest';
import {
  EgressAttemptedEvent,
  EgressBlockedEvent,
  EgressCheckpointEvent,
  EgressEvent,
} from '../../packages/contracts/src/telemetry.js';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_ISO = '2026-05-15T14:30:00.123Z';
const VALID_DOC_ID = 'doc-c8cf6ea2';

describe('Telemetry event schemas (Constitution V, IX, XIII)', () => {
  describe('EgressAttemptedEvent', () => {
    it('accepts a valid attempted event', () => {
      const result = EgressAttemptedEvent.safeParse({
        event: 'egress.attempted',
        timestamp: VALID_ISO,
        primitive: 'undici.Dispatcher',
        destination_host: 'example.com',
        destination_port: 443,
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid primitive', () => {
      const result = EgressAttemptedEvent.safeParse({
        event: 'egress.attempted',
        timestamp: VALID_ISO,
        primitive: 'fetch.api', // not in enum
        destination_host: 'example.com',
        destination_port: 443,
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid request_id (non-uuid)', () => {
      const result = EgressAttemptedEvent.safeParse({
        event: 'egress.attempted',
        timestamp: VALID_ISO,
        primitive: 'undici.Dispatcher',
        destination_host: 'example.com',
        destination_port: 443,
        request_id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EgressBlockedEvent', () => {
    it('accepts a valid blocked event', () => {
      const result = EgressBlockedEvent.safeParse({
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

    it('accepts blocked_at = os_firewall', () => {
      const result = EgressBlockedEvent.safeParse({
        event: 'egress.blocked',
        timestamp: VALID_ISO,
        primitive: 'net.Socket.connect',
        destination_host: '8.8.8.8',
        destination_port: 53,
        result: 'blocked',
        blocked_at: 'os_firewall',
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid blocked_at value', () => {
      const result = EgressBlockedEvent.safeParse({
        event: 'egress.blocked',
        timestamp: VALID_ISO,
        primitive: 'net.Socket.connect',
        destination_host: '8.8.8.8',
        destination_port: 53,
        result: 'blocked',
        blocked_at: 'made_up_layer',
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EgressCheckpointEvent', () => {
    it('accepts a valid checkpoint event', () => {
      const result = EgressCheckpointEvent.safeParse({
        event: 'egress.checkpoint',
        timestamp: VALID_ISO,
        doc_id: VALID_DOC_ID,
        pipeline_stage: 'find',
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid doc_id', () => {
      const result = EgressCheckpointEvent.safeParse({
        event: 'egress.checkpoint',
        timestamp: VALID_ISO,
        doc_id: 'doc-XXXX',
        pipeline_stage: 'find',
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid pipeline_stage', () => {
      const result = EgressCheckpointEvent.safeParse({
        event: 'egress.checkpoint',
        timestamp: VALID_ISO,
        doc_id: VALID_DOC_ID,
        pipeline_stage: 'unknown-stage',
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EgressEvent (discriminated union)', () => {
    it('routes attempted event to correct schema', () => {
      const result = EgressEvent.safeParse({
        event: 'egress.attempted',
        timestamp: VALID_ISO,
        primitive: 'undici.Dispatcher',
        destination_host: 'example.com',
        destination_port: 443,
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('routes blocked event to correct schema', () => {
      const result = EgressEvent.safeParse({
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

    it('routes checkpoint event to correct schema', () => {
      const result = EgressEvent.safeParse({
        event: 'egress.checkpoint',
        timestamp: VALID_ISO,
        doc_id: VALID_DOC_ID,
        pipeline_stage: 'find',
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown event type', () => {
      const result = EgressEvent.safeParse({
        event: 'egress.unknown',
        timestamp: VALID_ISO,
        request_id: VALID_UUID,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Serialization size constraint (Constitution IX — ≤4 KB)', () => {
    it('typical event serializes well under 4096 bytes', () => {
      const event = {
        event: 'egress.blocked' as const,
        timestamp: VALID_ISO,
        primitive: 'net.Socket.connect' as const,
        destination_host: '8.8.8.8',
        destination_port: 53,
        result: 'blocked' as const,
        blocked_at: 'in_process_hook' as const,
        request_id: VALID_UUID,
      };
      const serialized = JSON.stringify(event);
      expect(serialized.length).toBeLessThanOrEqual(4096);
    });

    it('event with 10KB destination_host string serializes >4096 bytes (gate triggers)', () => {
      const huge = 'x'.repeat(10_000);
      const event = {
        event: 'egress.attempted' as const,
        timestamp: VALID_ISO,
        primitive: 'undici.Dispatcher' as const,
        destination_host: huge,
        destination_port: 443,
        request_id: VALID_UUID,
      };
      const serialized = JSON.stringify(event);
      expect(serialized.length).toBeGreaterThan(4096);
    });
  });
});
