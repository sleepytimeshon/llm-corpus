// T024 (SP-004 US1) — Classify circuit-breaker contract test.
//
// Verifies ClassifyCircuitBreaker:
//   - Increments consecutive_failures on recordFailure (ollama_unavailable).
//   - Resets to 0 on recordSuccess.
//   - shouldHalt() returns true once consecutive_failures >= threshold.
//   - Default threshold = 3 per Edge Case + Decision F.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-010 (classify.batch_halted),
//     Edge Case "Ollama service unavailable" circuit-breaker
//   - specs/004-classifier/research.md Decision F
//
// TDD: this test MUST FAIL before T037 (the implementation) lands.

import { describe, it, expect } from 'vitest';

describe('US1 — ClassifyCircuitBreaker (contract)', () => {
  it('ClassifyCircuitBreaker is exported', async () => {
    const mod = (await import(
      '../../packages/pipeline/src/classify-circuit-breaker.js'
    )) as Record<string, unknown>;
    expect(typeof mod.ClassifyCircuitBreaker).toBe('function');
  });

  it('starts with shouldHalt()=false and zero consecutive failures', async () => {
    const { ClassifyCircuitBreaker } = await import(
      '../../packages/pipeline/src/classify-circuit-breaker.js'
    );
    const cb = new ClassifyCircuitBreaker();
    expect(cb.shouldHalt()).toBe(false);
  });

  it('shouldHalt()=true once consecutive_failures reaches default threshold (3)', async () => {
    const { ClassifyCircuitBreaker } = await import(
      '../../packages/pipeline/src/classify-circuit-breaker.js'
    );
    const cb = new ClassifyCircuitBreaker();
    cb.recordFailure('ollama_unavailable');
    expect(cb.shouldHalt()).toBe(false);
    cb.recordFailure('ollama_unavailable');
    expect(cb.shouldHalt()).toBe(false);
    cb.recordFailure('ollama_unavailable');
    expect(cb.shouldHalt()).toBe(true);
  });

  it('recordSuccess resets the consecutive-failures counter', async () => {
    const { ClassifyCircuitBreaker } = await import(
      '../../packages/pipeline/src/classify-circuit-breaker.js'
    );
    const cb = new ClassifyCircuitBreaker();
    cb.recordFailure('ollama_unavailable');
    cb.recordFailure('ollama_unavailable');
    cb.recordSuccess();
    cb.recordFailure('ollama_unavailable');
    expect(cb.shouldHalt()).toBe(false);
  });

  it('custom threshold is respected', async () => {
    const { ClassifyCircuitBreaker } = await import(
      '../../packages/pipeline/src/classify-circuit-breaker.js'
    );
    const cb = new ClassifyCircuitBreaker({ threshold: 2 });
    cb.recordFailure('ollama_unavailable');
    expect(cb.shouldHalt()).toBe(false);
    cb.recordFailure('ollama_unavailable');
    expect(cb.shouldHalt()).toBe(true);
  });

  it('exposes lastErrorCode for telemetry use', async () => {
    const { ClassifyCircuitBreaker } = await import(
      '../../packages/pipeline/src/classify-circuit-breaker.js'
    );
    const cb = new ClassifyCircuitBreaker({ threshold: 3 });
    cb.recordFailure('ollama_unavailable');
    expect(cb.lastErrorCode).toBe('ollama_unavailable');
    expect(cb.consecutiveFailures).toBe(1);
  });
});
