// SP-007 T078 — RED-phase contract test for sudo-elevation path.

import { describe, it, expect } from 'vitest';
import { provisionFirewallRule } from '../../packages/cli/src/install-helpers/firewall-provisioner.js';

describe('SP-007 T078 — firewall sudo elevation', () => {
  it('non-root user → sudo cmd prepended; reverse mirror also sudo-prefixed', async () => {
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
    expect(spec.reverse_command.cmd).toBe('sudo');
  });

  it('root user → no sudo prepended', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 0,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    expect(spec.provision_command.cmd).toBe('iptables');
    expect(spec.reverse_command.cmd).toBe('iptables');
  });
});
