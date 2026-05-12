// T044 (SP-003) — RED integration test for drain orchestrator + policies.
//
// References:
//   - Constitution VI (One Pipeline, Two Policies)
//   - specs/003-ingest-pipeline/plan.md Decision H

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/drain-orchestrator.js';
const POLICIES_PATH = '../../packages/pipeline/src/policies.js';

async function loadModule(p: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('drain orchestrator + policies (T044 — Phase 2 RED)', () => {
  it('exports drain(input, policy, signal)', async () => {
    const mod = await loadModule(MODULE_PATH);
    expect(mod).not.toBeNull();
    expect(typeof mod?.drain).toBe('function');
  });

  it('ONE drain function shared by interactive and batch (Constitution VI)', async () => {
    expect.fail('Phase 3 (T072) required');
  });

  it('exports interactivePolicy and batchPolicy as Zod-validated Policy records', async () => {
    const pol = await loadModule(POLICIES_PATH);
    expect(pol).not.toBeNull();
    expect.fail('Phase 3 (T071) required — policy module not yet implemented');
  });

  it('drain dispatches behavior off policy fields', async () => {
    expect.fail('Phase 3 (T072) required');
  });
});
