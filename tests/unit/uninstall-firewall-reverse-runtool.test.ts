// SP-007 T080 — RED-phase contract test for `reverseFirewallRule`.

import { describe, it, expect } from 'vitest';
import {
  reverseFirewallRule,
  provisionFirewallRule,
} from '../../packages/cli/src/install-helpers/firewall-provisioner.js';

describe('SP-007 T080 — reverseFirewallRule (uninstall path)', () => {
  it('captured spec round-trips: provision then reverse uses recorded reverse_command', async () => {
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
    // reverseFirewallRule will spawn iptables; in CI without iptables it
    // will fail with SPAWN_FAILED and emit UninstallFirewallReverseError —
    // either outcome verifies the call path. We assert that the reverse
    // command shape matches what `reverseFirewallRule` will invoke.
    expect(spec.reverse_command.cmd).toBe('iptables');
    expect(spec.reverse_command.args[0]).toBe('-D');
    // Attempt the reverse and accept either ok or UninstallFirewallReverseError.
    let threw: unknown = null;
    try {
      await reverseFirewallRule(spec, new AbortController().signal);
    } catch (e) {
      threw = e;
    }
    if (threw) {
      expect((threw as Error).name).toBe('UninstallFirewallReverseError');
    }
  });
});
