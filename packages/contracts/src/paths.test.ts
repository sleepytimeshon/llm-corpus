// T001 — Contract test for PREREQ-001 (Paths.pilotTelemetry resolver).
//
// Verifies that Paths.pilotTelemetry() exists, returns a directory path
// composed from Paths.state(), is distinct from Paths.telemetry() (file vs
// directory), and resolves under $HOME (NOT /tmp, /var, or os.tmpdir()).
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T001 / T003
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-005, FR-PILOT-006, SC-006
//   - Constitution Principle XIV (single resolver)
//
// TDD: this test MUST FAIL before T003 (the implementation) lands.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

describe('PREREQ-001 — Paths.pilotTelemetry() (contract)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.CORPUS_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('Paths.pilotTelemetry is exported as a function', async () => {
    const { Paths } = await freshImport();
    expect(typeof (Paths as unknown as Record<string, unknown>).pilotTelemetry).toBe('function');
  });

  it('returns exactly path.join(Paths.state(), "pilot-telemetry")', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-home';
    const { Paths } = await freshImport();
    expect(Paths.pilotTelemetry()).toBe(path.join(Paths.state(), 'pilot-telemetry'));
  });

  it('returns a directory path (no .jsonl extension)', async () => {
    const { Paths } = await freshImport();
    const result = Paths.pilotTelemetry();
    expect(result.endsWith('.jsonl')).toBe(false);
    expect(result.endsWith('pilot-telemetry')).toBe(true);
  });

  it('composes from Paths.state() (no new XDG base introduced)', async () => {
    process.env.CORPUS_HOME = '/tmp/h';
    const { Paths } = await freshImport();
    // Must literally begin with Paths.state() — proving derived-from, not parallel root.
    expect(Paths.pilotTelemetry().startsWith(Paths.state())).toBe(true);
    expect(Paths.pilotTelemetry()).toBe(path.join('/tmp/h', 'state', 'pilot-telemetry'));
  });

  it('is distinct from Paths.telemetry() (directory vs file)', async () => {
    process.env.CORPUS_HOME = '/tmp/h';
    const { Paths } = await freshImport();
    expect(Paths.pilotTelemetry()).not.toBe(Paths.telemetry());
    // Telemetry is a .jsonl file; pilotTelemetry is a directory.
    expect(Paths.telemetry().endsWith('telemetry.jsonl')).toBe(true);
    expect(Paths.pilotTelemetry().endsWith('pilot-telemetry')).toBe(true);
  });

  it('defaults to ~/.local/state/llm-corpus/pilot-telemetry when no env overrides', async () => {
    const { Paths } = await freshImport();
    const expected = path.join(os.homedir(), '.local', 'state', 'llm-corpus', 'pilot-telemetry');
    expect(Paths.pilotTelemetry()).toBe(expected);
  });

  it('honors XDG_STATE_HOME override', async () => {
    process.env.XDG_STATE_HOME = '/tmp/xdg-state';
    const { Paths } = await freshImport();
    expect(Paths.pilotTelemetry()).toBe(path.join('/tmp/xdg-state', 'llm-corpus', 'pilot-telemetry'));
  });

  it('honors CORPUS_HOME override and takes precedence over XDG', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-home';
    process.env.XDG_STATE_HOME = '/tmp/xdg-state';
    const { Paths } = await freshImport();
    expect(Paths.pilotTelemetry()).toBe(path.join('/tmp/corpus-home', 'state', 'pilot-telemetry'));
  });
});

async function freshImport(): Promise<typeof import('./paths.js')> {
  vi.resetModules();
  return (await import('./paths.js')) as typeof import('./paths.js');
}
