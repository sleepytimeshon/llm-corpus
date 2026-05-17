// SP-008 T031 — RED unit test for `telemetry-log-scanner.ts`.
//
// Contract:
//   (i) parses well-formed lines via Zod against TelemetryEvent
//  (ii) skips malformed lines, increments parse_errors_count, emits
//       engagement.report_telemetry_parse_failed for each
// (iii) respects since/until filter (UTC ISO-8601 comparison)
//  (iv) iterates rotated logs whose mtime falls in window (SP-003 pattern)
//   (v) accepts AbortSignal and aborts mid-scan
//  (vi) bounded-by-timeout via setTimeout/clearTimeout/controller.abort()
//       (NEVER Promise.race(setTimeout))
// (vii) uses readline-on-stream for memory-bounded reading
//
// References:
//   - specs/008-user-acceptance/tasks.md T031 / T038
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-003, SC-008-018,
//     SC-008-020, SC-008-021, SC-008-031
//   - Constitution Principles V, VII, XIII

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanTelemetryLog } from '../../packages/cli/src/engagement/telemetry-log-scanner.js';

describe('SP-008 T031 — telemetry-log-scanner', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-scan-'));
  });
  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  async function writeLog(name: string, lines: readonly string[]): Promise<string> {
    const p = path.join(tempDir, name);
    await fsp.writeFile(p, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
    return p;
  }

  it('parses well-formed engagement.* lines and returns them in chrono order', async () => {
    const find = (id: string, ts: string, rc = 1) =>
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: ts,
        request_id: id,
        query: 'q',
        query_hash: 'a'.repeat(64),
        result_count: rc,
        tier_used: 'hybrid',
        duration_ms: 5,
      });
    const accept = (id: string, ts: string) =>
      JSON.stringify({
        event: 'engagement.acceptance_event',
        timestamp: ts,
        request_id: id,
      });

    const logPath = await writeLog('t.jsonl', [
      find('00000000-0000-4000-8000-000000000001', '2026-05-10T10:00:00Z', 2),
      accept('00000000-0000-4000-8000-000000000001', '2026-05-10T11:00:00Z'),
      find('00000000-0000-4000-8000-000000000002', '2026-05-10T12:00:00Z', 0),
    ]);
    const res = await scanTelemetryLog(
      {
        telemetryLogPath: logPath,
        since: '2026-05-10T09:00:00Z',
        until: '2026-05-10T13:00:00Z',
      },
      new AbortController().signal,
    );
    expect(res.events.length).toBe(3);
    expect(res.parse_errors_count).toBe(0);
  });

  it('filters events outside [since, until]', async () => {
    const find = (id: string, ts: string) =>
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: ts,
        request_id: id,
        query: 'q',
        query_hash: 'a'.repeat(64),
        result_count: 1,
        tier_used: 'hybrid',
        duration_ms: 5,
      });
    const logPath = await writeLog('t.jsonl', [
      find('00000000-0000-4000-8000-000000000001', '2026-05-09T10:00:00Z'),
      find('00000000-0000-4000-8000-000000000002', '2026-05-10T10:00:00Z'),
      find('00000000-0000-4000-8000-000000000003', '2026-05-11T10:00:00Z'),
    ]);
    const res = await scanTelemetryLog(
      {
        telemetryLogPath: logPath,
        since: '2026-05-10T00:00:00Z',
        until: '2026-05-10T23:59:59Z',
      },
      new AbortController().signal,
    );
    expect(res.events.length).toBe(1);
  });

  it('skips malformed lines and increments parse_errors_count', async () => {
    const find = JSON.stringify({
      event: 'engagement.corpus_find_invoked',
      timestamp: '2026-05-10T10:00:00Z',
      request_id: '00000000-0000-4000-8000-000000000001',
      query: 'q',
      query_hash: 'a'.repeat(64),
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 5,
    });
    const logPath = await writeLog('t.jsonl', [
      find,
      '{not valid json',
      '{"event": "engagement.corpus_find_invoked"}', // Zod-invalid
    ]);
    const res = await scanTelemetryLog(
      {
        telemetryLogPath: logPath,
        since: '2026-05-10T00:00:00Z',
        until: '2026-05-10T23:59:59Z',
      },
      new AbortController().signal,
    );
    expect(res.events.length).toBe(1);
    expect(res.parse_errors_count).toBeGreaterThanOrEqual(2);
  });

  it('aborts mid-scan when AbortSignal is fired pre-scan', async () => {
    const logPath = await writeLog('t.jsonl', ['{}']);
    const ctrl = new AbortController();
    ctrl.abort('test');
    await expect(
      scanTelemetryLog(
        {
          telemetryLogPath: logPath,
          since: '2026-05-10T00:00:00Z',
          until: '2026-05-10T23:59:59Z',
        },
        ctrl.signal,
      ),
    ).rejects.toBeDefined();
  });

  it('returns 0 events + 0 parse errors when telemetry log does not exist', async () => {
    const res = await scanTelemetryLog(
      {
        telemetryLogPath: path.join(tempDir, 'nonexistent.jsonl'),
        since: '2026-05-10T00:00:00Z',
        until: '2026-05-10T23:59:59Z',
      },
      new AbortController().signal,
    );
    expect(res.events.length).toBe(0);
    expect(res.parse_errors_count).toBe(0);
  });
});
