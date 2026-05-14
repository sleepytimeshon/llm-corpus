// SP-005 (T055 REPLACE) — corpus.find tool handler — real ranking.
// SP-006 (Engineer #5 cutover) — delegates to the SP-006 tier-fallthrough
// cascade (`runTieredSearch`) rather than the SP-005 Tier 0-only
// `searchOrchestrator`. Tier 0 (hybrid) remains the primary retrieval
// surface; Tiers 1/2/3 fire only when Tier 0 returns fewer than
// `policy.minResultsForFallthrough` hits and the aggregate budget allows.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-004,
//     FR-RETRIEVAL-011, FR-RETRIEVAL-017, FR-RETRIEVAL-020
//   - specs/006-hardening/spec.md FR-HARDEN-013..019
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md "Decision"
//   - specs/005-retrieval/contracts/{search-hit,error-envelope}-schema.json
//   - Constitution Principles III, V, VII
//
// Behavior:
//   1. Zod-parse the raw input via SearchInputZodSchema.
//   2. On parse failure → return a `validation_error` envelope (SUCCESSFUL
//      tool response per FR-RETRIEVAL-004).
//   3. On parse success → build a TierDeps wired against the SP-005 Tier 0
//      retriever (unmodified) plus SP-006 Tier 1/2/3 retrievers, then call
//      `runTieredSearch`. Each SearchHit's `tier_used` field reflects the
//      tier that produced it; the SearchOutput's cascade-level `tier_used`
//      reflects the deepest contributing tier.

import {
  SearchInputZodSchema,
  SearchOutputZodSchema,
  type SearchOutput,
} from '@llm-corpus/contracts';
import type { CorpusFindInputType } from './schemas.js';

import type { Database as DatabaseType } from 'better-sqlite3';
import type { EmbeddingAdapter } from '@llm-corpus/inference';
import { runTieredSearch, buildDefaultTierDeps } from '@llm-corpus/index';
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
  /** Optional confidence-weight override (defaults to DEFAULT_CONFIDENCE_WEIGHTS).
   * Reserved for future Tier 0 wiring; the current SP-005 hybrid surface
   * loads confidence weights internally from DEFAULT_CONFIDENCE_WEIGHTS.
   */
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
 *   3. On parse success → build a TierDeps and invoke `runTieredSearch` (the
 *      SP-006 tier-fallthrough cascade). Returns the SearchOutput unchanged
 *      (already validated by SearchOutputZodSchema inside the orchestrator).
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

    const tierDeps = buildDefaultTierDeps({
      input: parsed.data,
      db: deps.db,
      embeddingAdapter: deps.embeddingAdapter,
      topKPerRetriever: interactivePolicy.topKPerRetriever,
      retrieverSqlTimeoutMs: interactivePolicy.retrieverSqlTimeoutMs,
      embeddingHttpTimeoutMs: interactivePolicy.embeddingHttpTimeoutMs,
      searchTotalTimeoutMs: interactivePolicy.searchTotalTimeoutMs,
      policy: {
        minResultsForFallthrough: interactivePolicy.minResultsForFallthrough,
        tierTotalBudgetMs: interactivePolicy.tierTotalBudgetMs,
        tierBm25TimeoutMs: interactivePolicy.tierBm25TimeoutMs,
        tierCatalogGrepTimeoutMs: interactivePolicy.tierCatalogGrepTimeoutMs,
        tierFsGrepTimeoutMs: interactivePolicy.tierFsGrepTimeoutMs,
      },
    });
    return runTieredSearch(parsed.data, tierDeps, signal);
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
