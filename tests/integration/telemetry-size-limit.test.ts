// T065 — Integration test: telemetry pre-append size assertion rejects
// records that exceed the 4096-byte append-atomic ceiling.
//
// Constitution IX (Concurrency-Safe Shared State): every JSONL record MUST
// be ≤ POSIX PIPE_BUF (4096 bytes) so `fs.appendFile()` with O_APPEND is
// kernel-atomic. The contracts package enforces this with a TelemetrySize-
// ExceededError thrown BEFORE the disk write.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  emitTelemetry,
  TelemetrySizeExceededError,
} from '../../packages/contracts/src/telemetry.js';

describe('T065 — telemetry size limit (Constitution IX)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tel-size-t065-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('rejects an event whose serialized form exceeds 4096 bytes', async () => {
    // 10 KB destination_host string forces serialized > 4096 bytes.
    const oversized = 'x'.repeat(10_000);
    const event = {
      event: 'egress.attempted' as const,
      timestamp: new Date().toISOString(),
      primitive: 'tls.connect' as const,
      destination_host: oversized,
      destination_port: 443,
      request_id: randomUUID(),
    };
    let caught: unknown;
    try {
      await emitTelemetry(event);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TelemetrySizeExceededError);
    const err = caught as TelemetrySizeExceededError;
    expect(err.serializedLength).toBeGreaterThan(4096);
    expect(err.limit).toBe(4096);

    // Telemetry file should NOT have been created (or should be empty).
    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    if (fs.existsSync(telPath)) {
      expect(fs.readFileSync(telPath, 'utf8').length).toBe(0);
    }
  });

  it('accepts an event whose serialized form fits under 4096 bytes', async () => {
    const event = {
      event: 'egress.attempted' as const,
      timestamp: new Date().toISOString(),
      primitive: 'tls.connect' as const,
      destination_host: 'example.org',
      destination_port: 443,
      request_id: randomUUID(),
    };
    await expect(emitTelemetry(event)).resolves.toBeUndefined();
    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    expect(fs.existsSync(telPath)).toBe(true);
    const lines = fs
      .readFileSync(telPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);
  });
});
