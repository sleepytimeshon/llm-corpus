// SP-008 T027 — `corpus accept <request-id> [--note <text>]` CLI entry point.
//
// The ONLY layer permitted to `process.exit` for the accept flow per
// Constitution XI + FR-ENGAGEMENT-017. Wires:
//
//   (a) parseAcceptArgs() (T025)
//   (b) runAcceptanceEventWriter() (T026)
//
// Exit-code translation per ADR-016:
//   - Zod parse failure → stderr + exit 2
//   - AcceptUnknownRequestIdError → stderr "unknown request_id: …" + exit 1
//   - AcceptZeroResultQueryError → stderr "cannot accept zero-result query: …" + exit 1
//   - AcceptDuplicateRequestIdError (INFORMATIONAL) → stdout
//     "already accepted: <id> at <ts>" + exit 0
//   - success → stdout "accepted: <id> at <ts>" + exit 0
//
// References:
//   - specs/008-user-acceptance/tasks.md T027
//   - specs/008-user-acceptance/contracts/adr-acceptance-event-definition.md
//     (ADR-016)
//   - Constitution Principles XI (CLI boundary), XIII (telemetry-or-die)

import {
  AcceptUnknownRequestIdError,
  AcceptZeroResultQueryError,
  AcceptDuplicateRequestIdError,
} from '@llm-corpus/contracts';
import { parseAcceptArgs } from './engagement/accept-args-parser.js';
import { runAcceptanceEventWriter } from './engagement/acceptance-event-writer.js';

export interface AcceptCommandInput {
  readonly argv: readonly string[];
}

export interface AcceptCommandResult {
  readonly exit: number;
}

export async function runAcceptCommand(
  input: AcceptCommandInput,
): Promise<AcceptCommandResult> {
  // SIGINT propagation: a master AbortController wraps the writer's IO so
  // ^C while the writer is mid-scan unwinds cleanly.
  const controller = new AbortController();
  const onSigint = (): void => controller.abort('SIGINT');
  process.on('SIGINT', onSigint);

  try {
    let args;
    try {
      args = parseAcceptArgs(input.argv);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`corpus accept: invalid arguments: ${msg}\n`);
      return { exit: 2 };
    }

    try {
      await runAcceptanceEventWriter(args, controller.signal);
      process.stdout.write(`accepted: ${args.request_id}\n`);
      return { exit: 0 };
    } catch (err) {
      if (err instanceof AcceptDuplicateRequestIdError) {
        // INFORMATIONAL — idempotent no-op per Constitution X.
        process.stdout.write(
          `already accepted: ${err.data.request_id} at ${err.data.prior_acceptance_timestamp}\n`,
        );
        return { exit: 0 };
      }
      if (err instanceof AcceptUnknownRequestIdError) {
        process.stderr.write(`unknown request_id: ${err.data.request_id}\n`);
        return { exit: 1 };
      }
      if (err instanceof AcceptZeroResultQueryError) {
        process.stderr.write(
          `cannot accept zero-result query: ${err.data.request_id}\n`,
        );
        return { exit: 1 };
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`corpus accept: ${msg}\n`);
      return { exit: 1 };
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
}
