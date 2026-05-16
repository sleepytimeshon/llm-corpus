// SP-007 T046 — `corpus init` 11-step pipeline orchestrator (+ optional smoke).
//
// References:
//   - specs/007-install-first-run/tasks.md T031 / T032 / T046
//   - specs/007-install-first-run/spec.md FR-INSTALL-001, FR-INSTALL-002,
//     FR-INSTALL-004, FR-INSTALL-022
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution Principles VII, X, XI (CLI is the ONLY layer permitted to
//     `process.exit` for the install flow), XIII
//
// This file is one of the three SP-007 CLI command entry points exempted
// from `no-process-exit-in-libs`. It orchestrates the 11-step pipeline,
// wraps the whole thing in `withInstallBudget`, and emits the appropriate
// telemetry envelope on every outcome.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  Paths,
  InstallCliArgsZodSchema,
  emitTelemetry,
  type InstallReceipt,
  type FirewallRuleSpec,
  type AutoStartUnitSpec,
} from '@llm-corpus/contracts';
import { installPolicy } from '@llm-corpus/pipeline';
import { openIndexReadWrite } from '@llm-corpus/storage';

import { withInstallBudget } from './install-helpers/install-budget.js';
import { runInstallPreflight } from './install-helpers/preflight.js';
import { bringUpXdgSubtree } from './install-helpers/xdg-bringup.js';
import { setupSingleFileSqlite } from './install-helpers/sqlite-singlefile.js';
import { writeDefaultConfigToml } from './install-helpers/config-toml-writer.js';
import { loadAndInsertTaxonomySeed } from './install-helpers/taxonomy-seed-loader.js';
import {
  mutateMcpClientConfig,
} from './install-helpers/mcp-client-config-mutator.js';
import { provisionFirewallRule } from './install-helpers/firewall-provisioner.js';
import { installAutoStartUnit } from './install-helpers/auto-start-unit-installer.js';
import { writeInstallReceipt, installReceiptPath } from './install-helpers/install-receipt-writer.js';
import { readInstallReceipt } from './install-helpers/install-receipt-reader.js';
import {
  rollbackPartialInstall,
  type PartialReceiptForRollback,
} from './install-helpers/install-rollback.js';
import { runSmokeHarness } from './install-helpers/smoke-harness.js';

/* ----------------------------- arg parsing ---------------------------- */

interface InstallArgs {
  mcpClientConfig?: string;
  enableAutostart: boolean;
  smoke: boolean;
  forceAutostart: boolean;
}

export function parseInstallArgs(argv: readonly string[]): InstallArgs {
  let mcpClientConfig: string | undefined;
  let enableAutostart = false;
  let noAutostart = false;
  let smoke = false;
  let forceAutostart = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mcp-client-config') {
      mcpClientConfig = argv[i + 1];
      i += 1;
    } else if (a?.startsWith('--mcp-client-config=')) {
      mcpClientConfig = a.slice('--mcp-client-config='.length);
    } else if (a === '--enable-autostart') {
      enableAutostart = true;
    } else if (a === '--no-autostart') {
      noAutostart = true;
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--force-autostart') {
      forceAutostart = true;
    }
  }
  // Validate via the contract schema (defense per Constitution V).
  const obj = {
    'mcp-client-config': mcpClientConfig,
    'enable-autostart': enableAutostart || undefined,
    'no-autostart': noAutostart || undefined,
    smoke: smoke || undefined,
    'force-autostart': forceAutostart || undefined,
  };
  InstallCliArgsZodSchema.parse(obj);
  return {
    mcpClientConfig,
    enableAutostart: enableAutostart && !noAutostart,
    smoke,
    forceAutostart,
  };
}

/* ------------------------- helpers for receipt ------------------------ */

function platformOs(): 'linux' | 'macos' {
  return os.platform() === 'darwin' ? 'macos' : 'linux';
}

function installedViaHeuristic(): 'npx' | 'global' | 'local' {
  const exe = process.execPath;
  if (exe.includes(path.sep + '_npx' + path.sep)) return 'npx';
  if (exe.includes(path.sep + 'node_modules' + path.sep + '.bin' + path.sep)) {
    return 'global';
  }
  return 'local';
}

function nowIso(): string {
  return new Date().toISOString();
}

function corpusBinaryAbsolutePath(): string {
  // `process.argv[1]` is the entry script — for the dist build this is
  // `packages/cli/dist/index.js`. The `bin` field in package.json points
  // to this same file, so we record it verbatim.
  return path.resolve(process.argv[1] ?? process.execPath);
}

/* ---------------------- pipeline + idempotency ------------------------ */

async function isFullyInstalled(): Promise<boolean> {
  // Idempotency check: install-receipt present + Zod-valid + index.db present.
  try {
    await fs.access(installReceiptPath());
    await fs.access(Paths.indexDb());
    await readInstallReceipt(new AbortController().signal);
    return true;
  } catch {
    return false;
  }
}

