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
  emitTelemetry,
} from '@llm-corpus/contracts';
import { randomUUID, createHash } from 'node:crypto';
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

/**
 * SP-008 T016 — Maximum query length for the engagement event's `query` field
 * (Constitution IX ≤ 4 KB-per-line discipline; data-model.md Entity 1).
 */
const ENGAGEMENT_QUERY_MAX = 1024;

/**
 * SP-008 T016/T019 — additive instrumentation that wraps any CorpusFindHandler
 * with the per-`corpus.find` engagement-event emission. Per Decision A:
 *
 *   (a) generates `request_id: randomUUID()` at handler entry
 *   (b) runs the inner handler (which already emits the existing
 *       SP-005 `search.query` event)
 *   (c) emits a new `engagement.corpus_find_invoked` event via
 *       `emitTelemetry()` AFTER the inner handler returns
 *   (d) computes `query_hash` over the FULL untruncated query
 *   (e) truncates `query` to 1024 chars + sets `query_truncated: true` when
 *       length > 1024
 *   (f) captures `result_count`, `tier_used`, `duration_ms` from the
 *       SearchOutput + wall-clock timing
 *   (g) optionally echoes `request_id` to stderr ONLY when CLI-mediated
 *       (heuristic: `process.stderr.isTTY === true` AND
 *       `process.env.MCP_TRANSPORT !== 'stdio'`)
 *
 * ZERO mutation of `SearchOutputZodSchema` shape — the request_id is
 * surfaced via the engagement event, NOT via the MCP `tools/call` response.
 *
 * Per Constitution III + XIII: this is the deepest common handler-boundary
 * point — the wrapper covers all three transport paths (real MCP-stdio,
 * library-handler-direct, CLI-mediated) because every path eventually
 * calls a CorpusFindHandler. The wrapper does NOT add new outbound
 * endpoints (FR-ENGAGEMENT-015 preserved).
 *
 * Telemetry-or-Die (Constitution XIII): the engagement emit is best-effort
 * — a transient `emitTelemetry()` failure is logged and swallowed; the
 * SearchOutput still returns to the caller. This matches the SP-005
 * `search.query` emit discipline (both are observability records, not
 * load-bearing application state).
 */
export function wrapHandlerWithEngagement(
  inner: CorpusFindHandler,
): CorpusFindHandler {
  return async (input, signal) => {
    const request_id = randomUUID();
    const startedAt = Date.now();
    const output = await inner(input, signal);
    const duration_ms = Date.now() - startedAt;

    // Engagement event payload — query-truncation + hash per data-model.md
    // Entity 1 invariants (query_hash over the FULL untruncated text,
    // query_truncated only when > 1024 chars).
    const queryRaw =
      typeof (input as { query?: unknown })?.query === 'string'
        ? (input as { query: string }).query
        : '';
    const truncated = queryRaw.length > ENGAGEMENT_QUERY_MAX;
    const query = truncated ? queryRaw.slice(0, ENGAGEMENT_QUERY_MAX) : queryRaw;
    const query_hash = createHash('sha256').update(queryRaw).digest('hex');

    try {
      await emitTelemetry({
        event: 'engagement.corpus_find_invoked',
        timestamp: new Date().toISOString(),
        request_id,
        query,
        ...(truncated ? { query_truncated: true as const } : {}),
        query_hash,
        result_count: output.result_count,
        tier_used: output.tier_used,
        duration_ms,
      });
    } catch (err) {
      // Telemetry-or-Die compromise: log to stderr (NOT process.exit) and
      // surface the SearchOutput to the caller. Matches SP-005 behavior.
      const msg = err instanceof Error ? err.message : String(err);
      try {
        process.stderr.write(
          `corpus.find: engagement.corpus_find_invoked emit failed: ${msg}\n`,
        );
      } catch {
        /* swallow */
      }
    }

    // Optional CLI-side echo of request_id so the operator can copy it for
    // `corpus accept <request_id>`. Suppressed for MCP-stdio mediated
    // calls so the JSON-RPC stream stays clean.
    if (
      process.stderr.isTTY === true &&
      process.env.MCP_TRANSPORT !== 'stdio'
    ) {
      try {
        process.stderr.write(`corpus.find: request_id=${request_id}\n`);
      } catch {
        /* swallow */
      }
    }

    return output;
  };
}

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
  deps: CorpusFindHandlerDeps | { handlerOverride: CorpusFindHandler },
): CorpusFindHandler {
  // SP-008 T016 — test affordance: when `handlerOverride` is supplied, wrap
  // it with the engagement instrumentation directly without booting the
  // tier-orchestrator. Used by unit tests that exercise the wrapper at the
  // handler boundary without real Ollama/SQLite. Production callers pass
  // `CorpusFindHandlerDeps` and the canonical Tier-0..3 path runs.
  if ('handlerOverride' in deps) {
    return wrapHandlerWithEngagement(deps.handlerOverride);
  }
  const production: CorpusFindHandler = async (rawInput, signal) => {
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
  // SP-008 T016 — wrap the production handler with the engagement
  // instrumentation so every successful corpus.find emits the engagement
  // event per FR-ENGAGEMENT-001.
  return wrapHandlerWithEngagement(production);
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
 *
 * SP-008 T016 — this default handler is intentionally NOT wrapped with
 * the engagement instrumentation: it is the empty-hits placeholder used
 * by tests that verify tools/list surface shape; emitting engagement
 * events from those tests would pollute test telemetry. The wrapper is
 * applied to the production handler via `createCorpusFindHandler`.
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
