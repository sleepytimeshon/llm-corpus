// SP-000-Lite Phase 3 (T025/T026) — `corpus pilot` CLI subcommand.
//
// Wires the parsed CLI args into the `runPilot` driver from
// `@llm-corpus/pipeline`. Behavior:
//   - Parses `--variant <id>` and `--iteration <1|2>` flags, optional
//     `--spec <path>` and `--queries <path>` overrides.
//   - Rejects iteration ≥ 3 at argument validation (ADR-010 scope: ≤ 2
//     iterations) — FR-PILOT-004.
//   - On success: prints a human-readable summary to stdout and returns 0.
//   - On failure: prints the structured error to stderr and returns non-zero.
//
// Constitution XI: this file is the ONLY site in the pilot subtree allowed
// to call `process.exit`. We instead return a numeric exit code to the
// `corpus` dispatcher (`packages/cli/src/index.ts`), which is the project's
// single library-to-CLI boundary that invokes `process.exit`.
//
// Constitution XVI: `pilotHelpText` carries the personal-scale qualifier
// (qwen3:8b + Shon's personal substrate) inline so `--help` cannot be misread
// as an industry-standard claim. The qualifier-presence contract test
// (`tests/contract/sp000-lite/qualifier-presence.test.ts`) asserts both the
// `qwen3:8b` substring and a "personal" or "Shon" marker.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T006, T007, T025, T026
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-004, FR-PILOT-008
//   - specs/000-nfr-008-pilot-lite/data-model.md Entity 1
//   - .product/ADRs/ADR-010-sp000-lite-supersedes-005.md

import {
  runPilot,
  type PilotIteration,
  type RunPilotOptions,
  type RunPilotResult,
} from '@llm-corpus/pipeline';

export interface PilotArgs {
  readonly variant: string;
  readonly iteration: PilotIteration;
  readonly specPath?: string;
  readonly queriesPath?: string;
  readonly loopback?: boolean;
}

export type PilotArgParseResult =
  | { readonly ok: true; readonly args: PilotArgs }
  | { readonly ok: false; readonly message: string };

/**
 * Parse `corpus pilot` arguments. Iteration ≥ 3 is rejected here per
 * ADR-010 §Decision (binary exit ≤ 2 iterations). FR-PILOT-004.
 *
 * Accepted flags:
 *   --variant <id>      (required) prompt variant identifier
 *   --iteration <1|2>   (required) pilot iteration number
 *   --spec <path>       path to spec.md for Q3 ratification gate (optional)
 *   --queries <path>    path to queries.yaml (optional)
 *   --loopback          dev/test mode: bypass Ollama + MCP, synthesize a
 *                       deterministic 50-event run from in-process fixtures
 *   --help, -h          print help text
 */
export function parsePilotArgs(rest: readonly string[]): PilotArgParseResult {
  let variant: string | undefined;
  let iterationRaw: string | undefined;
  let subcmd: string | undefined;
  let specPath: string | undefined;
  let queriesPath: string | undefined;
  let loopback = false;

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
    } else if (tok === '--spec') {
      const next = rest[i + 1];
      if (next === undefined) {
        return { ok: false, message: 'corpus pilot: --spec requires a value' };
      }
      specPath = next;
      i += 1;
    } else if (tok === '--queries') {
      const next = rest[i + 1];
      if (next === undefined) {
        return { ok: false, message: 'corpus pilot: --queries requires a value' };
      }
      queriesPath = next;
      i += 1;
    } else if (tok === '--loopback') {
      loopback = true;
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

  const args: PilotArgs = {
    variant,
    iteration: iterationNum as PilotIteration,
    ...(specPath !== undefined ? { specPath } : {}),
    ...(queriesPath !== undefined ? { queriesPath } : {}),
    ...(loopback ? { loopback: true } : {}),
  };
  return { ok: true, args };
}

/**
 * `corpus pilot run` entry point. Parses args, wires up an AbortController on
 * SIGINT/SIGTERM (Constitution VII), invokes the `runPilot` driver, and
 * surfaces a human-readable summary on stdout (success) or a structured
 * error on stderr (failure).
 *
 * Returns the numeric exit code to the `corpus` dispatcher, which is the
 * single library-to-CLI boundary that calls `process.exit` (Constitution XI).
 */
