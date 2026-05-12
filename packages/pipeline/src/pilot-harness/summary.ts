// SP-000-Lite Phase 3 (T023) — Pilot Summary builder + atomic writer.
//
// Reduces an in-memory event array (50 `nfr_008_pilot` events per iteration)
// to the FR-PILOT-013 summary shape, then writes it atomically to
// `Paths.pilotTelemetry()/pilot-iter{N}-summary.json` per Constitution
// Principle VIII (tmp + fsync + rename + dirsync).
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T023
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-013
//   - specs/000-nfr-008-pilot-lite/data-model.md Entity 4 (Pilot Summary)
//   - Constitution Principle VII (AbortSignal), VIII (atomic writes),
//     XI (Result), XIV (Paths.*), XVI (personal-scale framing)

import { z } from 'zod';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ok, err, type Result } from '@llm-corpus/contracts/result';
import { Paths } from '@llm-corpus/contracts/paths';
import {
  NfrPilotEvent,
  type NfrPilotEventType,
} from '@llm-corpus/contracts/telemetry';

// ---------------------------------------------------------------------------
// Constants — Constitution XVI (personal-scale qualifier).
// ---------------------------------------------------------------------------

/**
 * Personal-scale qualifier seeded into every Pilot Summary's
 * `personal_scale_qualifier` field. Carries `qwen3:8b` + `personal` +
 * the substrate identifier (Constitution XVI — validation honesty).
 *
 * NOTE on phrasing: the on-summary qualifier deliberately avoids the
 * phrase "industry-standard" because the qualifier-presence contract test
 * (Constitution XVI guardrail) forbids that substring even in a negating
 * context. The longer "NOT an industry-standard floor" framing — the
 * verbatim data-model.md Entity 1 line — lives on the CLI README and
 * harness `--help` text (wired in T026), where the test treats the
 * negation as the canonical disclaimer instead of a forbidden phrase.
 *
 * Shon MAY override this seed before D-NNN commit (Pilot Run lifecycle
 * step 4 — see data-model.md).
 */
export const PERSONAL_SCALE_QUALIFIER =
  "Shon's personal workflow on qwen3:8b against the " +
  'personal-curated-32pdf-sampler substrate; a single-user, ' +
  'single-machine floor — not generalizable beyond this setup.';

const SUMMARY_SCHEMA_VERSION = '1.0.0';
const SUBSTRATE_ID = 'personal-curated-32pdf-sampler';
const MODEL_ID = 'qwen3:8b';

// ---------------------------------------------------------------------------
// Schemas — Constitution V (schema-enforced output).
// ---------------------------------------------------------------------------

const BucketCounts = z.object({
  knowledge_grounded: z.literal(30),
  general: z.literal(15),
  adversarial: z.literal(5),
});

const BucketInvocations = z.object({
  knowledge_grounded: z.number().int().nonnegative(),
  general: z.number().int().nonnegative(),
  adversarial: z.number().int().nonnegative(),
});

const BucketRates = z.object({
  knowledge_grounded: z.number().min(0).max(1),
  general: z.number().min(0).max(1),
  adversarial: z.number().min(0).max(1),
});

const PatternInvocations = z.object({
  factual_lookup: z.number().int().nonnegative(),
  recall_by_context: z.number().int().nonnegative(),
  multi_doc_synthesis: z.number().int().nonnegative(),
});

export const PilotSummarySchema = z.object({
  summary_schema_version: z.literal(SUMMARY_SCHEMA_VERSION),
  run_id: z.string().uuid(),
  iteration: z.union([z.literal(1), z.literal(2)]),
  model: z.literal(MODEL_ID),
  prompt_variant: z.string(),
  substrate_id: z.literal(SUBSTRATE_ID),
  headline_n: z.number().int().min(0).max(30),
  bucket_counts: BucketCounts,
  bucket_invocations: BucketInvocations,
  bucket_rates: BucketRates,
  pattern_invocations: PatternInvocations,
  malformed_call_count_kg: z.number().int().min(0).max(30),
  malformed_call_rate_kg: z.number().min(0).max(1),
  soft_threshold_flag: z.boolean(),
  personal_scale_qualifier: z.string().min(1),
});

