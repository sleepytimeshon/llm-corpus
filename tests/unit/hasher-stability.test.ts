// T037 (SP-003) — RED contract test: file stability check (size changes mid-hash).
//
// References:
//   - specs/003-ingest-pipeline/spec.md Edge Case "File modified during hash"
//   - specs/003-ingest-pipeline/data-model.md Entity 7 Hash Stability Decision

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/hasher.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('hashFile stability (T037 — Phase 2 RED)', () => {
  it('file size changes between pre-hash and post-hash stat → Result.err(IngestError(file_unstable))', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T060) required — pre-hash + post-hash stat compare; on mismatch Result.err(IngestError(file_unstable))',
    );
  });
});
