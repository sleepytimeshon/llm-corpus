// SP-006 T006 — Contract test for SearchHit.tier_used required field.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-017
//   - specs/006-hardening/research.md Decision K
//   - Constitution Principle V (Schema-Enforced Structured Output)

import { describe, it, expect } from 'vitest';
import {
  SearchHitZodSchema,
  SearchOutputZodSchema,
} from '../../packages/contracts/src/search-schemas.js';

const validBaseHit = {
  uri: 'corpus://docs/doc-deadbeef',
  score: 0.92,
  title: 'A doc',
  facet_domain: 'rhel',
  facet_type: 'reference' as const,
  tags: ['sssd', 'ad'],
  snippet: 'snippet content',
};

describe('PREREQ-005 — SearchHit.tier_used required field (SP-006+)', () => {
  it('accepts SearchHit with tier_used: "hybrid"', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validBaseHit,
      tier_used: 'hybrid',
    });
    expect(r.success).toBe(true);
  });

  it('accepts SearchHit with tier_used: "bm25-only"', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validBaseHit,
      tier_used: 'bm25-only',
    });
    expect(r.success).toBe(true);
  });

  it('accepts SearchHit with tier_used: "catalog-grep"', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validBaseHit,
      tier_used: 'catalog-grep',
    });
    expect(r.success).toBe(true);
  });

  it('accepts SearchHit with tier_used: "fs-grep"', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validBaseHit,
      tier_used: 'fs-grep',
    });
    expect(r.success).toBe(true);
  });

  it('rejects SearchHit without tier_used (REQUIRED in SP-006+)', () => {
    const r = SearchHitZodSchema.safeParse(validBaseHit);
    expect(r.success).toBe(false);
  });

  it('rejects SearchHit with malformed tier_used (out of enum)', () => {
    const r = SearchHitZodSchema.safeParse({
      ...validBaseHit,
      tier_used: 'made-up-tier',
    });
    expect(r.success).toBe(false);
  });
});

describe('PREREQ-005 — SearchOutput.tier_used widened to enum', () => {
  it('accepts SearchOutput with tier_used: "bm25-only"', () => {
    const r = SearchOutputZodSchema.safeParse({
      hits: [{ ...validBaseHit, tier_used: 'bm25-only' }],
      query: 'q',
      result_count: 1,
      tier_used: 'bm25-only',
      signals_used: ['bm25'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts SearchOutput with tier_used: "fs-grep"', () => {
    const r = SearchOutputZodSchema.safeParse({
      hits: [{ ...validBaseHit, tier_used: 'fs-grep' }],
      query: 'q',
      result_count: 1,
      tier_used: 'fs-grep',
      signals_used: [],
    });
    expect(r.success).toBe(true);
  });

  it('rejects SearchOutput with malformed tier_used', () => {
    const r = SearchOutputZodSchema.safeParse({
      hits: [],
      query: 'q',
      result_count: 0,
      tier_used: 'made-up-tier',
      signals_used: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts SearchOutput with tier_used: "hybrid" (SP-005 baseline)', () => {
    const r = SearchOutputZodSchema.safeParse({
      hits: [{ ...validBaseHit, tier_used: 'hybrid' }],
      query: 'q',
      result_count: 1,
      tier_used: 'hybrid',
      signals_used: ['bm25', 'dense', 'graph', 'confidence'],
    });
    expect(r.success).toBe(true);
  });
});
