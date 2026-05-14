// SP-006 T056 — Integration test: aggregate budget exceeded.
//
// With tierTotalBudgetMs aggressively low (50 ms) AND a stalling tier, the
// orchestrator fires the AbortController, returns a partial set (NOT an error
// envelope), and emits search.tier_budget_exceeded.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-016
//   - SC-HARDEN-014, Constitution VII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths, type SearchInput, type SearchHit } from '@llm-corpus/contracts';
import { runTieredSearch } from '../../packages/index/src/tier-orchestrator.js';

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

function mkHit(suffix: string, tier: SearchHit['tier_used']): SearchHit {
  return {
    uri: `corpus://docs/doc-${suffix}` as SearchHit['uri'],
    score: 1.0,
    title: `Doc ${suffix}`,
    facet_domain: 'engineering',
    facet_type: 'reference',
    tags: [],
    snippet: 'x',
    tier_used: tier,
  };
}

describe('T056 — tier budget exceeded (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-budget-int-'));
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

  it('emits search.tier_budget_exceeded with budget_ms, actual_ms, tiers_attempted', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const result = await runTieredSearch(
      input,
      {
        tier0: async () => ({
          tier: 'hybrid',
          hits: [mkHit('00000001', 'hybrid')],
          elapsed_ms: 1,
          outcome: 'completed',
        }),
        tier1: async (signal) => {
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { tier: 'bm25-only', hits: [], elapsed_ms: 999, outcome: 'aborted' };
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
          minResultsForFallthrough: 10,
          tierTotalBudgetMs: 50,
          tierBm25TimeoutMs: 25,
          tierCatalogGrepTimeoutMs: 25,
          tierFsGrepTimeoutMs: 25,
        },
      },
      new AbortController().signal,
    );
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    const events = await readEvents();
    const budget = events.find(
      (e) => e.event === 'search.tier_budget_exceeded',
    ) as
      | { budget_ms?: number; actual_ms?: number; tiers_attempted?: unknown[] }
      | undefined;
    expect(budget).toBeDefined();
    expect(budget?.budget_ms).toBe(50);
    expect(typeof budget?.actual_ms).toBe('number');
    expect(Array.isArray(budget?.tiers_attempted)).toBe(true);
  });
});
