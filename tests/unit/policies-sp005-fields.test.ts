// SP-005 T007 — Contract test for SP-005 policy-record fields.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-011, FR-RETRIEVAL-022
//   - specs/005-retrieval/research.md Decision L
//   - Constitution Principles VI, VII

import { describe, it, expect } from 'vitest';

describe('PREREQ-004 — SP-005 policy-record fields', () => {
  it('interactivePolicy carries SP-005 default fields', async () => {
    const { interactivePolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(interactivePolicy.perDocEmbedTimeoutMs).toBe(10_000);
    expect(interactivePolicy.perDocIndexTimeoutMs).toBe(5_000);
    expect(interactivePolicy.perDocEdgesBuildTimeoutMs).toBe(15_000);
    expect(interactivePolicy.embeddingHttpTimeoutMs).toBe(10_000);
    expect(interactivePolicy.retrieverSqlTimeoutMs).toBe(5_000);
    expect(interactivePolicy.searchTotalTimeoutMs).toBe(30_000);
    expect(interactivePolicy.topKPerRetriever).toBe(64);
  });

  it('batchPolicy carries SP-005 default fields', async () => {
    const { batchPolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    expect(batchPolicy.perDocEmbedTimeoutMs).toBe(30_000);
    expect(batchPolicy.perDocIndexTimeoutMs).toBe(10_000);
    expect(batchPolicy.perDocEdgesBuildTimeoutMs).toBe(60_000);
    expect(batchPolicy.embeddingHttpTimeoutMs).toBe(30_000);
    expect(batchPolicy.retrieverSqlTimeoutMs).toBe(10_000);
    expect(batchPolicy.searchTotalTimeoutMs).toBe(60_000);
    expect(batchPolicy.topKPerRetriever).toBe(64);
  });

  it('PolicySchema parses existing SP-003/SP-004 fields unchanged', async () => {
    const { PolicySchema } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    const r = PolicySchema.safeParse({
      name: 'interactive',
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
    });
    expect(r.success).toBe(true);
  });
});
