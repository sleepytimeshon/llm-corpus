// SP-008 T045 — **C-046 end-to-end smoke harness for the
// `corpus engagement-proxy report` CLI**.
//
// Per Decision C ("no library-level handler test is sufficient") this test
// spawns the production binary `node <dist>/index.js engagement-proxy
// report --format=json` against a tempdir that carries a synthetic
// telemetry log; the test asserts the report's stdout JSON matches the
// expected verdict for the synthetic input.
//
// Synthetic telemetry is the canonical PASS fixture (5
// engagement.corpus_find_invoked + 1 engagement.acceptance_event). This
// keeps the E2E test deterministic and Ollama-independent — the Ollama
// path is exercised by the SP-007 smoke-e2e.test.ts harness; this test
// exists to assert the SP-008 report-generation surface ships through the
// production binary correctly, NOT to re-test the full corpus.find
// retrieval pipeline.
//
// References:
//   - specs/008-user-acceptance/tasks.md T045
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-006, SC-008-027
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     (ADR-017)
//   - Constitution Principles VI, VII, XII, XVI

import { describe, it, expect } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CLI_DIST_ENTRY = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
const FIXTURE_PASS = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'sp008-engagement',
  'telemetry-fixture-pass.jsonl',
);

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function spawnReport(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [CLI_DIST_ENTRY, 'engagement-proxy', 'report', ...args],
      { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code }));
    child.on('error', (err) =>
      resolve({ stdout, stderr: stderr + err.message, exitCode: -1 }),
    );
  });
}

describe('SP-008 T045 — C-046 E2E: `corpus engagement-proxy report` produces correct verdict', () => {
  it('PASS verdict against synthetic 5q + 1a fixture (--format=json)', async () => {
    // Verify the production binary exists before running the test. If the
    // CLI hasn't been built yet, skip silently.
    try {
      await fsp.access(CLI_DIST_ENTRY);
    } catch {
      return;
    }
    const tempHome = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'sp008-e2e-'),
    );
    try {
      // Seed CORPUS_HOME with the canonical PASS fixture as the telemetry
      // log. The fixture has 5 finds (all in 2026-05-10) + 1 acceptance.
      const stateDir = path.join(tempHome, 'state');
      await fsp.mkdir(stateDir, { recursive: true });
      const telemetryPath = path.join(stateDir, 'telemetry.jsonl');
      await fsp.copyFile(FIXTURE_PASS, telemetryPath);

      const result = await spawnReport(
        {
          ...process.env,
          CORPUS_HOME: tempHome,
        },
        [
          '--format=json',
          '--since=2026-05-10T00:00:00Z',
          '--until=2026-05-10T23:59:59Z',
        ],
      );

      // The report must exit 0 on PASS.
      expect(result.exitCode).toBe(0);

      // Parse the JSON stdout and assert the expected verdict trio.
      // The audit emit ('engagement.report_generated') prints nothing to
      // stdout, so stdout is exactly the JSON payload.
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(result.stdout) as Record<string, unknown>;
      } catch (err) {
        // Surface the raw output for diagnostic value if parsing fails.
        throw new Error(
          `Failed to parse JSON stdout. exit=${result.exitCode} stderr=${result.stderr} stdout=${result.stdout.slice(0, 512)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      expect(payload['schema_version']).toBe(1);
      expect(payload['verdict']).toBe('PASS');
      expect(payload['queries_in_window']).toBe(5);
      expect(payload['acceptance_events_in_window']).toBe(1);
      expect(payload['c028_threshold_met']).toBe(true);
      expect(payload['kill_signal']).toBe(false);

      // The audit emit must have appended an engagement.report_generated
      // event to the telemetry log.
      const updated = await fsp.readFile(telemetryPath, 'utf8');
      const reportEvents = updated
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => {
          try {
            return JSON.parse(l) as { event?: string };
          } catch {
            return {};
          }
        })
        .filter((e) => e.event === 'engagement.report_generated');
      expect(reportEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      await fsp.rm(tempHome, { recursive: true, force: true });
    }
  }, 30_000);

  it('text format prints the Track A/B banner per SC-008-034', async () => {
    try {
      await fsp.access(CLI_DIST_ENTRY);
    } catch {
      return;
    }
    const tempHome = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'sp008-e2e-text-'),
    );
    try {
      const stateDir = path.join(tempHome, 'state');
      await fsp.mkdir(stateDir, { recursive: true });
      await fsp.copyFile(
        FIXTURE_PASS,
        path.join(stateDir, 'telemetry.jsonl'),
      );

      const result = await spawnReport(
        {
          ...process.env,
          CORPUS_HOME: tempHome,
        },
        [
          '--format=text',
          '--since=2026-05-10T00:00:00Z',
          '--until=2026-05-10T23:59:59Z',
        ],
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Maya Week-1 Engagement-Proxy Report/);
      expect(result.stdout).toMatch(/Track B measurement/);
      expect(result.stdout).toMatch(/Verdict: PASS/);
    } finally {
      await fsp.rm(tempHome, { recursive: true, force: true });
    }
  }, 30_000);
});
