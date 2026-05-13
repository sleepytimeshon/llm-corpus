// SP-005 (T055 REPLACE) — corpus.find tool handler — real ranking.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-004,
//     FR-RETRIEVAL-011, FR-RETRIEVAL-017, FR-RETRIEVAL-020
//   - specs/005-retrieval/contracts/{search-hit,error-envelope}-schema.json
//   - Constitution Principles III, V, VII
//
// Replaces the SP-001 placeholder. Validates input via the canonical
// SearchInputZodSchema → on parse failure, returns a validation_error
// envelope wrapped in the SearchOutput shape (as a SUCCESSFUL MCP tool
// response, NOT a transport-level error per FR-RETRIEVAL-004 verbatim).
// On success, delegates to @llm-corpus/index searchOrchestrator.
//
// The MCP server entry point is responsible for constructing the
// dependencies (db handle, embedding adapter, weights config) once at boot
// and threading them in via the handler factory below.

import {
  SearchInputZodSchema,
  SearchOutputZodSchema,
  type SearchOutput,
} from '@llm-corpus/contracts';
import type { CorpusFindInputType } from './schemas.js';

import type { Database as DatabaseType } from 'better-sqlite3';
import type { EmbeddingAdapter } from '@llm-corpus/inference';
import { searchOrchestrator } from '@llm-corpus/index';
import type { ConfidenceWeights } from '@llm-corpus/index';
import { interactivePolicy } from '@llm-corpus/pipeline';

export type CorpusFindHandler = (
  input: CorpusFindInputType,
  signal: AbortSignal,
) => Promise<SearchOutput>;

export interface CorpusFindHandlerDeps {
  /** SQLite write-or-read connection with sqlite-vec loaded. */
  db: DatabaseType;
  /** Configured embedding adapter (single instance per server). */
  embeddingAdapter: EmbeddingAdapter;
  /** Optional confidence-weight override (defaults to DEFAULT_CONFIDENCE_WEIGHTS). */
  weightsConfig?: ConfidenceWeights;
}

/**
 * Build a corpus.find handler bound to the given dependencies. The
 * mcp-server.ts call site constructs deps once at boot and registers the
 * tool with the returned handler.
 *
 * Handler behavior:
 *   1. Zod-parse the raw input via SearchInputZodSchema.
 *   2. On parse failure → return a `validation_error` envelope (SUCCESSFUL
 *      tool response per FR-RETRIEVAL-004).
 *   3. On parse success → call searchOrchestrator with the supplied
 *      AbortSignal. Return its SearchOutput unchanged (already validated
 *      by SearchOutputZodSchema inside the orchestrator).
 */
export function createCorpusFindHandler(
  deps: CorpusFindHandlerDeps,
): CorpusFindHandler {
  return async (rawInput, signal) => {
    const parsed = SearchInputZodSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 5).map((i) => i.message);
      return SearchOutputZodSchema.parse({
        hits: [],
        query:
          typeof (rawInput as { query?: unknown })?.query === 'string'
            ? (rawInput as { query: string }).query
            : '',
        result_count: 0,
        tier_used: 'hybrid' as const,
        signals_used: [],
        error: {
          error_code: 'validation_error' as const,
          message: `Invalid input: ${issues.join('; ')}`.slice(0, 1024),
          hint: 'Check that query is ≤ 2048 chars; filter keys are facet_domain/facet_type/tags/since/until/source_type; limit is in [1, 100].',
        },
      });
    }

    return searchOrchestrator({
      input: parsed.data,
      db: deps.db,
      embeddingAdapter: deps.embeddingAdapter,
      weightsConfig: deps.weightsConfig,
      topKPerRetriever: interactivePolicy.topKPerRetriever,
      retrieverSqlTimeoutMs: interactivePolicy.retrieverSqlTimeoutMs,
      embeddingHttpTimeoutMs: interactivePolicy.embeddingHttpTimeoutMs,
      searchTotalTimeoutMs: interactivePolicy.searchTotalTimeoutMs,
      signal,
    });
  };
}

/**
 * Default handler — preserves the SP-001 placeholder contract for callers
 * that build the MCP server without DI (typically: tests verifying the
 * tools/list surface, daemon startup before the index DB is open). It
 * returns the SearchOutput shape with an empty hits array and the query
 * echo — equivalent to the original SP-001 behavior, now structurally
 * wrapped in the SP-005 SearchOutput envelope.
 *
 * Real ranking lands when the mcp-server is built with `corpusFindDeps`
 * or `corpusFindHandlerOverride` — see createCorpusFindHandler().
 */
export const corpusFindHandler: CorpusFindHandler = async (input, signal) => {
  signal.throwIfAborted();
  return SearchOutputZodSchema.parse({
    hits: [],
    query: input.query,
    result_count: 0,
    tier_used: 'hybrid' as const,
    signals_used: [],
  });
};
