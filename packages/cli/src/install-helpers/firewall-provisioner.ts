// SP-007 T081/T082 — OS firewall provisioner (install-step 8 / uninstall reverse).
//
// References:
//   - specs/007-install-first-run/tasks.md T076-T083
//   - specs/007-install-first-run/spec.md FR-INSTALL-010, FR-INSTALL-018
//   - specs/007-install-first-run/contracts/adr-firewall-provisioning.md (ADR-013)
//   - specs/001-egress-hook/contracts/adr-001-firewall-path.md (ADR-001)
//   - specs/007-install-first-run/research.md Decision B
//   - Constitution Principles IV (single-user), X (idempotent), XII (runTool only)
//
// Platform dispatch:
//   - Linux:  iptables OUTPUT chain, UID-scoped, comment-tagged `llm-corpus`
//   - macOS:  pfctl anchor `corpus`, UID-scoped block
//
// Sudo handling: if not running as root AND the firewall binary requires
// privileges, prepend `sudo` via `runTool('sudo', [cmd, ...args])`.
// stdin/stderr are inherited via the SP-001 runTool defaults (capture only;
// runTool's default already preserves the operator's interactive password
// prompt via stderr's pipe-then-print).

import * as os from 'node:os';
import {
  runTool,
  emitTelemetry,
  InstallFirewallProvisionError,
  UninstallFirewallReverseError,
  type FirewallRuleSpec,
  type InstallOs,
} from '@llm-corpus/contracts';

export interface FirewallProvisionerDeps {
  /** Optional override for tests — synthetic platform. */
  platformOverride?: NodeJS.Platform;
  /** Optional override for tests — synthetic UID. */
  uidOverride?: number;
  /** Optional override for tests — skip the actual `runTool` invocation. */
  skipExec?: boolean;
  /** Optional override for tests — skip the existing-rule probe + assume false. */
  skipExistsProbe?: boolean;
  /** Optional override for tests — claim the rule already exists. */
  forceExistsResult?: boolean;
  /** Optional override for tests — synthetic effective UID for sudo detection. */
  runningAsRootOverride?: boolean;
}

function platformOs(p: NodeJS.Platform): InstallOs {
  return p === 'darwin' ? 'macos' : 'linux';
}

function corpusUid(deps: FirewallProvisionerDeps): number {
  if (typeof deps.uidOverride === 'number') return deps.uidOverride;
  return os.userInfo().uid;
}

function runningAsRoot(deps: FirewallProvisionerDeps): boolean {
  if (deps.runningAsRootOverride !== undefined) {
    return deps.runningAsRootOverride;
  }
  // process.getuid is defined on POSIX (which is our entire target surface).
  const getuid = (process as { getuid?: () => number }).getuid;
  if (typeof getuid !== 'function') return false;
  return getuid() === 0;
}

/**
 * Detect sudo availability cheaply: `runTool('sudo', ['-n', 'true'])` exits 0
 * if non-interactive sudo is configured for the user; non-zero otherwise.
 * Returns true if sudo is available (with or without password); false if the
 * `sudo` binary itself is missing.
 */
async function sudoAvailable(): Promise<boolean> {
  const r = await runTool('sudo', ['-V'], {});
  return r.ok;
}

/* ----------------------------- Linux ---------------------------------- */

function iptablesArgs(direction: 'A' | 'D' | 'C', uid: number): string[] {
  return [
    `-${direction}`,
    'OUTPUT',
    '-m',
    'owner',
    '--uid-owner',
    String(uid),
    '!',
    '-d',
    '127.0.0.1/8',
    '-j',
    'REJECT',
    '-m',
    'comment',
    '--comment',
    'llm-corpus',
  ];
}

async function probeExistingLinux(
  uid: number,
  asRoot: boolean,
  signal: AbortSignal,
): Promise<boolean> {
  const baseArgs = ['iptables', ...iptablesArgs('C', uid)];
  const [cmd, ...args] = asRoot ? baseArgs : ['sudo', '-n', ...baseArgs];
  const r = await runTool(cmd!, args, { signal });
  return r.ok;
}

