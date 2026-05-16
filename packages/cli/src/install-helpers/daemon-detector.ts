// SP-007 T060 — Daemon-active detector (uninstall preflight step).
//
// References:
//   - specs/007-install-first-run/tasks.md T057 / T060
//   - specs/007-install-first-run/spec.md FR-INSTALL-015
//   - Constitution VII (cancellable), X (idempotent)
//
// The daemon writes its PID to `Paths.state() + '/daemon.pid'` when it starts.
// Uninstall must detect an active daemon, attempt graceful stop via
// `runTool('corpus', ['daemon', 'stop'])`, and refuse to proceed if the
// daemon doesn't terminate within Constitution VII's 2-second budget.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';

export function daemonPidFile(): string {
  return path.join(Paths.state(), 'daemon.pid');
}

export interface DaemonDetectorResult {
  alive: boolean;
  pid?: number;
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

export async function detectActiveDaemon(
  signal: AbortSignal,
): Promise<DaemonDetectorResult> {
  signal.throwIfAborted();
  let body: string;
  try {
    body = await fs.readFile(daemonPidFile(), 'utf8');
  } catch (cause) {
    const e = cause as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { alive: false };
    return { alive: false };
  }
  const pid = Number.parseInt(body.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return { alive: false };
  if (!isPidAlive(pid)) return { alive: false };
  return { alive: true, pid };
}
