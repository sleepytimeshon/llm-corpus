// SP-008 T043 — `corpus engagement-proxy report` CLI entry point.
//
// Initial skeleton committed alongside T027 (accept-command.ts) so the
// dispatcher in `index.ts` resolves at build time. Body filled by Phase 5
// implementation tasks T037-T046 below.
//
// The ONLY layer permitted to `process.exit` for the report flow per
// Constitution XI + FR-ENGAGEMENT-017.
//
// References:
//   - specs/008-user-acceptance/tasks.md T043
//   - specs/008-user-acceptance/contracts/adr-engagement-proxy-aggregation.md
//     (ADR-017)
//   - Constitution Principles VII (cancellable IO), XI (CLI boundary),
//     XIII (telemetry-or-die)

import {
  emitTelemetry,
  EngagementProxyWindowInvalidError,
  EngagementProxyReportZodSchema,
} from '@llm-corpus/contracts';
import { parseEngagementProxyReportArgs } from './engagement/engagement-proxy-report-args-parser.js';
import { scanTelemetryLog } from './engagement/telemetry-log-scanner.js';
import { aggregateReport } from './engagement/report-aggregator.js';
import { computeVerdict } from './engagement/verdict-computer.js';
import { renderReportJson } from './engagement/report-renderer-json.js';
import { renderReportText } from './engagement/report-renderer-text.js';

export interface EngagementProxyCommandInput {
  readonly argv: readonly string[];
}

export interface EngagementProxyCommandResult {
  readonly exit: number;
}

export async function runEngagementProxyCommand(
  input: EngagementProxyCommandInput,
): Promise<EngagementProxyCommandResult> {
  const controller = new AbortController();
  const onSigint = (): void => controller.abort('SIGINT');
  process.on('SIGINT', onSigint);

  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    let args;
    try {
      args = parseEngagementProxyReportArgs(input.argv);
    } catch (err) {
      if (err instanceof EngagementProxyWindowInvalidError) {
        process.stderr.write(
          `corpus engagement-proxy: invalid window: ${err.data.reason} (since=${err.data.since}, until=${err.data.until})\n`,
        );
        return { exit: 2 };
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`corpus engagement-proxy: invalid arguments: ${msg}\n`);
      return { exit: 2 };
    }

    // Per Constitution VII — setTimeout/clearTimeout + controller.abort(),
    // NEVER Promise.race(setTimeout).
    timeoutHandle = setTimeout(() => {
      controller.abort('engagement_report_timeout');
    }, args.timeout_ms);

    try {
      const scanned = await scanTelemetryLog(
        {
          telemetryLogPath: args.telemetry_log,
          since: args.since,
          until: args.until,
        },
        controller.signal,
      );
      const aggregate = aggregateReport(scanned.events);
      const verdict = computeVerdict(aggregate);

      const payload = EngagementProxyReportZodSchema.parse({
        schema_version: 1 as const,
        generated_at: new Date().toISOString(),
        window: { since: args.since, until: args.until },
        queries_in_window: aggregate.queries_in_window,
        acceptance_events_in_window: aggregate.acceptance_events_in_window,
        c028_threshold_met: verdict.c028_threshold_met,
        kill_signal: verdict.kill_signal,
        verdict: verdict.verdict,
        parse_errors_count: scanned.parse_errors_count,
        informational: aggregate.informational,
        c028_threshold: { min_queries: 5 as const, min_acceptance_events: 1 as const },
        kill_signal_threshold: { min_queries: 3 as const },
      });

      if (args.format === 'json') {
        renderReportJson(payload, process.stdout);
      } else {
        renderReportText(payload, process.stdout);
      }

      // Audit emit per Entity 3.
      try {
        await emitTelemetry({
          event: 'engagement.report_generated',
          timestamp: new Date().toISOString(),
          window: { since: args.since, until: args.until },
          verdict: payload.verdict,
          queries_in_window: payload.queries_in_window,
          acceptance_events_in_window: payload.acceptance_events_in_window,
          kill_signal: payload.kill_signal,
        });
      } catch (emitErr) {
        const msg = emitErr instanceof Error ? emitErr.message : String(emitErr);
        process.stderr.write(
          `corpus engagement-proxy: audit emit failed: ${msg}\n`,
        );
      }

      // Exit 0 on PASS, exit 1 on FAIL.
      return { exit: verdict.verdict === 'PASS' ? 0 : 1 };
    } catch (err) {
      if (controller.signal.aborted) {
        const reason =
          (controller.signal.reason as string | undefined) ?? 'aborted';
        process.stderr.write(
          `corpus engagement-proxy: scan aborted (${reason}); consider --timeout=<larger>\n`,
        );
        return { exit: 1 };
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`corpus engagement-proxy: ${msg}\n`);
      return { exit: 1 };
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    process.off('SIGINT', onSigint);
  }
}
