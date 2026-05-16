// SP-007 T028 — RED-phase contract test for `withInstallBudget`.
//
// References:
//   - specs/007-install-first-run/tasks.md T028 / T042
//   - specs/007-install-first-run/spec.md FR-INSTALL-002, FR-INSTALL-017,
//     SC-007-029, SC-007-034
//   - Constitution Principles VII, XVI

import { describe, it, expect } from 'vitest';
import { withInstallBudget } from '../../packages/cli/src/install-helpers/install-budget.js';
import { InstallBudgetExceededError } from '@llm-corpus/contracts';

describe('SP-007 T028 — install-budget AbortController enforcement', () => {
  it('resolves within budget; clearTimeout fires; result returned', async () => {
    const outer = new AbortController();
    const result = await withInstallBudget(
      { budgetMs: 5_000, outerSignal: outer.signal },
      async () => 'ok',
    );
    expect(result).toBe('ok');
  });

  it('exceeds budget → InstallBudgetExceededError', async () => {
    const outer = new AbortController();
    await expect(
      withInstallBudget(
        { budgetMs: 50, outerSignal: outer.signal },
        async (sig) => {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 2_000);
            sig.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('aborted from inner fn'));
              },
              { once: true },
            );
          });
          return 'never';
        },
      ),
    ).rejects.toBeInstanceOf(InstallBudgetExceededError);
  });

  it('outer SIGINT propagates through innerSignal', async () => {
    const outer = new AbortController();
    setTimeout(() => outer.abort('sigint'), 25);
    await expect(
      withInstallBudget(
        { budgetMs: 5_000, outerSignal: outer.signal },
        async (sig) => {
          await new Promise<void>((resolve, reject) => {
            sig.addEventListener(
              'abort',
              () => reject(new Error('aborted via outer SIGINT')),
              { once: true },
            );
            setTimeout(resolve, 1_000);
          });
          return 'never';
        },
      ),
    ).rejects.toThrow(/aborted via outer SIGINT/);
  });

  it('does NOT use Promise.race(setTimeout) — source has no race', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../packages/cli/src/install-helpers/install-budget.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    // Scan code only (strip comments) before asserting on the pattern.
    const codeOnly = src
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      .join('\n');
    expect(codeOnly).not.toMatch(/Promise\.race\s*\(\s*\[[^\]]*setTimeout/);
  });
});
