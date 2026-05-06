// T031 — Zod schemas for the corpus.find MCP tool.
// Source of truth: specs/001-local-only-mcp-foundation/contracts/mcp-corpus-find.md
// Constitution V (schema-enforced output).
//
// SP-001 ships the schemas + JSON Schema derivers; the handler (T032) returns
// empty hits per the contract. SP-005 fills in ranking semantics.

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const SearchFilter = z.object({
  domain: z.string().optional(),
  type: z
    .enum([
      'entity',
      'concept',
      'tutorial',
      'analysis',
      'reference',
      'synthesis',
      'cheat-sheet',
    ])
    .optional(),
  source_type: z
    .enum([
      'article',
      'research-paper',
      'manual',
      'form',
      'video',
      'podcast',
      'book',
      'notes',
      'transcript',
      'reference',
    ])
    .optional(),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(50).default(10),
  mode: z.enum(['hybrid', 'keyword', 'vector']).default('hybrid'),
});
export type SearchFilterType = z.infer<typeof SearchFilter>;

export const CorpusFindInput = z.object({
  query: z.string().min(1).max(2000),
  filter: SearchFilter.optional(),
});
export type CorpusFindInputType = z.infer<typeof CorpusFindInput>;

export const SearchHit = z.object({
  id: z.string().regex(/^doc-[0-9a-f]{8}$/),
  title: z.string(),
  source: z.string(),
  source_type: z.string(),
  facet_domain: z.string(),
  facet_type: z.string(),
  summary: z.string(),
  score: z.number(),
  matched_fields: z.array(z.string()),
  matched_tier: z.enum(['hybrid', 'keyword', 'grep_catalog', 'grep_body']),
});
export type SearchHitType = z.infer<typeof SearchHit>;

export const CorpusFindOutput = z.object({
  hits: z.array(SearchHit),
  query: z.string(),
  tier_used: z.enum(['hybrid', 'keyword', 'grep_catalog', 'grep_body']).optional(),
});
export type CorpusFindOutputType = z.infer<typeof CorpusFindOutput>;

/**
 * JSON Schema for `corpus.find` input — derived from CorpusFindInput.
 * Used in `tools/list` and as the SDK validation gate for `tools/call`.
 */
export function inputJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(CorpusFindInput, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}

/**
 * JSON Schema for `corpus.find` output — derived from CorpusFindOutput.
 * Used in `tools/list` advertisement and as the SDK validation gate for
 * the handler return value.
 */
export function outputJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(CorpusFindOutput, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}
