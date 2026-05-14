// SP-006 T047 — Tier-fallthrough orchestrator.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-013..019
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Decision"
//   - specs/006-hardening/data-model.md §"Entity 3 + 4"
//   - Constitution Principles VII (cancellable bounded IO), XIII (telemetry-or-die), XVI (validation honesty)
//
// Orchestrates the four-tier cascade:
//   Tier 0 hybrid (SP-005 wrapped) → Tier 1 BM25-only → Tier 2 CATALOG.md
//   grep → Tier 3 fs-grep
//
// Aggregate budget enforced via AbortController + setTimeout(abort)
// (NEVER Promise.race(setTimeout) per Constitution VII forbidden pattern).
// On budget exceeded, emits `search.tier_budget_exceeded` and returns the
// partial set assembled so far.
//
// Merge semantics (Decision K): higher-tier hits win on doc_id collision.
// A doc found at Tier 0 retains its `tier_used='hybrid'` even if Tier 1 also
// produces it. Only NEW doc_ids from lower tiers are appended.
//
// The cascade-level `tier_used` reported on the SearchOutput is the deepest
// tier that contributed any hit (e.g., 'fs-grep' if Tier 3 added at least
// one new hit; else 'catalog-grep'; else 'bm25-only'; else 'hybrid').

import {
  SearchOutputZodSchema,
  emitTelemetry,
  type SearchInput,
  type SearchOutput,
  type SearchHit,
} from '@llm-corpus/contracts';
import type { TierResult } from './bm25-only-tier.js';

export type { TierResult } from './bm25-only-tier.js';
import type { TierName } from './bm25-only-tier.js';

/** Per-tier invocation fn. Signal is chained from the master controller. */
export type TierFn = (signal: AbortSignal) => Promise<TierResult>;

export interface TierPolicy {
  minResultsForFallthrough: number;
  tierTotalBudgetMs: number;
  tierBm25TimeoutMs: number;
  tierCatalogGrepTimeoutMs: number;
  tierFsGrepTimeoutMs: number;
}

export interface TierDeps {
  tier0: TierFn;
  tier1: TierFn;
  tier2: TierFn;
  tier3: TierFn;
  policy: TierPolicy;
}

const TIER_ORDER: TierName[] = ['hybrid', 'bm25-only', 'catalog-grep', 'fs-grep'];

/**
 * Build a child AbortSignal that fires on parent OR after `timeoutMs`.
 * Returns { signal, cleanup }; cleanup MUST run to clear setTimeout +
 * remove parent listener.
 */
function abortChild(
  parent: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const child = new AbortController();
  const onParent = (): void => child.abort();
  if (parent.aborted) {
    child.abort();
  } else {
    parent.addEventListener('abort', onParent, { once: true });
  }
  const handle = setTimeout(() => child.abort(), timeoutMs);
  const cleanup = (): void => {
    clearTimeout(handle);
    parent.removeEventListener('abort', onParent);
  };
  return { signal: child.signal, cleanup };
}

/**
 * Orchestrate the tier-fallthrough cascade. Returns a complete SearchOutput
 * shape (validated via SearchOutputZodSchema).
 */
