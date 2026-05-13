# ADR — Tier 1/2/3 Fallthrough Cascade Algorithm + Per-Tier Latency Budgets

**Feature**: 006-hardening
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

SP-005 shipped Tier 0 (the four-signal hybrid retriever: BM25 + dense + graph + confidence) with `tier_used` hardcoded to `'hybrid'` per FR-RETRIEVAL-010. ARCHITECTURE-FINAL §10.6 specifies a four-tier model:

| Tier | Method | Latency target | Coverage |
|---|---|---|---|
| 0 | Hybrid (BM25 ⊕ vector ⊕ graph ⊕ confidence) | < 20 ms | metadata + body excerpt + semantic + edges |
| 1 | BM25 only | < 5 ms | indexed text fields |
| 2 | Body grep over `CATALOG.md` | < 50 ms | all summaries + domains |
| 3 | Filesystem grep across `docs/` | < 500 ms | full document body |

"A query returning fewer than `min_results` hits at tier 0 falls through to lower tiers within an aggregate latency budget. The caller sees one result set; the matched tier is reported in hit metadata."

The §10.6 model exists for queries where Tier 0 underdelivers (rare-term queries, queries against under-classified corpora, partial-signal degradation cases). Without tier fallthrough, those queries get empty or near-empty responses; with fallthrough, lower-tier retrievers fill the gap.

This ADR codifies the cascade algorithm, per-tier latency budgets, the `min_results` trigger, the aggregate budget enforcement, the `tier_used` field on each SearchHit, and the new SP-006 telemetry classes.

## Decision

**Cascade Algorithm**:

```
function searchWithFallthrough(query, filters, signal, policy):
  budget_ms = config.search.tier_total_budget_ms ?? 600
  min_results = config.search.min_results ?? 3
  controller = new AbortController()
  timeoutHandle = setTimeout(() => controller.abort('tier_budget_exceeded'), budget_ms)

  // Link caller's signal to our controller (composite signal)
  signal?.addEventListener('abort', () => controller.abort())

  results = []
  tiers_attempted = []

  try:
    // Tier 0 (hybrid) — SP-005 unchanged
    tier0Result = await tier0_hybrid_search(query, filters, controller.signal)
    tiers_attempted.push('hybrid')
    results = merge(results, tier0Result.hits, prefer='hybrid')
    if (count(results) >= min_results): return finalize(results, 'hybrid')

    emit('search.tier_fallthrough', {from:'hybrid', to:'bm25-only', reason:'below_min_results', hits_before_fallthrough: tier0Result.hits.length})

    // Tier 1 (BM25-only over documents_fts)
    tier1Result = await tier1_bm25_only(query, filters, controller.signal)
    tiers_attempted.push('bm25-only')
    results = merge(results, tier1Result.hits, prefer='hybrid_over_bm25-only')
    if (count(results) >= min_results): return finalize(results, 'bm25-only')

    emit('search.tier_fallthrough', {from:'bm25-only', to:'catalog-grep', reason:'below_min_results', hits_before_fallthrough: count(results)})

    // Tier 2 (in-process grep over Paths.data() + '/CATALOG.md')
    if (catalog_md_exists()):
      tier2Result = await tier2_catalog_grep(query, filters, controller.signal)
      tiers_attempted.push('catalog-grep')
      results = merge(results, tier2Result.hits, prefer='higher_tier')
      if (count(results) >= min_results): return finalize(results, 'catalog-grep')
    else:
      emit('search.tier_skipped', {tier:'catalog-grep', reason:'catalog_missing'})

    emit('search.tier_fallthrough', {from:'catalog-grep', to:'fs-grep', reason:'below_min_results', hits_before_fallthrough: count(results)})

    // Tier 3 (runTool('grep', ['-rn','-l','--include=*.md', <pattern>, Paths.docs()]))
    tier3Result = await tier3_fs_grep(query, filters, controller.signal)
    tiers_attempted.push('fs-grep')
    results = merge(results, tier3Result.hits, prefer='higher_tier')
    return finalize(results, 'fs-grep')

  catch error if error.name == 'AbortError' && controller.signal.reason == 'tier_budget_exceeded':
    emit('search.tier_budget_exceeded', {budget_ms, actual_ms: <measured>, tiers_attempted, final_hit_count: count(results)})
    return finalize(results, deepest_tier(tiers_attempted))

  finally:
    clearTimeout(timeoutHandle)
```

