// SP-007 T059 — `corpus uninstall` receipt-driven reverse pipeline.
//
// References:
//   - specs/007-install-first-run/tasks.md T051..T061
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, FR-INSTALL-016
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution Principles V, VII, VIII, X, XI (CLI is the ONLY layer
//     permitted to `process.exit` for the uninstall flow), XII, XIII
//
// 7-step reverse pipeline (matches ADR-012 §"Receipt-driven uninstall reverse
// contract"):
//   1. Preflight — read receipt; Zod-validate; detect platform mismatch.
//   2. Active-daemon detect — if daemon alive, attempt `runTool('corpus',
//      ['daemon','stop'])` with the Constitution VII 2-second budget; on
//      timeout exit non-zero.
//   3. Reverse MCP-client configs (preserve other entries).
//   4. Reverse firewall rules via the recorded reverse_command.
//   5. Reverse auto-start units.
//   6. Branch on --purge: with purge → fs.rm XDG subtree + delete receipt;
//      without purge → mark receipt `uninstalled:true` + `uninstalled_at`.
//   7. Emit verification summary to stdout.

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  Paths,
  emitTelemetry,
  runTool,
  UninstallCliArgsZodSchema,
  type InstallReceipt,
  type InstallReceiptUninstalled,
} from '@llm-corpus/contracts';

import { readInstallReceipt } from './install-helpers/install-receipt-reader.js';
import {
  writeInstallReceipt,
  installReceiptPath,
} from './install-helpers/install-receipt-writer.js';
import { reverseMcpClientConfig } from './install-helpers/mcp-client-config-reverser.js';
import { reverseFirewallRule } from './install-helpers/firewall-provisioner.js';
import { reverseAutoStartUnit } from './install-helpers/auto-start-unit-uninstaller.js';
import { detectActiveDaemon } from './install-helpers/daemon-detector.js';
import { buildVerificationSummary } from './install-helpers/verification-summary-builder.js';

/* ----------------------------- arg parsing ---------------------------- */

interface UninstallArgs {
  purge: boolean;
}

export function parseUninstallArgs(argv: readonly string[]): UninstallArgs {
  let purge = false;
  for (const a of argv) {
    if (a === '--purge') purge = true;
  }
  UninstallCliArgsZodSchema.parse({ purge: purge || undefined });
  return { purge };
}

/* --------------------------- helpers ----------------------------------- */

function platformOs(): 'linux' | 'macos' {
  return os.platform() === 'darwin' ? 'macos' : 'linux';
}

function nowIso(): string {
  return new Date().toISOString();
}

const DAEMON_STOP_BUDGET_MS = 2000;

