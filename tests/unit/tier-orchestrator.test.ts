// SP-006 T039 — Unit test for the tier-fallthrough orchestrator.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   - Tier 0 yields ≥ min_results → tier_used='hybrid'; no fallthrough event
//   - Tier 0 yields < min_results → emits search.tier_fallthrough; runs Tier 1
//   - Tier 1 yields ≥ min_results → tier_used='bm25-only'
//   - Tier 2 absent CATALOG.md → search.tier_skipped; falls to Tier 3
//   - Tier N throws → search.tier_failed; falls through (does NOT propagate)
//   - Aggregate budget exceeded via AbortController → search.tier_budget_exceeded
//     + returns partial set (NOT error)
//   - Per-hit tier_used reflects firing tier; cascade tier_used = deepest
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-013..019
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Decision"
//   - specs/006-hardening/data-model.md §"Entity 3 + 4"

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths, type SearchInput, type SearchHit } from '@llm-corpus/contracts';
import {
  runTieredSearch,
  type TierDeps,
  type TierResult,
} from '../../packages/index/src/tier-orchestrator.js';

/** Build a synthetic SearchHit for tier-orchestrator tests. */
function mkHit(docIdSuffix: string, tier: SearchHit['tier_used']): SearchHit {
  return {
    uri: `corpus://docs/doc-${docIdSuffix}` as SearchHit['uri'],
    score: 1.0,
    title: `Doc ${docIdSuffix}`,
    facet_domain: 'engineering',
    facet_type: 'reference',
    tags: ['demo'],
    snippet: 'synthetic snippet',
    tier_used: tier,
  };
}

interface ReadTelemetry {
  events: Array<{ event: string; [k: string]: unknown }>;
}

async function readTelemetryEvents(): Promise<ReadTelemetry> {
  const file = Paths.telemetry();
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    const events = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { event: string };
        } catch {
          return null;
        }
      })
      .filter((e): e is { event: string } => e !== null);
    return { events };
  } catch {
    return { events: [] };
  }
}

