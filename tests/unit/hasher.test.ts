// T035 (SP-003) — RED contract test for hashFile.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-004, ADR-002
//   - specs/003-ingest-pipeline/contracts/idempotency.feature

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/hasher.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('hashFile (T035 — Phase 2 RED)', () => {
  it('exports hashFile', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.hashFile).toBe('function');
  });

  it('uses crypto.createHash(sha256).update(stream).digest(hex) — full-file', async () => {
    expect.fail('Phase 3 (T060) required — stream SHA-256, NOT partial');
  });

  it('cancellable via AbortSignal mid-stream', async () => {
    expect.fail('Phase 3 (T060) required');
  });

  it('output matches openssl sha256 byte-for-byte (lowercase hex)', async () => {
    expect.fail('Phase 3 (T060) required');
  });
});
