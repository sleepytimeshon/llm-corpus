// T044 — Integration test: child-process OS-firewall block (NFR-002b, SC-004).
//
// =============================================================================
// ROOT-GATED TEST — requires root (CAP_NET_ADMIN) on Linux to install/remove
// the test iptables rule.
// =============================================================================
//
// What this test does:
//   1. Installs an OS-level egress block (iptables OUTPUT rule) scoped to
//      the running user's UID. Rule shape per ADR-001 §Decision.2:
//          iptables -A OUTPUT -m owner --uid-owner <uid> \
//                   -d 8.8.8.8 -p udp --dport 53 -j REJECT
//      The narrow rule (UID + dest + port) ensures we don't disrupt the
//      developer's machine networking outside the test scope.
//   2. Spawns a child process via `runTool` that attempts an outbound DNS
//      lookup (UDP/53) to 8.8.8.8.
//   3. Asserts the connection is rejected at the OS layer.
//   4. Cleanup (afterAll/finally): removes the iptables rule, no matter
//      what happened during the test (try/finally).
//
// Why root is needed:
//   `iptables -A OUTPUT` requires CAP_NET_ADMIN, which is effectively root
//   on default Fedora.
//
// Test invocation (root):
//
//       sudo LLM_CORPUS_ROOT_TESTS=1 npm run test:integration:root \
//         -- tests/integration/child-process-firewall.test.ts
//
// Default invocation (`npm run test:integration`) skips this test cleanly.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '../../packages/contracts/src/run-tool.js';
import { isOk, isErr } from '../../packages/contracts/src/result.js';

const ROOT_GATE = process.env.LLM_CORPUS_ROOT_TESTS === '1';

const TEST_DEST_HOST = '8.8.8.8';
const TEST_DEST_PORT = '53';

const uid = process.getuid?.();

async function installRule(): Promise<void> {
  if (uid === undefined) throw new Error('process.getuid() unavailable');
  const result = await runTool(
    'iptables',
    [
      '-A', 'OUTPUT',
      '-m', 'owner', '--uid-owner', String(uid),
      '-d', TEST_DEST_HOST,
      '-p', 'udp', '--dport', TEST_DEST_PORT,
      '-j', 'REJECT',
    ],
    {},
  );
  if (isErr(result)) {
    throw new Error(`iptables -A failed: ${result.error.stderr}`);
  }
}

async function removeRule(): Promise<void> {
  if (uid === undefined) return;
  // -D mirrors -A; if the rule was never installed, this is a no-op error
  // (acceptable in cleanup).
  await runTool(
    'iptables',
    [
      '-D', 'OUTPUT',
      '-m', 'owner', '--uid-owner', String(uid),
      '-d', TEST_DEST_HOST,
      '-p', 'udp', '--dport', TEST_DEST_PORT,
      '-j', 'REJECT',
    ],
    {},
  );
}

describe.skipIf(!ROOT_GATE)(
  'Child-process OS-firewall block (T044 / NFR-002b / SC-004)',
  () => {
    let installed = false;

    beforeAll(async () => {
      await installRule();
      installed = true;
    });

    afterAll(async () => {
      if (installed) {
        await removeRule();
      }
    });

    it('child-process DNS query to 8.8.8.8:53 is rejected by OS firewall', async () => {
      // dig is the smallest-footprint tool that performs an explicit DNS query
      // to a chosen server. If unavailable, fall back to nslookup or host.
      // We invoke via runTool (Constitution XII — no shell strings).
      const result = await runTool(
        'dig',
        ['+time=2', '+tries=1', `@${TEST_DEST_HOST}`, 'example.com'],
        { timeoutMs: 5000 },
      );
      // The rule REJECTs with ICMP. dig should fail with "no servers could be
      // reached" or similar non-zero exit.
      expect(isErr(result)).toBe(true);
      if (isOk(result)) {
        // Should not happen — but if dig reports success, ensure the resolver
        // didn't actually resolve through 8.8.8.8 (some systems silently
        // fallback to local resolver).
        expect(result.value.stdout).not.toMatch(/SERVER:\s*8\.8\.8\.8/);
      }
    }, 15_000);
  },
);
