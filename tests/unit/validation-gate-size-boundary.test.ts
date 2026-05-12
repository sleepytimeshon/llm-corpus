// T026 (SP-003) — RED contract test: size-boundary at max and max+1.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-008
//   - Constitution VII bounded IO

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/validation-gate.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('validateInboxFile size boundary (T026 — Phase 2 RED)', () => {
  it('file at exactly max_file_size_mb passes', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T058) required — file at exactly max size passes; max+1 bytes fails with size_exceeded',
    );
  });

  it('file at max+1 bytes fails with error_code size_exceeded', async () => {
    expect.fail('Phase 3 (T058) required');
  });

  it('reads at most max+1 bytes before rejection (bounded IO)', async () => {
    expect.fail('Phase 3 (T058) required');
  });
});
