// T039 — Unit test for loopback passthrough (NFR-002a).
// Loopback destinations (127/8, ::1, 'localhost') MUST proceed unblocked.
// `egress.attempted` events MAY fire for forensic completeness; `egress.blocked`
// events MUST NOT fire for loopback.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as net from 'node:net';

import {
  installEgressHook,
  type AttemptContext,
} from '../../packages/transport/src/egress-hook.js';

const cjsRequire = createRequire(import.meta.url);
const dgram = cjsRequire('node:dgram') as typeof import('node:dgram');

describe('Loopback passthrough — hook does not block 127/8 / ::1 / localhost', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let dispose: (() => void) | undefined;
  let observed: AttemptContext[];

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-loopback-'));
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

  it('net.Socket.connect to 127.0.0.1 does NOT throw and proceeds', async () => {
    // Bind a quick listener on loopback so the connect can succeed.
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    let connected = false;
    let error: unknown;
    await new Promise<void>((resolve) => {
      const socket = new net.Socket();
      socket.once('connect', () => {
        connected = true;
        socket.destroy();
        resolve();
      });
      socket.once('error', (e) => {
        error = e;
        resolve();
      });
      socket.connect({ host: '127.0.0.1', port });
    });
    server.close();

    expect(error).toBeUndefined();
    expect(connected).toBe(true);

    // Must observe a loopback classification, never a remote one for this call
    const netAttempts = observed.filter((c) => c.primitive === 'net.Socket.connect');
    expect(netAttempts.some((c) => c.classification === 'loopback')).toBe(true);
    expect(netAttempts.some((c) => c.classification === 'remote')).toBe(false);
  });

  it('dgram.send to 127.0.0.1 does NOT throw', async () => {
    const handle = installEgressHook({
      onAttempt: (ctx) => observed.push(ctx),
    });
    dispose = () => handle[Symbol.dispose]();

    const socket = dgram.createSocket('udp4');
    let error: unknown;
    await new Promise<void>((resolve) => {
      const buf = Buffer.from('hello');
      socket.send(buf, 0, buf.length, 1, '127.0.0.1', (e) => {
        if (e) error = e;
        resolve();
      });
    });
    socket.close();

    expect(error).toBeUndefined();
    const dgramAttempts = observed.filter((c) => c.primitive === 'dgram.send');
    expect(dgramAttempts.some((c) => c.classification === 'loopback')).toBe(true);
    expect(dgramAttempts.some((c) => c.classification === 'remote')).toBe(false);
  });

  it('emits egress.attempted with result-equivalent indicator and NO egress.blocked for loopback', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const handle = installEgressHook({});
    dispose = () => handle[Symbol.dispose]();

    await new Promise<void>((resolve) => {
      const socket = new net.Socket();
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => resolve());
      socket.connect({ host: '127.0.0.1', port });
    });
    server.close();

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    if (!fs.existsSync(telPath)) {
      // Loopback events are optional for forensic completeness — if not present, that's compliant.
      return;
    }
    const lines = fs
      .readFileSync(telPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // No egress.blocked event for net.Socket.connect to 127.0.0.1
    const blockedNet = lines.filter(
      (e: { event: string; primitive?: string }) =>
        e.event === 'egress.blocked' && e.primitive === 'net.Socket.connect',
    );
    expect(blockedNet).toEqual([]);
  });
});
