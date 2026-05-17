// SP-008 T046 — RED unit test for rotated-log scanning per ADR-017.
//
// The fixture at `tests/fixtures/sp008-engagement/telemetry-fixture-rotated/`
// carries:
//   - telemetry.jsonl        (active log; mtime now)
//   - telemetry.jsonl.1      (rotated log; mtime set so it falls in window)
//
// The scanner must enumerate BOTH files when the active log path is
// supplied AND the rotated log's mtime falls within [since, until]; the
// events from both contribute toward the aggregated counts.
//
// References:
//   - specs/008-user-acceptance/tasks.md T046
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-003, SC-008-020
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     "Rotated-log scan convention"
//   - Constitution Principles V, XIV

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanTelemetryLog } from '../../packages/cli/src/engagement/telemetry-log-scanner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FIXTURE_DIR = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'sp008-engagement',
  'telemetry-fixture-rotated',
);

describe('SP-008 T046 — scanner reads rotated logs (SP-003 convention)', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-rotated-'));
    // Copy fixture files into tempDir so we can set mtime without
    // corrupting the committed fixture.
    const activeSrc = path.join(FIXTURE_DIR, 'telemetry.jsonl');
    const rotatedSrc = path.join(FIXTURE_DIR, 'telemetry.jsonl.1');
    const activeDst = path.join(tempDir, 'telemetry.jsonl');
    const rotatedDst = path.join(tempDir, 'telemetry.jsonl.1');
    await fsp.copyFile(activeSrc, activeDst);
    await fsp.copyFile(rotatedSrc, rotatedDst);
    // Bring mtime of rotated log into the test window.
    const inWindow = new Date('2026-05-10T15:30:00Z');
    await fsp.utimes(rotatedDst, inWindow, inWindow);
  });
  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('scans active + rotated logs; events from both contribute toward counts', async () => {
    const res = await scanTelemetryLog(
      {
        telemetryLogPath: path.join(tempDir, 'telemetry.jsonl'),
        since: '2026-05-10T14:00:00Z',
        until: '2026-05-10T17:00:00Z',
      },
      new AbortController().signal,
    );
    // Fixture: active log has 2 find + 1 accept; rotated has 2 find.
    // Total: 4 finds + 1 accept (all within window).
    const finds = res.events.filter(
      (e) => e.event === 'engagement.corpus_find_invoked',
    );
    const accepts = res.events.filter(
      (e) => e.event === 'engagement.acceptance_event',
    );
    expect(finds.length).toBe(4);
    expect(accepts.length).toBe(1);
    expect(res.parse_errors_count).toBe(0);
  });

  it('excludes rotated logs whose mtime is outside the window', async () => {
    // Move rotated log's mtime OUTSIDE the window.
    const outside = new Date('2026-05-01T00:00:00Z');
    await fsp.utimes(path.join(tempDir, 'telemetry.jsonl.1'), outside, outside);
    const res = await scanTelemetryLog(
      {
        telemetryLogPath: path.join(tempDir, 'telemetry.jsonl'),
        since: '2026-05-10T14:00:00Z',
        until: '2026-05-10T17:00:00Z',
      },
      new AbortController().signal,
    );
    // Only the active log contributes (2 finds + 1 accept).
    expect(res.events.length).toBe(3);
  });
});
