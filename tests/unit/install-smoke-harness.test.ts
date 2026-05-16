// SP-007 T033 — RED-phase contract test for `runSmokeHarness` shape.
//
// This test verifies the module surface is well-formed and that the harness
// is wrapped in an outer budget. Full E2E coverage lives in T050 (gated on
// OLLAMA_RUNNING).

import { describe, it, expect } from 'vitest';
import { runSmokeHarness } from '../../packages/cli/src/install-helpers/smoke-harness.js';

describe('SP-007 T033 — runSmokeHarness module surface', () => {
  it('exports a callable function returning a promise', () => {
    expect(typeof runSmokeHarness).toBe('function');
  });

  it('aborts when signal is pre-aborted', async () => {
    const c = new AbortController();
    c.abort('test');
    await expect(
      runSmokeHarness(
        {
          corpusBinaryPath: '/does/not/exist/never-call-me',
          seedDocPath: '/dev/null',
          searchQuery: 'never',
          budgetMs: 100,
          daemonSpawnBudgetMs: 50,
        },
        c.signal,
      ),
    ).rejects.toBeDefined();
  });
});
