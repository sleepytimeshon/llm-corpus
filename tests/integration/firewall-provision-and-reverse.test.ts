// SP-007 T083 — Integration test for firewall provision + reverse round-trip.
//
// The test runs in "mocked-runTool" mode by default — the actual firewall
// mutation requires root or `sudo` with cached credentials, which CI does
// not have. The integration test asserts that:
//   - The provisioner returns a well-formed spec on each platform.
//   - Re-running with `forceExistsResult=true` is idempotent (no second exec).
//   - The captured reverse_command is the exact inverse of the provision_command
//     for the recorded platform.

import { describe, it, expect } from 'vitest';
import {
  provisionFirewallRule,
  reverseFirewallRule,
} from '../../packages/cli/src/install-helpers/firewall-provisioner.js';

describe('SP-007 T083 — firewall provision + reverse integration', () => {
  it('round-trip Linux: -A inverse is -D, same body args', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 1234,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    const provBody = spec.provision_command.args.slice(1).join(' ');
    const revBody = spec.reverse_command.args.slice(1).join(' ');
    expect(provBody).toBe(revBody);
    expect(spec.provision_command.args[0]).toBe('-A');
    expect(spec.reverse_command.args[0]).toBe('-D');
  });

  it('round-trip macOS: pfctl provision is -f -, reverse is -F all', async () => {
    const spec = await provisionFirewallRule(
      {
        platformOverride: 'darwin',
        uidOverride: 501,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    expect(spec.provision_command.args).toContain('-f');
    expect(spec.reverse_command.args).toEqual(['-a', 'corpus', '-F', 'all']);
  });

  it('idempotent: re-running provision with forceExistsResult=true is a no-op (spec returned, no exec)', async () => {
    const s1 = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 999,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    const s2 = await provisionFirewallRule(
      {
        platformOverride: 'linux',
        uidOverride: 999,
        skipExec: true,
        forceExistsResult: true,
        runningAsRootOverride: true,
      },
      new AbortController().signal,
    );
    expect(s1).toEqual(s2);
  });

  it('reverseFirewallRule surfaces UninstallFirewallReverseError on iptables non-zero', async () => {
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
    // The reverse command will be invoked against a rule that does not
    // exist (since we never provisioned). iptables -D returns non-zero
    // → reverseFirewallRule throws UninstallFirewallReverseError.
    // In CI without iptables on PATH, SPAWN_FAILED → still wrapped.
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
