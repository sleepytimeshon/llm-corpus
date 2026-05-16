// SP-007 T004 — RED-phase contract test for the 10 new SP-007 typed errors.
//
// References:
//   - specs/007-install-first-run/tasks.md T004 / T014
//   - specs/007-install-first-run/spec.md FR-INSTALL-019
//   - Constitution Principle XI (Library/CLI Boundary)

import { describe, it, expect } from 'vitest';

describe('SP-007 PREREQ-003 — typed errors (T004 / T014)', () => {
  it('InstallPreflightError is throwable with structured data + stable name', async () => {
    const { InstallPreflightError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new InstallPreflightError({
      unmet_requirement: 'node_version',
      message: 'node 16 detected',
    });
    expect(e instanceof InstallPreflightError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('InstallPreflightError');
    expect(() => {
      throw e;
    }).toThrow(InstallPreflightError);
  });

  it('InstallFirewallProvisionError captures error_code', async () => {
    const { InstallFirewallProvisionError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new InstallFirewallProvisionError({
      error_code: 'firewall_binary_missing',
      message: 'iptables not on PATH',
    });
    expect(e.name).toBe('InstallFirewallProvisionError');
    expect((e as unknown as { data: { error_code: string } }).data.error_code).toBe(
      'firewall_binary_missing',
    );
  });

  it('InstallMCPClientConfigError carries path + message', async () => {
    const { InstallMCPClientConfigError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new InstallMCPClientConfigError({
      path: '/home/user/.claude.json',
      message: 'malformed JSON',
    });
    expect(e.name).toBe('InstallMCPClientConfigError');
  });

  it('InstallReceiptWriteError is throwable', async () => {
    const { InstallReceiptWriteError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new InstallReceiptWriteError({ message: 'fs.write failed' });
    expect(e.name).toBe('InstallReceiptWriteError');
  });

  it('InstallBudgetExceededError carries elapsed_ms + budget_ms', async () => {
    const { InstallBudgetExceededError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new InstallBudgetExceededError({
      elapsed_ms: 95_000,
      budget_ms: 90_000,
    });
    expect(e.name).toBe('InstallBudgetExceededError');
    expect((e as unknown as { data: { budget_ms: number } }).data.budget_ms).toBe(
      90_000,
    );
  });

  it('UninstallReceiptMissingError carries receipt_path', async () => {
    const { UninstallReceiptMissingError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new UninstallReceiptMissingError({
      receipt_path: '/x/install-receipt.json',
      message: 'ENOENT',
    });
    expect(e.name).toBe('UninstallReceiptMissingError');
  });

  it('UninstallFirewallReverseError carries reverse_command snapshot', async () => {
    const { UninstallFirewallReverseError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new UninstallFirewallReverseError({
      reverse_command: { cmd: 'iptables', args: ['-D', 'OUTPUT'] },
      message: 'exit 1',
    });
    expect(e.name).toBe('UninstallFirewallReverseError');
  });

  it('TaxonomyPromoteLockContentionError carries lock_path', async () => {
    const { TaxonomyPromoteLockContentionError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new TaxonomyPromoteLockContentionError({
      lock_path: '/x/drain.lock',
    });
    expect(e.name).toBe('TaxonomyPromoteLockContentionError');
  });

  it('TaxonomyPromoteMissingTermError carries axis + term', async () => {
    const { TaxonomyPromoteMissingTermError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new TaxonomyPromoteMissingTermError({
      axis: 'domain',
      term: 'does_not_exist',
    });
    expect(e.name).toBe('TaxonomyPromoteMissingTermError');
    expect(
      (e as unknown as { data: { axis: string; term: string } }).data.axis,
    ).toBe('domain');
  });

  it('TaxonomyPromoteArgsError surfaces the Zod issues', async () => {
    const { TaxonomyPromoteArgsError } = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: Record<string, unknown>) => Error>;
    const e = new TaxonomyPromoteArgsError({
      issues: ['axis without --term'],
      message: 'invalid args',
    });
    expect(e.name).toBe('TaxonomyPromoteArgsError');
  });

  it('all 10 SP-007 errors have distinct names', async () => {
    const mod = (await import('../../packages/contracts/src/errors.js')) as Record<
      string,
      new (d: Record<string, unknown>) => Error
    >;
    const namesArr = [
      new mod.InstallPreflightError({ unmet_requirement: 'x', message: 'x' }).name,
      new mod.InstallFirewallProvisionError({ error_code: 'x', message: 'x' })
        .name,
      new mod.InstallMCPClientConfigError({ path: '/x', message: 'x' }).name,
      new mod.InstallReceiptWriteError({ message: 'x' }).name,
      new mod.InstallBudgetExceededError({ elapsed_ms: 1, budget_ms: 1 }).name,
      new mod.UninstallReceiptMissingError({ receipt_path: '/x', message: 'x' })
        .name,
      new mod.UninstallFirewallReverseError({
        reverse_command: { cmd: 'x', args: [] },
        message: 'x',
      }).name,
      new mod.TaxonomyPromoteLockContentionError({ lock_path: '/x' }).name,
      new mod.TaxonomyPromoteMissingTermError({ axis: 'tag', term: 'x' }).name,
      new mod.TaxonomyPromoteArgsError({ issues: ['x'], message: 'x' }).name,
    ];
    expect(new Set(namesArr).size).toBe(10);
  });
});