export async function runTieredSearch(
  input: SearchInput,
  deps: TierDeps,
  parentSignal: AbortSignal,
): Promise<SearchOutput> {
  const start = Date.now();
  const budgetMs = deps.policy.tierTotalBudgetMs;
  const minResults = deps.policy.minResultsForFallthrough;

  // Master abort: composite of parent + aggregate budget.
  const master = abortChild(parentSignal, budgetMs);

  const tierFns: ReadonlyArray<{ name: TierName; fn: TierFn; perTierMs: number }> = [
    { name: 'hybrid', fn: deps.tier0, perTierMs: budgetMs },
    { name: 'bm25-only', fn: deps.tier1, perTierMs: deps.policy.tierBm25TimeoutMs },
    {
      name: 'catalog-grep',
      fn: deps.tier2,
      perTierMs: deps.policy.tierCatalogGrepTimeoutMs,
    },
    { name: 'fs-grep', fn: deps.tier3, perTierMs: deps.policy.tierFsGrepTimeoutMs },
  ];

  const merged = new Map<string, SearchHit>(); // doc_id (from uri) → hit
  const tiersAttempted: TierName[] = [];
  let deepestContributing: TierName = 'hybrid';
  let budgetExceeded = false;

  for (let i = 0; i < tierFns.length; i++) {
    const tier = tierFns[i];
    if (tier === undefined) continue;
    tiersAttempted.push(tier.name);

    if (master.signal.aborted) {
      budgetExceeded = true;
      break;
    }

    // Per-tier child signal chained off master.
    const perTier = abortChild(master.signal, tier.perTierMs);
    let tierResult: TierResult;
    try {
      tierResult = await tier.fn(perTier.signal);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      await emitTelemetry({
        event: 'search.tier_failed',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'failed',
        tier: tier.name,
        error_code: message.slice(0, 128),
        duration_ms: Date.now() - start,
      });
      // Emit a tier_fallthrough record if not the last tier.
      if (i < tierFns.length - 1) {
        const next = tierFns[i + 1];
        if (next !== undefined) {
          await emitTelemetry({
            event: 'search.tier_fallthrough',
            timestamp: new Date().toISOString(),
            severity: 'info',
            outcome: 'success',
            from_tier:
              tier.name === 'fs-grep'
                ? 'catalog-grep'
                : (tier.name as 'hybrid' | 'bm25-only' | 'catalog-grep'),
            to_tier: next.name as 'bm25-only' | 'catalog-grep' | 'fs-grep',
            reason: 'tier_failed',
            hits_before_fallthrough: merged.size,
          });
        }
      }
      perTier.cleanup();
      continue;
    } finally {
      perTier.cleanup();
    }

    // Merge — higher-tier wins on doc_id collision.
    let addedFromThisTier = 0;
    for (const hit of tierResult.hits) {
      if (!merged.has(hit.uri)) {
        merged.set(hit.uri, hit);
        addedFromThisTier += 1;
      }
    }
    if (addedFromThisTier > 0) {
      deepestContributing = tier.name;
    }

    // Outcome='aborted' is treated as budget exceeded.
    if (tierResult.outcome === 'aborted') {
      budgetExceeded = true;
      break;
    }
    // Orchestrator-level skipped event for observability — the tier itself
    // may or may not have already fired one (idempotent on consumer side
    // since skipped events carry their tier label).
    if (
      tierResult.outcome === 'skipped' &&
      (tier.name === 'catalog-grep' || tier.name === 'fs-grep')
    ) {
      await emitTelemetry({
        event: 'search.tier_skipped',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'success',
        tier: tier.name,
        reason: tier.name === 'catalog-grep' ? 'catalog_missing' : 'grep_unavailable',
      });
    }

    // Met threshold? Stop cascading.
    if (merged.size >= minResults) break;

    // Emit fallthrough event (not on the last tier).
    if (i < tierFns.length - 1) {
      const next = tierFns[i + 1];
      if (next !== undefined) {
        await emitTelemetry({
          event: 'search.tier_fallthrough',
          timestamp: new Date().toISOString(),
          severity: 'info',
          outcome: 'success',
          from_tier:
            tier.name === 'fs-grep'
              ? 'catalog-grep'
              : (tier.name as 'hybrid' | 'bm25-only' | 'catalog-grep'),
          to_tier: next.name as 'bm25-only' | 'catalog-grep' | 'fs-grep',
          reason: 'below_min_results',
          hits_before_fallthrough: merged.size,
        });
      }
    }

    if (master.signal.aborted) {
      budgetExceeded = true;
      break;
    }
  }

  master.cleanup();

  if (budgetExceeded) {
    await emitTelemetry({
      event: 'search.tier_budget_exceeded',
      timestamp: new Date().toISOString(),
      severity: 'warn',
      outcome: 'success',
      budget_ms: budgetMs,
      actual_ms: Date.now() - start,
      tiers_attempted: tiersAttempted,
      final_hit_count: merged.size,
    });
  }

  const hits = Array.from(merged.values()).slice(0, input.limit);
  const tierUsed = deepestTier(deepestContributing, hits);

  const output = SearchOutputZodSchema.parse({
    hits,
    query: input.query,
    result_count: hits.length,
    tier_used: tierUsed,
    signals_used: [],
    ...(input.filters ? { filters_applied: input.filters } : {}),
  });
  return output;
}

