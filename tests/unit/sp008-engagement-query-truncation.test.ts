// SP-008 T018 — RED unit test for query-truncation + hashing in the
// engagement event per Constitution IX + data-model.md Entity 1 invariants:
//
//   - 2KB query → engagement event with `query.length === 1024` AND
//     `query_truncated: true` AND `query_hash` matching SHA-256 of the FULL
//     2KB input (NOT the truncation)
//   - 100-byte query → engagement event with `query` equal to input,
//     `query_truncated` absent (or false), `query_hash` matching SHA-256 of
//     the input
//   - total event payload remains ≤ 4096 bytes for both cases
//
// References:
//   - specs/008-user-acceptance/tasks.md T018 / T019
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-001, SC-008-004,
//     SC-008-005
//   - Constitution Principle IX (≤4 KB per telemetry line)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { wrapHandlerWithEngagement } from '@llm-corpus/transport';
import type {
  SearchOutput,
  EngagementCorpusFindInvokedEvent,
} from '@llm-corpus/contracts';
import { Paths } from '@llm-corpus/contracts';

async function readEngagementEvents(): Promise<readonly EngagementCorpusFindInvokedEvent[]> {
  const file = Paths.telemetry();
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { event: string })
      .filter(
        (e): e is EngagementCorpusFindInvokedEvent =>
          e.event === 'engagement.corpus_find_invoked',
      );
  } catch {
    return [];
  }
}

function fakeOut(query: string): SearchOutput {
  return {
    hits: [],
    query,
    result_count: 1,
    tier_used: 'hybrid' as const,
    signals_used: [],
  };
}

describe('SP-008 T018 — engagement query-truncation + query_hash', () => {
  let tempHome: string;
  let prevHome: string | undefined;
  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-truncate-'));
    prevHome = process.env.CORPUS_HOME;
    process.env.CORPUS_HOME = tempHome;
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prevHome;
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('100-byte query: query echoed, query_truncated absent or false, hash matches input', async () => {
    const queryRaw = 'a'.repeat(100);
    const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrapped({ query: queryRaw, limit: 1 }, new AbortController().signal);

    const events = await readEngagementEvents();
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.query).toBe(queryRaw);
    expect(e.query.length).toBe(100);
    // query_truncated must be absent (or false)
    expect(e.query_truncated === undefined || e.query_truncated === false).toBe(true);
    const expectedHash = createHash('sha256').update(queryRaw).digest('hex');
    expect(e.query_hash).toBe(expectedHash);
  });

  it('2KB query: truncated to 1024 chars, query_truncated:true, hash matches FULL input', async () => {
    const queryRaw = 'b'.repeat(2048);
    const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrapped({ query: queryRaw, limit: 1 }, new AbortController().signal);

    const events = await readEngagementEvents();
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.query.length).toBe(1024);
    expect(e.query).toBe('b'.repeat(1024));
    expect(e.query_truncated).toBe(true);
    const expectedHash = createHash('sha256').update(queryRaw).digest('hex');
    expect(e.query_hash).toBe(expectedHash);
  });

  it('serialized event size remains <= 4096 bytes for both cases', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrapped({ query: 'short', limit: 1 }, new AbortController().signal);
    await wrapped({ query: 'c'.repeat(2048), limit: 1 }, new AbortController().signal);

    const file = Paths.telemetry();
    const raw = await fsp.readFile(file, 'utf8');
    for (const line of raw.split('\n').filter((l) => l.length > 0)) {
      // Constitution IX cap
      expect(line.length).toBeLessThanOrEqual(4096);
    }
  });
});
