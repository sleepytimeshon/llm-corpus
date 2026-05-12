// T036 (SP-003) — RED contract test for ADR-002 F-10 60-MB adversary.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-006
//   - ADR-002 F-10

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

const MODULE_PATH = '../../packages/pipeline/src/hasher.js';
const FIXTURE_A =
  'tests/fixtures/sp003-ingest/adversary-60mb-identical-prefix-A.bin';
const FIXTURE_B =
  'tests/fixtures/sp003-ingest/adversary-60mb-identical-prefix-B.bin';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const fixturesAvailable = fs.existsSync(FIXTURE_A) && fs.existsSync(FIXTURE_B);

describe.skipIf(!fixturesAvailable)(
  'hashFile F-10 adversary (T036 — Phase 2 RED — requires 60MB fixtures)',
  () => {
    it('two 60-MB files with identical first 1-MB but differing last byte produce DIFFERENT hashes', async () => {
      const mod = await loadModule();
      expect(mod).not.toBeNull();
      expect.fail('Phase 3 (T060) required');
    });
  },
);

describe('hashFile F-10 adversary (T036 — Phase 2 RED — module-level)', () => {
  it('hasher module exports hashFile (sanity)', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.hashFile).toBe('function');
  });
});
