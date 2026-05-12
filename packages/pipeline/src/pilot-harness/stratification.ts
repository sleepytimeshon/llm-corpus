// SP-000-Lite Phase 3 (T018) — queries.yaml stratification linter.
//
// Validates the 50-query authored set against FR-PILOT-002 (30/15/5 bucket
// stratification), FR-PILOT-003 (3 retrieval patterns + worked examples),
// and FR-PILOT-011 (per-bucket provenance). Returns a Result<ValidatedQuerySet,
// LintError[]> per Constitution Principle XI — library code never throws or
// process.exit.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T018
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-002, FR-PILOT-003,
//     FR-PILOT-011, FR-PILOT-012
//   - specs/000-nfr-008-pilot-lite/data-model.md Entity 2 (Query)
//   - specs/000-nfr-008-pilot-lite/contracts/query-set.feature
//   - Constitution Principle V (schema-enforced — Zod validation here)

import { z } from 'zod';
import { ok, err, type Result } from '@llm-corpus/contracts/result';

// ---------------------------------------------------------------------------
// Zod schema for one query row (matches the contract-test fixture shape).
// ---------------------------------------------------------------------------

const QueryBucket = z.enum(['knowledge_grounded', 'general', 'adversarial']);
const RetrievalPattern = z.enum([
  'factual_lookup',
  'recall_by_context',
  'multi_doc_synthesis',
]);

/**
 * Schema for a single authored query in `specs/000-nfr-008-pilot-lite/queries.yaml`.
 *
 * Field shape matches the contract-test fixture
 * (`tests/contract/sp000-lite/query-stratification.test.ts`) — note that the
 * authored field is `bucket`, not `query_bucket` (the latter is the telemetry
 * envelope name; the linter operates on the on-disk authoring shape).
 */
export const QueryRowSchema = z
  .object({
    query_id: z.string().min(1),
    query_text: z.string().min(1),
    bucket: QueryBucket,
    retrieval_pattern: RetrievalPattern.nullable(),
    provenance: z.string().min(1),
    worked_example_for: RetrievalPattern.nullable(),
  })
  .strict();

export type QueryRow = z.infer<typeof QueryRowSchema>;

/** Schema for the top-level queries.yaml document. */
export const QuerySetSchema = z
  .object({
    schema_version: z.string().min(1),
    queries: z.array(QueryRowSchema),
  })
  .strict();

export type QuerySet = z.infer<typeof QuerySetSchema>;

// ---------------------------------------------------------------------------
// LintError discriminated union — stable error codes for CLI surfacing.
// ---------------------------------------------------------------------------

export type LintError =
  | {
      readonly code: 'SCHEMA_VIOLATION';
      readonly path: string;
      readonly message: string;
      readonly citation: 'FR-PILOT-002' | 'FR-PILOT-003' | 'FR-PILOT-011';
    }
  | {
      readonly code: 'BUCKET_COUNT_MISMATCH';
      readonly bucket: 'knowledge_grounded' | 'general' | 'adversarial';
      readonly expected: number;
      readonly actual: number;
      readonly citation: 'FR-PILOT-002';
    }
  | {
      readonly code: 'TOTAL_COUNT_MISMATCH';
      readonly expected: 50;
      readonly actual: number;
      readonly citation: 'FR-PILOT-002';
    }
  | {
      readonly code: 'MISSING_RETRIEVAL_PATTERN';
      readonly pattern: 'factual_lookup' | 'recall_by_context' | 'multi_doc_synthesis';
      readonly citation: 'FR-PILOT-003';
    }
  | {
      readonly code: 'NON_KG_QUERY_HAS_PATTERN';
      readonly query_id: string;
      readonly bucket: 'general' | 'adversarial';
      readonly citation: 'FR-PILOT-003';
    }
  | {
      readonly code: 'KG_QUERY_MISSING_PATTERN';
      readonly query_id: string;
      readonly citation: 'FR-PILOT-003';
    }
  | {
      readonly code: 'DUPLICATE_QUERY_ID';
      readonly query_id: string;
      readonly citation: 'FR-PILOT-002';
    }
  | {
      readonly code: 'WRONG_PROVENANCE';
      readonly query_id: string;
      readonly bucket: 'knowledge_grounded' | 'general' | 'adversarial';
      readonly expected: string;
      readonly actual: string;
      readonly citation: 'FR-PILOT-011';
    };

// ---------------------------------------------------------------------------
// ValidatedQuerySet — the Ok-branch payload.
// ---------------------------------------------------------------------------

/**
 * A parsed-and-stratification-checked query set. Caller may rely on the
 * 30/15/5 invariant and on each retrieval pattern appearing at least once
 * in the knowledge-grounded bucket.
 */
export interface ValidatedQuerySet {
  readonly schema_version: string;
  readonly queries: ReadonlyArray<QueryRow>;
  readonly bucket_counts: {
    readonly knowledge_grounded: 30;
    readonly general: 15;
    readonly adversarial: 5;
  };
}

