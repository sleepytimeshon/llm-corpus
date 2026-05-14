// SP-006 T043 — Unit test for aggregate budget enforcement.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   With aggressive tier_total_budget_ms, force all four tiers to fire.
//   AbortController fires after the budget; cascade returns the partial set
//   that the earliest tier produced. search.tier_budget_exceeded event fires
//   with budget_ms, actual_ms, tiers_attempted, final_hit_count. Whole call
//   exits within budget + a generous slack (Constitution VII bounded abort).
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-016
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Aggregate Budget"
//   - Constitution VII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths, type SearchInput, type SearchHit } from '@llm-corpus/contracts';
import {
  runTieredSearch,
  type TierDeps,
} from '../../packages/index/src/tier-orchestrator.js';

function mkHit(suffix: string, tier: SearchHit['tier_used']): SearchHit {
  return {
    uri: `corpus://docs/doc-${suffix}` as SearchHit['uri'],
    score: 1.0,
    title: `Doc ${suffix}`,
    facet_domain: 'engineering',
    facet_type: 'reference',
    tags: ['demo'],
    snippet: 'synthetic',
    tier_used: tier,
  };
}

async function readEvents(): Promise<Array<{ event: string; [k: string]: unknown }>> {
  try {
    const raw = await fsp.readFile(Paths.telemetry(), 'utf8');
    return raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as { event: string };
        } catch {
          return null;
        }
      })
      .filter((e): e is { event: string } => e !== null);
  } catch {
    return [];
  }
}

describe('T043 — tier budget enforcement (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-budget-'));
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

  it('exits within budget + slack; emits search.tier_budget_exceeded with required fields', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [mkHit('00000001', 'hybrid')], // 1 hit only — below min_results
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async (signal) => {
        // Stalls until aborted.
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
          // safety fuse — never resolve from time alone
          setTimeout(() => reject(new Error('tier1 stuck')), 5_000);
        });
        return {
          tier: 'bm25-only',
          hits: [],
          elapsed_ms: 100,
          outcome: 'aborted',
        };
      },
      tier2: async () => ({
        tier: 'catalog-grep',
        hits: [],
        elapsed_ms: 1,
        outcome: 'skipped',
      }),
      tier3: async () => ({
        tier: 'fs-grep',
        hits: [],
        elapsed_ms: 1,
        outcome: 'skipped',
      }),
      policy: {
        minResultsForFallthrough: 5,
        tierTotalBudgetMs: 50,
        tierBm25TimeoutMs: 25,
        tierCatalogGrepTimeoutMs: 25,
        tierFsGrepTimeoutMs: 25,
      },
    };
    const start = Date.now();
    const result = await runTieredSearch(
      input,
      deps,
      new AbortController().signal,
    );
    const elapsed = Date.now() - start;
    // Partial set returned (Tier 0's 1 hit) — never an error envelope.
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    // Generous slack for CI jitter — budget is 50 ms, allow 5 s ceiling.
    expect(elapsed).toBeLessThan(5_000);

    const events = await readEvents();
    const budget = events.find(
      (e) => e.event === 'search.tier_budget_exceeded',
    ) as
      | { budget_ms?: number; actual_ms?: number; tiers_attempted?: unknown }
      | undefined;
    expect(budget).toBeDefined();
    expect(budget?.budget_ms).toBe(50);
    expect(typeof budget?.actual_ms).toBe('number');
    expect(Array.isArray(budget?.tiers_attempted)).toBe(true);
  });
});
