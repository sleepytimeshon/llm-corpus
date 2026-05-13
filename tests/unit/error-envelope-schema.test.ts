// SP-005 T004 — Contract test for SearchErrorEnvelopeZodSchema.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-004
//   - specs/005-retrieval/contracts/error-envelope-schema.json
//   - specs/005-retrieval/data-model.md §"Entity 9"

import { describe, it, expect } from 'vitest';
import {
  SearchErrorEnvelopeZodSchema,
  SEARCH_ERROR_CODES,
} from '../../packages/contracts/src/search-schemas.js';

describe('PREREQ-001 — SearchErrorEnvelopeZodSchema', () => {
  it('accepts a valid envelope', () => {
    const r = SearchErrorEnvelopeZodSchema.safeParse({
      error_code: 'validation_error',
      message: 'm',
      hint: 'h',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown error_code', () => {
    const r = SearchErrorEnvelopeZodSchema.safeParse({
      error_code: 'unknown_kind',
      message: 'm',
      hint: 'h',
    });
    expect(r.success).toBe(false);
  });

  it('rejects message > 1024 chars', () => {
    const r = SearchErrorEnvelopeZodSchema.safeParse({
      error_code: 'internal_error',
      message: 'm'.repeat(1025),
      hint: 'h',
    });
    expect(r.success).toBe(false);
  });

  it('rejects hint > 1024 chars', () => {
    const r = SearchErrorEnvelopeZodSchema.safeParse({
      error_code: 'internal_error',
      message: 'm',
      hint: 'h'.repeat(1025),
    });
    expect(r.success).toBe(false);
  });

  it('SEARCH_ERROR_CODES is the closed expected enum', () => {
    expect([...SEARCH_ERROR_CODES]).toEqual([
      'validation_error',
      'embedding_unavailable',
      'index_unavailable',
      'query_aborted',
      'all_signals_failed',
      'internal_error',
    ]);
  });
});
