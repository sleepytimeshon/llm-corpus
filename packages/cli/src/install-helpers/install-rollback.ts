// SP-007 T043 — Partial-install rollback (install failure unwind).
//
// References:
//   - specs/007-install-first-run/tasks.md T029 / T043
//   - specs/007-install-first-run/spec.md FR-INSTALL-002, FR-INSTALL-017
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md
//   - Constitution Principles VII, X (idempotent), XII (runTool), XIII
//
// Walks the in-flight install's partial receipt in REVERSE order:
//   auto_start_units → firewall_rules → mcp_client_configs →
//   (seeded_taxonomy_terms: NO-OP; INSERT OR IGNORE not reversed per
//    Constitution X) → config.toml (if it was written) → created_paths.
//
// Each reverse invocation uses `runTool()` (firewall, auto-start) or
// `fs.rm` (XDG paths, config files). The unwind is idempotent.

import * as fs from 'node:fs/promises';
import {
  Paths,
  runTool,
  emitTelemetry,
} from '@llm-corpus/contracts';
import { installReceiptPath } from './install-receipt-writer.js';
import {
  resolveMcpClientConfigPath,
} from './mcp-client-config-mutator.js';
import type {
  FirewallRuleSpec,
  AutoStartUnitSpec,
} from '@llm-corpus/contracts';

export interface PartialReceiptForRollback {
  /** Created XDG / file paths to remove via `fs.rm({recursive: true})`. */
  created_paths?: readonly string[];
  /** Whether `config.toml` was newly written (so we can safely delete it). */
  config_toml_written?: boolean;
  /** MCP-client config entries to revert (delete `mcpServers.corpus`). */
  mcp_client_configs?: readonly { path: string }[];
  /** Firewall rules to reverse via the recorded reverse_command. */
  firewall_rules?: readonly FirewallRuleSpec[];
  /** Auto-start units to disable + remove. */
  auto_start_units?: readonly AutoStartUnitSpec[];
}

async function reverseFirewall(spec: FirewallRuleSpec): Promise<void> {
  const r = await runTool(spec.reverse_command.cmd, spec.reverse_command.args, {});
  if (!r.ok) {
    // Idempotent best-effort — telemetry then continue.
    try {
      await emitTelemetry({
        event: 'install.step_failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failure',
        step: 'firewall_provision',
        duration_ms: 0,
        error_code: 'rollback_firewall_failed',
      });
    } catch {
      /* ignore */
    }
  }
}

async function reverseAutoStart(unit: AutoStartUnitSpec): Promise<void> {
  const r = await runTool(unit.reverse_command.cmd, unit.reverse_command.args, {});
  if (!r.ok) {
    try {
      await emitTelemetry({
        event: 'install.step_failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failure',
        step: 'auto_start_unit',
        duration_ms: 0,
        error_code: 'rollback_autostart_failed',
      });
    } catch {
      /* ignore */
    }
  }
  try {
    await fs.unlink(unit.unit_path);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      /* best-effort */
    }
  }
}

async function reverseMcpClientConfig(entry: { path: string }): Promise<void> {
  try {
    const body = await fs.readFile(entry.path, 'utf8');
    const parsed = JSON.parse(body) as {
      mcpServers?: Record<string, unknown>;
      [k: string]: unknown;
    };
    if (parsed.mcpServers && 'corpus' in parsed.mcpServers) {
      delete parsed.mcpServers.corpus;
    }
    await fs.writeFile(entry.path, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  } catch {
    /* best-effort: file may not exist, may be malformed mid-rollback */
  }
}

async function removeConfigToml(): Promise<void> {
  try {
    await fs.unlink(Paths.configFile());
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      /* best-effort */
    }
  }
}

async function removeCreatedPath(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

async function deletePartialReceipt(): Promise<void> {
  try {
    await fs.unlink(installReceiptPath());
  } catch {
    /* receipt may not have been written yet — fine */
  }
}

export interface RollbackDeps {
  /** Optional override for tests — alternate MCP-client config resolver. */
  resolveMcpClientConfig?: typeof resolveMcpClientConfigPath;
}

/**
 * Walk the partial-receipt in REVERSE order and invoke each recorded
 * reverse-side-effect. Best-effort + idempotent.
 */
export async function rollbackPartialInstall(
  partial: PartialReceiptForRollback,
  deps: RollbackDeps,
  signal: AbortSignal,
): Promise<void> {
  void deps;
  void signal;

  // 1. auto-start units (newest side-effect; reverse first)
  for (const unit of (partial.auto_start_units ?? []).slice().reverse()) {
    await reverseAutoStart(unit);
  }

  // 2. firewall rules
  for (const rule of (partial.firewall_rules ?? []).slice().reverse()) {
    await reverseFirewall(rule);
  }

  // 3. MCP-client configs
  for (const cfg of (partial.mcp_client_configs ?? []).slice().reverse()) {
    await reverseMcpClientConfig(cfg);
  }

  // 4. taxonomy_terms rows from INSERT OR IGNORE: NO-OP per Constitution X.

  // 5. config.toml (if newly written)
  if (partial.config_toml_written === true) {
    await removeConfigToml();
  }

  // 6. created_paths (reverse order — deepest first)
  for (const p of (partial.created_paths ?? []).slice().reverse()) {
    await removeCreatedPath(p);
  }

  // 7. delete partial-receipt (post-rollback)
  await deletePartialReceipt();
}
