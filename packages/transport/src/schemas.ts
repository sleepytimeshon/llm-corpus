// SP-005 (T055 REPLACE) — Zod schemas for the corpus.find MCP tool.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-004,
//     FR-RETRIEVAL-017, FR-RETRIEVAL-020
//   - specs/005-retrieval/contracts/{search-hit,error-envelope}-schema.json
//   - Constitution Principle V (Schema-Enforced Structured Output)
//
// SP-001 shipped this module with a placeholder SearchHit/Output shape
// (id-based, including matched_tier / matched_fields fields that never got
// wired up). SP-005 REPLACES those types with the canonical
// SearchInput / SearchHit / SearchOutput shapes from
// @llm-corpus/contracts/search-schemas — single source of truth.
//
// Per PREREQ-009 / FR-RETRIEVAL-017, NO new MCP tools are added. The
// corpus.find tool's tool name + Zod-validated input/output surface
// remains; the FIELDS within input/output are now SP-005 verbatim per
// the spec FR-RETRIEVAL-001 verbatim contract.

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SearchInputZodSchema,
  SearchOutputZodSchema,
  SearchHitZodSchema,
  SearchFiltersZodSchema,
  type SearchInput,
  type SearchOutput,
  type SearchHit as SearchHitType_,
  type SearchFilters,
} from '@llm-corpus/contracts';

// Re-export the canonical SP-005 schemas under the SP-001-era names so the
// mcp-server.ts tool-registration call sites remain unchanged.
export const CorpusFindInput = SearchInputZodSchema;
export const CorpusFindOutput = SearchOutputZodSchema;
export const SearchHit = SearchHitZodSchema;
export const SearchFilter = SearchFiltersZodSchema;
export type CorpusFindInputType = SearchInput;
export type CorpusFindOutputType = SearchOutput;
export type SearchHitType = SearchHitType_;
export type SearchFilterType = SearchFilters;

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
