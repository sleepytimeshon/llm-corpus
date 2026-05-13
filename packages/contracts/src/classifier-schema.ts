// SP-004 PREREQ-001 — Classifier output schema + canonical JSON Schema.
//
// References:
//   - specs/004-classifier/plan.md PREREQ-001
//   - specs/004-classifier/spec.md FR-CLASSIFY-003, FR-CLASSIFY-004,
//     FR-CLASSIFY-005, FR-CLASSIFY-014
//   - specs/004-classifier/data-model.md §"Entity 1 — ClassifierOutput"
//   - specs/004-classifier/research.md Decision J
//   - specs/004-classifier/contracts/classifier-output.schema.json
//   - Constitution Principle V (Schema-Enforced Structured Output)
//
// This module is the single source of truth for the classifier-output shape:
//
//   1. `FACET_TYPE_VALUES` — the SCHEMA.md 7-value constitutional enum
//      (`entity`, `concept`, `tutorial`, `analysis`, `reference`, `synthesis`,
//      `cheat-sheet`). The ONLY hardcoded enum permitted by FR-CLASSIFY-014;
//      domain + tag axes are dynamic per Constitution Principle XV.
//
//   2. `ClassifierOutputZodSchema` — Zod strict-mode object with the
//      classifier's required + optional fields. `.strict()` forbids extra
//      fields and prevents silent coercion of missing required fields
//      (FR-CLASSIFY-005 defense-in-depth).
//
//   3. `CLASSIFIER_OUTPUT_JSON_SCHEMA` — the JSON Schema rendered from the
//      Zod schema via `zod-to-json-schema ^3.x` (Decision J). Rendered ONCE at
//      module-load time and frozen. Post-processed to strip the top-level
//      `$schema` keyword and to inline `$ref` references — Ollama's
//      structured-output `format` parameter may not resolve them reliably
//      across versions (R3 mitigation in plan.md).

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * The SCHEMA.md v1.0 7-value `facet_type` enum. Constitutional taxonomy axis
 * — Principle XV's dynamic-vocabulary mandate applies to OPEN axes (domain,
 * tag), NOT to this structural enum. FR-CLASSIFY-014 carves it out as the
 * ONLY hardcoded enum in SP-004 source.
 */
export const FACET_TYPE_VALUES = [
  'entity',
  'concept',
  'tutorial',
  'analysis',
  'reference',
  'synthesis',
  'cheat-sheet',
] as const;
export type FacetType = (typeof FACET_TYPE_VALUES)[number];

/**
 * The Zod schema for the classifier's structured-output response. Strict
 * mode — extra fields are rejected, missing required fields throw at parse
 * time without silent coercion. FR-CLASSIFY-005 defense-in-depth.
 */
export const ClassifierOutputZodSchema = z
  .object({
    facet_domain: z.string().min(1),
    facet_type: z.enum(FACET_TYPE_VALUES),
    tags: z.array(z.string().min(1)).min(3).max(10),
    summary: z.string().min(1).max(500),
    confidence: z
      .object({
        domain: z.number().min(0).max(1),
        type: z.number().min(0).max(1),
        tags: z.number().min(0).max(1),
      })
      .strict(),
    facet_domain_proposed: z.string().min(1).optional(),
    facet_tags_proposed: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type ClassifierOutput = z.infer<typeof ClassifierOutputZodSchema>;

/**
 * Recursively strip every `$ref` key from a JSON-Schema tree. The
 * `zod-to-json-schema` emitter sometimes (re-)introduces `$ref`s to short
 * inline definitions; Ollama's structured-output parser may not resolve
 * them across versions. The Zod schema we render is shallow enough that
 * inlining is always achievable; this pass enforces "no `$ref`s anywhere".
 */
function inlineRefs(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => inlineRefs(n));
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' || key === '$defs' || key === 'definitions') {
        continue;
      }
      out[key] = inlineRefs(value);
    }
    return out;
  }
  return node;
}

function buildJsonSchema(): Record<string, unknown> {
  const raw = zodToJsonSchema(ClassifierOutputZodSchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  // Strip top-level `$schema` (Ollama compat — R3 mitigation).
  const stripped = { ...raw };
  delete stripped['$schema'];
  // Defense-in-depth: inline any residual `$ref`s.
  return inlineRefs(stripped) as Record<string, unknown>;
}

/**
 * The canonical JSON Schema for the classifier output. Rendered once at
 * module-load time from `ClassifierOutputZodSchema` and frozen. Bound to
 * Ollama's `format` parameter in the OllamaAdapter. See Decision J in
 * `research.md` for rationale.
 */
export const CLASSIFIER_OUTPUT_JSON_SCHEMA: Readonly<Record<string, unknown>> =
  Object.freeze(buildJsonSchema());
