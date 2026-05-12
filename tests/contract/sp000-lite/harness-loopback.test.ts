// SP-000-Lite Phase 2 (T016) — harness end-to-end contract test.
//
// Drives the harness against an in-process MCP loopback fixture + a stub
// Ollama HTTP responder, asserts the 50-event JSONL stream and atomic
// summary write under Paths.pilotTelemetry(), and verifies iteration-2
// retention semantics.
//
// Failure-mode telemetry (T017) lives in failure-mode-telemetry.test.ts.
//
// TDD: `runPilot` export does not exist in Phase 1; assertions fail at
// runtime until Phase 3 (T024) lands.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T016
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-001/004/014, SC-003/006
//   - specs/000-nfr-008-pilot-lite/contracts/pilot-harness.feature
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe('SP-000-Lite T016 — harness end-to-end loopback (FR-PILOT-001/014, SC-003)', () => {
  it('runPilot is exported from @llm-corpus/pipeline (Phase 3 T024)', async () => {
    const mod = await loadHarness();
    expect(mod).toBeDefined();
    expect(mod?.runPilot).toBeDefined();
    expect(typeof mod?.runPilot).toBe('function');
  });

  it('iteration 1 writes pilot-iter1.jsonl with exactly 50 events and pilot-iter1-summary.json', async () => {
    const mod = await loadHarness();
    const run = mod?.runPilot as
      | ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
      | undefined;
    expect(run, 'runPilot not yet exported (Phase 3 T024)').toBeDefined();
    if (!run) return;
    // Phase 3 will accept loopback-mode fixtures via opts. Until then, this
    // assertion fails because run is undefined.
    const ac = new AbortController();
    const result = await run({
      variant: 'v1',
      iteration: 1,
      signal: ac.signal,
      loopback: true, // Phase 3 contract
    });
    expect(result.ok).toBe(true);
    const jsonlPath = result.jsonl_path as string;
    const summaryPath = result.summary_path as string;
    expect(fs.existsSync(jsonlPath)).toBe(true);
    expect(fs.existsSync(summaryPath)).toBe(true);
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(50);
  });

  it('iteration 2 does NOT delete or overwrite iteration-1 artifacts (FR-PILOT-014)', async () => {
    const mod = await loadHarness();
    const run = mod?.runPilot as
      | ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
      | undefined;
    if (!run) {
      expect(run).toBeDefined();
      return;
    }
    const ac = new AbortController();
    const iter1 = await run({ variant: 'v1', iteration: 1, signal: ac.signal, loopback: true });
    const iter1JsonlMtime = fs.statSync(iter1.jsonl_path as string).mtimeMs;
    await run({ variant: 'v2', iteration: 2, signal: ac.signal, loopback: true });
    // Iteration-1 artifacts are unchanged on disk.
    expect(fs.existsSync(iter1.jsonl_path as string)).toBe(true);
    expect(fs.statSync(iter1.jsonl_path as string).mtimeMs).toBe(iter1JsonlMtime);
  });

  it('CLI rejects iteration ≥ 3 at argument validation (FR-PILOT-004)', async () => {
    const target = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'pilot', 'command.js');
    const mod = (await import(target).catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
    expect(mod).toBeDefined();
    const parse = mod?.parsePilotArgs as
      | ((rest: readonly string[]) => Record<string, unknown>)
      | undefined;
    expect(parse).toBeDefined();
    if (!parse) return;
    const result = parse(['run', '--variant', 'v1', '--iteration', '3']);
    expect(result.ok).toBe(false);
    expect((result.message as string).includes('iteration')).toBe(true);
  });
});

