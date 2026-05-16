// SP-007 T044 — Auto-start unit installer (install-step 9).
//
// References:
//   - specs/007-install-first-run/tasks.md T030 / T044
//   - specs/007-install-first-run/spec.md FR-INSTALL-011
//   - specs/007-install-first-run/research.md Decision E
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution Principles VII, X, XII
//
// Discriminates on `os.platform()`; writes systemd user unit on Linux or
// launchd plist on macOS; invokes the unit-loader (systemctl --user
// enable --now / launchctl load) via `runTool()`; captures
// `reverse_command` into the returned spec for receipt persistence.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runTool,
  emitTelemetry,
  type AutoStartUnitSpec,
  type InstallOs,
} from '@llm-corpus/contracts';

export interface AutoStartUnitInstallerDeps {
  /** Optional override for tests — skip the actual systemctl/launchctl call. */
  skipUnitLoad?: boolean;
  /** Optional override — alternate unit-file write location. */
  unitPathOverride?: string;
  /** Optional override — alternate platform discriminator. */
  platformOverride?: NodeJS.Platform;
  /** Force-overwrite an existing unit file. */
  forceAutostart?: boolean;
}

export interface AutoStartInstallResult {
  unit_path: string;
  reverse_command: { cmd: string; args: string[] };
  /** True when the unit file was newly written; false when --force-autostart skipped. */
  wrote: boolean;
}

function systemdUnitBody(corpusBinary: string): string {
  return (
    `[Unit]\n` +
    `Description=llm-corpus daemon\n` +
    `After=default.target\n` +
    `\n` +
    `[Service]\n` +
    `ExecStart=${corpusBinary} daemon start\n` +
    `Restart=on-failure\n` +
    `\n` +
    `[Install]\n` +
    `WantedBy=default.target\n`
  );
}

function launchdPlistBody(corpusBinary: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">\n` +
    `<dict>\n` +
    `  <key>Label</key><string>io.llm-corpus.daemon</string>\n` +
    `  <key>ProgramArguments</key>\n` +
    `  <array>\n` +
    `    <string>${corpusBinary}</string>\n` +
    `    <string>daemon</string>\n` +
    `    <string>start</string>\n` +
    `  </array>\n` +
    `  <key>RunAtLoad</key><true/>\n` +
    `  <key>KeepAlive</key><true/>\n` +
    `</dict>\n` +
    `</plist>\n`
  );
}

function platformOs(p: NodeJS.Platform): InstallOs {
  if (p === 'darwin') return 'macos';
  return 'linux';
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function installAutoStartUnit(
  corpusBinaryPath: string,
  deps: AutoStartUnitInstallerDeps,
  signal: AbortSignal,
): Promise<AutoStartUnitSpec & { wrote: boolean }> {
  const platform = deps.platformOverride ?? os.platform();
  const startedAt = Date.now();
  const installOs = platformOs(platform);

  let unitPath: string;
  let unitBody: string;
  let provisionLoad: { cmd: string; args: string[] };
  let reverseUnload: { cmd: string; args: string[] };

  if (installOs === 'linux') {
    unitPath =
      deps.unitPathOverride ??
      path.join(os.homedir(), '.config', 'systemd', 'user', 'corpus.service');
    unitBody = systemdUnitBody(corpusBinaryPath);
    provisionLoad = {
      cmd: 'systemctl',
      args: ['--user', 'enable', '--now', 'corpus.service'],
    };
    reverseUnload = {
      cmd: 'systemctl',
      args: ['--user', 'disable', '--now', 'corpus.service'],
    };
  } else {
    unitPath =
      deps.unitPathOverride ??
      path.join(
        os.homedir(),
        'Library',
        'LaunchAgents',
        'io.llm-corpus.daemon.plist',
      );
    unitBody = launchdPlistBody(corpusBinaryPath);
    provisionLoad = { cmd: 'launchctl', args: ['load', unitPath] };
    reverseUnload = { cmd: 'launchctl', args: ['unload', unitPath] };
  }

  // Conflict: existing file + no --force-autostart → emit step_failed + throw.
  if (await fileExists(unitPath)) {
    if (deps.forceAutostart !== true) {
      try {
        await emitTelemetry({
          event: 'install.step_failed',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failure',
          step: 'auto_start_unit',
          duration_ms: Date.now() - startedAt,
          error_code: 'unit_file_already_exists',
        });
      } catch {
        /* ignore */
      }
      throw new Error(
        `auto-start unit already exists at ${unitPath}; pass --force-autostart to overwrite`,
      );
    }
  }

  await fs.mkdir(path.dirname(unitPath), { recursive: true });
  await fs.writeFile(unitPath, unitBody, 'utf8');

  if (deps.skipUnitLoad !== true) {
    const loaded = await runTool(provisionLoad.cmd, provisionLoad.args, {
      signal,
    });
    if (!loaded.ok) {
      try {
        await emitTelemetry({
          event: 'install.step_failed',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failure',
          step: 'auto_start_unit',
          duration_ms: Date.now() - startedAt,
          error_code: loaded.error.code,
        });
      } catch {
        /* ignore */
      }
      // Clean up the unit file we just wrote so rollback is clean.
      try {
        await fs.unlink(unitPath);
      } catch {
        /* ignore */
      }
      throw new Error(
        `failed to load auto-start unit (${provisionLoad.cmd}): ${loaded.error.message}`,
      );
    }
  }

  return {
    os: installOs,
    unit_path: unitPath,
    reverse_command: reverseUnload,
    wrote: true,
  };
}