async function tryStopDaemon(signal: AbortSignal): Promise<boolean> {
  // Best-effort stop. Returns true if the daemon is gone after the call.
  const r = await runTool('corpus', ['daemon', 'stop'], { signal });
  if (!r.ok) return false;
  // Poll for daemon-PID disappearance within the 2-second budget.
  const deadline = Date.now() + DAEMON_STOP_BUDGET_MS;
  while (Date.now() < deadline) {
    const d = await detectActiveDaemon(signal);
    if (!d.alive) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  const final = await detectActiveDaemon(signal);
  return !final.alive;
}

/* ----------------------------- public command ------------------------- */

export interface RunUninstallCommandInput {
  argv: readonly string[];
  signal?: AbortSignal;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
}

export interface RunUninstallCommandResult {
  exit: number;
}

export async function runUninstallCommand(
  input: RunUninstallCommandInput,
): Promise<RunUninstallCommandResult> {
  const startedAt = Date.now();
  const stdout = input.stdout ?? ((m) => process.stdout.write(m));
  const stderr = input.stderr ?? ((m) => process.stderr.write(m));
  const signal = input.signal ?? new AbortController().signal;
  const args = parseUninstallArgs(input.argv);

  /* ---- Step 1: preflight ---- */
  let receipt: InstallReceipt | InstallReceiptUninstalled;
  try {
    receipt = await readInstallReceipt(signal);
  } catch (cause) {
    const path = installReceiptPath();
    stderr(
      `corpus uninstall: ${(cause as Error).message ?? 'receipt unreadable'}\n` +
        `manual remediation: rm -rf ${Paths.config()} ${Paths.data()} ${Paths.state()} ${Paths.cache()}\n` +
        `                    edit ~/.claude.json and delete the mcpServers.corpus entry\n` +
        `                    reverse the firewall rule manually (pfctl -a corpus -F all on macos; iptables -D OUTPUT ... on linux)\n` +
        `(install-receipt path: ${path})\n`,
    );
    try {
      await emitTelemetry({
        event: 'uninstall.preflight_failed',
        timestamp: nowIso(),
        severity: 'error',
        outcome: 'failure',
        unmet_requirement:
          (cause as Error).message?.includes('malformed')
            ? 'receipt_malformed'
            : 'receipt_missing',
        details: { receipt_path: path },
      });
    } catch {
      /* ignore */
    }
    return { exit: 1 };
  }

  // Already-uninstalled receipt → re-run is a no-op.
  if ('uninstalled' in receipt && receipt.uninstalled === true) {
    stdout(`corpus uninstall: already uninstalled (${receipt.uninstalled_at ?? 'unknown'})\n`);
    if (args.purge) {
      // Re-running --purge after no-purge uninstall: remove XDG subtree now.
      await purgeXdgSubtree();
      await deleteReceipt();
    }
    try {
      await emitTelemetry({
        event: 'uninstall.completed',
        timestamp: nowIso(),
        severity: 'info',
        outcome: 'success',
        duration_ms: Date.now() - startedAt,
        purged: args.purge,
      });
    } catch {
      /* ignore */
    }
    return { exit: 0 };
  }

  // Platform mismatch.
  if (receipt.os !== platformOs()) {
    stderr(
      `corpus uninstall: receipt records os='${receipt.os}' but current host is '${platformOs()}'; refusing to proceed.\n` +
        `manual remediation: run uninstall on the original host where the install was performed.\n`,
    );
    try {
      await emitTelemetry({
        event: 'uninstall.preflight_failed',
        timestamp: nowIso(),
        severity: 'error',
        outcome: 'failure',
        unmet_requirement: 'platform_mismatch',
        details: { install_os: receipt.os, current_os: platformOs() },
      });
    } catch {
      /* ignore */
    }
    return { exit: 1 };
  }

  /* ---- Step 2: active-daemon detect ---- */
  const daemonStatus = await detectActiveDaemon(signal);
  if (daemonStatus.alive) {
    const stopped = await tryStopDaemon(signal);
    if (!stopped) {
      stderr(
        `corpus uninstall: daemon (pid=${daemonStatus.pid}) did not stop within ${DAEMON_STOP_BUDGET_MS}ms.\n` +
          `manual remediation: kill -TERM ${daemonStatus.pid}\n`,
      );
      try {
        await emitTelemetry({
          event: 'uninstall.step_failed',
          timestamp: nowIso(),
          severity: 'error',
          outcome: 'failure',
          step: 'preflight',
          duration_ms: Date.now() - startedAt,
          error_code: 'daemon_did_not_stop',
        });
      } catch {
        /* ignore */
      }
      return { exit: 1 };
    }
  }

  /* ---- Step 3: reverse MCP-client configs ---- */
  for (const cfg of receipt.mcp_client_configs) {
    try {
      await reverseMcpClientConfig({ path: cfg.path }, signal);
    } catch (cause) {
      try {
        await emitTelemetry({
          event: 'uninstall.step_failed',
          timestamp: nowIso(),
          severity: 'error',
          outcome: 'failure',
          step: 'mcp_client_config_reverse',
          duration_ms: Date.now() - startedAt,
          error_code: ((cause as Error).message ?? 'unknown').slice(0, 256),
        });
      } catch {
        /* ignore */
      }
      // Best-effort: continue with other reversals.
    }
  }

  /* ---- Step 4: reverse firewall rules ---- */
  for (const rule of receipt.firewall_rules) {
    try {
      await reverseFirewallRule(rule, signal);
    } catch (cause) {
      stderr(
        `corpus uninstall: firewall reverse failed: ${(cause as Error).message}\n`,
      );
      try {
        await emitTelemetry({
          event: 'uninstall.step_failed',
          timestamp: nowIso(),
          severity: 'error',
          outcome: 'failure',
          step: 'firewall_reverse',
          duration_ms: Date.now() - startedAt,
          error_code: 'firewall_reverse_failed',
        });
      } catch {
        /* ignore */
      }
      return { exit: 1 };
    }
  }

  /* ---- Step 5: reverse auto-start units ---- */
  for (const unit of receipt.auto_start_units) {
    await reverseAutoStartUnit(unit, signal);
  }

  /* ---- Step 6 (non-purge): mark receipt uninstalled ---- */
  if (!args.purge) {
    const uninstalledReceipt: InstallReceiptUninstalled = {
      ...receipt,
      uninstalled: true,
      uninstalled_at: nowIso(),
    };
    await writeInstallReceipt(uninstalledReceipt, signal);
  }

  /* ---- Step 7: verification summary (BEFORE purge so post-purge paths
   *             reflect the actual on-disk state at summary time). For
   *             the non-purge path, the summary shows post-reverse state. ---- */
  try {
    const summary = await buildVerificationSummary({
      created_paths: receipt.created_paths,
      mcp_client_configs: receipt.mcp_client_configs.map((c) => ({ path: c.path })),
      firewall_rules: receipt.firewall_rules,
    });
    stdout(summary);
  } catch {
    /* summary is informational; failures don't block exit 0 */
  }

  /* ---- Emit terminal telemetry BEFORE purge ---- */
  try {
    await emitTelemetry({
      event: 'uninstall.completed',
      timestamp: nowIso(),
      severity: 'info',
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
      purged: args.purge,
    });
  } catch {
    /* ignore */
  }

  /* ---- Step 6 (purge): tear down XDG subtree LAST so all prior steps
   *             could write telemetry / receipt to Paths.state(). ---- */
  if (args.purge) {
    await purgeXdgSubtree();
    await deleteReceipt();
  }
  return { exit: 0 };
}

async function purgeXdgSubtree(): Promise<void> {
  for (const dir of [Paths.config(), Paths.data(), Paths.state(), Paths.cache()]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

async function deleteReceipt(): Promise<void> {
  try {
    await fs.unlink(installReceiptPath());
  } catch {
    /* receipt may already be gone via XDG purge */
  }
}
