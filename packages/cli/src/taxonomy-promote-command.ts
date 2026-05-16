// SP-007 T068 — `corpus taxonomy promote` CLI command entry point.
//
// References:
//   - specs/007-install-first-run/tasks.md T068
//   - specs/007-install-first-run/spec.md FR-INSTALL-014
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)
//   - Constitution Principles V, VII, VIII, IX, X, XI (CLI is the ONLY layer
//     permitted to surface non-zero exits for the promote flow), XIII

import {
  TaxonomyPromoteArgsError,
  TaxonomyPromoteLockContentionError,
  TaxonomyPromoteMissingTermError,
} from '@llm-corpus/contracts';
import {
  parsePromoteArgs,
  runTaxonomyPromote,
} from './install-helpers/taxonomy-promote-helpers.js';

export interface RunTaxonomyPromoteCommandInput {
  argv: readonly string[];
  signal?: AbortSignal;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
}

export interface RunTaxonomyPromoteCommandResult {
  exit: number;
}

export async function runTaxonomyPromoteCommand(
  input: RunTaxonomyPromoteCommandInput,
): Promise<RunTaxonomyPromoteCommandResult> {
  const stdout = input.stdout ?? ((m) => process.stdout.write(m));
  const stderr = input.stderr ?? ((m) => process.stderr.write(m));
  const signal = input.signal ?? new AbortController().signal;

  let args;
  try {
    args = parsePromoteArgs(input.argv);
  } catch (cause) {
    if (cause instanceof TaxonomyPromoteArgsError) {
      stderr(
        `corpus taxonomy promote: ${cause.data.message}\n` +
          `usage: corpus taxonomy promote --axis=<domain|type|tag|source_type> --term=<t> [--term=<t>...]\n` +
          `       corpus taxonomy promote --from-proposed-with-count-ge=<N>\n`,
      );
      return { exit: 1 };
    }
    stderr(`corpus taxonomy promote: ${(cause as Error).message ?? String(cause)}\n`);
    return { exit: 1 };
  }

  try {
    const result = await runTaxonomyPromote(args, signal);
    for (const p of result.promoted) {
      stdout(`promoted: ${p.axis}/${p.term}\n`);
    }
    for (const a of result.alreadyEstablished) {
      stdout(`already established: ${a.axis}/${a.term}\n`);
    }
    stdout(
      `done — promoted=${result.promotedCount}, already_established=${result.alreadyEstablishedCount}\n`,
    );
    return { exit: 0 };
  } catch (cause) {
    if (cause instanceof TaxonomyPromoteLockContentionError) {
      stderr(
        `corpus taxonomy promote: daemon busy — drain-lock held at ${cause.data.lock_path}\n` +
          `Run: corpus daemon stop\n` +
          `Then: re-run corpus taxonomy promote\n`,
      );
      return { exit: 1 };
    }
    if (cause instanceof TaxonomyPromoteMissingTermError) {
      stderr(
        `corpus taxonomy promote: term not found: ${cause.data.axis}/${cause.data.term}\n` +
          `(no SQL writes occurred — operator can verify term name and re-run)\n`,
      );
      return { exit: 1 };
    }
    stderr(`corpus taxonomy promote: ${(cause as Error).message ?? String(cause)}\n`);
    return { exit: 1 };
  }
}
