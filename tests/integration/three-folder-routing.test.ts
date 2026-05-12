// T048 (SP-003) — RED integration test: three-folder routing invariants.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-002

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('three-folder routing (T048 — Phase 2 RED)', () => {
  it('post-drain: Paths.pending() is empty', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail('Phase 3 (T072/T073) required');
  });

  it('every Paths.processed() file has a success row', async () => {
    expect.fail('Phase 3 (T072/T073) required');
  });

  it('every Paths.failed() file has a sidecar AND no success row matching source_path', async () => {
    expect.fail('Phase 3 (T072/T073) required');
  });
});
