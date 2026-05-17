// SP-008 T026 — `engagement.acceptance_event` writer per ADR-016 +
// FR-ENGAGEMENT-002.
//
// Contract:
//   (a) scans Paths.telemetry() line-by-line for the matching
//       engagement.corpus_find_invoked event by request_id
//   (b) throws AcceptUnknownRequestIdError if absent
//   (c) throws AcceptZeroResultQueryError if result_count === 0
//   (d) throws AcceptDuplicateRequestIdError (INFORMATIONAL) if a prior
//       engagement.acceptance_event exists for the same request_id; ZERO new
//       event written
//   (e) appends engagement.acceptance_event via emitTelemetry() (SP-003
//       atomic-append, ≤ 4 KB per line)
//   (f) honors AbortSignal — aborts mid-scan on SIGINT
//
// References:
//   - specs/008-user-acceptance/tasks.md T026
//   - specs/008-user-acceptance/data-model.md Entity 2
//   - specs/008-user-acceptance/contracts/adr-acceptance-event-definition.md
//     (ADR-016)
//   - Constitution Principles V, VII, IX, X, XI (zero process.exit), XIII

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import {
  Paths,
  emitTelemetry,
  AcceptUnknownRequestIdError,
  AcceptZeroResultQueryError,
  AcceptDuplicateRequestIdError,
  type AcceptArgs,
} from '@llm-corpus/contracts';

interface FindEventLite {
  readonly request_id: string;
  readonly result_count: number;
}

interface AcceptEventLite {
  readonly request_id: string;
  readonly timestamp: string;
}

interface ScanResult {
  find: FindEventLite | undefined;
  priorAccept: AcceptEventLite | undefined;
}

async function scanTelemetryForRequest(
  telemetryPath: string,
  requestId: string,
  signal: AbortSignal,
): Promise<ScanResult> {
  let result: ScanResult = { find: undefined, priorAccept: undefined };
  if (!fs.existsSync(telemetryPath)) return result;

  return new Promise<ScanResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const stream = fs.createReadStream(telemetryPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
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
      if (line.length === 0) return;
      try {
        const obj = JSON.parse(line) as {
          event?: string;
          request_id?: string;
          result_count?: number;
          timestamp?: string;
        };
        if (obj.event === 'engagement.corpus_find_invoked' && obj.request_id === requestId) {
          if (typeof obj.result_count === 'number') {
            result = {
              ...result,
              find: { request_id: requestId, result_count: obj.result_count },
            };
          }
        } else if (
          obj.event === 'engagement.acceptance_event' &&
          obj.request_id === requestId &&
          typeof obj.timestamp === 'string'
        ) {
          result = {
            ...result,
            priorAccept: { request_id: requestId, timestamp: obj.timestamp },
          };
        }
      } catch {
        // malformed line — skip silently in writer's scan; the report
        // scanner's defensive emission handles surfacing parse failures.
      }
    });
    rl.on('close', () => {
      if (aborted) return;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    });
    rl.on('error', (err) => {
      if (aborted) return;
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

/**
 * Validate + write the `engagement.acceptance_event` for the supplied
 * request_id. Throws typed errors per ADR-016. ZERO `process.exit`
 * (Constitution XI — library boundary).
 *
 * The caller (`accept-command.ts`) is responsible for translating thrown
 * errors into stderr + exit codes:
 *   - AcceptUnknownRequestIdError → exit 1
 *   - AcceptZeroResultQueryError → exit 1
 *   - AcceptDuplicateRequestIdError → stdout "already accepted: …" + exit 0
 */
export async function runAcceptanceEventWriter(
  args: AcceptArgs,
  signal: AbortSignal,
): Promise<void> {
  const telemetryPath = Paths.telemetry();
  const { find, priorAccept } = await scanTelemetryForRequest(
    telemetryPath,
    args.request_id,
    signal,
  );

  if (find === undefined) {
    throw new AcceptUnknownRequestIdError({
      request_id: args.request_id,
      telemetry_log_path: telemetryPath,
    });
  }
  if (find.result_count === 0) {
    throw new AcceptZeroResultQueryError({ request_id: args.request_id });
  }
  if (priorAccept !== undefined) {
    throw new AcceptDuplicateRequestIdError({
      request_id: args.request_id,
      prior_acceptance_timestamp: priorAccept.timestamp,
    });
  }

  // GREEN path — append the acceptance event via emitTelemetry().
  await emitTelemetry({
    event: 'engagement.acceptance_event',
    timestamp: new Date().toISOString(),
    request_id: args.request_id,
    ...(args.note !== undefined ? { acceptance_note: args.note } : {}),
  });
}
