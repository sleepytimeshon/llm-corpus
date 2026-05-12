// SP-003 T074 / T075 — `corpus daemon start|stop` + `corpus drain` CLI
// subcommands.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001, FR-INGEST-011
//   - Constitution XI (CLI is one of the two legitimate process.exit sites)
//
// `daemon start` invokes the long-running daemon main(). A PID file is
// written to Paths.state()/daemon.pid to allow `daemon stop` to signal it.
// `daemon stop` sends SIGTERM to the PID file's holder and waits ≤ 5s for
// the process to exit.
// `drain` invokes the one-shot drain via the daemon entrypoint helper.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';
import { main as daemonMain, runOneShotDrain } from '@llm-corpus/daemon';

function pidFilePath(): string {
  return path.join(Paths.state(), 'daemon.pid');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    return e.code === 'EPERM';
  }
}

export async function runDaemonStart(): Promise<number> {
  const pidFile = pidFilePath();
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });

  // Refuse to start if a live daemon is already running.
  if (fs.existsSync(pidFile)) {
    const existingPid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isFinite(existingPid) && isPidAlive(existingPid)) {
      process.stderr.write(`corpus daemon: already running (pid=${existingPid})\n`);
      return 1;
    }
    // Stale PID file — remove.
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* best-effort */
    }
  }

  fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  // Note: daemonMain calls process.exit(0) on graceful shutdown.
  // We register a cleanup so the PID file is removed if main returns.
  try {
    return await daemonMain({ noExit: true });
  } finally {
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* best-effort */
    }
  }
}

export async function runDaemonStop(): Promise<number> {
  const pidFile = pidFilePath();
  if (!fs.existsSync(pidFile)) {
    process.stderr.write('corpus daemon: not running (no PID file)\n');
    return 1;
  }
  const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
  if (!Number.isFinite(pid)) {
    process.stderr.write(`corpus daemon: invalid PID file at ${pidFile}\n`);
    return 1;
  }
  if (!isPidAlive(pid)) {
    process.stderr.write(`corpus daemon: pid ${pid} not alive; removing stale PID file\n`);
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* best-effort */
    }
    return 0;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (caught) {
    process.stderr.write(`corpus daemon: kill failed: ${(caught as Error).message}\n`);
    return 1;
  }
  // Wait up to 5s for the process to exit.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      // Clean up PID file if still present.
      try {
        fs.unlinkSync(pidFile);
      } catch {
        /* best-effort */
      }
      return 0;
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  process.stderr.write(`corpus daemon: pid ${pid} did not exit within 5s\n`);
  return 1;
}

export async function runDrain(): Promise<number> {
  return runOneShotDrain();
}
