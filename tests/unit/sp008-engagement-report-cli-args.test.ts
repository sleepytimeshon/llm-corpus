// SP-008 T035 — RED unit test for the engagement-proxy report args parser.
//
// References:
//   - specs/008-user-acceptance/tasks.md T035 / T037
//   - specs/008-user-acceptance/data-model.md Entity 7
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-003, SC-008-013,
//     SC-008-018
//   - Constitution Principles V, VII

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseEngagementProxyReportArgs } from '../../packages/cli/src/engagement/engagement-proxy-report-args-parser.js';
import { EngagementProxyWindowInvalidError } from '@llm-corpus/contracts';

describe('SP-008 T035 — engagement-proxy report args parser', () => {
  let tempHome: string;
  let prev: string | undefined;
  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-args-'));
    prev = process.env.CORPUS_HOME;
    process.env.CORPUS_HOME = tempHome;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prev;
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('applies defaults: since = now-7d, until = now, format = text, timeout_ms = 30000', () => {
    const args = parseEngagementProxyReportArgs([]);
    expect(args.format).toBe('text');
    expect(args.timeout_ms).toBe(30000);
    const sinceMs = Date.parse(args.since);
    const untilMs = Date.parse(args.until);
    expect(untilMs - sinceMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5000);
    expect(untilMs - sinceMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 5000);
  });

  it('accepts --since and --until in ISO-8601', () => {
    const args = parseEngagementProxyReportArgs([
      '--since=2026-05-01T00:00:00Z',
      '--until=2026-05-10T00:00:00Z',
    ]);
    expect(args.since).toBe('2026-05-01T00:00:00Z');
    expect(args.until).toBe('2026-05-10T00:00:00Z');
  });

  it('accepts --format=json', () => {
    const args = parseEngagementProxyReportArgs(['--format=json']);
    expect(args.format).toBe('json');
  });

  it('rejects --format=xml', () => {
    expect(() => parseEngagementProxyReportArgs(['--format=xml'])).toThrow();
  });

  it('rejects invalid ISO-8601 with EngagementProxyWindowInvalidError', () => {
    let caught: unknown;
    try {
      parseEngagementProxyReportArgs(['--since=not-a-date']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngagementProxyWindowInvalidError);
  });

  it('rejects since > until', () => {
    let caught: unknown;
    try {
      parseEngagementProxyReportArgs([
        '--since=2026-05-10T00:00:00Z',
        '--until=2026-05-01T00:00:00Z',
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngagementProxyWindowInvalidError);
  });

  it('rejects --timeout=0', () => {
    expect(() => parseEngagementProxyReportArgs(['--timeout-ms=0'])).toThrow();
  });

  it('rejects --timeout=700000', () => {
    expect(() => parseEngagementProxyReportArgs(['--timeout-ms=700000'])).toThrow();
  });

  it('accepts --telemetry-log=<path>', () => {
    const args = parseEngagementProxyReportArgs(['--telemetry-log=/tmp/x.jsonl']);
    expect(args.telemetry_log).toBe('/tmp/x.jsonl');
  });

  it('future --until accepted', () => {
    const args = parseEngagementProxyReportArgs([
      '--since=2026-05-01T00:00:00Z',
      '--until=2099-01-01T00:00:00Z',
    ]);
    expect(args.until).toBe('2099-01-01T00:00:00Z');
  });
});
