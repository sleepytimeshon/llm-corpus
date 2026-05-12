// T051 (SP-003) — RED integration test: no body content in telemetry.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-014
//   - Constitution I (Local-First, No Egress)

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('telemetry no body content (T051 — Phase 2 RED)', () => {
  it('fixture document contains FIXTURE_CANARY_PHRASE → grep over Paths.telemetry() returns ZERO matches; hashes/ids/paths permitted', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T076) required — body content MUST NOT appear in telemetry payloads',
    );
  });
});
