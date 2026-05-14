// SP-006 T020 — Unit test: daemon startup recovery hook ordering.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-001
//   - specs/006-hardening/contracts/adr-kill9-recovery.md
//   - Constitution VI, VII, IX, XI
//
// Verifies daemon `main()` calls runRecoveryScan BEFORE inbox watcher
// activates. Pre-Phase-3 there is no recovery hook; once T027 lands the
// daemon emits `daemon.started` + invokes the scanner in the right order.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Paths } from '@llm-corpus/contracts';
import { main as daemonMain } from '../../packages/daemon/src/index.js';

beforeEach(() => {
  const telemetryPath = Paths.telemetry();
  if (fs.existsSync(telemetryPath)) fs.unlinkSync(telemetryPath);
  // Drop any leftover lock.
  const lockPath = Paths.drainLock();
  if (fs.existsSync(lockPath)) {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
  // Ensure xdg directories.
  for (const d of [Paths.inbox(), Paths.pending(), Paths.processed(), Paths.failed(), Paths.docsStore()]) {
    fs.mkdirSync(d, { recursive: true });
  }
});

function readEvents(): Array<{ event: string; [k: string]: unknown }> {
  const telemetryPath = Paths.telemetry();
  if (!fs.existsSync(telemetryPath)) return [];
  return fs
    .readFileSync(telemetryPath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { event: string; [k: string]: unknown });
}

describe('daemon startup — recovery scan ordering', () => {
  it('emits daemon.started before recovery.scan_started/skipped', async () => {
    const controller = new AbortController();
    // Schedule abort after a short window so the daemon exits cleanly.
    setTimeout(() => controller.abort(), 200);
    await daemonMain({
      noExit: true,
      controller,
      classifyEnabled: false,
      retrievalEnabled: false,
    });
    const events = readEvents();
    const daemonStartedIdx = events.findIndex((e) => e.event === 'daemon.started');
    const scanIdx = events.findIndex(
      (e) =>
        e.event === 'recovery.scan_started' ||
        e.event === 'recovery.scan_skipped',
    );
    expect(daemonStartedIdx).toBeGreaterThanOrEqual(0);
    expect(scanIdx).toBeGreaterThan(daemonStartedIdx);
  });

  it('recovery scan runs BEFORE inbox watcher activates a drain', async () => {
    // Seed the inbox with a sentinel file BEFORE the daemon boots. The
    // recovery hook should emit its scan-skipped event (no prior session)
    // BEFORE any ingest.normalized event from the watcher.
    const inboxFile = path.join(Paths.inbox(), 'sentinel.md');
    await fsp.writeFile(inboxFile, '# Test\nbody', 'utf8');

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    await daemonMain({
      noExit: true,
      controller,
      classifyEnabled: false,
      retrievalEnabled: false,
    });
    const events = readEvents();
    const scanIdx = events.findIndex(
      (e) =>
        e.event === 'recovery.scan_started' ||
        e.event === 'recovery.scan_skipped',
    );
    const ingestIdx = events.findIndex((e) => e.event === 'ingest.normalized');
    // Recovery scan must emit before (or in absence of) the first
    // ingest.normalized event.
    if (ingestIdx !== -1) {
      expect(scanIdx).toBeGreaterThanOrEqual(0);
      expect(scanIdx).toBeLessThan(ingestIdx);
    } else {
      expect(scanIdx).toBeGreaterThanOrEqual(0);
    }
  });
});
