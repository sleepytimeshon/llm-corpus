// SP-007 T076 — RED-phase contract test for `provisionFirewallRule` (macOS).

import { describe, it, expect } from 'vitest';
import { provisionFirewallRule } from '../../packages/cli/src/install-helpers/firewall-provisioner.js';

describe('SP-007 T076 — provisionFirewallRule macOS', () => {
  it('constructs pfctl provision/reverse arg array; UID numeric', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'darwin',
        uidOverride: 501,
        skipExec: true,
        forceExistsResult: true, // skip the actual binary call
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    expect(spec.os).toBe('macos');
    expect(spec.corpus_uid).toBe(501);
    expect(spec.anchor_or_chain).toBe('corpus');
    expect(spec.provision_command.cmd).toBe('pfctl');
    expect(spec.provision_command.args).toContain('-a');
    expect(spec.provision_command.args).toContain('corpus');
    expect(spec.reverse_command.cmd).toBe('pfctl');
    expect(spec.reverse_command.args).toEqual(['-a', 'corpus', '-F', 'all']);
    expect(spec.rule_text).toMatch(/user 501/);
    // Args are arrays — zero string-formed shell commands (Constitution XII)
    expect(Array.isArray(spec.provision_command.args)).toBe(true);
    expect(Array.isArray(spec.reverse_command.args)).toBe(true);
  });

  it('non-root path prepends sudo to provision + reverse commands', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'darwin',
        uidOverride: 501,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: false,
      },
      new AbortController().signal,
    );
    expect(spec.provision_command.cmd).toBe('sudo');
    expect(spec.provision_command.args[0]).toBe('pfctl');
    expect(spec.reverse_command.cmd).toBe('sudo');
  });
});
