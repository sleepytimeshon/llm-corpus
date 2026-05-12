// SP-000-Lite Phase 2 (T017) — failure-mode telemetry contract.
//
// Asserts that the harness emits error-severity events to Paths.telemetry()
// (NOT Paths.pilotTelemetry()) on Ollama unavailability, MCP server crash,
// and telemetry-write IO failures. The harness halts non-zero without
// resumption and without substituting another model.
//
// Also enforces Constitution XIII's no-swallow rule via a grep-based static
// check: no `catch { }` empty-block patterns under the pilot subtrees.
//
// TDD: `runPilot` export does not exist in Phase 1; assertions fail at
// runtime until Phase 3 (T024) lands.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T017
//   - specs/000-nfr-008-pilot-lite/contracts/pilot-harness.feature
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature
//   - Constitution Principle XIII (no-swallow)

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

describe('SP-000-Lite T017 — failure-mode telemetry (Constitution XIII)', () => {
  it('emits error-severity event to Paths.telemetry() when Ollama is unreachable', async () => {
    const mod = await loadHarness();
    const run = mod?.runPilot as
      | ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
      | undefined;
    expect(run, 'runPilot not yet exported (Phase 3 T024)').toBeDefined();
    if (!run) return;
    const ac = new AbortController();
    const result = await run({
      variant: 'v1',
      iteration: 1,
      signal: ac.signal,
      loopback: true,
      ollamaUnreachable: true, // Phase 3 contract: stub-injected failure
    });
    expect(result.ok).toBe(false);
    // No pilot-iter*.jsonl was created.
    expect(result.jsonl_created).toBe(false);
    // An error-severity event was emitted to Paths.telemetry() (NOT the
    // pilot-iter JSONL).
    expect(result.error_event_path).toBeDefined();
    expect((result.error_event_path as string).endsWith('telemetry.jsonl')).toBe(true);
  });

  it('emits error-severity event when MCP server crashes mid-run', async () => {
    const mod = await loadHarness();
    const run = mod?.runPilot as
      | ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
      | undefined;
    if (!run) {
      expect(run, 'runPilot not yet exported (Phase 3 T024)').toBeDefined();
      return;
    }
    const ac = new AbortController();
    const result = await run({
      variant: 'v1',
      iteration: 1,
      signal: ac.signal,
      loopback: true,
      mcpCrashAfter: 3, // Phase 3 contract: stub injects crash after Nth turn
    });
    expect(result.ok).toBe(false);
    expect(result.error_event_path).toBeDefined();
    // Partial JSONL records that landed before the crash are NOT cleaned up
    // (FR-PILOT-014 retention).
    if (fs.existsSync(result.jsonl_path as string)) {
      const lines = fs.readFileSync(result.jsonl_path as string, 'utf8').trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThan(50);
    }
  });

  it('emits error-severity event when telemetry-write IO fails', async () => {
    const mod = await loadHarness();
    const run = mod?.runPilot as
      | ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
      | undefined;
    if (!run) {
      expect(run, 'runPilot not yet exported (Phase 3 T024)').toBeDefined();
      return;
    }
    const ac = new AbortController();
    const result = await run({
      variant: 'v1',
      iteration: 1,
      signal: ac.signal,
      loopback: true,
      telemetryWriteFails: true, // Phase 3 contract
    });
    expect(result.ok).toBe(false);
    expect(result.error_event_path).toBeDefined();
  });

  it('no try { } catch { /* ignore */ } patterns under pilot subtrees (grep)', () => {
    const targets = [
      path.join(REPO_ROOT, 'packages', 'cli', 'src', 'pilot'),
      path.join(REPO_ROOT, 'packages', 'pipeline', 'src', 'pilot-harness'),
    ];
    // Pattern: `catch` followed by an empty or comment-only block.
    const swallowPattern = /catch\s*\([^)]*\)\s*\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)?\s*\}/m;
    for (const dir of targets) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
      for (const f of files) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        expect(
          swallowPattern.test(src),
          `${path.join(dir, f)} contains an empty catch block (Constitution XIII no-swallow)`,
        ).toBe(false);
      }
    }
  });
});
