// SP-008 T020 — RED unit test verifying that zero-result `corpus.find`
// invocations STILL emit `engagement.corpus_find_invoked` with
// `result_count: 0`. Per FR-ENGAGEMENT-001 + Entity 1 invariants:
// zero-result queries are valid (counted as a query by the aggregator)
// but cannot be the target of `corpus accept` (per FR-ENGAGEMENT-002 +
// AcceptZeroResultQueryError).
//
// References:
//   - specs/008-user-acceptance/tasks.md T020
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-001, SC-008-006
//   - Constitution Principle XIII (Telemetry-or-Die)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { wrapHandlerWithEngagement } from '@llm-corpus/transport';
import type {
  SearchOutput,
  EngagementCorpusFindInvokedEvent,
} from '@llm-corpus/contracts';
import { Paths } from '@llm-corpus/contracts';

describe('SP-008 T020 — engagement event on zero-result corpus.find', () => {
  let tempHome: string;
  let prevHome: string | undefined;
  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-zero-result-'));
    prevHome = process.env.CORPUS_HOME;
    process.env.CORPUS_HOME = tempHome;
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prevHome;
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('emits engagement event with result_count:0 + valid tier_used + duration_ms >= 0', async () => {
    const emptyOut: SearchOutput = {
      hits: [],
      query: 'nothing here',
      result_count: 0,
      tier_used: 'fs-grep' as const,
      signals_used: [],
    };
    const wrapped = wrapHandlerWithEngagement(async () => emptyOut);
    await wrapped({ query: 'nothing here', limit: 5 }, new AbortController().signal);

    const raw = await fsp.readFile(Paths.telemetry(), 'utf8');
    const events = raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { event: string });
    const engage = events.find(
      (e) => e.event === 'engagement.corpus_find_invoked',
    ) as EngagementCorpusFindInvokedEvent | undefined;
    expect(engage).toBeDefined();
    expect(engage!.result_count).toBe(0);
    expect(['hybrid', 'bm25-only', 'catalog-grep', 'fs-grep']).toContain(engage!.tier_used);
    expect(engage!.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