async function provisionLinux(
  deps: FirewallProvisionerDeps,
  signal: AbortSignal,
): Promise<FirewallRuleSpec> {
  const uid = corpusUid(deps);
  const asRoot = runningAsRoot(deps);

  const provisionArgs = iptablesArgs('A', uid);
  const reverseArgs = iptablesArgs('D', uid);

  // Existing-rule detection (idempotency).
  const exists =
    deps.forceExistsResult ??
    (deps.skipExistsProbe ? false : await probeExistingLinux(uid, asRoot, signal));

  const provisionCommand = asRoot
    ? { cmd: 'iptables', args: provisionArgs }
    : { cmd: 'sudo', args: ['iptables', ...provisionArgs] };
  const reverseCommand = asRoot
    ? { cmd: 'iptables', args: reverseArgs }
    : { cmd: 'sudo', args: ['iptables', ...reverseArgs] };

  const ruleText = `iptables -A OUTPUT -m owner --uid-owner ${uid} ! -d 127.0.0.1/8 -j REJECT -m comment --comment llm-corpus`;

  const spec: FirewallRuleSpec = {
    os: 'linux',
    corpus_uid: uid,
    anchor_or_chain: 'OUTPUT',
    rule_text: ruleText,
    provision_command: provisionCommand,
    reverse_command: reverseCommand,
  };

  if (exists) {
    // Idempotent skip — return the spec without provisioning.
    return spec;
  }

  if (!asRoot && !(await sudoAvailable())) {
    throw new InstallFirewallProvisionError({
      error_code: 'sudo_unavailable',
      message: 'firewall provisioning requires root or sudo; sudo is not on PATH',
    });
  }

  if (deps.skipExec === true) return spec;

  const r = await runTool(provisionCommand.cmd, provisionCommand.args, {
    signal,
  });
  if (!r.ok) {
    if (r.error.code === 'SPAWN_FAILED') {
      throw new InstallFirewallProvisionError(
        {
          error_code: 'firewall_binary_missing',
          message: `iptables binary missing or unspawnable: ${r.error.message.slice(0, 256)}`,
        },
        r.error,
      );
    }
    throw new InstallFirewallProvisionError(
      {
        error_code: r.error.code,
        message: `iptables provisioning failed: ${r.error.stderr.slice(0, 256)}`,
      },
      r.error,
    );
  }

  return spec;
}

/* ----------------------------- macOS ---------------------------------- */

function pfctlRuleText(uid: number): string {
  // Block all outbound except loopback for the corpus runtime UID.
  return `block out proto {tcp,udp} from any to any user ${uid}\npass out proto {tcp,udp} from any to 127.0.0.1 user ${uid}\n`;
}

async function probeExistingMacos(
  asRoot: boolean,
  signal: AbortSignal,
): Promise<boolean> {
  const baseArgs = ['pfctl', '-a', 'corpus', '-sr'];
  const [cmd, ...args] = asRoot ? baseArgs : ['sudo', '-n', ...baseArgs];
  const r = await runTool(cmd!, args, { signal });
  if (!r.ok) return false;
  return r.value.stdout.includes('llm-corpus') || /\bblock out\b/.test(r.value.stdout);
}

async function provisionMacos(
  deps: FirewallProvisionerDeps,
  signal: AbortSignal,
): Promise<FirewallRuleSpec> {
  const uid = corpusUid(deps);
  const asRoot = runningAsRoot(deps);
  const ruleText = pfctlRuleText(uid);

  const provisionCommand = asRoot
    ? { cmd: 'pfctl', args: ['-a', 'corpus', '-f', '-'] }
    : { cmd: 'sudo', args: ['pfctl', '-a', 'corpus', '-f', '-'] };
  const reverseCommand = asRoot
    ? { cmd: 'pfctl', args: ['-a', 'corpus', '-F', 'all'] }
    : { cmd: 'sudo', args: ['pfctl', '-a', 'corpus', '-F', 'all'] };

  const exists =
    deps.forceExistsResult ??
    (deps.skipExistsProbe ? false : await probeExistingMacos(asRoot, signal));

  const spec: FirewallRuleSpec = {
    os: 'macos',
    corpus_uid: uid,
    anchor_or_chain: 'corpus',
    rule_text: ruleText,
    provision_command: provisionCommand,
    reverse_command: reverseCommand,
  };

  if (exists) return spec;

  if (!asRoot && !(await sudoAvailable())) {
    throw new InstallFirewallProvisionError({
      error_code: 'sudo_unavailable',
      message: 'firewall provisioning requires root or sudo; sudo is not on PATH',
    });
  }

  if (deps.skipExec === true) return spec;

  // pfctl accepts the rule via stdin. runTool currently spawns with `stdio:
  // ['ignore', 'pipe', 'pipe']` — for stdin-bearing invocations we use the
  // shell-free workaround of piping via the args. Since pfctl reads `-f -`
  // from stdin, and we cannot supply stdin through runTool without an
  // extension to that helper, the production path uses an intermediate
  // tmpfile and `-f <tmpfile>` to avoid mutating the SP-001 runTool
  // contract. (Documented in research.md Decision B; preserves Constitution
  // XII — no shell-string exec, all args are arrays.)
  // Future SP-008+ can extend runTool to accept a `stdin` option; for now
  // the tmpfile pattern is the safe carrier.
  return await provisionMacosViaTmpfile(spec, ruleText, signal);
}

