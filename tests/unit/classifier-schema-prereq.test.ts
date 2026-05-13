// T002 (SP-004 PREREQ-001) — Contract test for the classifier output schema.
//
// Verifies:
//   - ClassifierOutputZodSchema parses a valid output (all required fields).
//   - Strict-mode rejection of missing required fields (no silent coercion).
//   - Bounds enforcement: tags.length ∈ [3, 10]; confidence sub-scores ∈ [0,1];
//     facet_type ∈ FACET_TYPE_VALUES (7-value enum).
//   - FACET_TYPE_VALUES is the SCHEMA.md 7-value enum (constitutional —
//     FR-CLASSIFY-014).
//   - CLASSIFIER_OUTPUT_JSON_SCHEMA is a frozen object that has been
//     post-processed for Ollama compatibility (R3 mitigation: no top-level
//     `$schema` keyword, no unresolved `$ref` references).
//
// Spec references:
//   - specs/004-classifier/plan.md PREREQ-001
//   - specs/004-classifier/spec.md FR-CLASSIFY-003, FR-CLASSIFY-004,
//     FR-CLASSIFY-005, FR-CLASSIFY-014
//   - specs/004-classifier/data-model.md §"Entity 1 — ClassifierOutput"
//   - specs/004-classifier/research.md Decision J
//   - Constitution Principle V (Schema-Enforced Structured Output)
//
// TDD: this test MUST FAIL before T008 (the implementation) lands.

import { describe, it, expect } from 'vitest';

describe('PREREQ-001 — ClassifierOutputZodSchema + FACET_TYPE_VALUES + CLASSIFIER_OUTPUT_JSON_SCHEMA', () => {
  it('FACET_TYPE_VALUES is the SCHEMA.md 7-value enum (constitutional per FR-CLASSIFY-014)', async () => {
    const { FACET_TYPE_VALUES } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    expect(FACET_TYPE_VALUES.length).toBe(7);
    expect([...FACET_TYPE_VALUES]).toEqual([
      'entity',
      'concept',
      'tutorial',
      'analysis',
      'reference',
      'synthesis',
      'cheat-sheet',
    ]);
  });

  it('ClassifierOutputZodSchema parses a valid minimal output', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const valid = {
      facet_domain: 'ai-systems',
      facet_type: 'tutorial',
      tags: ['a', 'b', 'c'],
      summary: 'a short summary.',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    };
    const parsed = ClassifierOutputZodSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects missing required field (facet_domain absent — strict mode, no coercion)', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const bad = {
      facet_type: 'tutorial',
      tags: ['a', 'b', 'c'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    };
    expect(ClassifierOutputZodSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects tags.length < 3', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const bad = {
      facet_domain: 'ai-systems',
      facet_type: 'tutorial',
      tags: ['a', 'b'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    };
    expect(ClassifierOutputZodSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects tags.length > 10', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const bad = {
      facet_domain: 'ai-systems',
      facet_type: 'tutorial',
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    };
    expect(ClassifierOutputZodSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects facet_type not in FACET_TYPE_VALUES', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const bad = {
      facet_domain: 'ai-systems',
      facet_type: 'not-a-real-type',
      tags: ['a', 'b', 'c'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    };
    expect(ClassifierOutputZodSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects confidence.domain out of [0,1]', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const bad = {
      facet_domain: 'ai-systems',
      facet_type: 'tutorial',
      tags: ['a', 'b', 'c'],
      summary: 's',
      confidence: { domain: 1.5, type: 0.9, tags: 0.9 },
    };
    expect(ClassifierOutputZodSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts optional facet_domain_proposed + facet_tags_proposed when present', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const valid = {
      facet_domain: 'ai-systems',
      facet_type: 'tutorial',
      tags: ['a', 'b', 'c'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
      facet_domain_proposed: 'quantum-cryptography',
      facet_tags_proposed: ['new-tag-a', 'new-tag-b'],
    };
    expect(ClassifierOutputZodSchema.safeParse(valid).success).toBe(true);
  });

  it('strict mode rejects extra fields not declared in the schema', async () => {
    const { ClassifierOutputZodSchema } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const bad = {
      facet_domain: 'ai-systems',
      facet_type: 'tutorial',
      tags: ['a', 'b', 'c'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
      extra_field_that_should_be_rejected: 'oops',
    };
    expect(ClassifierOutputZodSchema.safeParse(bad).success).toBe(false);
  });

  it('CLASSIFIER_OUTPUT_JSON_SCHEMA is a frozen object', async () => {
    const { CLASSIFIER_OUTPUT_JSON_SCHEMA } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    expect(Object.isFrozen(CLASSIFIER_OUTPUT_JSON_SCHEMA)).toBe(true);
  });

  it('CLASSIFIER_OUTPUT_JSON_SCHEMA has no top-level $schema keyword (R3 — Ollama compatibility)', async () => {
    const { CLASSIFIER_OUTPUT_JSON_SCHEMA } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    expect(
      (CLASSIFIER_OUTPUT_JSON_SCHEMA as Record<string, unknown>)['$schema'],
    ).toBeUndefined();
  });

  it('CLASSIFIER_OUTPUT_JSON_SCHEMA contains no $ref strings anywhere in the tree (R3 — inlined)', async () => {
    const { CLASSIFIER_OUTPUT_JSON_SCHEMA } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const json = JSON.stringify(CLASSIFIER_OUTPUT_JSON_SCHEMA);
    expect(json.includes('"$ref"')).toBe(false);
  });

  it('CLASSIFIER_OUTPUT_JSON_SCHEMA requires the same 5 fields as the Zod schema', async () => {
    const { CLASSIFIER_OUTPUT_JSON_SCHEMA } = await import(
      '../../packages/contracts/src/classifier-schema.js'
    );
    const schema = CLASSIFIER_OUTPUT_JSON_SCHEMA as Record<string, unknown>;
    const required = schema['required'] as string[];
    expect(new Set(required)).toEqual(
      new Set(['facet_domain', 'facet_type', 'tags', 'summary', 'confidence']),
    );
  });
});
