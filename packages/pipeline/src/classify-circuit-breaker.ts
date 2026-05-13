// SP-004 US1 (T037) — Classify circuit-breaker.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-010 (classify.batch_halted),
//     Edge Case "Ollama service unavailable" circuit-breaker semantics
//   - specs/004-classifier/research.md Decision F
//
// Scoped to a batch lifetime. The classify-stage orchestrator constructs
// one breaker per batch; each post-persist invocation (daemon hook) and
// each `corpus reenrich` batch get a fresh breaker.
//
// On `consecutive_failures === threshold`, shouldHalt() returns true and
// the orchestrator emits `classify.batch_halted` + skips remaining docs.
// Resetting on success means a transient Ollama hiccup followed by
// recovery does NOT trip the breaker.

import type { Sp004ClassifyErrorCodeType } from '@llm-corpus/contracts';

export interface ClassifyCircuitBreakerOptions {
  /** Failures-in-a-row before the breaker trips. Default 3 (Decision F). */
  threshold?: number;
}

export class ClassifyCircuitBreaker {
  readonly threshold: number;
  private failures = 0;
  private last: Sp004ClassifyErrorCodeType | null = null;

  constructor(options: ClassifyCircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 3;
  }

  /** Returns true once consecutive_failures >= threshold. */
  shouldHalt(): boolean {
    return this.failures >= this.threshold;
  }

  /** Failures-in-a-row counter (for telemetry). */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /** The most-recent error_code observed (for telemetry). null until first failure. */
  get lastErrorCode(): Sp004ClassifyErrorCodeType | null {
    return this.last;
  }

  recordFailure(errorCode: Sp004ClassifyErrorCodeType): void {
    this.failures += 1;
    this.last = errorCode;
  }

  recordSuccess(): void {
    this.failures = 0;
  }
}
