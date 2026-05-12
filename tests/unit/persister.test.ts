// T038 (SP-003) — RED contract test for persist (single-transaction commit).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-008
//   - Constitution VIII (atomic + transactional)

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/persister.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('persist (T038 — Phase 2 RED)', () => {
  it('exports persist', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.persist).toBe('function');
  });

  it('writes body file via withTempDir atomic-rename', async () => {
    expect.fail('Phase 3 (T068) required');
  });

  it('INSERTs documents row + renames source to processed/ in a single SQLite transaction', async () => {
    expect.fail('Phase 3 (T068) required');
  });

  it('both succeed or both fail (partial-failure rollback verified)', async () => {
    expect.fail('Phase 3 (T068) required');
  });
});
