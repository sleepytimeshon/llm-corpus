// T020 (SP-004 US1) — Defense-in-depth validator contract test.
//
// Verifies validateClassifierOutput(rawJsonString, vocabulary):
//   - Returns Result<ClassifierOutput, SchemaInvalidError | VocabularyViolationError>.
//   - JSON-parse failure → SchemaInvalidError.
//   - Missing required field → SchemaInvalidError (Zod strict — no coercion).
//   - facet_domain in vocab → ok.
//   - facet_domain NOT in vocab AND no facet_domain_proposed → VocabularyViolationError.
//   - facet_domain NOT in vocab BUT facet_domain_proposed present → ok (proposed routes the new term to taxonomy_terms).
//   - tag NOT in vocab AND NOT in facet_tags_proposed → VocabularyViolationError.
//   - tag NOT in vocab BUT in facet_tags_proposed → ok.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-005, FR-CLASSIFY-006
//   - Constitution Principle V, XV
//
// TDD: this test MUST FAIL before T033 (the implementation) lands.

import { describe, it, expect } from 'vitest';

function vocab(): {
  domains: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  types: ReadonlySet<string>;
  snapshot_id: string;
  loaded_at: string;
} {
  return {
    domains: new Set(['agent-systems', 'distributed-systems']),
    tags: new Set(['memory', 'retrieval', 'tutorial']),
    types: new Set(),
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    loaded_at: '2026-05-13T10:00:00.000Z',
  };
}

const validJson = JSON.stringify({
  facet_domain: 'agent-systems',
  facet_type: 'tutorial',
  tags: ['memory', 'retrieval', 'tutorial'],
  summary: 'short summary.',
  confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
});

describe('US1 — validateClassifierOutput (contract)', () => {
  it('validateClassifierOutput is exported from packages/inference', async () => {
    const mod = (await import(
      '../../packages/inference/src/validate.js'
    )) as Record<string, unknown>;
    expect(typeof mod.validateClassifierOutput).toBe('function');
  });

  it('returns ok for a schema-valid + vocab-valid response', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const r = validateClassifierOutput(validJson, vocab());
    expect(r.ok).toBe(true);
  });

  it('JSON parse failure → SchemaInvalidError', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const { SchemaInvalidError } = await import('@llm-corpus/contracts');
    const r = validateClassifierOutput('{not-json', vocab());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(SchemaInvalidError);
    }
  });

  it('missing required field → SchemaInvalidError (Zod strict, no coercion)', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const { SchemaInvalidError } = await import('@llm-corpus/contracts');
    const bad = JSON.stringify({
      // facet_domain missing
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'tutorial'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    });
    const r = validateClassifierOutput(bad, vocab());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(SchemaInvalidError);
    }
  });

  it('facet_domain not in vocab AND no proposed → VocabularyViolationError', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const { VocabularyViolationError } = await import('@llm-corpus/contracts');
    const bad = JSON.stringify({
      facet_domain: 'hallucinated-domain',
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'tutorial'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    });
    const r = validateClassifierOutput(bad, vocab());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(VocabularyViolationError);
      const data = (r.error as { data: { offending_field: string; offending_value: string } }).data;
      expect(data.offending_field).toBe('facet_domain');
      expect(data.offending_value).toBe('hallucinated-domain');
    }
  });

  it('facet_domain not in vocab BUT facet_domain_proposed present → ok', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const good = JSON.stringify({
      facet_domain: 'agent-systems',
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'tutorial'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
      facet_domain_proposed: 'quantum-cryptography',
    });
    const r = validateClassifierOutput(good, vocab());
    expect(r.ok).toBe(true);
  });

  it('tag not in vocab AND not in facet_tags_proposed → VocabularyViolationError', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const { VocabularyViolationError } = await import('@llm-corpus/contracts');
    const bad = JSON.stringify({
      facet_domain: 'agent-systems',
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'novel-unproposed-tag'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
    });
    const r = validateClassifierOutput(bad, vocab());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(VocabularyViolationError);
    }
  });

  it('tag not in vocab BUT in facet_tags_proposed → ok', async () => {
    const { validateClassifierOutput } = await import(
      '../../packages/inference/src/validate.js'
    );
    const good = JSON.stringify({
      facet_domain: 'agent-systems',
      facet_type: 'tutorial',
      tags: ['memory', 'retrieval', 'novel-tag-a'],
      summary: 's',
      confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
      facet_tags_proposed: ['novel-tag-a'],
    });
    const r = validateClassifierOutput(good, vocab());
    expect(r.ok).toBe(true);
  });
});