export async function runPilotCommand(rest: readonly string[]): Promise<number> {
  const parsed = parsePilotArgs(rest);
  if (!parsed.ok) {
    process.stderr.write(parsed.message + '\n');
    return 2;
  }
  const { args } = parsed;

  // Constitution VII: wire SIGINT/SIGTERM to the AbortController so the
  // driver can persist partial state and exit within 2s.
  const controller = new AbortController();
  const onSignal = (sig: NodeJS.Signals): void => {
    process.stderr.write(`corpus pilot: received ${sig}; aborting iteration...\n`);
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const runOptions: RunPilotOptions = {
    variant: args.variant,
    iteration: args.iteration,
    signal: controller.signal,
    ...(args.specPath !== undefined ? { specPath: args.specPath } : {}),
    ...(args.queriesPath !== undefined ? { queriesPath: args.queriesPath } : {}),
    ...(args.loopback === true ? { loopback: true } : {}),
  };

  let result: RunPilotResult;
  try {
    result = await runPilot(runOptions);
  } catch (cause) {
    // Constitution XIII: catch + surface (NOT swallow). The driver itself
    // returns structured errors via the Result envelope; reaching this
    // catch means an unexpected throw escaped the driver, which is itself
    // a bug we need to report.
    const msg = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    process.stderr.write(`corpus pilot: unhandled driver failure: ${msg}\n`);
    return 1;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  if (!result.ok) {
    process.stderr.write(
      `corpus pilot: iteration ${args.iteration} FAILED (code=${result.error_code ?? 'UNKNOWN'}).\n`,
    );
    if (result.error_message !== undefined && result.error_message.length > 0) {
      process.stderr.write(`  message: ${result.error_message}\n`);
    }
    if (result.error_event_path !== undefined) {
      process.stderr.write(`  error event: ${result.error_event_path}\n`);
    }
    if (result.jsonl_created) {
      process.stderr.write(
        `  partial telemetry retained at ${result.jsonl_path} (FR-PILOT-014).\n`,
      );
    }
    return 1;
  }

  // Success path — render the summary so Shon can eyeball the headline N.
  process.stdout.write(
    [
      `corpus pilot: iteration ${args.iteration} variant "${args.variant}" complete.`,
      `  telemetry: ${result.jsonl_path}`,
      `  summary:   ${result.summary_path}`,
      result.summary !== undefined
        ? `  headline_n=${result.summary.headline_n}` +
          ` malformed_call_count_kg=${result.summary.malformed_call_count_kg}` +
          ` soft_threshold_flag=${String(result.summary.soft_threshold_flag)}`
        : '  summary: <unavailable>',
      `  qualifier: ${result.summary?.personal_scale_qualifier ?? '<unavailable>'}`,
      '',
    ].join('\n'),
  );
  return 0;
}

/**
 * Help text for `corpus pilot`. Carries the personal-scale qualifier inline
 * (Constitution XVI, FR-PILOT-008) so the `--help` output cannot be misread
 * as an industry-standard floor claim. The qualifier-presence contract test
 * (`tests/contract/sp000-lite/qualifier-presence.test.ts`) asserts both the
 * literal `qwen3:8b` substring and a "personal" or "Shon" marker, AND the
 * absence of industry-generalization phrases (industry-standard, benchmark
 * floor, cross-model, cross-user, cross-machine).
 *
 * The qualifier line uses "single-user, single-machine floor" rather than
 * the longer "NOT an industry-standard floor" framing because the
 * forbidden-phrase guardrail rejects the substring "industry-standard"
 * unconditionally, including inside negations. The negation framing lives
 * in `packages/cli/src/pilot/README.md` (separate test asserts the verbatim
 * data-model.md Entity 1 line there).
 */
export function pilotHelpText(): string {
  return [
    'corpus pilot — NFR-008 reduced-scope pilot harness (SP-000-Lite)',
    '',
    'Drives a 50-query stratified benchmark against qwen3:8b on Shon\'s',
    'personal-curated-32pdf-sampler substrate. This is a single-user,',
    'single-machine floor — not a generalizable model evaluation.',
    '',
    'Usage:',
    '  corpus pilot run --variant <id> --iteration <1|2> [--spec PATH] [--queries PATH]',
    '',
    'Flags:',
    '  --variant <id>      Prompt variant identifier.',
    '  --iteration <1|2>   Pilot iteration number. Iteration ≥ 3 is rejected',
    '                      at argument validation per ADR-010 scope (FR-PILOT-004).',
    '  --spec <path>       Override spec.md path for Q3 ratification gate.',
    '  --queries <path>    Override queries.yaml path for stratification linter.',
    '  --loopback          Dev/test mode: synthesize a deterministic 50-event',
    '                      run with no Ollama or MCP traffic.',
    '  --help, -h          Print this message.',
    '',
    'Personal-scale qualifier (Constitution XVI, FR-PILOT-008):',
    '  Pilot results characterize Shon\'s personal workflow on qwen3:8b against',
    '  the personal-curated-32pdf-sampler substrate. Single-user, single-machine.',
    '',
  ].join('\n');
}
