// SP-008 T038 — telemetry-log scanner.
//
// Reads `telemetryLogPath` line-by-line via readline-on-stream
// (memory-bounded); Zod-parses each line against the
// engagement.corpus_find_invoked + engagement.acceptance_event schemas;
// filters by timestamp within [since, until]; iterates rotated logs whose
// mtime falls in the window per the SP-003 rotation file-naming
// convention.
//
// Per FR-ENGAGEMENT-016 + Constitution VII: accepts AbortSignal; aborts
// mid-scan on signal. The per-invocation timeout lives in
// engagement-proxy-command.ts (setTimeout + clearTimeout +
// controller.abort()) — NEVER Promise.race(setTimeout).
//
// On parse failure for a line: increments parse_errors_count AND emits
// engagement.report_telemetry_parse_failed.
//
// References:
//   - specs/008-user-acceptance/tasks.md T038
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     (ADR-017)
//   - Constitution Principles V, VII, XIII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {
  emitTelemetry,
  EngagementCorpusFindInvokedEventZodSchema,
  EngagementAcceptanceEventZodSchema,
  type EngagementCorpusFindInvokedEvent,
  type EngagementAcceptanceEvent,
} from '@llm-corpus/contracts';

export type ScannedEvent = EngagementCorpusFindInvokedEvent | EngagementAcceptanceEvent;

export interface ScanInput {
  readonly telemetryLogPath: string;
  readonly since: string;
  readonly until: string;
}

export interface ScanResult {
  readonly events: readonly ScannedEvent[];
  readonly parse_errors_count: number;
}

/**
 * Enumerate the candidate log files for the scan: the active
 * `telemetryLogPath` plus any rotated logs in the same directory whose
 * name matches the SP-003 rotation pattern (`<basename>.<n>` where the
 * full file name still ends with the active log's extension OR the
 * full file name is `<active>.<n>`). The fixture at
 * `tests/fixtures/sp008-engagement/telemetry-fixture-rotated/` uses the
 * canonical `<active>.<n>` form (`telemetry.jsonl` + `telemetry.jsonl.1`).
 *
 * Per ADR-017: include a rotated file IFF its mtime falls within
 * `[since, until]`. The active log is ALWAYS included regardless of mtime
 * (operator may have queried a window that includes events post-rotation).
 */
async function enumerateRotatedFiles(
  activePath: string,
  since: string,
  until: string,
): Promise<readonly string[]> {
  const out: string[] = [];
  const exists = await fsp
    .stat(activePath)
    .then(() => true)
    .catch(() => false);
  if (exists) out.push(activePath);

  const dir = path.dirname(activePath);
  const activeBasename = path.basename(activePath);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return out;
  }

  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);

  // Rotated files match: <activeBasename>.<n> where n is a positive integer.
  const rotatedRe = new RegExp(
    `^${activeBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[1-9][0-9]*$`,
  );

  for (const entry of entries) {
    if (!rotatedRe.test(entry)) continue;
    const full = path.join(dir, entry);
    try {
      const st = await fsp.stat(full);
      const mtimeMs = st.mtimeMs;
      if (mtimeMs >= sinceMs && mtimeMs <= untilMs) {
        out.push(full);
      }
    } catch {
      // unreadable file — skip silently
    }
  }
  // Active log last so events appear roughly chronologically; rotated
  // logs are older and come first.
  out.sort((a, b) => {
    if (a === activePath) return 1;
    if (b === activePath) return -1;
    return a < b ? 1 : -1;
  });
  return out;
}

async function scanOneFile(
  filePath: string,
  since: string,
  until: string,
  signal: AbortSignal,
): Promise<ScanResult> {
  const events: ScannedEvent[] = [];
  let parse_errors_count = 0;
  if (!fs.existsSync(filePath)) {
    return { events, parse_errors_count };
  }

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    const pendingEmits: Array<Promise<void>> = [];
    const onAbort = (): void => {
      rl.close();
      stream.destroy();
      reject(signal.reason ?? new Error('aborted'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    rl.on('line', (line) => {
      lineNumber += 1;
      if (line.length === 0) return;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(line);
      } catch (err) {
        parse_errors_count += 1;
        const msg = err instanceof Error ? err.message : String(err);
        pendingEmits.push(
          (async () => {
            try {
              await emitTelemetry({
                event: 'engagement.report_telemetry_parse_failed',
                timestamp: new Date().toISOString(),
                telemetry_log_path: filePath,
                line_number: lineNumber,
                error_message: msg.slice(0, 1024),
              });
            } catch {
              /* swallow */
            }
          })(),
        );
        return;
      }
      const obj = parsedJson as { event?: string };
      if (obj.event === 'engagement.corpus_find_invoked') {
        const r = EngagementCorpusFindInvokedEventZodSchema.safeParse(obj);
        if (!r.success) {
          parse_errors_count += 1;
          pendingEmits.push(
            (async () => {
              try {
                await emitTelemetry({
                  event: 'engagement.report_telemetry_parse_failed',
                  timestamp: new Date().toISOString(),
                  telemetry_log_path: filePath,
                  line_number: lineNumber,
                  error_message: r.error.message.slice(0, 1024),
                });
              } catch {
                /* swallow */
              }
            })(),
          );
          return;
        }
        if (r.data.timestamp >= since && r.data.timestamp <= until) {
          events.push(r.data);
        }
      } else if (obj.event === 'engagement.acceptance_event') {
        const r = EngagementAcceptanceEventZodSchema.safeParse(obj);
        if (!r.success) {
          parse_errors_count += 1;
          pendingEmits.push(
            (async () => {
              try {
                await emitTelemetry({
                  event: 'engagement.report_telemetry_parse_failed',
                  timestamp: new Date().toISOString(),
                  telemetry_log_path: filePath,
                  line_number: lineNumber,
                  error_message: r.error.message.slice(0, 1024),
                });
              } catch {
                /* swallow */
              }
            })(),
          );
          return;
        }
        if (r.data.timestamp >= since && r.data.timestamp <= until) {
          events.push(r.data);
        }
      }
      // Non-engagement.* events are silently skipped (not counted as parse
      // errors — they may be valid SP-001..SP-007 events).
    });
    rl.on('close', () => {
      signal.removeEventListener('abort', onAbort);
      // Wait for any in-flight parse-failure emits before resolving so the
      // caller's report is consistent.
      Promise.all(pendingEmits).finally(() => resolve());
    });
    rl.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });

  return { events, parse_errors_count };
}

/**
 * Scan the telemetry log (and any rotated logs) for engagement.* events
 * in the window. Memory-bounded (readline-on-stream); cancellable
 * (AbortSignal). ZERO `process.exit` (Constitution XI).
 */
export async function scanTelemetryLog(
  input: ScanInput,
  signal: AbortSignal,
): Promise<ScanResult> {
  const files = await enumerateRotatedFiles(
    input.telemetryLogPath,
    input.since,
    input.until,
  );
  const allEvents: ScannedEvent[] = [];
  let totalErrors = 0;
  for (const f of files) {
    if (signal.aborted) {
      throw signal.reason ?? new Error('aborted');
    }
    const r = await scanOneFile(f, input.since, input.until, signal);
    allEvents.push(...r.events);
    totalErrors += r.parse_errors_count;
  }
  return { events: allEvents, parse_errors_count: totalErrors };
}
