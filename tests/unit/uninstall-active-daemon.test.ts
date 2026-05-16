// SP-007 T057 — Active-daemon detection during uninstall preflight.
//
// References:
//   - specs/007-install-first-run/tasks.md T057
//   - specs/007-install-first-run/spec.md FR-INSTALL-015
//   - Constitution VII (cancellable + budgeted)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import {
  detectActiveDaemon,
  daemonPidFile,
} from '../../packages/cli/src/install-helpers/daemon-detector.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-daemon-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

describe('SP-007 T057 — detectActiveDaemon', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('returns alive=false when no PID file exists', async () => {
    await tempdir();
    const r = await detectActiveDaemon(new AbortController().signal);
    expect(r.alive).toBe(false);
  });

  it('returns alive=false when PID file references a dead PID', async () => {
    await tempdir();
    // PID 1 is always init on Linux; use a max-int PID instead to guarantee dead.
    await fs.writeFile(daemonPidFile(), '999999999', 'utf8');
    const r = await detectActiveDaemon(new AbortController().signal);
    expect(r.alive).toBe(false);
  });

  it('returns alive=true when PID file references the current process', async () => {
    await tempdir();
    await fs.writeFile(daemonPidFile(), String(process.pid), 'utf8');
    const r = await detectActiveDaemon(new AbortController().signal);
    expect(r.alive).toBe(true);
    expect(r.pid).toBe(process.pid);
  });
});
