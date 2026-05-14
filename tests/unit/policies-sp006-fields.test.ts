// SP-006 T005 — Contract test for the SP-006-extended PolicySchema fields.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-016, FR-HARDEN-020
//   - specs/006-hardening/research.md Decision M
//   - Constitution VI (One Pipeline, Two Policies), VII (Bounded Async)

import { describe, it, expect } from 'vitest';
import {
  PolicySchema,
  interactivePolicy,
  batchPolicy,
} from '../../packages/pipeline/src/policies.js';

describe('PREREQ-004 — SP-006 PolicySchema fields', () => {
  it('interactivePolicy carries all 7 SP-006 fields with defaults', () => {
    expect(interactivePolicy.recoveryScanTimeoutMs).toBe(30000);
    expect(interactivePolicy.tierTotalBudgetMs).toBe(600);
    expect(interactivePolicy.tierBm25TimeoutMs).toBe(5);
    expect(interactivePolicy.tierCatalogGrepTimeoutMs).toBe(50);
    expect(interactivePolicy.tierFsGrepTimeoutMs).toBe(500);
    expect(interactivePolicy.failuresResourceTimeoutMs).toBe(5000);
    expect(interactivePolicy.minResultsForFallthrough).toBe(3);
  });

  it('batchPolicy carries all 7 SP-006 fields with same defaults (Decision M)', () => {
    expect(batchPolicy.recoveryScanTimeoutMs).toBe(30000);
    expect(batchPolicy.tierTotalBudgetMs).toBe(600);
    expect(batchPolicy.tierBm25TimeoutMs).toBe(5);
    expect(batchPolicy.tierCatalogGrepTimeoutMs).toBe(50);
    expect(batchPolicy.tierFsGrepTimeoutMs).toBe(500);
    expect(batchPolicy.failuresResourceTimeoutMs).toBe(5000);
    expect(batchPolicy.minResultsForFallthrough).toBe(3);
  });

  it('PolicySchema accepts the SP-006 fields when explicitly provided', () => {
    const r = PolicySchema.safeParse({
      name: 'interactive',
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
      // SP-006:
      recoveryScanTimeoutMs: 30000,
      tierTotalBudgetMs: 600,
      tierBm25TimeoutMs: 5,
      tierCatalogGrepTimeoutMs: 50,
      tierFsGrepTimeoutMs: 500,
      failuresResourceTimeoutMs: 5000,
      minResultsForFallthrough: 3,
    });
    expect(r.success).toBe(true);
  });

  it('PolicySchema applies SP-006 defaults when SP-006 fields are omitted (backward compat)', () => {
    // Mirrors the SP-005 backward-compat pattern: existing SP-003/SP-004 Policy
    // literals continue to parse and PolicySchema.parse() fills in defaults.
    const parsed = PolicySchema.parse({
      name: 'interactive',
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
    });
    expect(parsed.recoveryScanTimeoutMs).toBe(30000);
    expect(parsed.tierTotalBudgetMs).toBe(600);
    expect(parsed.minResultsForFallthrough).toBe(3);
  });

  it('PolicySchema rejects negative tier budgets', () => {
    const r = PolicySchema.safeParse({
      name: 'interactive',
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
      tierTotalBudgetMs: -1,
    });
    expect(r.success).toBe(false);
  });

  it('PolicySchema rejects negative minResultsForFallthrough', () => {
    const r = PolicySchema.safeParse({
      name: 'interactive',
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
      minResultsForFallthrough: -1,
    });
    expect(r.success).toBe(false);
  });

  it('SP-003 / SP-004 / SP-005 fields parse unchanged on interactivePolicy', () => {
    expect(interactivePolicy.perDocTimeoutMs).toBe(60_000);
    expect(interactivePolicy.perDocClassifyTimeoutMs).toBe(60_000);
    expect(interactivePolicy.classifyRetryMaxAttempts).toBe(1);
    expect(interactivePolicy.consecutiveOllamaFailureBatchHaltThreshold).toBe(3);
    expect(interactivePolicy.perDocEmbedTimeoutMs).toBe(10_000);
  });
});