describe('T039 — runTieredSearch (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-tier-orch-'));
    process.env.CORPUS_HOME = tmpHome;
    await fsp.mkdir(Paths.state(), { recursive: true });
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('Tier 0 yields ≥ min_results → tier_used="hybrid", no fallthrough event', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [
          mkHit('00000001', 'hybrid'),
          mkHit('00000002', 'hybrid'),
          mkHit('00000003', 'hybrid'),
          mkHit('00000004', 'hybrid'),
          mkHit('00000005', 'hybrid'),
        ],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async () => {
        throw new Error('tier1 must not run');
      },
      tier2: async () => {
        throw new Error('tier2 must not run');
      },
      tier3: async () => {
        throw new Error('tier3 must not run');
      },
      policy: {
        minResultsForFallthrough: 3,
        tierTotalBudgetMs: 600,
        tierBm25TimeoutMs: 5,
        tierCatalogGrepTimeoutMs: 50,
        tierFsGrepTimeoutMs: 500,
      },
    };
    const result = await runTieredSearch(input, deps, new AbortController().signal);
    expect(result.tier_used).toBe('hybrid');
    expect(result.hits.length).toBe(5);
    expect(result.hits.every((h) => h.tier_used === 'hybrid')).toBe(true);
    const tel = await readTelemetryEvents();
    expect(tel.events.find((e) => e.event === 'search.tier_fallthrough')).toBeUndefined();
  });

  it('Tier 0 yields 2 hits, Tier 1 fills to 3 → tier_used="bm25-only", fallthrough event emitted', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [mkHit('00000001', 'hybrid'), mkHit('00000002', 'hybrid')],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async () => ({
        tier: 'bm25-only',
        hits: [
          mkHit('00000003', 'bm25-only'),
          mkHit('00000004', 'bm25-only'),
          mkHit('00000005', 'bm25-only'),
        ],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier2: async () => {
        throw new Error('tier2 must not run');
      },
      tier3: async () => {
        throw new Error('tier3 must not run');
      },
      policy: {
        minResultsForFallthrough: 3,
        tierTotalBudgetMs: 600,
        tierBm25TimeoutMs: 5,
        tierCatalogGrepTimeoutMs: 50,
        tierFsGrepTimeoutMs: 500,
      },
    };
    const result = await runTieredSearch(input, deps, new AbortController().signal);
    expect(result.tier_used).toBe('bm25-only');
    expect(result.hits.length).toBe(5);
    const tel = await readTelemetryEvents();
    const ft = tel.events.find((e) => e.event === 'search.tier_fallthrough');
    expect(ft).toBeDefined();
  });

  it('Tier 2 skipped (CATALOG.md missing) → search.tier_skipped emitted; falls to Tier 3', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async () => ({
        tier: 'bm25-only',
        hits: [],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier2: async () => ({
        tier: 'catalog-grep',
        hits: [],
        elapsed_ms: 1,
        outcome: 'skipped',
      }),
      tier3: async () => ({
        tier: 'fs-grep',
        hits: [mkHit('00000003', 'fs-grep')],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      policy: {
        minResultsForFallthrough: 3,
        tierTotalBudgetMs: 600,
        tierBm25TimeoutMs: 5,
        tierCatalogGrepTimeoutMs: 50,
        tierFsGrepTimeoutMs: 500,
      },
    };
    const result = await runTieredSearch(input, deps, new AbortController().signal);
    expect(result.tier_used).toBe('fs-grep');
    expect(result.hits.length).toBe(1);
    const tel = await readTelemetryEvents();
    expect(tel.events.find((e) => e.event === 'search.tier_skipped')).toBeDefined();
  });

  it('Tier failure does not propagate → search.tier_failed emitted; falls through', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async () => {
        throw new Error('tier 1 explosion');
      },
      tier2: async () => ({
        tier: 'catalog-grep',
        hits: [mkHit('00000009', 'catalog-grep'), mkHit('0000000a', 'catalog-grep'), mkHit('0000000b', 'catalog-grep')],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier3: async () => {
        throw new Error('tier3 must not run');
      },
      policy: {
        minResultsForFallthrough: 3,
        tierTotalBudgetMs: 600,
        tierBm25TimeoutMs: 5,
        tierCatalogGrepTimeoutMs: 50,
        tierFsGrepTimeoutMs: 500,
      },
    };
    const result = await runTieredSearch(input, deps, new AbortController().signal);
    expect(result.tier_used).toBe('catalog-grep');
    expect(result.hits.length).toBe(3);
    const tel = await readTelemetryEvents();
    expect(tel.events.find((e) => e.event === 'search.tier_failed')).toBeDefined();
  });

  it('Aggregate budget exceeded → emits search.tier_budget_exceeded and returns partial set', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    let tier1Ran = false;
    const slowTier: TierResult = {
      tier: 'bm25-only',
      hits: [],
      elapsed_ms: 1,
      outcome: 'completed',
    };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [mkHit('00000001', 'hybrid')],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async (_signal) => {
        tier1Ran = true;
        // Sleep beyond the aggressive budget — abort signal will fire.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        return slowTier;
      },
      tier2: async () => slowTier,
      tier3: async () => slowTier,
      policy: {
        minResultsForFallthrough: 5,
        tierTotalBudgetMs: 30, // small enough that Tier 1's 50ms sleep is aborted
        tierBm25TimeoutMs: 30,
        tierCatalogGrepTimeoutMs: 30,
        tierFsGrepTimeoutMs: 30,
      },
    };
    const result = await runTieredSearch(input, deps, new AbortController().signal);
    // Partial set returned (Tier 0's 1 hit), not an error.
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(tier1Ran).toBe(true);
    const tel = await readTelemetryEvents();
    expect(tel.events.find((e) => e.event === 'search.tier_budget_exceeded')).toBeDefined();
  });
});
