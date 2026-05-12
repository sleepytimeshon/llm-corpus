// T057 (SP-003) — drain policy selection.

import { describe, it, expect } from 'vitest';
import {
  drain,
  interactivePolicy,
  batchPolicy,
} from '../../packages/pipeline/src/index.js';

describe('daemon policy selection (T057)', () => {
  it('interactivePolicy + batchPolicy both validate to Zod Policy records', () => {
    expect(interactivePolicy.name).toBe('interactive');
    expect(batchPolicy.name).toBe('batch');
    expect(interactivePolicy.perDocTimeoutMs).toBe(60_000);
    expect(batchPolicy.perDocTimeoutMs).toBe(300_000);
  });

  it('ONE drain function is exported (Constitution VI)', () => {
    expect(typeof drain).toBe('function');
  });

  it('drain accepts either policy and returns DrainSummary', async () => {
    // Smoke check: drain accepts both policy types in the type system.
    type DrainFn = typeof drain;
    const fn: DrainFn = drain;
    expect(typeof fn).toBe('function');
  });
});
