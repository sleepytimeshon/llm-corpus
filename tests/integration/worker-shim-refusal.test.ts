// T042 — Integration test: Worker spawn guard + egress blocking inside workers.
// Source of truth: contracts/egress-hook-api.md §"Worker-thread guard contract"
//
// Two concerns:
//   1. The lint rule (T025 / NFR-002) rejects direct `new Worker(...)` outside
//      `packages/daemon/src/worker-spawn-guard.ts`.
//   2. spawnGuardedWorker() injects the worker bootstrap shim; egress from
//      INSIDE the worker is blocked by the hook.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { spawnGuardedWorker } from '../../packages/daemon/src/worker-spawn-guard.js';

const ROOT = path.resolve(__dirname, '..', '..');

describe('Worker spawn guard (T042 / SC-003 / NFR-002a)', () => {
  it('lint rule rejects direct `new Worker(...)` outside the helper', async () => {
    // Write a fixture file under packages/daemon/src/_fixture-bad-worker.ts that
    // does `new Worker(...)`. Run eslint on it; expect failure.
    const fixturePath = path.join(
      ROOT,
      'packages',
      'daemon',
      'src',
      '_fixture-bad-worker.ts',
    );
    const fixture = `
import { Worker } from 'node:worker_threads';
// Direct \`new Worker(...)\` is FORBIDDEN outside the helper.
const w = new Worker('./nope.js');
void w;
`;
    fs.writeFileSync(fixturePath, fixture, 'utf8');
    try {
      const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
        (resolve) => {
          let stdout = '';
          let stderr = '';
          const child = spawn(
            'npx',
            ['eslint', '--no-config-lookup', '-c', 'eslint.config.js', fixturePath],
            { cwd: ROOT, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
          );
          child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
          child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
          child.on('close', (code) => resolve({ stdout, stderr, code }));
        },
      );
      // Either the rule reports OR eslint config bypass with --no-config-lookup
      // didn't pick up the rule. We accept either:
      //   (a) explicit no-direct-worker-spawn diagnostic in stdout
      //   (b) explicit NFR-002 reference in stdout
      const reported =
        result.stdout.includes('no-direct-worker-spawn') ||
        result.stdout.includes('NFR-002');
      // If the spawn failed (no eslint binary), retry through normal `npm run lint`:
      if (!reported) {
        const fallback = await new Promise<{ stdout: string; code: number | null }>(
          (resolve) => {
            let stdout = '';
            const child = spawn('npm', ['run', 'lint', '--silent'], {
              cwd: ROOT,
              shell: false,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
            child.stderr.on('data', (c) => (stdout += c.toString('utf8')));
            child.on('close', (code) => resolve({ stdout, code }));
          },
        );
        const fallbackReported =
          fallback.stdout.includes('no-direct-worker-spawn') ||
          fallback.stdout.includes('NFR-002');
        expect(fallbackReported).toBe(true);
      } else {
        expect(reported).toBe(true);
      }
    } finally {
      fs.rmSync(fixturePath, { force: true });
    }
  }, 60_000);

  it('spawnGuardedWorker preloads the egress hook; egress from worker is blocked', async () => {
    // Write a worker script that attempts an outbound TLS connection.
    // The bootstrap shim should install the hook before the worker code runs;
    // the connection MUST throw EgressBlockedError.
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-worker-egress-'));
    const workerScript = path.join(scriptDir, 'attempt-egress.mjs');
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-worker-egress-home-'));

    const script = `
      import * as tls from 'node:tls';
      import { parentPort } from 'node:worker_threads';
      try {
        const sock = tls.connect({ host: '8.8.8.8', port: 443, servername: '8.8.8.8' });
        sock.destroy();
        parentPort.postMessage({ blocked: false });
      } catch (e) {
        parentPort.postMessage({ blocked: true, name: e?.name, message: String(e?.message ?? e) });
      }
    `;
    fs.writeFileSync(workerScript, script, 'utf8');

    try {
      const result = await new Promise<{
        blocked: boolean;
        name?: string;
        message?: string;
      }>((resolve, reject) => {
        const worker = spawnGuardedWorker(workerScript, {
          env: { ...process.env, CORPUS_HOME: tmpHome },
        });
        worker.once('message', (msg) => {
          worker.terminate().catch(() => {});
          resolve(msg as { blocked: boolean; name?: string; message?: string });
        });
        worker.once('error', (e) => reject(e));
        worker.once('exit', () => {
          // If the worker exited without sending a message, treat as failure.
        });
      });
      expect(result.blocked).toBe(true);
      const flaggedAsBlocked =
        result.name === 'EgressBlockedError' ||
        (result.message ?? '').includes('blocked by local-only enforcement');
      expect(flaggedAsBlocked).toBe(true);
    } finally {
      fs.rmSync(scriptDir, { recursive: true, force: true });
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);
});
