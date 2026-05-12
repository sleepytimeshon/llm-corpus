// T052 (SP-003) — RED integration test: SIGTERM aborts mid-extract within 2s.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-016
//   - FR-INGEST-010 (cancellable IO)

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('SIGTERM abort (T052 — Phase 2 RED)', () => {
  it('drop large PDF; send SIGTERM mid-extract; daemon exits within 2s; in-flight doc in Paths.failed() with error_code=aborted, retriable=true; ingest.aborted telemetry', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T073/T077) required — master AbortController → controller.abort() → ingests fail with aborted',
    );
  });
});
