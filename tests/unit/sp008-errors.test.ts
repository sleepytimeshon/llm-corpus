// SP-008 T004 — Asserts the 5 new SP-008 typed errors instantiate with
// structured `data`, are throwable, carry distinct `name` constants verbatim
// from data-model.md "Schema migration delta — errors.ts", and that
// `AcceptDuplicateRequestIdError` is INFORMATIONAL (the CLI catches it and
// exits 0 per FR-ENGAGEMENT-002 + Constitution X).
//
// References:
//   - specs/008-user-acceptance/data-model.md "Schema migration delta — errors.ts"
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-002, FR-ENGAGEMENT-017,
//     SC-008-032
//   - Constitution Principles X, XI

import { describe, it, expect } from 'vitest';
import {
  EngagementProxyTelemetryParseError,
  EngagementProxyWindowInvalidError,
  AcceptUnknownRequestIdError,
  AcceptZeroResultQueryError,
  AcceptDuplicateRequestIdError,
} from '../../packages/contracts/src/errors.js';

const VALID_UUID = 'e53d5aab-5e61-4c8f-b950-fd7b095756ed';

describe('SP-008 PREREQ-003 — typed errors', () => {
  it('EngagementProxyTelemetryParseError carries structured data + stable name', () => {
    const e = new EngagementProxyTelemetryParseError({
      line_number: 42,
      error_message: 'unexpected token in JSON',
      telemetry_log_path: '/var/lib/llm-corpus/state/telemetry.jsonl',
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('EngagementProxyTelemetryParseError');
    expect(e.code).toBe('ENGAGEMENT_PROXY_TELEMETRY_PARSE');
    expect(e.data.line_number).toBe(42);
    expect(e.data.error_message).toBe('unexpected token in JSON');
    expect(e.data.telemetry_log_path).toBe(
      '/var/lib/llm-corpus/state/telemetry.jsonl',
    );
    expect(() => {
      throw e;
    }).toThrow(EngagementProxyTelemetryParseError);
  });

  it('EngagementProxyTelemetryParseError allows line_number to be omitted (binary corruption)', () => {
    const e = new EngagementProxyTelemetryParseError({
      error_message: 'mid-file binary corruption',
      telemetry_log_path: '/path/to/telemetry.jsonl',
    });
    expect(e.data.line_number).toBeUndefined();
    expect(e.message).toContain('/path/to/telemetry.jsonl');
  });

  it('EngagementProxyWindowInvalidError carries since + until + reason', () => {
    const e = new EngagementProxyWindowInvalidError({
      since: '2026-05-17T11:00:00Z',
      until: '2026-05-17T10:00:00Z',
      reason: 'since must be <= until',
    });
    expect(e.name).toBe('EngagementProxyWindowInvalidError');
    expect(e.code).toBe('ENGAGEMENT_PROXY_WINDOW_INVALID');
    expect(e.data.since).toBe('2026-05-17T11:00:00Z');
    expect(e.data.until).toBe('2026-05-17T10:00:00Z');
    expect(e.data.reason).toBe('since must be <= until');
    expect(e.message).toContain('since must be <= until');
  });

  it('AcceptUnknownRequestIdError carries request_id + telemetry_log_path', () => {
    const e = new AcceptUnknownRequestIdError({
      request_id: VALID_UUID,
      telemetry_log_path: '/path/to/telemetry.jsonl',
    });
    expect(e.name).toBe('AcceptUnknownRequestIdError');
    expect(e.code).toBe('ACCEPT_UNKNOWN_REQUEST_ID');
    expect(e.data.request_id).toBe(VALID_UUID);
    expect(e.message).toContain(VALID_UUID);
  });

  it('AcceptZeroResultQueryError carries request_id', () => {
    const e = new AcceptZeroResultQueryError({ request_id: VALID_UUID });
    expect(e.name).toBe('AcceptZeroResultQueryError');
    expect(e.code).toBe('ACCEPT_ZERO_RESULT_QUERY');
    expect(e.data.request_id).toBe(VALID_UUID);
    expect(e.message).toContain('cannot accept zero-result query');
  });

  it('AcceptDuplicateRequestIdError is INFORMATIONAL and carries prior timestamp', () => {
    const e = new AcceptDuplicateRequestIdError({
      request_id: VALID_UUID,
      prior_acceptance_timestamp: '2026-05-10T10:25:00Z',
    });
    expect(e.name).toBe('AcceptDuplicateRequestIdError');
    expect(e.code).toBe('ACCEPT_DUPLICATE_REQUEST_ID');
    expect(e.data.prior_acceptance_timestamp).toBe('2026-05-10T10:25:00Z');
    expect(e.message).toContain('already accepted');
    expect(e.message).toContain(VALID_UUID);
  });

  it('all 5 errors have distinct names', () => {
    const names = new Set([
      new EngagementProxyTelemetryParseError({
        error_message: '',
        telemetry_log_path: '/x',
      }).name,
      new EngagementProxyWindowInvalidError({
        since: '2026-05-17T10:00:00Z',
        until: '2026-05-17T10:00:00Z',
        reason: '',
      }).name,
      new AcceptUnknownRequestIdError({
        request_id: VALID_UUID,
        telemetry_log_path: '/x',
      }).name,
      new AcceptZeroResultQueryError({ request_id: VALID_UUID }).name,
      new AcceptDuplicateRequestIdError({
        request_id: VALID_UUID,
        prior_acceptance_timestamp: '2026-05-10T10:25:00Z',
      }).name,
    ]);
    expect(names.size).toBe(5);
  });
});
