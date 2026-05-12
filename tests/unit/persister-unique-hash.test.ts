// T041 (SP-003) — RED contract test: UNIQUE constraint defense-in-depth.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-004 defense-in-depth
//   - PREREQ-002 UNIQUE index

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/persister.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('persist unique-hash defense (T041 — Phase 2 RED)', () => {
  it('application-level dedup bypassed → UNIQUE constraint rejects duplicate-hash INSERT', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T067/T068) required — duplicate-hash INSERT rejected by UNIQUE constraint with persist.failed telemetry',
    );
  });

  it('persist.failed telemetry emitted with severity error', async () => {
    expect.fail('Phase 3 (T068) required');
  });
});
