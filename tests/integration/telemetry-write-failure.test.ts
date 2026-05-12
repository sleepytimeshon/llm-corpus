// T050 (SP-003) — RED integration test: honest failure on telemetry-write fail.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-013
//   - Constitution XIII Telemetry-or-Die

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('telemetry write failure (T050 — Phase 2 RED)', () => {
  it('mid-test remount JSONL parent dir read-only → in-flight ingest routes to Paths.failed() with error_code telemetry_write_failed, retriable=true', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T076) required — exception observable to caller, NOT silently swallowed',
    );
  });
});
