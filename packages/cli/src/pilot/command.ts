// SP-000-Lite Phase 1 (T006/T007) — `corpus pilot` CLI subcommand stub.
//
// Phase 1 ships the plumbing only:
//   - Parses `--variant <id>` and `--iteration <1|2>` flags.
//   - Rejects iteration ≥ 3 at argument validation (ADR-010 scope: ≤ 2
//     iterations).
//   - Returns a non-zero exit code with a "harness implementation pending
//     Phase 3" message via the CLI's stderr writer.
//
// Phase 3 (T024 + T025) will wire this to the real `runPilot` driver and the
// personal-scale qualifier. Constitution XI: this file is the only site in
// the pilot subtree allowed to call `process.exit` — but for Phase 1 we
// return a numeric exit code to the dispatcher and let it call `process.exit`
// at the boundary (matching the existing `runMcp` shape).
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T006, T007
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-004
//   - .product/ADRs/ADR-010-sp000-lite-supersedes-005.md

import type { PilotIteration } from '@llm-corpus/pipeline';

/** Phase 1 stub message — Phase 3 replaces this with `runPilot()` output. */
export const PHASE1_PENDING_MESSAGE =
  'corpus pilot: harness implementation pending Phase 3 (T018–T026 in specs/000-nfr-008-pilot-lite/tasks.md).';

export interface PilotArgs {
  readonly variant: string;
  readonly iteration: PilotIteration;
}

export type PilotArgParseResult =
  | { readonly ok: true; readonly args: PilotArgs }
  | { readonly ok: false; readonly message: string };

/**
 * Parse `corpus pilot` arguments. Iteration ≥ 3 is rejected here per
 * ADR-010 §Decision (binary exit ≤ 2 iterations). FR-PILOT-004.
 */
export function parsePilotArgs(rest: readonly string[]): PilotArgParseResult {
  let variant: string | undefined;
  let iterationRaw: string | undefined;
  let subcmd: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i];
    if (tok === '--variant') {
      const next = rest[i + 1];
      if (next === undefined) {
        return { ok: false, message: 'corpus pilot: --variant requires a value' };
      }
      variant = next;
      i += 1;
    } else if (tok === '--iteration') {
      const next = rest[i + 1];
      if (next === undefined) {
        return { ok: false, message: 'corpus pilot: --iteration requires a value' };
      }
      iterationRaw = next;
      i += 1;
    } else if (tok === '--help' || tok === '-h') {
      return { ok: false, message: pilotHelpText() };
    } else if (subcmd === undefined && tok !== undefined && !tok.startsWith('-')) {
      subcmd = tok;
    } else {
      return { ok: false, message: `corpus pilot: unknown argument "${tok ?? ''}"` };
    }
  }

  if (subcmd !== undefined && subcmd !== 'run') {
    return { ok: false, message: `corpus pilot: unknown subcommand "${subcmd}" (expected "run")` };
  }

  if (variant === undefined || variant.length === 0) {
    return { ok: false, message: 'corpus pilot: --variant <id> is required' };
  }

  if (iterationRaw === undefined) {
    return { ok: false, message: 'corpus pilot: --iteration <1|2> is required' };
  }

  const iterationNum = Number.parseInt(iterationRaw, 10);
  if (iterationNum !== 1 && iterationNum !== 2) {
    return {
      ok: false,
      message: `corpus pilot: --iteration must be 1 or 2 (got "${iterationRaw}"); iteration ≥ 3 is forbidden by ADR-010 scope (FR-PILOT-004).`,
    };
  }

  return { ok: true, args: { variant, iteration: iterationNum as PilotIteration } };
}

/**
 * Phase 1 stub entry point. Parses args and exits non-zero with the
 * "pending Phase 3" message. Phase 3 (T025) replaces this body with a call
 * into `runPilot` from `@llm-corpus/pipeline`.
 */
export async function runPilotCommand(rest: readonly string[]): Promise<number> {
  const parsed = parsePilotArgs(rest);
  if (!parsed.ok) {
    process.stderr.write(parsed.message + '\n');
    return 2;
  }
  // Args parsed cleanly; Phase 1 has no implementation to run.
  process.stderr.write(PHASE1_PENDING_MESSAGE + '\n');
  process.stderr.write(
    `  parsed: variant="${parsed.args.variant}" iteration=${parsed.args.iteration}\n`,
  );
  return 2;
}

export function pilotHelpText(): string {
  // Phase 3 (T026) seeds the personal-scale qualifier here. Phase 1 leaves
  // a TODO marker so Phase 2 contract tests for qualifier presence stay red.
  return [
    'corpus pilot — NFR-008 reduced-scope pilot harness (SP-000-Lite)',
    '',
    'Usage:',
    '  corpus pilot run --variant <id> --iteration <1|2>',
    '',
    'Flags:',
    '  --variant <id>      Prompt variant identifier.',
    '  --iteration <1|2>   Pilot iteration number. Iteration ≥ 3 is rejected',
    '                      at argument validation per ADR-010 scope.',
    '',
    'NOTE: Phase 1 plumbing only — harness implementation pending Phase 3',
    '(T018–T026 in specs/000-nfr-008-pilot-lite/tasks.md).',
    '',
  ].join('\n');
}
