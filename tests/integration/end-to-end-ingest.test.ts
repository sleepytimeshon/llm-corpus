// T045 (SP-003) — RED integration test: end-to-end ingest of 4 MIME families.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-001, SC-INGEST-002

import { describe, it, expect } from 'vitest';

const DAEMON_PATH = '../../packages/daemon/src/index.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(DAEMON_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('end-to-end ingest (T045 — Phase 2 RED)', () => {
  it('boots daemon with batchPolicy; drops 4 files (PDF, MD, TXT, HTML); within per-doc budget yields 4 documents rows', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T073) required — assert 4 documents rows with status=success, 4 body files in Paths.docsStore(), Paths.pending() empty, Paths.processed() has 4 forensics copies, ≥4 distinct telemetry classes',
    );
  });
});
