// SP-007 T005 — RED-phase contract test for the 8 new policy fields.
//
// References:
//   - specs/007-install-first-run/tasks.md T005 / T015
//   - specs/007-install-first-run/spec.md FR-INSTALL-002, FR-INSTALL-013
//   - Constitution Principles VI, VII

import { describe, it, expect } from 'vitest';

describe('SP-007 PREREQ-004 — install / uninstall policy fields (T005 / T015)', () => {
  it('PolicySchema accepts the 8 SP-007 fields with documented defaults', async () => {
    const { PolicySchema } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    const candidate = {
      name: 'interactive' as const,
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
      installBudgetMs: 90_000,
      smokeBudgetMs: 30_000,
      uninstallDaemonStopBudgetMs: 2_000,
      firewallProvisionBudgetMs: 10_000,
      mcpClientConfigMutateBudgetMs: 1_000,
      seedInsertBudgetMs: 1_000,
      xdgBringupBudgetMs: 2_000,
      sqliteSinglefileBudgetMs: 10_000,
    };
    const parsed = PolicySchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.installBudgetMs).toBe(90_000);
      expect(parsed.data.smokeBudgetMs).toBe(30_000);
      expect(parsed.data.uninstallDaemonStopBudgetMs).toBe(2_000);
      expect(parsed.data.firewallProvisionBudgetMs).toBe(10_000);
      expect(parsed.data.mcpClientConfigMutateBudgetMs).toBe(1_000);
      expect(parsed.data.seedInsertBudgetMs).toBe(1_000);
      expect(parsed.data.xdgBringupBudgetMs).toBe(2_000);
      expect(parsed.data.sqliteSinglefileBudgetMs).toBe(10_000);
    }
  });

  it('PolicySchema defaults the 8 SP-007 fields when absent (back-compat with SP-003/4/5/6 literals)', async () => {
    const { PolicySchema } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    const minimal = {
      name: 'interactive' as const,
      perDocTimeoutMs: 60_000,
      perStageTimeoutMs: 30_000,
      retryOnRetriableError: false,
      emitProgress: true,
      perDocClassifyTimeoutMs: 60_000,
      classifyRetryMaxAttempts: 1,
      consecutiveOllamaFailureBatchHaltThreshold: 3,
    };
    const parsed = PolicySchema.parse(minimal);
    expect(parsed.installBudgetMs).toBe(90_000);
    expect(parsed.smokeBudgetMs).toBe(30_000);
    expect(parsed.uninstallDaemonStopBudgetMs).toBe(2_000);
  });

  it('installPolicy + uninstallPolicy literals are exported with SP-007 defaults', async () => {
    const mod = (await import('../../packages/pipeline/src/policies.js')) as Record<
      string,
      unknown
    >;
    expect(mod.installPolicy).toBeDefined();
    expect(mod.uninstallPolicy).toBeDefined();
    const install = mod.installPolicy as { installBudgetMs: number };
    expect(install.installBudgetMs).toBe(90_000);
    const uninstall = mod.uninstallPolicy as {
      uninstallDaemonStopBudgetMs: number;
    };
    expect(uninstall.uninstallDaemonStopBudgetMs).toBe(2_000);
  });

  it('interactive + batch policies still parse unchanged after SP-007 additions', async () => {
    const { interactivePolicy, batchPolicy } = await import(
      '../../packages/pipeline/src/policies.js'
    );
    // Pre-existing fields preserved
    expect(interactivePolicy.perDocTimeoutMs).toBe(60_000);
    expect(batchPolicy.perDocTimeoutMs).toBe(300_000);
    // SP-007 fields filled in via defaults
    expect(interactivePolicy.installBudgetMs).toBe(90_000);
    expect(batchPolicy.installBudgetMs).toBe(90_000);
  });
});