// ---------------------------------------------------------------------------
// Expected per-bucket provenance strings (FR-PILOT-011).
// ---------------------------------------------------------------------------

const EXPECTED_PROVENANCE = {
  knowledge_grounded: 'mined-from-MEMORY-WORK',
  general: 'hand-crafted-general',
  adversarial: 'hand-crafted-adversarial',
} as const;

// ---------------------------------------------------------------------------
// lintQuerySet — the public entry point.
// ---------------------------------------------------------------------------

/**
 * Validate a parsed queries.yaml document against FR-PILOT-002/003/011.
 *
 * Returns `Result.Ok(ValidatedQuerySet)` when the input passes every check;
 * `Result.Err(LintError[])` when one or more violations are detected. All
 * detectable errors are reported in a single pass — the linter does NOT
 * short-circuit on the first violation (Shon edits the YAML once, not once
 * per violation).
 *
 * Constitution V: Zod schema validates at the structural layer; bucket-count
 * and pattern-coverage checks are bespoke because they span the array.
 */
export function lintQuerySet(parsed: unknown): Result<ValidatedQuerySet, LintError[]> {
  // --- Structural validation via Zod ---------------------------------------
  const structural = QuerySetSchema.safeParse(parsed);
  if (!structural.success) {
    const errors: LintError[] = structural.error.issues.map((issue) => ({
      code: 'SCHEMA_VIOLATION' as const,
      path: issue.path.join('.'),
      message: issue.message,
      citation: 'FR-PILOT-002' as const,
    }));
    return err(errors);
  }
  const data = structural.data;

  const errors: LintError[] = [];

  // --- Total count ---------------------------------------------------------
  if (data.queries.length !== 50) {
    errors.push({
      code: 'TOTAL_COUNT_MISMATCH',
      expected: 50,
      actual: data.queries.length,
      citation: 'FR-PILOT-002',
    });
  }

  // --- Per-bucket counts ---------------------------------------------------
  const counts = {
    knowledge_grounded: 0,
    general: 0,
    adversarial: 0,
  };
  for (const q of data.queries) {
    counts[q.bucket] += 1;
  }
  const expected = { knowledge_grounded: 30, general: 15, adversarial: 5 } as const;
  for (const bucket of ['knowledge_grounded', 'general', 'adversarial'] as const) {
    if (counts[bucket] !== expected[bucket]) {
      errors.push({
        code: 'BUCKET_COUNT_MISMATCH',
        bucket,
        expected: expected[bucket],
        actual: counts[bucket],
        citation: 'FR-PILOT-002',
      });
    }
  }

  // --- Retrieval-pattern coverage (KG bucket) ------------------------------
  const patternsSeen = new Set<'factual_lookup' | 'recall_by_context' | 'multi_doc_synthesis'>();
  for (const q of data.queries) {
    if (q.bucket === 'knowledge_grounded') {
      if (q.retrieval_pattern === null) {
        errors.push({
          code: 'KG_QUERY_MISSING_PATTERN',
          query_id: q.query_id,
          citation: 'FR-PILOT-003',
        });
      } else {
        patternsSeen.add(q.retrieval_pattern);
      }
    } else {
      if (q.retrieval_pattern !== null) {
        errors.push({
          code: 'NON_KG_QUERY_HAS_PATTERN',
          query_id: q.query_id,
          bucket: q.bucket,
          citation: 'FR-PILOT-003',
        });
      }
    }
  }
  for (const pat of ['factual_lookup', 'recall_by_context', 'multi_doc_synthesis'] as const) {
    if (!patternsSeen.has(pat)) {
      errors.push({
        code: 'MISSING_RETRIEVAL_PATTERN',
        pattern: pat,
        citation: 'FR-PILOT-003',
      });
    }
  }

  // --- Unique query_id -----------------------------------------------------
  const seen = new Map<string, number>();
  for (const q of data.queries) {
    seen.set(q.query_id, (seen.get(q.query_id) ?? 0) + 1);
  }
  for (const [query_id, n] of seen.entries()) {
    if (n > 1) {
      errors.push({
        code: 'DUPLICATE_QUERY_ID',
        query_id,
        citation: 'FR-PILOT-002',
      });
    }
  }

  // --- Per-bucket provenance (FR-PILOT-011) --------------------------------
  for (const q of data.queries) {
    const expectedProv = EXPECTED_PROVENANCE[q.bucket];
    if (q.provenance !== expectedProv) {
      errors.push({
        code: 'WRONG_PROVENANCE',
        query_id: q.query_id,
        bucket: q.bucket,
        expected: expectedProv,
        actual: q.provenance,
        citation: 'FR-PILOT-011',
      });
    }
  }

  if (errors.length > 0) {
    return err(errors);
  }

  return ok({
    schema_version: data.schema_version,
    queries: data.queries,
    bucket_counts: { knowledge_grounded: 30, general: 15, adversarial: 5 },
  });
}
