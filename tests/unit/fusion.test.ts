// SP-005 T028 — Contract test for RRF fusion + confidence multiplier.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-002, FR-RETRIEVAL-009,
//     SC-RETRIEVAL-005
//   - specs/005-retrieval/contracts/adr-rrf-fusion.md
//   - R7 (RRF with empty retriever results)

import { describe, it, expect } from 'vitest';
import { fuseRrf } from '../../packages/index/src/fusion.js';
import type { RankingSignal } from '../../packages/index/src/fts5-adapter.js';

function sig(
  kind: RankingSignal['kind'],
  docs: Array<[string, number]>,
): RankingSignal {
  return {
    kind,
    succeeded: true,
    results: docs.map(([doc_id, rank]) => ({
      doc_id,
      rank,
      score: 1 / rank,
    })),
  };
}

describe('fuseRrf — RRF + confidence post-fusion multiplier', () => {
  it('combines four retrievers via 1/(60+rank)', () => {
    const signals: RankingSignal[] = [
      sig('bm25', [['doc-aaaaaaaa', 1], ['doc-bbbbbbbb', 2]]),
      sig('dense', [['doc-aaaaaaaa', 1]]),
      sig('graph', [['doc-bbbbbbbb', 1]]),
      sig('confidence', [['doc-aaaaaaaa', 1]]),
    ];
    const out = fuseRrf({
      signals,
      k: 60,
      confidenceWeights: new Map([
        ['doc-aaaaaaaa', 1.2],
        ['doc-bbbbbbbb', 1.0],
      ]),
      limit: 10,
    });
    expect(out.length).toBe(2);
    expect(out[0].doc_id).toBe('doc-aaaaaaaa');
    // doc-a in bm25(1), dense(1), confidence(1) → 3/(60+1) = 0.04918...
    // × 1.2 = ~0.059
    expect(out[0].score).toBeCloseTo((3 / 61) * 1.2, 4);
    expect(out[1].doc_id).toBe('doc-bbbbbbbb');
  });

  it('returns empty fused list when all retrievers are empty', () => {
    const signals: RankingSignal[] = [
      sig('bm25', []),
      sig('dense', []),
      sig('graph', []),
      sig('confidence', []),
    ];
    const out = fuseRrf({
      signals,
      k: 60,
      confidenceWeights: new Map(),
      limit: 10,
    });
    expect(out).toEqual([]);
  });

  it('skips failed retrievers (succeeded=false)', () => {
    const signals: RankingSignal[] = [
      sig('bm25', [['doc-aaaaaaaa', 1]]),
      { kind: 'dense', results: [], succeeded: false, error: 'unavail' },
      sig('graph', []),
      sig('confidence', []),
    ];
    const out = fuseRrf({
      signals,
      k: 60,
      confidenceWeights: new Map([['doc-aaaaaaaa', 1.0]]),
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0].score).toBeCloseTo(1 / 61, 4);
  });

  it('respects the caller limit', () => {
    const signals: RankingSignal[] = [
      sig('bm25', [
        ['doc-11111111', 1],
        ['doc-22222222', 2],
        ['doc-33333333', 3],
        ['doc-44444444', 4],
      ]),
    ];
    const out = fuseRrf({
      signals,
      k: 60,
      confidenceWeights: new Map(),
      limit: 2,
    });
    expect(out.length).toBe(2);
    expect(out[0].doc_id).toBe('doc-11111111');
    expect(out[1].doc_id).toBe('doc-22222222');
  });

  it('confidence multiplier flips ranking when weight is large enough', () => {
    // bm25 alone says A > B; confidence weight 1.5 on B should flip.
    const signals: RankingSignal[] = [
      sig('bm25', [['doc-aaaaaaaa', 1], ['doc-bbbbbbbb', 2]]),
    ];
    const out = fuseRrf({
      signals,
      k: 60,
      confidenceWeights: new Map([
        ['doc-aaaaaaaa', 1.0],
        ['doc-bbbbbbbb', 5.0], // outsized to flip
      ]),
      limit: 10,
    });
    expect(out[0].doc_id).toBe('doc-bbbbbbbb');
  });

  it('contributingRanks records the rank for each retriever that contributed', () => {
    const signals: RankingSignal[] = [
      sig('bm25', [['doc-aaaaaaaa', 1]]),
      sig('dense', [['doc-aaaaaaaa', 3]]),
    ];
    const out = fuseRrf({
      signals,
      k: 60,
      confidenceWeights: new Map(),
      limit: 1,
    });
    expect(out[0].contributingRanks.bm25).toBe(1);
    expect(out[0].contributingRanks.dense).toBe(3);
    expect(out[0].contributingRanks.graph).toBeUndefined();
  });
});