interface OrchestratorDeps {
  /** Test-only: skip the actual firewall mutation but capture the spec. */
  skipFirewallExec?: boolean;
  /** Test-only: synthesize the firewall already-exists branch. */
  forceFirewallExistsResult?: boolean;
  /** Test-only: skip the actual auto-start unit-load invocation. */
  skipAutoStartLoad?: boolean;
}

async function runPipeline(
  args: InstallArgs,
  deps: OrchestratorDeps,
  innerSignal: AbortSignal,
): Promise<InstallReceipt> {
  const startedAt = Date.now();
  const partial: PartialReceiptForRollback = {};
  const createdPaths: string[] = [];
  const mcpClientConfigs: { path: string; key_added: 'mcpServers.corpus' }[] = [];
  const firewallRules: FirewallRuleSpec[] = [];
  const autoStartUnits: AutoStartUnitSpec[] = [];
  let configWritten = false;
  let seedingResult: Awaited<
    ReturnType<typeof loadAndInsertTaxonomySeed>
  > | null = null;

  try {
    // Step 1: preflight
    const pre = await runInstallPreflight({}, innerSignal);
    if (
      !pre.node_ok ||
      !pre.ollama_ok ||
      !pre.xdg_writable ||
      pre.partial_install_detected
    ) {
      throw new Error('preflight_failed');
    }

    // Step 2: idempotency check is done in runInstallCommand before pipeline.

    // Step 3: XDG bringup
    const created = await bringUpXdgSubtree({}, innerSignal);
    createdPaths.push(...created);
    partial.created_paths = createdPaths;

    // Step 4: SQLite single-file
    await setupSingleFileSqlite({}, innerSignal);

    // Step 5: config.toml
    const tomlR = await writeDefaultConfigToml({}, innerSignal);
    configWritten = tomlR.written;
    partial.config_toml_written = configWritten;

    // Step 6: taxonomy seed
    {
      const db = openIndexReadWrite();
      try {
        seedingResult = await loadAndInsertTaxonomySeed(db, {}, innerSignal);
      } finally {
        db.close();
      }
    }

    // Step 7: MCP-client config mutate
    const mcp = await mutateMcpClientConfig(
      {
        configPathOverride: args.mcpClientConfig,
        corpusBinaryPath: corpusBinaryAbsolutePath(),
      },
      innerSignal,
    );
    mcpClientConfigs.push(mcp);
    partial.mcp_client_configs = mcpClientConfigs.map((c) => ({ path: c.path }));

    // Step 8: OS firewall
    {
      const spec = await provisionFirewallRule(
        {
          skipExec: deps.skipFirewallExec,
          forceExistsResult: deps.forceFirewallExistsResult,
        },
        innerSignal,
      );
      firewallRules.push(spec);
      partial.firewall_rules = firewallRules;
    }

    // Step 9: auto-start unit (only when --enable-autostart)
    if (args.enableAutostart) {
      const unit = await installAutoStartUnit(
        corpusBinaryAbsolutePath(),
        {
          forceAutostart: args.forceAutostart,
          skipUnitLoad: deps.skipAutoStartLoad,
        },
        innerSignal,
      );
      autoStartUnits.push({
        os: unit.os,
        unit_path: unit.unit_path,
        reverse_command: unit.reverse_command,
      });
      partial.auto_start_units = autoStartUnits;
    }

    // Step 10: install-receipt
    const seededTaxonomyTerms = (seedingResult?.seededEntries ?? []).map(
      (e) => ({
        axis: e.axis,
        term: e.term,
        established_at: seedingResult!.establishedAt,
      }),
    );
    const receipt: InstallReceipt = {
      schema_version: 1,
      installed_at: nowIso(),
      installed_via: installedViaHeuristic(),
      corpus_binary_path: corpusBinaryAbsolutePath(),
      created_paths: createdPaths,
      mcp_client_configs: mcpClientConfigs,
      firewall_rules: firewallRules,
      auto_start_units: autoStartUnits,
      seeded_taxonomy_terms: seededTaxonomyTerms,
      os: platformOs(),
      os_version: os.release(),
      node_version: process.versions.node,
    };
    await writeInstallReceipt(receipt, innerSignal);

    // Step 11: next-step output is the caller's responsibility (stdout).
    return receipt;
  } catch (cause) {
    // Roll back any partial side-effects then re-throw.
    try {
      await emitTelemetry({
        event: 'install.step_failed',
        timestamp: nowIso(),
        severity: 'error',
        outcome: 'failure',
        step: stepFromCause(cause),
        duration_ms: Date.now() - startedAt,
        error_code: ((cause as Error).message ?? 'unknown').slice(0, 256),
      });
    } catch {
      /* telemetry must not crash install */
    }
    try {
      await rollbackPartialInstall(partial, {}, innerSignal);
    } catch {
      /* rollback is best-effort */
    }
    throw cause;
  }
}

