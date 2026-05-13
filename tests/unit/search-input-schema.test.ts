// SP-005 T002 — Contract test for SearchInputZodSchema.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-020
//   - specs/005-retrieval/data-model.md §"Entity 7"
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { SearchInputZodSchema } from '../../packages/contracts/src/search-schemas.js';

describe('PREREQ-001 — SearchInputZodSchema', () => {
  it('accepts minimal { query } with default limit=20', () => {
    const r = SearchInputZodSchema.safeParse({ query: 'x' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(20);
  });

  it('rejects query longer than 2048 chars', () => {
    const big = 'a'.repeat(2049);
    const r = SearchInputZodSchema.safeParse({ query: big });
    expect(r.success).toBe(false);
  });

  it('rejects unknown filter keys (strict)', () => {
    const r = SearchInputZodSchema.safeParse({
      query: 'x',
      filters: { zzz_unknown: 'foo' } as never,
    });
    expect(r.success).toBe(false);
  });

  it('rejects limit < 1', () => {
    const r = SearchInputZodSchema.safeParse({ query: 'x', limit: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects limit > 100', () => {
    const r = SearchInputZodSchema.safeParse({ query: 'x', limit: 101 });
    expect(r.success).toBe(false);
  });

  it('rejects malformed since (non-ISO-8601)', () => {
    const r = SearchInputZodSchema.safeParse({
      query: 'x',
      filters: { since: 'not-a-date' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown top-level keys (strict)', () => {
    const r = SearchInputZodSchema.safeParse({
      query: 'x',
      extra: 'foo',
    } as never);
    expect(r.success).toBe(false);
  });

  it('accepts facet_type as string or string[]', () => {
    expect(
      SearchInputZodSchema.safeParse({
        query: 'x',
        filters: { facet_type: 'tutorial' },
      }).success,
    ).toBe(true);
    expect(
      SearchInputZodSchema.safeParse({
        query: 'x',
        filters: { facet_type: ['tutorial', 'reference'] },
      }).success,
    ).toBe(true);
  });

  it('accepts empty query (degenerate ranking permitted)', () => {
    const r = SearchInputZodSchema.safeParse({ query: '' });
    expect(r.success).toBe(true);
  });
});