**Merge Semantics**:

Higher-tier hits win on doc_id collision. A doc found at both Tier 0 (score=0.8, tier_used='hybrid') and Tier 1 (score=0.5, tier_used='bm25-only') retains its Tier 0 score and `tier_used: 'hybrid'`. This preserves the highest-quality ranking; only NEW docs from lower tiers are added.

**Per-Tier Latency Budgets** (per ARCHITECTURE-FINAL §10.6 verbatim — TARGETS not guarantees per Constitution XVI):

- Tier 0 (hybrid): < 20 ms aspirational / < 100 ms honest commitment (inherited from SP-005)
- Tier 1 (BM25-only): < 5 ms aspirational / < 25 ms honest commitment
- Tier 2 (CATALOG.md in-process grep): < 50 ms aspirational / < 150 ms honest commitment
- Tier 3 (fs-grep via runTool): < 500 ms aspirational / < 1000 ms honest commitment

**Aggregate Latency Budget**: Configurable via `config.toml [search].tier_total_budget_ms`; default 600 ms (= 20 + 5 + 50 + 500 + 25 ms slack). Enforced via AbortController + `setTimeout(() => controller.abort('tier_budget_exceeded'), budget_ms)` + `clearTimeout` on cascade completion. NEVER `Promise.race(setTimeout)` (Constitution VII forbidden pattern).

**`tier_used` Field on SearchHit** (per Decision K in research.md): SP-005's `SearchHitZodSchema` is extended additively with `tier_used: z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])`. Per-hit `tier_used` reflects the tier that produced the hit. The `search.completed` event payload's `tier_used` reflects the DEEPEST tier that contributed any hit.

**Tier 0 (Hybrid) Implementation**: Unchanged from SP-005. The SP-005 `searchOrchestrator` is wrapped by the new `tier-orchestrator.ts`; the wrapper invokes `searchOrchestrator` for Tier 0, then applies the fallthrough logic.

**Tier 1 (BM25-only) Implementation**: `packages/index/src/bm25-only-tier.ts` (NEW). Calls SP-005's `Fts5Adapter.search(query, {topK, filters, signal})` ONLY (no dense / graph / confidence). Returns the FTS5-ranked SearchHit list with `tier_used: 'bm25-only'`.

**Tier 2 (CATALOG.md Grep) Implementation**: `packages/index/src/catalog-grep-tier.ts` (NEW). Reads `Paths.data() + '/CATALOG.md'` into memory; line-by-line substring-match against the query terms (case-insensitive); for each matching line, parses out the doc_id; maps to SearchHit shape. If CATALOG.md is absent, emits `search.tier_skipped` and falls through. NO subprocess (in-process grep).

**Tier 3 (fs-grep) Implementation**: `packages/index/src/fs-grep-tier.ts` (NEW). Invokes `runTool('grep', ['-rn', '-l', '--include=*.md', escapedPattern, Paths.docs()], {signal, timeoutMs: 500})` per Constitution XII subprocess hygiene. The `escapedPattern` is the query string escaped for BRE (backslash-escape `[]\^$.|*+()?{}`). Matched file paths are mapped to doc_id via `SELECT id FROM documents WHERE body_path = ?` SQL lookup. Returns SearchHit list with `tier_used: 'fs-grep'`. On `ENOENT` (grep not installed), emits `search.tier_failed` with `errno='ENOENT'` and returns empty.

