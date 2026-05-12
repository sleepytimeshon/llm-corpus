// T057 (SP-003) — RED integration test: drain policy selection.
//
// References:
//   - Constitution VI (One Pipeline, Two Policies)

import { describe, it, expect } from 'vitest';

const POLICIES_PATH = '../../packages/pipeline/src/policies.js';
const ORCH_PATH = '../../packages/pipeline/src/drain-orchestrator.js';

async function loadModule(p: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('daemon policy selection (T057 — Phase 2 RED)', () => {
  it('corpus drain CLI one-shot uses interactivePolicy', async () => {
    const pol = await loadModule(POLICIES_PATH);
    expect(pol).not.toBeNull();
    expect.fail('Phase 3 (T071/T074/T075) required');
  });

  it('corpus daemon start uses batchPolicy', async () => {
    expect.fail('Phase 3 (T071/T073/T074) required');
  });

  it('ONE drain orchestrator function is invoked by both', async () => {
    const orch = await loadModule(ORCH_PATH);
    expect(orch).not.toBeNull();
    expect.fail('Phase 3 (T072) required');
  });
});
