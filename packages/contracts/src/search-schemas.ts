// SP-005 PREREQ-001 — SearchInput / SearchHit / SearchErrorEnvelope Zod schemas.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-004,
//     FR-RETRIEVAL-020
//   - specs/005-retrieval/data-model.md §"Entity 7 / 8 / 9"
//   - specs/005-retrieval/contracts/{search-hit-schema,error-envelope-schema}.json
//   - Constitution Principle V (Schema-Enforced Structured Output)
//
// Single source of truth for the corpus.find tool's input/output shapes.
// The canonical JSON Schema files under specs/005-retrieval/contracts/ are
// kept in sync by hand — any divergence is a bug.

import { z } from 'zod';
import { FACET_TYPE_VALUES } from './classifier-schema.js';

// ISO-8601 string regex (date or datetime).
const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Closed-vocabulary filter facets. Each retriever pushes these into its SQL
 * WHERE clause BEFORE fusion (FR-RETRIEVAL-001; SC-RETRIEVAL-008). Strict
 * mode — unknown keys produce a validation_error envelope.
 */
export const SearchFiltersZodSchema = z
  .object({
    facet_domain: z.string().optional(),
    facet_type: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.array(z.string()).optional(),
    since: z.string().regex(ISO8601_REGEX).optional(),
    until: z.string().regex(ISO8601_REGEX).optional(),
    source_type: z.string().optional(),
  })
  .strict();
export type SearchFilters = z.infer<typeof SearchFiltersZodSchema>;

/**
 * Input shape for the corpus.find MCP tool. Validated at the tool boundary;
 * failure produces a validation_error envelope as a successful MCP response
 * per FR-RETRIEVAL-004 (NOT a transport-level error).
 */
export const SearchInputZodSchema = z
  .object({
    query: z.string().max(2048),
    filters: SearchFiltersZodSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export type SearchInput = z.infer<typeof SearchInputZodSchema>;

/**
 * SearchHit — one entry in the corpus.find response's `hits` array. Canonical
 * schema mirrors specs/005-retrieval/contracts/search-hit-schema.json.
 */
export const SearchHitZodSchema = z
  .object({
    uri: z.string().regex(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/),
    score: z.number(),
    title: z.string(),
    facet_domain: z.string().min(1),
    facet_type: z.enum(FACET_TYPE_VALUES),
    tags: z.array(z.string().min(1)),
    snippet: z.string().max(400),
  })
  .strict();
export type SearchHit = z.infer<typeof SearchHitZodSchema>;

/**
 * Closed-vocabulary error_code enum for the SearchErrorEnvelope. Returned
 * inside the standard tool response shape (NOT as a transport-level error)
 * per FR-RETRIEVAL-004.
 */
export const SEARCH_ERROR_CODES = [
  'validation_error',
  'embedding_unavailable',
  'index_unavailable',
  'query_aborted',
  'all_signals_failed',
  'internal_error',
] as const;
export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[number];

export const SearchErrorEnvelopeZodSchema = z
  .object({
    error_code: z.enum(SEARCH_ERROR_CODES),
    message: z.string().max(1024),
    hint: z.string().max(1024),
  })
  .strict();
export type SearchErrorEnvelope = z.infer<typeof SearchErrorEnvelopeZodSchema>;

/**
 * Closed list of named ranking signals — used in `signals_used` and
 * `degraded_signals` annotations on the SearchOutput.
 */
export const RANKING_SIGNAL_NAMES = [
  'bm25',
  'dense',
  'graph',
  'confidence',
] as const;
export type RankingSignalName = (typeof RANKING_SIGNAL_NAMES)[number];

/**
 * Output shape for the corpus.find tool. Always carries the query echo + the
 * structural metadata; `hits` is empty when an error envelope is returned.
 */
export const SearchOutputZodSchema = z
  .object({
    hits: z.array(SearchHitZodSchema),
    query: z.string(),
    result_count: z.number().int().nonnegative(),
    tier_used: z.literal('hybrid'),
    signals_used: z.array(z.enum(RANKING_SIGNAL_NAMES)),
    degraded_signals: z.array(z.enum(RANKING_SIGNAL_NAMES)).optional(),
    filters_applied: SearchFiltersZodSchema.optional(),
    error: SearchErrorEnvelopeZodSchema.optional(),
  })
  .strict();
export type SearchOutput = z.infer<typeof SearchOutputZodSchema>;
