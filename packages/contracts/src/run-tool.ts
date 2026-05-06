// T018 — runTool helper (Constitution VII, XII).
// Spawns a subprocess with an explicit arg array (no shell), propagates
// AbortSignal, captures stdout/stderr, returns Result<{stdout, stderr,
// exitCode}, ToolInvocationError>.
//
// All subprocess calls in this project MUST go through this helper
// (Constitution XII — Subprocess Hygiene). The `no-shell-string-exec` lint
// rule rejects `execSync`, `child_process.exec`, and string-formed shell
// commands.
//
// T067 — OS-firewall block detection. When a child exits non-zero AND its
// stderr contains an unambiguous kernel-rejection signal (ECONNREFUSED /
// ENETUNREACH) targeting a non-loopback host, runTool emits
// `egress.blocked` with `blocked_at: 'os_firewall'`. Otherwise the existing
// ToolInvocationError contract is preserved — the heuristic is conservative
// to avoid false-positive os_firewall events on unrelated subprocess
// failures.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ToolInvocationError } from './errors.js';
import { isLoopbackHost } from './loopback.js';
import { ok, err, type Result } from './result.js';
import { emitTelemetry, type PrimitiveType } from './telemetry.js';

export interface RunToolOptions {
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Wall-clock timeout in milliseconds. Default: undefined (no timeout). */
  timeoutMs?: number;
}

export interface RunToolSuccess {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute `name` with the given argv array, capturing stdout/stderr.
 * Returns `Result.ok` on exit-code 0 success; `Result.err(ToolInvocationError)`
 * otherwise.
 */
export async function runTool(
  name: string,
  args: readonly string[],
  opts: RunToolOptions,
): Promise<Result<RunToolSuccess, ToolInvocationError>> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    let child;
    try {
      child = spawn(name, [...args], {
        cwd: opts.cwd,
        env: opts.env,
        shell: false, // Constitution XII: no shell interpretation.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      resolve(
        err(
          new ToolInvocationError(
            'SPAWN_FAILED',
            name,
            args,
            null,
            String((cause as Error).message ?? ''),
            cause,
          ),
        ),
      );
      return;
    }

    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        child.kill('SIGTERM');
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (cause) => {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      resolve(
        err(
          new ToolInvocationError(
            'SPAWN_FAILED',
            name,
            args,
            null,
            String(cause.message),
            cause,
          ),
        ),
      );
    });

    child.on('close', async (code, signal) => {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);

      if (timedOut) {
        resolve(err(new ToolInvocationError('TIMEOUT', name, args, code, stderr)));
        return;
      }
      if (opts.signal?.aborted) {
        resolve(err(new ToolInvocationError('ABORTED', name, args, code, stderr)));
        return;
      }
      if (code === 0) {
        resolve(ok({ stdout, stderr, exitCode: 0 }));
        return;
      }
      // Non-zero exit OR killed by signal. T067 detection point: if stderr
      // shows an unambiguous kernel-rejection signal targeting a non-loopback
      // host, emit `egress.blocked` with `blocked_at: 'os_firewall'`. We
      // await the emit so callers reading the telemetry file synchronously
      // after the runTool promise resolves observe the event. Telemetry
      // errors must NEVER crash runTool — caught and swallowed.
      try {
        await maybeEmitOsFirewallBlock(stderr);
      } catch {
        /* telemetry must never crash runTool */
      }
      const exitCode = code ?? -1;
      resolve(
        err(
          new ToolInvocationError(
            signal ? 'ABORTED' : 'EXIT_NONZERO',
            name,
            args,
            exitCode,
            stderr,
          ),
        ),
      );
    });
  });
}

/* --- T067 — OS-firewall block detection ---------------------------------- */

/**
 * Match the canonical kernel-rejection patterns Node + most CLI tools surface
 * in stderr when an outbound connection is rejected at the OS layer.
 *
 *   "connect ECONNREFUSED 8.8.8.8:53"
 *   "connect ENETUNREACH 1.1.1.1:443"
 *
 * The heuristic is intentionally narrow: it MUST match an explicit kernel
 * errno code adjacent to a host:port pair. Generic "connection refused"
 * prose is rejected because it cannot reliably attribute a destination.
 */
const OS_FIREWALL_PATTERN =
  /(ECONNREFUSED|ENETUNREACH|EHOSTUNREACH)\s+([0-9.]+|\[[0-9a-fA-F:]+\]):(\d+)/;

interface OsFirewallSignal {
  errno: 'ECONNREFUSED' | 'ENETUNREACH' | 'EHOSTUNREACH';
  host: string;
  port: number;
}

function detectOsFirewallSignal(stderr: string): OsFirewallSignal | null {
  const m = stderr.match(OS_FIREWALL_PATTERN);
  if (!m) return null;
  const ernoRaw = m[1];
  const hostRaw = m[2];
  const portRaw = m[3];
  if (ernoRaw === undefined || hostRaw === undefined || portRaw === undefined) {
    return null;
  }
  const errno = ernoRaw as OsFirewallSignal['errno'];
  let host = hostRaw;
  // Strip IPv6 brackets if present.
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port < 0 || port > 65535) return null;
  return { errno, host, port };
}

/**
 * Emit an `egress.blocked` telemetry event with `blocked_at: 'os_firewall'`
 * when the stderr signal is unambiguous AND the destination is non-loopback.
 *
 * The primitive label is `net.Socket.connect` because subprocess egress
 * universally lands on the BSD-socket path; we don't have enough information
 * from stderr alone to distinguish UDP vs TCP vs TLS reliably, and the
 * blocked_at field already conveys the "this was an OS-layer block, not an
 * in-process hook" distinction.
 */
async function maybeEmitOsFirewallBlock(stderr: string): Promise<void> {
  if (!stderr) return;
  const signal = detectOsFirewallSignal(stderr);
  if (!signal) return;
  if (isLoopbackHost(signal.host)) return; // loopback ECONNREFUSED is not a firewall block
  const primitive: PrimitiveType = 'net.Socket.connect';
  await emitTelemetry({
    event: 'egress.blocked',
    timestamp: new Date().toISOString(),
    primitive,
    destination_host: signal.host,
    destination_port: signal.port,
    result: 'blocked',
    blocked_at: 'os_firewall',
    request_id: randomUUID(),
  });
}
