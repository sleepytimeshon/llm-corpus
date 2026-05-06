// T064 — Integration test: OS-firewall block detection emits
// `blocked_at: 'os_firewall'` telemetry event.
//
// FR-OBS / US5 AS2 / SC-004: when a child process under runTool fails with
// an OS-firewall-rejection signal (ECONNREFUSED / ENETUNREACH from a
// non-loopback target), runTool MUST emit an `egress.blocked` event with
// `blocked_at: 'os_firewall'`.
//
// Strategy: this test does NOT install an actual iptables rule (that is
// root-gated and lives in T044). Instead it exercises the runTool detection
// heuristic directly: spawn a child process whose stderr contains the
// canonical kernel-rejection strings + a non-loopback destination host,
// and assert the emitted telemetry envelope.
//
// We synthesize the failure by invoking a small Node child-process script
// that prints the exact stderr pattern and exits non-zero.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTool } from '../../packages/contracts/src/run-tool.js';
import { isErr } from '../../packages/contracts/src/result.js';

interface AnyEvent {
  event: string;
  primitive?: string;
  destination_host?: string;
  destination_port?: number;
  result?: string;
  blocked_at?: string;
  request_id?: string;
  timestamp?: string;
}

describe('T064 — runTool emits egress.blocked with blocked_at: os_firewall on ECONNREFUSED/ENETUNREACH', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let scriptPath: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tel-osfw-t064-'));
    process.env.CORPUS_HOME = tmpHome;
    // Synthetic child script that prints the canonical kernel-rejection
    // pattern to stderr and exits 1. Use a small Node script written to
    // disk; we avoid bash heredocs (Constitution XII).
    scriptPath = path.join(tmpHome, 'fake-firewall-fail.mjs');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('detects ECONNREFUSED with non-loopback target host and emits os_firewall telemetry', async () => {
    // Child writes the canonical "connect ECONNREFUSED 8.8.8.8:53" pattern
    // and exits 1.
    fs.writeFileSync(
      scriptPath,
      `process.stderr.write("connect ECONNREFUSED 8.8.8.8:53\\n"); process.exit(1);`,
    );
    const result = await runTool('node', [scriptPath], {});
    expect(isErr(result)).toBe(true);

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    expect(fs.existsSync(telPath)).toBe(true);
    const events: AnyEvent[] = fs
      .readFileSync(telPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AnyEvent);
    const fwBlocked = events.find(
      (e) => e.event === 'egress.blocked' && e.blocked_at === 'os_firewall',
    );
    expect(fwBlocked).toBeDefined();
    expect(fwBlocked!.destination_host).toBe('8.8.8.8');
    expect(fwBlocked!.destination_port).toBe(53);
    expect(fwBlocked!.result).toBe('blocked');
  });

  it('detects ENETUNREACH with non-loopback target host and emits os_firewall telemetry', async () => {
    fs.writeFileSync(
      scriptPath,
      `process.stderr.write("connect ENETUNREACH 1.1.1.1:443\\n"); process.exit(1);`,
    );
    const result = await runTool('node', [scriptPath], {});
    expect(isErr(result)).toBe(true);

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    const events: AnyEvent[] = fs.existsSync(telPath)
      ? fs
          .readFileSync(telPath, 'utf8')
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => JSON.parse(l) as AnyEvent)
      : [];
    const fwBlocked = events.find(
      (e) => e.event === 'egress.blocked' && e.blocked_at === 'os_firewall',
    );
    expect(fwBlocked).toBeDefined();
    expect(fwBlocked!.destination_host).toBe('1.1.1.1');
    expect(fwBlocked!.destination_port).toBe(443);
  });

  it('does NOT emit os_firewall telemetry for loopback ECONNREFUSED (no firewall block)', async () => {
    // Loopback ECONNREFUSED is just a closed local port — not a firewall block.
    fs.writeFileSync(
      scriptPath,
      `process.stderr.write("connect ECONNREFUSED 127.0.0.1:9999\\n"); process.exit(1);`,
    );
    const result = await runTool('node', [scriptPath], {});
    expect(isErr(result)).toBe(true);

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    if (fs.existsSync(telPath)) {
      const events: AnyEvent[] = fs
        .readFileSync(telPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as AnyEvent);
      const fwBlocked = events.find(
        (e) => e.event === 'egress.blocked' && e.blocked_at === 'os_firewall',
      );
      expect(fwBlocked).toBeUndefined();
    }
  });

  it('does NOT emit os_firewall telemetry on success (exit 0, no rejection pattern)', async () => {
    fs.writeFileSync(scriptPath, `process.stdout.write("ok\\n"); process.exit(0);`);
    const result = await runTool('node', [scriptPath], {});
    expect(result.ok).toBe(true);

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    if (fs.existsSync(telPath)) {
      const events: AnyEvent[] = fs
        .readFileSync(telPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as AnyEvent);
      expect(
        events.some(
          (e) => e.event === 'egress.blocked' && e.blocked_at === 'os_firewall',
        ),
      ).toBe(false);
    }
  });

  it('does NOT emit os_firewall telemetry on ambiguous failure (no kernel-rejection pattern)', async () => {
    // Child fails for a reason unrelated to network: missing module.
    fs.writeFileSync(
      scriptPath,
      `process.stderr.write("ReferenceError: foo is not defined\\n"); process.exit(1);`,
    );
    const result = await runTool('node', [scriptPath], {});
    expect(isErr(result)).toBe(true);

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    if (fs.existsSync(telPath)) {
      const events: AnyEvent[] = fs
        .readFileSync(telPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as AnyEvent);
      expect(
        events.some(
          (e) => e.event === 'egress.blocked' && e.blocked_at === 'os_firewall',
        ),
      ).toBe(false);
    }
  });
});
