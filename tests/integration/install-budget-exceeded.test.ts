// SP-007 T049 — Integration: install budget exceeded → rollback + non-zero exit.
//
// Drives the AbortController budget enforcement by invoking the budget
// helper directly with a 50ms ceiling against a 1000ms task.

import { describe, it, expect } from 'vitest';
import { withInstallBudget } from '../../packages/cli/src/install-helpers/install-budget.js';
import { InstallBudgetExceededError } from '@llm-corpus/contracts';

describe('SP-007 T049 — install budget exceeded triggers abort', () => {
  it('synthetic 1000ms task vs 50ms budget → InstallBudgetExceededError', async () => {
    const outer = new AbortController();
    await expect(
      withInstallBudget(
        { budgetMs: 50, outerSignal: outer.signal },
        async (sig) =>
          new Promise<string>((resolve, reject) => {
            const t = setTimeout(resolve, 1_000);
            sig.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('aborted'));
              },
              { once: true },
            );
          }),
      ),
    ).rejects.toBeInstanceOf(InstallBudgetExceededError);
  });

  it('error carries elapsed_ms + budget_ms diagnostic fields', async () => {
    const outer = new AbortController();
    try {
      await withInstallBudget(
        { budgetMs: 30, outerSignal: outer.signal },
        async (sig) =>
          new Promise<string>((resolve, reject) => {
            const t = setTimeout(resolve, 500);
            sig.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('aborted'));
              },
              { once: true },
            );
          }),
      );
    } catch (cause) {
      const e = cause as InstallBudgetExceededError;
      expect(e).toBeInstanceOf(InstallBudgetExceededError);
      expect(e.data.budget_ms).toBe(30);
      expect(e.data.elapsed_ms).toBeGreaterThanOrEqual(30);
    }
  });
});
