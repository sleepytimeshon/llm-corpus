// SP-008 T005 — RED placeholders replaced by Engineer #2 (T016 landed).
//
// Asserts the contract surface that the find-handler wrapper
// (`wrapHandlerWithEngagement`) installs. Decision A + data-model.md
// Entity 1 invariants:
//
//   - the engagement event is emitted on every successful corpus.find
//   - the request_id is a UUIDv4 generated server-side at handler entry
//   - the engagement event populates result_count / tier_used / duration_ms
//     from the SearchOutput; the SearchOutput itself is unchanged
//   - query_hash is computed over the FULL untruncated text
//   - query_truncated:true ONLY when query.length > 1024 (truncates to 1024)
//   - the wrapper does NOT mutate the SearchOutputZodSchema shape
//   - the wrapper echoes request_id to stderr only when CLI-mediated
//     (heuristic: stderr.isTTY === true && MCP_TRANSPORT !== 'stdio')
//
// References:
//   - specs/008-user-acceptance/plan.md PREREQ-004, Decision A
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-001, SC-008-001,
//     SC-008-002, SC-008-004, SC-008-006
//   - specs/008-user-acceptance/tasks.md T005 / T016
//   - Constitution Principles V, XIII

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

function fakeOut(
  query: string,
  count = 1,
  tier: SearchOutput['tier_used'] = 'hybrid',
): SearchOutput {
  return {
    hits: [],
    query,
    result_count: count,
    tier_used: tier,
    signals_used: [],
  };
}

async function readEngagement(): Promise<EngagementCorpusFindInvokedEvent[]> {
  const raw = await fsp.readFile(Paths.telemetry(), 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { event: string })
    .filter(
      (e): e is EngagementCorpusFindInvokedEvent =>
        e.event === 'engagement.corpus_find_invoked',
    );
}

describe('SP-008 T005 — corpus-find-tool engagement instrumentation', () => {
  let tempHome: string;
  let prevHome: string | undefined;
  let prevTransport: string | undefined;
  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-t005-'));
    prevHome = process.env.CORPUS_HOME;
    prevTransport = process.env.MCP_TRANSPORT;
    process.env.CORPUS_HOME = tempHome;
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prevHome;
    if (prevTransport === undefined) delete process.env.MCP_TRANSPORT;
    else process.env.MCP_TRANSPORT = prevTransport;
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('emits engagement.corpus_find_invoked AFTER the inner handler returns (T016)', async () => {
    let observedSearchOutput: SearchOutput | undefined;
    const wrapped = wrapHandlerWithEngagement(async (input) => {
      observedSearchOutput = fakeOut(input.query, 2);
      return observedSearchOutput;
    });
    await wrapped({ query: 'hello', limit: 5 }, new AbortController().signal);
    expect(observedSearchOutput).toBeDefined();
    const events = await readEngagement();
    expect(events.length).toBe(1);
  });

  it('engagement event carries a UUIDv4 request_id', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrapped({ query: 'q', limit: 1 }, new AbortController().signal);
    const [event] = await readEngagement();
    expect(event!.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('populates result_count + tier_used + duration_ms from the SP-005 SearchOutput', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) =>
      fakeOut(input.query, 4, 'bm25-only'),
    );
    await wrapped({ query: 'q', limit: 1 }, new AbortController().signal);
    const [event] = await readEngagement();
    expect(event!.result_count).toBe(4);
    expect(event!.tier_used).toBe('bm25-only');
    expect(event!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('computes query_hash over the FULL untruncated text', async () => {
    const queryRaw = 'x'.repeat(2000);
    const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrapped({ query: queryRaw, limit: 1 }, new AbortController().signal);
    const [event] = await readEngagement();
    const expected = createHash('sha256').update(queryRaw).digest('hex');
    expect(event!.query_hash).toBe(expected);
  });

  it('sets query_truncated:true ONLY when query.length > 1024', async () => {
    const longRaw = 'y'.repeat(1500);
    const wrappedLong = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrappedLong({ query: longRaw, limit: 1 }, new AbortController().signal);
    let [event] = await readEngagement();
    expect(event!.query_truncated).toBe(true);
    expect(event!.query.length).toBe(1024);

    // New temp home for short-query assertion (no truncation).
    await fsp.rm(tempHome, { recursive: true, force: true });
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-t005-2-'));
    process.env.CORPUS_HOME = tempHome;
    const wrappedShort = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    await wrappedShort({ query: 'short', limit: 1 }, new AbortController().signal);
    [event] = await readEngagement();
    expect(event!.query_truncated === undefined || event!.query_truncated === false).toBe(true);
  });

  it('does NOT mutate SearchOutputZodSchema shape (Decision A — additive emit, not response field)', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
    const out = await wrapped(
      { query: 'check shape', limit: 1 },
      new AbortController().signal,
    );
    expect(out).not.toHaveProperty('request_id');
    expect(out).toHaveProperty('hits');
    expect(out).toHaveProperty('query');
    expect(out).toHaveProperty('result_count');
    expect(out).toHaveProperty('tier_used');
    expect(out).toHaveProperty('signals_used');
  });

  it('suppresses request_id stderr echo when MCP_TRANSPORT=stdio', async () => {
    process.env.MCP_TRANSPORT = 'stdio';
    const chunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: unknown): boolean => {
      chunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;
    const originalIsTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
    try {
      const wrapped = wrapHandlerWithEngagement(async (input) => fakeOut(input.query));
      await wrapped({ query: 'quiet', limit: 1 }, new AbortController().signal);
      expect(chunks.join('')).not.toMatch(/request_id/);
    } finally {
      process.stderr.write = origWrite;
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalIsTty,
        configurable: true,
      });
    }
  });
});
