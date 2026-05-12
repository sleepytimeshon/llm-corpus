// T046 (SP-003) — RED integration test: content-hash dedup + F-10 adversary.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-005, SC-INGEST-006

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('dedup content-hash (T046 — Phase 2 RED)', () => {
  it('drop file twice under different filenames → single documents row + ingest.dedup_hit', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T072 / T080) required — single documents row; ingest.dedup_hit telemetry; no orphan in Paths.pending()',
    );
  });

  it('ADR-002 F-10 60-MB adversary → two separate rows', async () => {
    expect.fail('Phase 3 (T072 / T080) required — fixture-dependent (60MB adversary)');
  });
});
