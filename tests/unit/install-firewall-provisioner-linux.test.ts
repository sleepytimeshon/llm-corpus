// SP-007 T077 — RED-phase contract test for `provisionFirewallRule` (Linux).

import { describe, it, expect } from 'vitest';
import { provisionFirewallRule } from '../../packages/cli/src/install-helpers/firewall-provisioner.js';

describe('SP-007 T077 — provisionFirewallRule Linux', () => {
  it('constructs iptables provision args with UID-owner + loopback exception', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 1000,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    expect(spec.os).toBe('linux');
    expect(spec.corpus_uid).toBe(1000);
    expect(spec.anchor_or_chain).toBe('OUTPUT');
    const provArgs = spec.provision_command.args.join(' ');
    expect(provArgs).toMatch(/-A OUTPUT/);
    expect(provArgs).toMatch(/--uid-owner 1000/);
    expect(provArgs).toMatch(/-d 127\.0\.0\.1\/8/);
    expect(provArgs).toMatch(/--comment llm-corpus/);
    expect(spec.reverse_command.args.join(' ')).toMatch(/-D OUTPUT/);
  });

  it('non-root path prepends sudo', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 1000,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: false,
      },
      new AbortController().signal,
    );
    expect(spec.provision_command.cmd).toBe('sudo');
    expect(spec.provision_command.args[0]).toBe('iptables');
  });

  it('idempotent: forceExistsResult=true skips provisioning, returns spec', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 1000,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    expect(spec.os).toBe('linux');
  });
});
