// SP-007 T055 — Firewall reverse via captured reverse_command (uses Engineer #2's
// `reverseFirewallRule` helper in firewall-provisioner.ts).
//
// References:
//   - specs/007-install-first-run/tasks.md T055
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, SC-007-015
//   - Constitution XII (runTool — no shell strings)

import { describe, it, expect } from 'vitest';
import { reverseFirewallRule } from '../../packages/cli/src/install-helpers/firewall-provisioner.js';
import type { FirewallRuleSpec } from '@llm-corpus/contracts';

describe('SP-007 T055 — uninstall firewall reverse', () => {
  it('invokes the recorded reverse_command via runTool (`true` is always-succeed)', async () => {
    const spec: FirewallRuleSpec = {
      os: 'linux',
      corpus_uid: 1000,
      anchor_or_chain: 'OUTPUT',
      rule_text: 'placeholder',
      provision_command: { cmd: 'true', args: [] },
      reverse_command: { cmd: 'true', args: [] },
    };
    await expect(
      reverseFirewallRule(spec, new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('throws UninstallFirewallReverseError when reverse_command exits non-zero', async () => {
    const spec: FirewallRuleSpec = {
      os: 'linux',
      corpus_uid: 1000,
      anchor_or_chain: 'OUTPUT',
      rule_text: 'placeholder',
      provision_command: { cmd: 'false', args: [] },
      reverse_command: { cmd: 'false', args: [] }, // always exits 1
    };
    await expect(
      reverseFirewallRule(spec, new AbortController().signal),
    ).rejects.toMatchObject({ name: 'UninstallFirewallReverseError' });
  });
});
