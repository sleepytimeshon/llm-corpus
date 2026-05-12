// SP-000-Lite Phase 2 (T011) — contract test for path discipline
// (FR-PILOT-006, SC-006, Constitution XIV).
//
// Asserts that:
//   - Paths.pilotTelemetry() returns a directory under $HOME (NOT under
//     /tmp, /var, or os.tmpdir()).
//   - Paths.telemetry() returns a path distinct from Paths.pilotTelemetry()
//     (file vs directory).
//   - The harness writes telemetry to
//     path.join(Paths.pilotTelemetry(), `pilot-iter${N}.jsonl`) and summary
//     to `pilot-iter${N}-summary.json` via a not-yet-existing
//     `getHarnessPaths(iteration)` export (Phase 3 T024).
//   - No hardcoded path literal appears under packages/cli/src/pilot/ or
//     packages/pipeline/src/pilot-harness/ (grep-based assertion).
//
// TDD: `getHarnessPaths` export does not exist in Phase 1; assertion fails
// at runtime. The Paths resolver assertions pass already (PREREQ-001).
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T011
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-006, SC-006
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature
//   - Constitution Principle XIV

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { Paths } from '@llm-corpus/contracts/paths';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe('SP-000-Lite T011 — path discipline (FR-PILOT-006, Constitution XIV)', () => {
  it('Paths.pilotTelemetry() is a string', () => {
    expect(typeof Paths.pilotTelemetry()).toBe('string');
  });

  it('Paths.pilotTelemetry() resolves under $HOME, not /tmp, /var, or os.tmpdir()', () => {
    const p = Paths.pilotTelemetry();
    const home = os.homedir();
    // Must not reside under any forbidden system root.
    expect(p.startsWith('/tmp/')).toBe(false);
    expect(p.startsWith('/var/')).toBe(false);
    expect(p.startsWith(os.tmpdir() + path.sep)).toBe(false);
    // Default state path is under $HOME (unless XDG_STATE_HOME or CORPUS_HOME
    // is set in the test environment).
    const xdgState = process.env.XDG_STATE_HOME;
    const corpusHome = process.env.CORPUS_HOME;
    if (!xdgState && !corpusHome) {
      expect(p.startsWith(home)).toBe(true);
    }
  });

  it('Paths.pilotTelemetry() is distinct from Paths.telemetry() (directory vs file)', () => {
    expect(Paths.pilotTelemetry()).not.toBe(Paths.telemetry());
    // Sanity: pilotTelemetry is a directory path; telemetry is the .jsonl file.
    expect(Paths.telemetry().endsWith('.jsonl')).toBe(true);
    expect(Paths.pilotTelemetry().endsWith('.jsonl')).toBe(false);
  });

  it('Paths.pilotTelemetry() composes from Paths.state() (no new XDG base)', () => {
    expect(Paths.pilotTelemetry().startsWith(Paths.state())).toBe(true);
  });

  it('getHarnessPaths(iteration) export exists in @llm-corpus/pipeline (Phase 3 T024)', async () => {
    const mod = await loadHarness();
    expect(mod).toBeDefined();
    expect(mod?.getHarnessPaths).toBeDefined();
    expect(typeof mod?.getHarnessPaths).toBe('function');
  });

  it('getHarnessPaths(1) resolves the iteration-1 jsonl and summary paths', async () => {
    const mod = await loadHarness();
    const fn = mod?.getHarnessPaths as ((it: 1 | 2) => Record<string, string>) | undefined;
    expect(fn).toBeDefined();
    if (!fn) return;
    const paths = fn(1);
    expect(paths.jsonl).toBe(path.join(Paths.pilotTelemetry(), 'pilot-iter1.jsonl'));
    expect(paths.summary).toBe(path.join(Paths.pilotTelemetry(), 'pilot-iter1-summary.json'));
  });

  it('getHarnessPaths(2) resolves the iteration-2 jsonl and summary paths', async () => {
    const mod = await loadHarness();
    const fn = mod?.getHarnessPaths as ((it: 1 | 2) => Record<string, string>) | undefined;
    if (!fn) {
      expect(fn).toBeDefined();
      return;
    }
    const paths = fn(2);
    expect(paths.jsonl).toBe(path.join(Paths.pilotTelemetry(), 'pilot-iter2.jsonl'));
    expect(paths.summary).toBe(path.join(Paths.pilotTelemetry(), 'pilot-iter2-summary.json'));
  });

  it('no hardcoded path literal under packages/cli/src/pilot/ (grep)', () => {
    const dir = path.join(REPO_ROOT, 'packages', 'cli', 'src', 'pilot');
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const forbidden = /["'](\/tmp\/|\/var\/|\/data\/|llm-corpus\/)/;
    for (const f of entries) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src.match(forbidden), `${f} contains a forbidden path literal`).toBeNull();
    }
  });

  it('no hardcoded path literal under packages/pipeline/src/pilot-harness/ (grep)', () => {
    const dir = path.join(REPO_ROOT, 'packages', 'pipeline', 'src', 'pilot-harness');
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const forbidden = /["'](\/tmp\/|\/var\/|\/data\/|llm-corpus\/)/;
    for (const f of entries) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src.match(forbidden), `${f} contains a forbidden path literal`).toBeNull();
    }
  });
});