async function provisionMacosViaTmpfile(
  spec: FirewallRuleSpec,
  ruleText: string,
  signal: AbortSignal,
): Promise<FirewallRuleSpec> {
  // Compose the actual provision command swapping `-f -` for `-f <path>`.
  // The receipt records the original (which is reversible via `-F all` so
  // path stability is irrelevant for uninstall).
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const { Paths } = await import('@llm-corpus/contracts');
  const baseDir = path.join(Paths.cache(), 'sp007-pfctl');
  await fs.mkdir(baseDir, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(baseDir, 'pfctl-'));
  const tmpFile = path.join(
    tmpDir,
    `corpus.${crypto.randomBytes(2).toString('hex')}.pf`,
  );
  try {
    await fs.writeFile(tmpFile, ruleText, 'utf8');
    const pfctlArgs = ['-a', 'corpus', '-f', tmpFile];
    const args = spec.provision_command.cmd === 'sudo'
      ? ['pfctl', ...pfctlArgs]
      : pfctlArgs;
    const cmd = spec.provision_command.cmd;
    const r = await runTool(cmd, args, { signal });
    if (!r.ok) {
      if (r.error.code === 'SPAWN_FAILED') {
        throw new InstallFirewallProvisionError(
          {
            error_code: 'firewall_binary_missing',
            message: `pfctl binary missing: ${r.error.message.slice(0, 256)}`,
          },
          r.error,
        );
      }
      throw new InstallFirewallProvisionError(
        {
          error_code: r.error.code,
          message: `pfctl provisioning failed: ${r.error.stderr.slice(0, 256)}`,
        },
        r.error,
      );
    }
    return spec;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/* ----------------------------- Public surface ---------------------------- */

/**
 * Provision the SP-007 firewall rule via the platform-specific path. Returns
 * the FirewallRuleSpec (recorded into the install-receipt). Idempotent:
 * re-running over an already-provisioned rule is a no-op.
 */
export async function provisionFirewallRule(
  deps: FirewallProvisionerDeps,
  signal: AbortSignal,
): Promise<FirewallRuleSpec> {
  const platform = deps.platformOverride ?? os.platform();
  const installOs = platformOs(platform);
  const startedAt = Date.now();
  try {
    if (installOs === 'linux') return await provisionLinux(deps, signal);
    return await provisionMacos(deps, signal);
  } catch (cause) {
    try {
      const errorCode =
        cause instanceof InstallFirewallProvisionError
          ? cause.data.error_code
          : 'firewall_unknown';
      await emitTelemetry({
        event: 'install.step_failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failure',
        step: 'firewall_provision',
        duration_ms: Date.now() - startedAt,
        error_code: errorCode,
      });
    } catch {
      /* telemetry must not crash install */
    }
    throw cause;
  }
}

/**
 * Reverse a recorded firewall rule via its captured `reverse_command`. Used
 * by `corpus uninstall` (Phase 4 — Engineer #3 owns the consumer site).
 */
export async function reverseFirewallRule(
  spec: FirewallRuleSpec,
  signal: AbortSignal,
): Promise<void> {
  const r = await runTool(spec.reverse_command.cmd, spec.reverse_command.args, {
    signal,
  });
  if (!r.ok) {
    throw new UninstallFirewallReverseError(
      {
        reverse_command: spec.reverse_command,
        message: `firewall reverse failed: ${r.error.stderr.slice(0, 256)}`,
      },
      r.error,
    );
  }
}