**CATALOG.md Generation** (per Decision L in research.md): Auto-generated at SP-005 index-stage time. `packages/storage/src/index-persister.ts` (EXTENDED) appends a line to `Paths.data() + '/CATALOG.md'` after each successful index transaction (post-COMMIT). Atomic via `withTempDir + fs.appendFile`. `corpus reindex` (EXTENDED) regenerates the file wholesale during the backfill loop.

**Telemetry Classes** (per FR-HARDEN-019 + Constitution XIII):

- `search.tier_fallthrough` — per fallthrough; payload: `from_tier`, `to_tier`, `reason`, `hits_before_fallthrough`.
- `search.tier_skipped` — per skipped tier; payload: `tier`, `reason`.
- `search.tier_failed` — per failed tier; payload: `tier`, `errno`/`error_code`, `duration_ms`.
- `search.tier_budget_exceeded` — per cascade timeout; payload: `budget_ms`, `actual_ms`, `tiers_attempted`, `final_hit_count`.
- `search.completed` (UPDATED) — `tier_used` field upgraded from `z.literal('hybrid')` to `z.enum([...])`.

## Consequences

**Positive**:

- Queries that Tier 0 underdelivered on now have a graceful degradation path through three lower tiers.
- The §10.6 architectural commitment is fully implemented.
- Per-hit `tier_used` provides provenance — operators can audit which tier produced which hit.
- The aggregate budget prevents pathological slow queries.
- The merge semantics preserve higher-tier quality.

**Negative**:

- Adds complexity to the search orchestrator (sequential cascade vs SP-005's parallel four-retriever fusion).
- Tier 3's subprocess invocation is the only new subprocess in SP-006 — requires `runTool` discipline.
- CATALOG.md grows linearly with corpus size; pathological 1M-doc corpora may need sharding (deferred to future-horizon).

**Risk mitigations**:

- **R1 (low) — grep binary absent on PATH**: Mitigation: Tier 3 emits `search.tier_failed` with `errno='ENOENT'`; cascade returns prior tiers' results.
- **R2 (medium) — Aggregate budget exhausted before Tier 3 starts**: Mitigation: per-tier budget allocation respects §10.6 targets; worst-case the cascade returns the partial set with `search.tier_budget_exceeded` telemetry. Honest commitment (configurable).
- **R3 (low) — `tier_used` field breaks SP-005 consumers**: Mitigation: SearchHit consumers that ignore unknown fields are unaffected; strict-parsing consumers in the SP-006-aware substrate parse the enum correctly.
- **R4 (low) — Tier 2 in-process grep slow on huge CATALOG.md**: Mitigation: < 50 ms target at 10k-doc corpora; < 150 ms honest at 100k. Beyond 1M, future-horizon sharding.

## Implementation Notes

- `packages/index/src/tier-orchestrator.ts` (NEW) — `tierFallthroughSearch(input, deps, signal): Promise<SearchOutput>`. Orchestrates Tier 0 → 1 → 2 → 3 cascade with budget enforcement.
- `packages/index/src/bm25-only-tier.ts` (NEW)
- `packages/index/src/catalog-grep-tier.ts` (NEW)
- `packages/index/src/fs-grep-tier.ts` (NEW)
- `packages/storage/src/index-persister.ts` (EXTENDED) — CATALOG.md append post-COMMIT.
- `packages/storage/src/catalog-md-generator.ts` (NEW) — `formatCatalogLine(doc): string` helper; `appendCatalogLine(doc, signal): Promise<void>`.
- `packages/contracts/src/search-schemas.ts` (EXTENDED) — `tier_used` enum field added to `SearchHitZodSchema`; `SearchOutputZodSchema.tier_used` updated to enum.
- `packages/contracts/src/telemetry.ts` (EXTENDED) — 4 new tier-* event classes + 1 updated `search.completed`.
- `packages/cli/src/reindex-command.ts` (EXTENDED) — CATALOG.md regeneration as part of backfill loop.
- `eslint.config.js` (EXTENDED) — `no-shell-string-exec` + `paths-from-resolver-only` scoped over the new SP-006 index/tier source files.

## Status

Accepted. Implementation in `tasks.md` Phase 5 (US3 P2).
