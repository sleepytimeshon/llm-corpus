// T063 — Integration test: telemetry stream contains all required fields for
// egress.attempted + egress.blocked events.
//
// FR-OBS / US5 AS1: every egress attempt MUST produce structured events in
// `Paths.telemetry()`-resolved JSONL with timestamp, primitive,
// destination_host, destination_port, request_id, blocked_at.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

import { installEgressHook } from '../../packages/transport/src/egress-hook.js';

const cjsRequire = createRequire(import.meta.url);
const tls = cjsRequire('node:tls') as typeof import('node:tls');

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AnyEvent {
  event: string;
  timestamp?: string;
  primitive?: string;
  destination_host?: string;
  destination_port?: number;
  request_id?: string;
  blocked_at?: string;
  result?: string;
  doc_id?: string;
  pipeline_stage?: string;
}

describe('T063 — telemetry stream emits egress.attempted + egress.blocked with all required fields', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tel-egress-t063-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('appends egress.attempted + egress.blocked with FR-OBS fields to Paths.telemetry()', () => {
    const handle = installEgressHook();
    dispose = () => handle[Symbol.dispose]();

    // tls.connect to 1.1.1.1 — synchronous throw on remote.
    try {
      tls.connect({ host: '1.1.1.1', port: 443, servername: '1.1.1.1' });
    } catch {
      /* expected — egress hook synchronously throws */
    }

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    expect(fs.existsSync(telPath)).toBe(true);
    const events: AnyEvent[] = fs
      .readFileSync(telPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AnyEvent);

    const tlsEvents = events.filter((e) => e.primitive === 'tls.connect');
    expect(tlsEvents.length).toBeGreaterThanOrEqual(2);

    const attempted = tlsEvents.find((e) => e.event === 'egress.attempted');
    const blocked = tlsEvents.find((e) => e.event === 'egress.blocked');
    expect(attempted).toBeDefined();
    expect(blocked).toBeDefined();

    // egress.attempted required FR-OBS fields
    expect(attempted!.timestamp).toMatch(ISO8601);
    expect(attempted!.primitive).toBe('tls.connect');
    expect(attempted!.destination_host).toBe('1.1.1.1');
    expect(attempted!.destination_port).toBe(443);
    expect(attempted!.request_id).toMatch(UUID);

    // egress.blocked required FR-OBS fields
    expect(blocked!.timestamp).toMatch(ISO8601);
    expect(blocked!.primitive).toBe('tls.connect');
    expect(blocked!.destination_host).toBe('1.1.1.1');
    expect(blocked!.destination_port).toBe(443);
    expect(blocked!.request_id).toMatch(UUID);
    expect(blocked!.result).toBe('blocked');
    expect(blocked!.blocked_at).toBe('in_process_hook');

    // attempted + blocked must share the same request_id (per-call correlation)
    expect(attempted!.request_id).toBe(blocked!.request_id);
  });
});
