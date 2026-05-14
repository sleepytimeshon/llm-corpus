// SP-006 T046 — Unit test for tier-orchestrator merge semantics.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   Given Tier 0 returns hits {doc-aaa, doc-bbb tier='hybrid'} and Tier 1
//   returns hits {doc-aaa-dup, doc-ccc, doc-ddd tier='bm25-only'}, the merged
//   result has 4 distinct hits — doc-aaa retains tier_used='hybrid'; doc-bbb
//   retains tier_used='hybrid'; doc-ccc and doc-ddd carry tier_used='bm25-only'
//   per the higher-tier-wins merge rule (Decision K).
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-017
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Merge Semantics"
//   - specs/006-hardening/research.md Decision K

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

function mkHit(suffix: string, tier: SearchHit['tier_used'], score = 1): SearchHit {
  return {
    uri: `corpus://docs/doc-${suffix}` as SearchHit['uri'],
    score,
    title: `Doc ${suffix}`,
    facet_domain: 'engineering',
    facet_type: 'reference',
    tags: ['demo'],
    snippet: 'synthetic',
    tier_used: tier,
  };
}

describe('T046 — runTieredSearch merge semantics (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-tier-merge-'));
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

  it('higher-tier wins on doc_id collision; new lower-tier docs are appended', async () => {
    const input: SearchInput = { query: 'q', limit: 20 };
    const deps: TierDeps = {
      tier0: async () => ({
        tier: 'hybrid',
        hits: [
          mkHit('00000aaa', 'hybrid', 0.9),
          mkHit('00000bbb', 'hybrid', 0.8),
        ],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier1: async () => ({
        tier: 'bm25-only',
        hits: [
          // Same doc as Tier 0 — should be deduplicated, hybrid wins.
          mkHit('00000aaa', 'bm25-only', 0.5),
          mkHit('00000ccc', 'bm25-only', 0.4),
          mkHit('00000ddd', 'bm25-only', 0.3),
        ],
        elapsed_ms: 1,
        outcome: 'completed',
      }),
      tier2: async () => {
        throw new Error('tier 2 must not run (≥ min_results met after tier 1)');
      },
      tier3: async () => {
        throw new Error('tier 3 must not run');
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
    // 4 distinct doc_ids — 2 from Tier 0 + 2 new from Tier 1 (doc-00000aaa is deduped).
    expect(result.hits.length).toBe(4);
    const byId = new Map(result.hits.map((h) => [h.uri, h]));
    expect(byId.get('corpus://docs/doc-00000aaa')?.tier_used).toBe('hybrid');
    expect(byId.get('corpus://docs/doc-00000bbb')?.tier_used).toBe('hybrid');
    expect(byId.get('corpus://docs/doc-00000ccc')?.tier_used).toBe('bm25-only');
    expect(byId.get('corpus://docs/doc-00000ddd')?.tier_used).toBe('bm25-only');
    // Cascade tier_used is the deepest tier that contributed a NEW hit.
    expect(result.tier_used).toBe('bm25-only');
  });
});
