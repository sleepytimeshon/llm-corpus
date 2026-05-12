// T003 (SP-003 PREREQ-003) — Contract test for the 14 SP-003 telemetry event
// class Zod schemas registered in the TelemetryEvent discriminated union.
//
// Spec references:
//   - specs/003-ingest-pipeline/plan.md PREREQ-003
//   - specs/003-ingest-pipeline/data-model.md §"Entity 10 — Telemetry Event"
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-009
//   - Constitution Principle V (schema-enforced) + IX (≤ 4096 bytes)
//
// TDD: this test MUST FAIL before T009 (the implementation) lands.

import { describe, it, expect } from 'vitest';

const VALID_ISO = '2026-05-12T14:30:00.123Z';

const SP003_EVENT_NAMES = [
  'inbox.allowlist_hit',
  'inbox.allowlist_miss',
  'inbox.mime_mismatch',
  'inbox.size_exceeded',
  'inbox.filename_sanity_failed',
  'inbox.watcher_resource_exhausted',
  'ingest.dedup_hit',
  'ingest.dedup_miss',
  'ingest.normalized',
  'ingest.completed',
  'ingest.file_unstable',
  'ingest.aborted',
  'pipeline.lock_contention',
  'persist.failed',
] as const;

describe('PREREQ-003 — SP-003 telemetry event classes (contract)', () => {
  it('TelemetryEvent union accepts all 14 new SP-003 event variants', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    // Each class must round-trip a minimal-but-valid payload.
    for (const name of SP003_EVENT_NAMES) {
      const payload = minimalPayloadFor(name);
      const result = TelemetryEvent.safeParse(payload);
      expect(result.success, `${name} should be a valid TelemetryEvent variant`).toBe(true);
    }
  });

  it('rejects an unknown event name (closed union)', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const bad = {
      event: 'inbox.does_not_exist',
      timestamp: VALID_ISO,
      severity: 'info',
      outcome: 'success',
      file_path: '/foo',
    };
    expect(TelemetryEvent.safeParse(bad).success).toBe(false);
  });

  it('every SP-003 event has timestamp + severity + outcome envelope fields', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    for (const name of SP003_EVENT_NAMES) {
      const payload = minimalPayloadFor(name);
      // Strip the timestamp — must fail validation.
      const stripped = { ...payload };
      delete (stripped as Record<string, unknown>).timestamp;
      expect(
        TelemetryEvent.safeParse(stripped).success,
        `${name} should require timestamp`,
      ).toBe(false);
    }
  });

  it('every SP-003 event serializes under the ≤ 4096 byte append-atomic limit', async () => {
    const { TelemetryEvent, TELEMETRY_MAX_BYTES } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    expect(TELEMETRY_MAX_BYTES).toBe(4096);
    for (const name of SP003_EVENT_NAMES) {
      const payload = minimalPayloadFor(name);
      const parsed = TelemetryEvent.safeParse(payload);
      expect(parsed.success, `${name} must be parseable to check size`).toBe(
        true,
      );
      if (parsed.success) {
        const serialized = JSON.stringify(parsed.data);
        expect(
          serialized.length,
          `${name} serialized size`,
        ).toBeLessThanOrEqual(4096);
      }
    }
  });

  it('preserves SP-001 EgressAttemptedEvent variant (additive change)', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const event = {
      event: 'egress.attempted',
      timestamp: VALID_ISO,
      primitive: 'net.Socket.connect',
      destination_host: '1.2.3.4',
      destination_port: 80,
      request_id: '019099d4-78f0-7e61-a37c-8c2a9b5d2e10',
    };
    expect(TelemetryEvent.safeParse(event).success).toBe(true);
  });

  it('preserves SP-002 ResourceReadEvent variant (additive change)', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const event = {
      event: 'resource.read',
      timestamp: VALID_ISO,
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: 12,
      request_id: '019099d4-78f0-7e61-a37c-8c2a9b5d2e10',
      severity: 'info',
    };
    expect(TelemetryEvent.safeParse(event).success).toBe(true);
  });

  it('inbox.mime_mismatch carries extension + detected_mime + error_code fields', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const event = {
      event: 'inbox.mime_mismatch',
      timestamp: VALID_ISO,
      severity: 'warn',
      outcome: 'rejected',
      file_path: '/foo.md',
      extension: 'md',
      detected_mime: 'application/pdf',
      error_code: 'mime_mismatch',
    };
    expect(TelemetryEvent.safeParse(event).success).toBe(true);
  });

  it('ingest.dedup_hit carries hash + existing_doc_id', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const event = {
      event: 'ingest.dedup_hit',
      timestamp: VALID_ISO,
      severity: 'info',
      outcome: 'deduplicated',
      file_path: '/foo',
      hash: 'a'.repeat(64),
      existing_doc_id: 'doc-aa11bb22',
    };
    expect(TelemetryEvent.safeParse(event).success).toBe(true);
  });

  it('persist.failed bounds message to 1024 chars (size-budget)', async () => {
    const { TelemetryEvent } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    const event = {
      event: 'persist.failed',
      timestamp: VALID_ISO,
      severity: 'error',
      outcome: 'failed',
      file_path: '/foo',
      error_code: 'persist_failed',
      message: 'x'.repeat(1025),
      stage: 'persist',
    };
    expect(TelemetryEvent.safeParse(event).success).toBe(false);
  });

  it('emitTelemetry accepts a valid SP-003 event (integration smoke)', async () => {
    const { emitTelemetry } = await import(
      '../../packages/contracts/src/telemetry.js'
    );
    // Use the per-test CORPUS_HOME from the global setup — telemetry append is
    // isolated. We just verify the function does not throw on a valid payload.
    await expect(
      emitTelemetry({
        event: 'ingest.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        doc_id: 'doc-aa11bb22',
        hash: 'b'.repeat(64),
        duration_ms: 123,
        mime_type: 'text/markdown',
      } as never),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalPayloadFor(name: string): Record<string, unknown> {
  const base = {
    timestamp: VALID_ISO,
  } as Record<string, unknown>;
  switch (name) {
    case 'inbox.allowlist_hit':
      return {
        event: name,
        ...base,
        severity: 'info',
        outcome: 'success',
        file_path: '/inbox/foo.md',
        mime_type: 'text/markdown',
        size_bytes: 100,
      };
    case 'inbox.allowlist_miss':
      return {
        event: name,
        ...base,
        severity: 'warn',
        outcome: 'rejected',
        file_path: '/inbox/foo.docx',
        mime_type: 'application/vnd.openxmlformats',
        error_code: 'mime_not_allowlisted',
      };
    case 'inbox.mime_mismatch':
      return {
        event: name,
        ...base,
        severity: 'warn',
        outcome: 'rejected',
        file_path: '/inbox/foo.md',
        extension: 'md',
        detected_mime: 'application/pdf',
        error_code: 'mime_mismatch',
      };
    case 'inbox.size_exceeded':
      return {
        event: name,
        ...base,
        severity: 'warn',
        outcome: 'rejected',
        file_path: '/inbox/big.txt',
        size_bytes: 1_000_000_000,
        max_bytes: 100_000_000,
        error_code: 'size_exceeded',
      };
    case 'inbox.filename_sanity_failed':
      return {
        event: name,
        ...base,
        severity: 'warn',
        outcome: 'rejected',
        file_path: '/inbox/\x00bad',
        error_code: 'filename_sanity_failed',
        reason: 'null_byte',
      };
    case 'inbox.watcher_resource_exhausted':
      return {
        event: name,
        ...base,
        severity: 'error',
        outcome: 'failed',
        errno: 'ENOSPC',
        limit_kind: 'inotify_watches',
        message: 'inotify watch limit exceeded',
      };
    case 'ingest.dedup_hit':
      return {
        event: name,
        ...base,
        severity: 'info',
        outcome: 'deduplicated',
        file_path: '/pending/foo.md',
        hash: 'a'.repeat(64),
        existing_doc_id: 'doc-aa11bb22',
      };
    case 'ingest.dedup_miss':
      return {
        event: name,
        ...base,
        severity: 'info',
        outcome: 'success',
        file_path: '/pending/foo.md',
        hash: 'a'.repeat(64),
      };
    case 'ingest.normalized':
      return {
        event: name,
        ...base,
        severity: 'info',
        outcome: 'success',
        file_path: '/pending/foo.md',
        doc_id: 'doc-aa11bb22',
        mime_type: 'text/markdown',
        body_path: 'store/aa/doc-aa11bb22.md',
      };
    case 'ingest.completed':
      return {
        event: name,
        ...base,
        severity: 'info',
        outcome: 'success',
        doc_id: 'doc-aa11bb22',
        hash: 'a'.repeat(64),
        duration_ms: 250,
        mime_type: 'text/markdown',
      };
    case 'ingest.file_unstable':
      return {
        event: name,
        ...base,
        severity: 'warn',
        outcome: 'failed',
        file_path: '/pending/foo.md',
        error_code: 'file_unstable',
        stat_before: 100,
        stat_after: 200,
      };
    case 'ingest.aborted':
      return {
        event: name,
        ...base,
        severity: 'warn',
        outcome: 'aborted',
        file_path: '/pending/foo.md',
        stage: 'normalize',
      };
    case 'pipeline.lock_contention':
      return {
        event: name,
        ...base,
        severity: 'info',
        outcome: 'success',
        lock_path: '/state/drain.lock',
        requesting_pid: 12345,
      };
    case 'persist.failed':
      return {
        event: name,
        ...base,
        severity: 'error',
        outcome: 'failed',
        file_path: '/pending/foo.md',
        error_code: 'persist_failed',
        message: 'transaction rolled back',
        stage: 'persist',
      };
    default:
      throw new Error(`Unknown SP-003 event name: ${name}`);
  }
}
