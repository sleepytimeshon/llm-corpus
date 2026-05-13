// SP-005 T003 — Contract test for SearchHitZodSchema.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-020,
//     SC-RETRIEVAL-020
//   - specs/005-retrieval/data-model.md §"Entity 8"
//   - specs/005-retrieval/contracts/search-hit-schema.json

import { describe, it, expect } from 'vitest';
import { SearchHitZodSchema } from '../../packages/contracts/src/search-schemas.js';

const validHit = {
  uri: 'corpus://docs/doc-deadbeef',
  score: 1.23,
  title: 't',
  facet_domain: 'd',
  facet_type: 'tutorial' as const,
  tags: ['a'],
  snippet: 's',
};

describe('PREREQ-001 — SearchHitZodSchema', () => {
  it('accepts a fully-valid SearchHit', () => {
    const r = SearchHitZodSchema.safeParse(validHit);
    expect(r.success).toBe(true);
  });

  it('rejects malformed uri (must match corpus://docs/doc-XXXXXXXX)', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validHit,
      uri: 'http://other/doc-abc',
    });
    expect(r.success).toBe(false);
  });

  it('rejects facet_type not in FACET_TYPE_VALUES', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validHit,
      facet_type: 'unknownkind' as never,
    });
    expect(r.success).toBe(false);
  });

  it('rejects snippet > 400 chars', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validHit,
      snippet: 'x'.repeat(401),
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validHit,
      extra: 'foo',
    } as never);
    expect(r.success).toBe(false);
  });
});
