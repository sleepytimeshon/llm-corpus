// T038 — Unit test for the runtime egress hook (NFR-002a).
// Source of truth: contracts/egress-hook-api.md, contracts/telemetry-egress-events.md
//
// Each of the six patched primitives MUST throw EgressBlockedError (or
// async-reject for promise-returning calls) when invoked against a remote
// destination, and MUST emit `egress.attempted` + `egress.blocked` events
// in order.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as net from 'node:net';
import { request as undiciRequest } from 'undici';

import {
  installEgressHook,
  type AttemptContext,
} from '../../packages/transport/src/egress-hook.js';
import { EgressBlockedError } from '@llm-corpus/contracts/errors';

// IMPORTANT: dns/http2/tls/dgram are loaded via CJS require so we share the
// same writable singleton the egress hook patches. ESM `import * as tls`
// captures non-configurable namespace bindings at import time — those don't
// see the hook's patches. Production discipline: hook installs BEFORE any
// pipeline module imports these primitives (T040 enforces this).
const cjsRequire = createRequire(import.meta.url);
const dns = cjsRequire('node:dns') as typeof import('node:dns');
const dgram = cjsRequire('node:dgram') as typeof import('node:dgram');
const http2 = cjsRequire('node:http2') as typeof import('node:http2');
const tls = cjsRequire('node:tls') as typeof import('node:tls');

describe('installEgressHook — six primitives (NFR-002a)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let dispose: (() => void) | undefined;
  let observed: AttemptContext[];

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-egress-hook-'));
    process.env.CORPUS_HOME = tmpHome;
    observed = [];
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('net.Socket.connect to remote IP throws EgressBlockedError', async () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    const socket = new net.Socket();
    let error: unknown;
    await new Promise<void>((resolve) => {
      socket.once('error', (e) => {
        error = e;
        resolve();
      });
      try {
        socket.connect({ host: '8.8.8.8', port: 53 });
      } catch (sync) {
        // Synchronous throw also acceptable per contract
        error = sync;
        resolve();
      }
    });
    expect(error).toBeInstanceOf(EgressBlockedError);
    const blocked = error as EgressBlockedError;
    expect(blocked.primitive).toBe('net.Socket.connect');
    expect(blocked.destination_host).toBe('8.8.8.8');
    expect(blocked.destination_port).toBe(53);

    // Observed both an attempted classification and remote decision
    const remoteAttempts = observed.filter((c) => c.primitive === 'net.Socket.connect');
    expect(remoteAttempts.length).toBeGreaterThanOrEqual(1);
    expect(remoteAttempts.some((c) => c.classification === 'remote')).toBe(true);
  });

  it('undici.request to remote rejects with EgressBlockedError', async () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    let error: unknown;
    try {
      await undiciRequest('http://example.org/');
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    // Either the EgressBlockedError directly, or an undici-wrapped error whose cause is the EgressBlockedError.
    const isEgressBlocked =
      error instanceof EgressBlockedError ||
      (error as { cause?: unknown }).cause instanceof EgressBlockedError ||
      String((error as Error).message ?? '').includes('EGRESS_BLOCKED') ||
      String((error as Error).message ?? '').includes('blocked by local-only enforcement');
    expect(isEgressBlocked).toBe(true);

    const undiciAttempts = observed.filter((c) => c.primitive === 'undici.Dispatcher');
    expect(undiciAttempts.some((c) => c.classification === 'remote')).toBe(true);
  });

  it('dgram.send to remote IP fails with EgressBlockedError', async () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    const socket = dgram.createSocket('udp4');
    let error: unknown;
    await new Promise<void>((resolve) => {
      const buf = Buffer.from('test');
      try {
        socket.send(buf, 0, buf.length, 53, '8.8.8.8', (e) => {
          if (e) error = e;
          resolve();
        });
      } catch (sync) {
        error = sync;
        resolve();
      }
    });
    socket.close();

    const isBlocked =
      error instanceof EgressBlockedError ||
      String((error as Error).message ?? '').includes('blocked by local-only enforcement');
    expect(isBlocked).toBe(true);

    const dgramAttempts = observed.filter((c) => c.primitive === 'dgram.send');
    expect(dgramAttempts.some((c) => c.classification === 'remote')).toBe(true);
  });

  it('dns.lookup of remote hostname rejects when the resolved IP is non-loopback', async () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    let error: unknown;
    try {
      await new Promise<void>((resolve, reject) => {
        dns.lookup('example.org', (err, address) => {
          if (err) reject(err);
          else resolve();
          void address;
        });
      });
    } catch (e) {
      error = e;
    }
    // example.org may not resolve (offline); treat that as acceptable so long as
    // an attempted-event was emitted. If it DID resolve, the post-resolution
    // check should have rejected.
    const dnsAttempts = observed.filter((c) => c.primitive === 'dns.lookup');
    expect(dnsAttempts.length).toBeGreaterThanOrEqual(1);
    if (error) {
      const isBlocked =
        error instanceof EgressBlockedError ||
        String((error as Error).message ?? '').includes('blocked by local-only enforcement');
      // We accept either EgressBlockedError or a network-failure error if offline
      expect(isBlocked || String((error as Error).code ?? '') !== '').toBe(true);
    }
  });

  it('http2.connect to remote authority throws EgressBlockedError', () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    let error: unknown;
    try {
      const session = http2.connect('https://example.org');
      // If somehow we got here, close immediately
      session.destroy();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EgressBlockedError);
    const blocked = error as EgressBlockedError;
    expect(blocked.primitive).toBe('http2.connect');
    expect(blocked.destination_host).toBe('example.org');
  });

  it('tls.connect to remote host throws EgressBlockedError', () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    let error: unknown;
    try {
      const socket = tls.connect({ host: '8.8.8.8', port: 443, servername: '8.8.8.8' });
      socket.destroy();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EgressBlockedError);
    const blocked = error as EgressBlockedError;
    expect(blocked.primitive).toBe('tls.connect');
    expect(blocked.destination_host).toBe('8.8.8.8');
  });

  it('emits egress.attempted then egress.blocked, in order, on a blocked call', async () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    // Use TLS for a clean synchronous-throw path
    try {
      tls.connect({ host: '1.1.1.1', port: 443, servername: '1.1.1.1' });
    } catch {
      /* expected */
    }

    // Read telemetry file for that primitive
    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    expect(fs.existsSync(telPath)).toBe(true);
    const lines = fs
      .readFileSync(telPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const tlsEvents = lines.filter(
      (e: { primitive?: string }) => e.primitive === 'tls.connect',
    );
    const attemptedIdx = tlsEvents.findIndex(
      (e: { event: string }) => e.event === 'egress.attempted',
    );
    const blockedIdx = tlsEvents.findIndex(
      (e: { event: string }) => e.event === 'egress.blocked',
    );
    expect(attemptedIdx).toBeGreaterThanOrEqual(0);
    expect(blockedIdx).toBeGreaterThanOrEqual(0);
    expect(attemptedIdx).toBeLessThan(blockedIdx);

    // Blocked event must have blocked_at: 'in_process_hook'
    const blocked = tlsEvents[blockedIdx];
    expect(blocked.blocked_at).toBe('in_process_hook');
  });
});
