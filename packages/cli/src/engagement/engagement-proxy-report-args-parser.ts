// SP-008 T037 — argv parser for `corpus engagement-proxy report`.
//
// Defaults (computed BEFORE Zod per Engineer #1 handoff #5):
//   - since = now - 7 days (UTC)
//   - until = now (UTC)
//   - format = 'text'
//   - telemetry_log = Paths.telemetry()
//   - timeout_ms = 30000 (30 seconds)
//
// References:
//   - specs/008-user-acceptance/tasks.md T037
//   - specs/008-user-acceptance/data-model.md Entity 7
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     (ADR-017)
//   - Constitution Principles V, XI (zero process.exit — library boundary)

import {
  Paths,
  EngagementProxyReportArgsZodSchema,
  EngagementProxyWindowInvalidError,
  type EngagementProxyReportArgs,
} from '@llm-corpus/contracts';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ISO8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

interface RawArgs {
  since?: string;
  until?: string;
  format?: string;
  telemetry_log?: string;
  timeout_ms?: string;
}

function readValue(argv: readonly string[], i: number, flag: string): string {
  const a = argv[i];
  if (a === flag) {
    const next = argv[i + 1];
    return next ?? '';
  }
  return a!.slice(flag.length + 1); // flag=value form (flag + '=' + value)
}

function tokenize(argv: readonly string[]): { raw: RawArgs; consumedNext: Set<number> } {
  const raw: RawArgs = {};
  const consumedNext = new Set<number>();
  for (let i = 0; i < argv.length; i++) {
    if (consumedNext.has(i)) continue;
    const a = argv[i];
    if (a === undefined) continue;
    if (a === '--since' || a.startsWith('--since=')) {
      raw.since = readValue(argv, i, '--since');
      if (a === '--since') {
        consumedNext.add(i + 1);
      }
    } else if (a === '--until' || a.startsWith('--until=')) {
      raw.until = readValue(argv, i, '--until');
      if (a === '--until') {
        consumedNext.add(i + 1);
      }
    } else if (a === '--format' || a.startsWith('--format=')) {
      raw.format = readValue(argv, i, '--format');
      if (a === '--format') {
        consumedNext.add(i + 1);
      }
    } else if (a === '--telemetry-log' || a.startsWith('--telemetry-log=')) {
      raw.telemetry_log = readValue(argv, i, '--telemetry-log');
      if (a === '--telemetry-log') {
        consumedNext.add(i + 1);
      }
    } else if (a === '--timeout-ms' || a.startsWith('--timeout-ms=')) {
      raw.timeout_ms = readValue(argv, i, '--timeout-ms');
      if (a === '--timeout-ms') {
        consumedNext.add(i + 1);
      }
    } else if (a === '--timeout' || a.startsWith('--timeout=')) {
      // Alias per spec.md surface — `--timeout=<ms>`.
      raw.timeout_ms = readValue(argv, i, '--timeout');
      if (a === '--timeout') {
        consumedNext.add(i + 1);
      }
    }
  }
  return { raw, consumedNext };
}

/**
 * Compute defaults THEN validate via Zod (per Engineer #1 handoff #5 —
 * args parser computes defaults BEFORE handing to Zod). Throws
 * `EngagementProxyWindowInvalidError` on malformed ISO-8601 or
 * `since > until`. ZERO `process.exit` (Constitution XI).
 */
export function parseEngagementProxyReportArgs(
  argv: readonly string[],
): EngagementProxyReportArgs {
  const { raw } = tokenize(argv);

  const now = new Date();
  const sinceDefault = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
  const untilDefault = now.toISOString();

  const since = raw.since ?? sinceDefault;
  const until = raw.until ?? untilDefault;

  // Early ISO-8601 validation so we can throw the rich typed error.
  if (!ISO8601_RE.test(since)) {
    throw new EngagementProxyWindowInvalidError({
      since,
      until,
      reason: '--since is not a valid ISO-8601 timestamp',
    });
  }
  if (!ISO8601_RE.test(until)) {
    throw new EngagementProxyWindowInvalidError({
      since,
      until,
      reason: '--until is not a valid ISO-8601 timestamp',
    });
  }
  if (since > until) {
    throw new EngagementProxyWindowInvalidError({
      since,
      until,
      reason: 'since > until',
    });
  }

  const format = raw.format ?? 'text';
  const telemetry_log = raw.telemetry_log ?? Paths.telemetry();
  const timeout_ms = raw.timeout_ms !== undefined
    ? Number.parseInt(raw.timeout_ms, 10)
    : 30000;

  // Final Zod validation — strict catches unknown formats, out-of-range
  // timeout, etc.
  return EngagementProxyReportArgsZodSchema.parse({
    since,
    until,
    format,
    telemetry_log,
    timeout_ms,
  });
}
