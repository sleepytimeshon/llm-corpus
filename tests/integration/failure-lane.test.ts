// T047 (SP-003) — RED integration test: failure-lane sidecar contract.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-010, SC-INGEST-011

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('failure-lane sidecar (T047 — Phase 2 RED)', () => {
  it('drop one file per error_code in the FR-INGEST-007 enum → each in Paths.failed() with .error.json sidecar', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T058/T059/T073) required — every error_code routes to Paths.failed() with sidecar matching ErrorSidecarSchema; no documents row with status=success for any',
    );
  });

  it('no documents row with status=success for any rejected file', async () => {
    expect.fail('Phase 3 (T058/T073) required');
  });
});