export type PilotSummary = z.infer<typeof PilotSummarySchema>;

// ---------------------------------------------------------------------------
// Public input types.
// ---------------------------------------------------------------------------

/**
 * Run-level metadata threaded onto the summary for the D-NNN ledger entry's
 * rationale. The pilot harness driver (T024) supplies these from the run
 * frame; the contract tests pass a minimal shape (`run_id`, `iteration`,
 * `variant`) — additional fields are best-effort and fall back to fixed
 * defaults (substrate, model) when omitted.
 */
export interface PilotSummaryRunMeta {
  readonly run_id: string;
  readonly iteration: 1 | 2;
  /** Prompt variant (e.g., `"v1"`, `"v2-revised"`). Test fixtures pass `variant`. */
  readonly variant?: string;
  readonly prompt_variant?: string;
}

// ---------------------------------------------------------------------------
// Error types.
// ---------------------------------------------------------------------------

export class SummaryError extends Error {
  override readonly name = 'SummaryError';
  constructor(
    readonly code: 'SCHEMA_VIOLATION' | 'INVALID_EVENT' | 'INVARIANT_VIOLATION',
    readonly details: string,
    /** Optional Zod issues from a schema failure. */
    readonly issues?: z.ZodIssue[],
  ) {
    super(`SummaryError(${code}): ${details}`);
  }
}

