// T056 (SP-003) — RED integration test: daemon lifecycle + SIGTERM wiring.
//
// References:
//   - Constitution XI (only daemon may process.exit)
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-013

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('daemon lifecycle (T056 — Phase 2 RED)', () => {
  it('corpus daemon start launches; SIGTERM wires master AbortController; watcher + drain loop wired to controller', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T073) required — daemon is the ONLY process.exit site in SP-003 source tree',
    );
  });

  it('daemon is the ONLY process.exit site in SP-003', async () => {
    expect.fail('Phase 3 (T073) required');
  });
});