// ---------------------------------------------------------------------------
// Convenience: build a TierDeps wired against SP-005 + SP-006 tier modules.
// ---------------------------------------------------------------------------

import type { Database as DatabaseType } from 'better-sqlite3';
import type { EmbeddingAdapter } from '@llm-corpus/inference';
import {
  searchOrchestrator,
  type SearchOrchestratorInput,
} from './search.js';
import { runBm25OnlyTier } from './bm25-only-tier.js';
import { runCatalogGrepTier } from './catalog-grep-tier.js';
import { runFsGrepTier } from './fs-grep-tier.js';

export interface BuildTierDepsArgs {
  /** Inherited from SP-005 Tier 0 surface. */
  input: SearchInput;
  db: DatabaseType;
  embeddingAdapter: EmbeddingAdapter;
  /** Tier 0 SP-005 retriever knobs. */
  topKPerRetriever: number;
  retrieverSqlTimeoutMs: number;
  embeddingHttpTimeoutMs: number;
  searchTotalTimeoutMs: number;
  /** SP-006 cascade policy. */
  policy: TierPolicy;
}

/**
 * Build a default TierDeps wired against:
 *   - Tier 0: SP-005 `searchOrchestrator` (unmodified)
 *   - Tier 1: `runBm25OnlyTier`
 *   - Tier 2: `runCatalogGrepTier`
 *   - Tier 3: `runFsGrepTier`
 *
 * The Tier 0 invocation reuses the SP-005 four-signal hybrid logic exactly
 * as-is. The cascade orchestrator wraps it without modifying its retrieval
 * semantics.
 */
export function buildDefaultTierDeps(args: BuildTierDepsArgs): TierDeps {
  return {
    tier0: async (signal) => {
      const start = Date.now();
      const orchestratorInput: SearchOrchestratorInput = {
        input: args.input,
        db: args.db,
        embeddingAdapter: args.embeddingAdapter,
        topKPerRetriever: args.topKPerRetriever,
        retrieverSqlTimeoutMs: args.retrieverSqlTimeoutMs,
        embeddingHttpTimeoutMs: args.embeddingHttpTimeoutMs,
        searchTotalTimeoutMs: args.searchTotalTimeoutMs,
        signal,
      };
      const out = await searchOrchestrator(orchestratorInput);
      // SP-005 emits its own search.completed/search.degraded telemetry; we
      // promote its hits into a TierResult for cascade integration.
      return {
        tier: 'hybrid',
        hits: out.hits,
        elapsed_ms: Date.now() - start,
        outcome: out.error ? 'failed' : 'completed',
      };
    },
    tier1: async (signal) =>
      runBm25OnlyTier({
        input: args.input,
        db: args.db,
        topK: args.topKPerRetriever,
        signal,
      }),
    tier2: async (signal) =>
      runCatalogGrepTier({
        input: args.input,
        signal,
      }),
    tier3: async (signal) =>
      runFsGrepTier({
        input: args.input,
        db: args.db,
        timeoutMs: args.policy.tierFsGrepTimeoutMs,
        signal,
      }),
    policy: args.policy,
  };
}

/**
 * Compute the cascade-level `tier_used`: the deepest tier among the
 * tier_used fields of the returned hits, or the explicit deepestContributing
 * tracker (in case no hits were returned).
 */
function deepestTier(
  fallback: TierName,
  hits: ReadonlyArray<SearchHit>,
): TierName {
  let deepestIdx = TIER_ORDER.indexOf(fallback);
  for (const h of hits) {
    const idx = TIER_ORDER.indexOf(h.tier_used);
    if (idx > deepestIdx) deepestIdx = idx;
  }
  return TIER_ORDER[deepestIdx] ?? fallback;
}