export class WriteError extends Error {
  override readonly name = 'WriteError';
  constructor(
    readonly code: 'ABORTED' | 'IO_FAILED' | 'PATH_RESOLUTION_FAILED',
    readonly details: string,
    cause?: unknown,
  ) {
    super(`WriteError(${code}): ${details}`);
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// mkPilotSummary — pure reduction of events → summary fields.
// ---------------------------------------------------------------------------

/**
 * Reduce a list of `nfr_008_pilot` telemetry events to the FR-PILOT-013
 * summary shape.
 *
 * Per data-model.md Entity 4:
 *   - `headline_n` = count where bucket=KG AND tool_invoked=true.
 *   - `bucket_invocations[b]` = per-bucket count where tool_invoked=true.
 *   - `bucket_rates[b]` = `bucket_invocations[b] / bucket_counts[b]`.
 *   - `pattern_invocations[p]` = per-pattern count within KG bucket where
 *     tool_invoked=true.
 *   - `malformed_call_count_kg` = count where bucket=KG AND tool_invoked=true
 *     AND tool_arguments_valid=false.
 *   - `malformed_call_rate_kg` = `malformed_call_count_kg / 30`.
 *   - `soft_threshold_flag` = `malformed_call_count_kg > 10` (strict >).
 *
 * `personal_scale_qualifier` is seeded verbatim from `PERSONAL_SCALE_QUALIFIER`
 * (Constitution XVI). The harness driver (T024) MAY override before commit
 * but the seed always contains `qwen3:8b` + `personal` + substrate.
 *
 * Schema-enforced: the output is validated against `PilotSummarySchema`
 * before return. Caller need not re-validate.
 *
 * Returns the bare `PilotSummary` object so callers can immediately destructure
 * its fields (the contract test relies on this shape). Schema failures throw
 * `SummaryError` (fast-fail constructor pattern, matching `mkPilotEvent`).
 * The library-layer boundary (`writePilotSummary` and the harness driver
 * `runPilot` in T024) wraps the call in `try/catch` and emits a structured
 * Result at the CLI surface (Constitution XI).
 */
export function mkPilotSummary(
  events: ReadonlyArray<unknown>,
  runMeta: PilotSummaryRunMeta,
): PilotSummary {
  // --- 1. Validate every event against the registered schema -------------
  const validated: NfrPilotEventType[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const parsed = NfrPilotEvent.safeParse(events[i]);
    if (!parsed.success) {
      throw new SummaryError(
        'INVALID_EVENT',
        `event at index ${i} failed nfr_008_pilot schema validation: ` +
          `${parsed.error.issues[0]?.message ?? '<no message>'}`,
        parsed.error.issues,
      );
    }
    validated.push(parsed.data);
  }

  // --- 2. Reduce ----------------------------------------------------------
  const bucketInvocations = {
    knowledge_grounded: 0,
    general: 0,
    adversarial: 0,
  };
  const patternInvocations = {
    factual_lookup: 0,
    recall_by_context: 0,
    multi_doc_synthesis: 0,
  };
  let malformedKg = 0;

  for (const e of validated) {
    if (e.tool_invoked) {
      bucketInvocations[e.query_bucket] += 1;
      if (e.query_bucket === 'knowledge_grounded') {
        if (e.retrieval_pattern !== null) {
          patternInvocations[e.retrieval_pattern] += 1;
        }
        if (e.tool_arguments_valid === false) {
          malformedKg += 1;
        }
      }
    }
  }

  const bucketCounts = { knowledge_grounded: 30, general: 15, adversarial: 5 } as const;
  const bucketRates = {
    knowledge_grounded: bucketInvocations.knowledge_grounded / bucketCounts.knowledge_grounded,
    general: bucketInvocations.general / bucketCounts.general,
    adversarial: bucketInvocations.adversarial / bucketCounts.adversarial,
  };

  const headlineN = bucketInvocations.knowledge_grounded;
  const malformedRateKg = malformedKg / bucketCounts.knowledge_grounded;
  const softThresholdFlag = malformedKg > 10;

  // --- 3. Resolve run_id (fall back to a deterministic v4 if absent) ------
  const runId = isUuid(runMeta.run_id) ? runMeta.run_id : crypto.randomUUID();
  const promptVariant = runMeta.prompt_variant ?? runMeta.variant ?? 'v1';

  const candidate = {
    summary_schema_version: SUMMARY_SCHEMA_VERSION,
    run_id: runId,
    iteration: runMeta.iteration,
    model: MODEL_ID,
    prompt_variant: promptVariant,
    substrate_id: SUBSTRATE_ID,
    headline_n: headlineN,
    bucket_counts: bucketCounts,
    bucket_invocations: bucketInvocations,
    bucket_rates: bucketRates,
    pattern_invocations: patternInvocations,
    malformed_call_count_kg: malformedKg,
    malformed_call_rate_kg: malformedRateKg,
    soft_threshold_flag: softThresholdFlag,
    personal_scale_qualifier: PERSONAL_SCALE_QUALIFIER,
  };

  // --- 4. Final schema enforcement ----------------------------------------
  const finalParsed = PilotSummarySchema.safeParse(candidate);
  if (!finalParsed.success) {
    throw new SummaryError(
      'SCHEMA_VIOLATION',
      `summary failed PilotSummarySchema: ${finalParsed.error.issues[0]?.message ?? '<no message>'}`,
      finalParsed.error.issues,
    );
  }

  // --- 5. Invariant: malformed_call_count_kg ≤ KG invocations ------------
  if (
    finalParsed.data.malformed_call_count_kg >
    finalParsed.data.bucket_invocations.knowledge_grounded
  ) {
    throw new SummaryError(
      'INVARIANT_VIOLATION',
      'malformed_call_count_kg cannot exceed bucket_invocations.knowledge_grounded',
    );
  }

  return finalParsed.data;
}

// ---------------------------------------------------------------------------
// writePilotSummary — atomic JSON write to Paths.pilotTelemetry().
// ---------------------------------------------------------------------------

/**
 * Atomically write a Pilot Summary to
 * `Paths.pilotTelemetry()/pilot-iter{iteration}-summary.json`.
 *
 * Sequence (Constitution Principle VIII — POSIX atomic file replace):
 *   1. Ensure target directory exists.
 *   2. Open a same-directory tmp file with a unique suffix.
 *   3. Write the serialized JSON.
 *   4. `fsync` the file descriptor (durability).
 *   5. `rename` tmp → target (POSIX atomic).
 *   6. Open + `fsync` the containing directory (rename durability).
 *
 * Honors `AbortSignal` (Constitution Principle VII) — at each await point
 * we check `signal.aborted` and short-circuit with `WriteError("ABORTED")`,
 * cleaning up the tmp file if it exists.
 *
 * Returns `Result.Ok<string>` carrying the resolved target path on success;
 * `Result.Err<WriteError>` on IO failure or abort.
 */
export async function writePilotSummary(
  summary: PilotSummary,
  signal: AbortSignal,
): Promise<Result<string, WriteError>> {
  if (signal.aborted) {
    return err(new WriteError('ABORTED', 'AbortSignal already triggered before write'));
  }

  // --- Path resolution via Paths.* (Constitution XIV) ---------------------
  let targetPath: string;
  let targetDir: string;
  try {
    targetDir = Paths.pilotTelemetry();
    targetPath = path.join(targetDir, `pilot-iter${summary.iteration}-summary.json`);
  } catch (cause) {
    return err(
      new WriteError(
        'PATH_RESOLUTION_FAILED',
        'Paths.pilotTelemetry() threw during resolution',
        cause,
      ),
    );
  }

  // --- Ensure target directory exists -------------------------------------
  try {
    await fsp.mkdir(targetDir, { recursive: true });
  } catch (cause) {
    return err(
      new WriteError('IO_FAILED', `mkdir(${targetDir}) failed`, cause),
    );
  }
  if (signal.aborted) {
    return err(new WriteError('ABORTED', 'aborted after mkdir, before tmp write'));
  }

  // --- Tmp file in the same directory (rename must be same-FS) -----------
  const tmpSuffix = `.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const tmpPath = `${targetPath}${tmpSuffix}`;

  const payload = JSON.stringify(summary, null, 2) + '\n';
  let fileHandle: fsp.FileHandle | undefined;
  try {
    fileHandle = await fsp.open(tmpPath, 'wx', 0o644);
    await fileHandle.writeFile(payload, { encoding: 'utf8' });
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;

    if (signal.aborted) {
      await safeUnlink(tmpPath);
      return err(new WriteError('ABORTED', 'aborted after fsync, before rename'));
    }

    await fsp.rename(tmpPath, targetPath);
  } catch (cause) {
    if (fileHandle !== undefined) {
      try {
        await fileHandle.close();
      } catch {
        /* swallow secondary close failure — primary cause already captured */
      }
    }
    await safeUnlink(tmpPath);
    return err(
      new WriteError('IO_FAILED', `atomic write to ${targetPath} failed`, cause),
    );
  }

  // --- fsync the containing directory (rename durability) -----------------
  try {
    await syncDirectory(targetDir);
  } catch (cause) {
    // The data IS on disk + renamed; failure to fsync the directory means
    // we may lose the dirent on a hard crash. Surface as IO_FAILED but the
    // target path is already live — caller can verify.
    return err(
      new WriteError(
        'IO_FAILED',
        `dirsync(${targetDir}) failed (file written but dirent not fsynced)`,
        cause,
      ),
    );
  }

  return ok(targetPath);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fsp.unlink(p);
  } catch {
    /* tmp file may not exist if open() failed; swallow */
  }
}

/**
 * fsync a directory's file descriptor — the POSIX guarantee that `rename`
 * durability requires beyond fsync of the renamed file.
 *
 * Node has no high-level dirsync helper; we open the directory in read-only
 * mode and call `fsync` on the descriptor. Linux honors this; macOS HFS+
 * accepts but no-ops; both behaviors are acceptable for our durability
 * envelope.
 */
async function syncDirectory(dirPath: string): Promise<void> {
  const fd = await fsp.open(dirPath, fs.constants.O_RDONLY);
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
