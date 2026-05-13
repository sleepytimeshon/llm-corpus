// SP-004 US1 (T033) — Defense-in-depth classifier-output validator.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-005, FR-CLASSIFY-006
//   - specs/004-classifier/data-model.md §"Entity 1 — ClassifierOutput"
//   - Constitution Principle V (Schema-Enforced Structured Output)
//   - Constitution Principle XV (Dynamic Taxonomy)
//
// Two-pass validation:
//
//   1. Zod-parse the raw JSON string against ClassifierOutputZodSchema (strict
//      mode — no coercion, no extra fields). JSON-parse failures + Zod
//      validation failures collapse to SchemaInvalidError.
//
//   2. Cross-check facet_domain + each tag against the established
//      vocabulary snapshot. Mismatch → VocabularyViolationError UNLESS
//      the corresponding _proposed field carries the offending value.
//
// Both errors are constitutional pre-failure-lane signals (FR-CLASSIFY-011).
// The caller routes the failure to <doc-id>.error.json with retriable=true.

import {
  ok,
  err,
  type Result,
  ClassifierOutputZodSchema,
  SchemaInvalidError,
  VocabularyViolationError,
  type ClassifierOutput,
} from '@llm-corpus/contracts';
import type { EstablishedVocabulary } from './vocabulary.js';

/**
 * Validate a raw Ollama response body (`message.content` string) against
 * the classifier schema + established vocabulary.
 */
export function validateClassifierOutput(
  rawJsonString: string,
  vocabulary: EstablishedVocabulary,
): Result<ClassifierOutput, SchemaInvalidError | VocabularyViolationError> {
  // Pass 1 — JSON.parse + Zod strict-mode validation.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch (caught) {
    return err(
      new SchemaInvalidError(
        {
          validation_errors: [
            `JSON.parse failed: ${(caught as Error).message}`,
          ],
        },
        caught,
      ),
    );
  }

  const schema = ClassifierOutputZodSchema.safeParse(parsed);
  if (!schema.success) {
    const issues = schema.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`.slice(0, 256));
    return err(
      new SchemaInvalidError({
        validation_errors: issues,
      }),
    );
  }
  const output = schema.data;

  // Pass 2 — vocabulary cross-check.
  const domainProposed = output.facet_domain_proposed;
  if (!vocabulary.domains.has(output.facet_domain) && !domainProposed) {
    return err(
      new VocabularyViolationError({
        offending_field: 'facet_domain',
        offending_value: output.facet_domain,
      }),
    );
  }

  const proposedTags = new Set(output.facet_tags_proposed ?? []);
  for (const tag of output.tags) {
    if (!vocabulary.tags.has(tag) && !proposedTags.has(tag)) {
      return err(
        new VocabularyViolationError({
          offending_field: 'tag',
          offending_value: tag,
        }),
      );
    }
  }

  return ok(output);
}
