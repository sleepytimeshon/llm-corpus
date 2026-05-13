// T005 (SP-004 PREREQ-004) — Contract test for SP-004 policy-record fields.
//
// Verifies the extended PolicySchema in packages/pipeline/src/policies.ts
// carries the new SP-004 fields:
//   - perDocClassifyTimeoutMs: number
//   - classifyRetryMaxAttempts: number
//   - consecutiveOllamaFailureBatchHaltThreshold: number
//
// With defaults per plan.md PREREQ-004:
//   - interactive: { 60_000, 1, 3 }
//   - batch:       { 300_000, 1, 3 }
//
// Spec references:
//   - specs/004-classifier/plan.md PREREQ-004
//   - specs/004-classifier/spec.md FR-CLASSIFY-009
//   - specs/004-classifier/research.md Decision D, Decision F
//   - Constitution Principle VI (One Pipeline, Two Policies)
//
// TDD: this test MUST FAIL before T011 (the implementation) lands.

import { describe, it, expect } from 'vitest';

describe('PREREQ-004 — SP-004 policy-record fields', () => {
  it('PolicySchema parses the new SP-004 fields without error', async () => {
    const { PolicySchema } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    const extended = {
      name: 'interactive',
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
    };
    const result = PolicySchema.safeParse(extended);
    expect(result.success).toBe(true);
  });

  it('interactivePolicy default carries perDocClassifyTimeoutMs=60_000', async () => {
    const { interactivePolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(
      (interactivePolicy as unknown as Record<string, number>)[
        'perDocClassifyTimeoutMs'
      ],
    ).toBe(60_000);
  });

  it('interactivePolicy default carries classifyRetryMaxAttempts=1', async () => {
    const { interactivePolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(
      (interactivePolicy as unknown as Record<string, number>)[
        'classifyRetryMaxAttempts'
      ],
    ).toBe(1);
  });

  it('interactivePolicy default carries consecutiveOllamaFailureBatchHaltThreshold=3', async () => {
    const { interactivePolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(
      (interactivePolicy as unknown as Record<string, number>)[
        'consecutiveOllamaFailureBatchHaltThreshold'
      ],
    ).toBe(3);
  });

  it('batchPolicy default carries perDocClassifyTimeoutMs=300_000', async () => {
    const { batchPolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(
      (batchPolicy as unknown as Record<string, number>)[
        'perDocClassifyTimeoutMs'
      ],
    ).toBe(300_000);
  });

  it('batchPolicy default carries classifyRetryMaxAttempts=1', async () => {
    const { batchPolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(
      (batchPolicy as unknown as Record<string, number>)[
        'classifyRetryMaxAttempts'
      ],
    ).toBe(1);
  });

  it('batchPolicy default carries consecutiveOllamaFailureBatchHaltThreshold=3', async () => {
    const { batchPolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(
      (batchPolicy as unknown as Record<string, number>)[
        'consecutiveOllamaFailureBatchHaltThreshold'
      ],
    ).toBe(3);
  });

  it('existing SP-003 perDocTimeoutMs / perStageTimeoutMs fields remain', async () => {
    const { interactivePolicy, batchPolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(interactivePolicy.perDocTimeoutMs).toBe(60_000);
    expect(interactivePolicy.perStageTimeoutMs).toBe(30_000);
    expect(batchPolicy.perDocTimeoutMs).toBe(300_000);
    expect(batchPolicy.perStageTimeoutMs).toBe(120_000);
  });
});