function stepFromCause(
  cause: unknown,
):
  | 'preflight'
  | 'idempotency_check'
  | 'xdg_bringup'
  | 'sqlite_singlefile'
  | 'config_toml'
  | 'taxonomy_seed'
  | 'mcp_client_config'
  | 'firewall_provision'
  | 'auto_start_unit'
  | 'install_receipt'
  | 'next_step_output' {
  if (!(cause instanceof Error)) return 'preflight';
  const name = cause.name;
  if (name === 'InstallPreflightError') return 'preflight';
  if (name === 'InstallFirewallProvisionError') return 'firewall_provision';
  if (name === 'InstallMCPClientConfigError') return 'mcp_client_config';
  if (name === 'InstallReceiptWriteError') return 'install_receipt';
  if (name === 'TaxonomyPromoteLockContentionError') return 'taxonomy_seed';
  return 'preflight';
}

/* ---------------------- public command surface ---------------------- */

export interface RunInstallCommandInput {
  argv: readonly string[];
  /** Optional outer AbortSignal (master SIGINT). */
  signal?: AbortSignal;
  /** Optional dependency overrides for tests. */
  deps?: OrchestratorDeps;
  /** Optional stdout/stderr sinks for tests. */
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
}

export interface RunInstallCommandResult {
  exit: number;
  receipt?: InstallReceipt;
  alreadyInstalled?: boolean;
}

/**
 * Library-side entry — returns an exit code; the binary wrapper does the
 * `process.exit(code)` per Constitution XI.
 */
export async function runInstallCommand(
  input: RunInstallCommandInput,
): Promise<RunInstallCommandResult> {
  const startedAt = Date.now();
  const stdout = input.stdout ?? ((m) => process.stdout.write(m));
  const stderr = input.stderr ?? ((m) => process.stderr.write(m));
  const args = parseInstallArgs(input.argv);
  const outerSignal = input.signal ?? new AbortController().signal;
  const deps = input.deps ?? {};

  // Idempotency: if a full install is already in place, print + exit 0.
  if (await isFullyInstalled()) {
    stdout(`corpus init: already initialized at ${installReceiptPath()}\n`);
    try {
      await emitTelemetry({
        event: 'install.completed',
        timestamp: nowIso(),
        severity: 'info',
        outcome: 'success',
        duration_ms: Date.now() - startedAt,
        installed_via: installedViaHeuristic(),
        os: platformOs(),
        steps_skipped: [
          'xdg_bringup',
          'sqlite_singlefile',
          'config_toml',
          'taxonomy_seed',
          'mcp_client_config',
          'firewall_provision',
        ],
      });
    } catch {
      /* ignore */
    }
    return { exit: 0, alreadyInstalled: true };
  }

  try {
    const receipt = await withInstallBudget(
      { budgetMs: installPolicy.installBudgetMs, outerSignal },
      (innerSignal) => runPipeline(args, deps, innerSignal),
    );

    // Step 11: next-step output
    stdout(
      [
        '',
        'corpus initialized.',
        `  install-receipt: ${installReceiptPath()}`,
        `  index:          ${Paths.indexDb()}`,
        `  inbox:          ${Paths.inbox()}`,
        `  next:           drop documents into the inbox; corpus daemon start`,
        '',
      ].join('\n'),
    );

    try {
      await emitTelemetry({
        event: 'install.completed',
        timestamp: nowIso(),
        severity: 'info',
        outcome: 'success',
        duration_ms: Date.now() - startedAt,
        installed_via: receipt.installed_via,
        os: receipt.os,
        steps_skipped: args.enableAutostart ? [] : ['auto_start_unit'],
      });
    } catch {
      /* ignore */
    }

    // Optional smoke step (step 12)
    if (args.smoke) {
      try {
        const seedDoc = path.resolve(
          path.dirname(corpusBinaryAbsolutePath()),
          '..',
          'fixtures',
          'first-run-seed.md',
        );
        await runSmokeHarness(
          {
            corpusBinaryPath: corpusBinaryAbsolutePath(),
            seedDocPath: seedDoc,
            searchQuery: 'SP-007 first-run seed document',
            budgetMs: installPolicy.smokeBudgetMs,
          },
          outerSignal,
        );
        stdout('corpus init --smoke: end-to-end smoke passed.\n');
      } catch (cause) {
        stderr(`corpus init --smoke: ${(cause as Error).message}\n`);
        return { exit: 2, receipt };
      }
    }

    return { exit: 0, receipt };
  } catch (cause) {
    stderr(`corpus init: ${(cause as Error).message ?? String(cause)}\n`);
    return { exit: 1 };
  }
}
