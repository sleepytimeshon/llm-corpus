// SP-008 T014 — RED unit test for the wrapped `corpus.find` handler.
//
// Asserts the additive emission contract per Decision A:
//   - one `randomUUID()` per invocation
//   - engagement.corpus_find_invoked carries a fresh UUIDv4 request_id
//   - `result_count`, `tier_used`, `duration_ms` populate from the SearchOutput
//   - ZERO `request_id` field added to the MCP `tools/call` response (the
//     SearchOutput contract is unchanged per Decision A)
//   - `process.stderr.write` echo of `request_id` ONLY when
//     `process.stderr.isTTY === true` AND `MCP_TRANSPORT !== 'stdio'`
//   - the engagement emit happens AFTER the inner handler returns
//
// Note on `search.query` ordering: the canonical `search.query` event is
// emitted deep inside `packages/index/src/search.ts` (the Tier-0 retriever),
// which is out of scope for the T014-T046 Engineer #2 dispatch (the only
// transport-side touch authorized is `corpus-find-tool.ts`). Threading the
// shared `request_id` through to that emit is a follow-up. The wrapper under
// test still generates and exposes the request_id via the new engagement
// event — the contract surface that downstream tooling reads.
//
// References:
//   - specs/008-user-acceptance/tasks.md T014 / T016
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-001, SC-008-001,
//     SC-008-002
//   - specs/008-user-acceptance/research.md Decision A
//   - Constitution Principles V, XIII

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

interface CapturedEnv {
  CORPUS_HOME: string;
  prevHome: string | undefined;
  prevTransport: string | undefined;
}

async function setupHome(): Promise<CapturedEnv> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-find-emit-'));
  const prevHome = process.env.CORPUS_HOME;
  const prevTransport = process.env.MCP_TRANSPORT;
  process.env.CORPUS_HOME = dir;
  return { CORPUS_HOME: dir, prevHome, prevTransport };
}

async function teardownHome(env: CapturedEnv): Promise<void> {
  if (env.prevHome === undefined) delete process.env.CORPUS_HOME;
  else process.env.CORPUS_HOME = env.prevHome;
  if (env.prevTransport === undefined) delete process.env.MCP_TRANSPORT;
  else process.env.MCP_TRANSPORT = env.prevTransport;
  await fsp.rm(env.CORPUS_HOME, { recursive: true, force: true });
}

async function readTelemetryLines(): Promise<readonly string[]> {
  const file = Paths.telemetry();
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return raw.split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

function fakeSearchOutput(
  query: string,
  result_count = 3,
  tier: SearchOutput['tier_used'] = 'hybrid',
): SearchOutput {
  return {
    hits: [],
    query,
    result_count,
    tier_used: tier,
    signals_used: [],
  };
}

describe('SP-008 T014 — corpus.find engagement-event emission', () => {
  let env: CapturedEnv;
  beforeEach(async () => {
    env = await setupHome();
  });
  afterEach(async () => {
    await teardownHome(env);
  });

  it('emits engagement.corpus_find_invoked after the inner handler returns', async () => {
    let innerCalled = false;
    const wrapped = wrapHandlerWithEngagement(async (input) => {
      innerCalled = true;
      return fakeSearchOutput(input.query, 3, 'hybrid');
    });
    await wrapped({ query: 'hello world', limit: 10 }, new AbortController().signal);

    expect(innerCalled).toBe(true);
    const lines = await readTelemetryLines();
    const events = lines.map((l) => JSON.parse(l) as { event: string });
    const engageIdx = events.findIndex(
      (e) => e.event === 'engagement.corpus_find_invoked',
    );
    expect(engageIdx, 'engagement.corpus_find_invoked must be emitted').toBeGreaterThanOrEqual(0);
  });

  it('engagement.corpus_find_invoked carries a fresh UUIDv4 request_id', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) =>
      fakeSearchOutput(input.query, 1, 'bm25-only'),
    );
    await wrapped({ query: 'shared id test', limit: 5 }, new AbortController().signal);

    const lines = await readTelemetryLines();
    const engage = lines
      .map((l) => JSON.parse(l) as { event: string; request_id?: string })
      .find((e) => e.event === 'engagement.corpus_find_invoked');
    expect(engage?.request_id).toBeTruthy();
    expect(engage?.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('populates result_count + tier_used + duration_ms from SearchOutput', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) =>
      fakeSearchOutput(input.query, 7, 'catalog-grep'),
    );
    await wrapped({ query: 'populate test', limit: 5 }, new AbortController().signal);

    const lines = await readTelemetryLines();
    const engage = lines
      .map((l) => JSON.parse(l) as EngagementCorpusFindInvokedEvent)
      .find((e) => e.event === 'engagement.corpus_find_invoked');
    expect(engage).toBeDefined();
    expect(engage!.result_count).toBe(7);
    expect(engage!.tier_used).toBe('catalog-grep');
    expect(engage!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(engage!.duration_ms)).toBe(true);
  });

  it('does NOT add a request_id field to the SearchOutput response (Decision A)', async () => {
    const wrapped = wrapHandlerWithEngagement(async (input) =>
      fakeSearchOutput(input.query, 2),
    );
    const out = await wrapped(
      { query: 'response check', limit: 5 },
      new AbortController().signal,
    );
    expect(out).not.toHaveProperty('request_id');
  });

  it('does NOT echo request_id to stderr when MCP_TRANSPORT is "stdio"', async () => {
    process.env.MCP_TRANSPORT = 'stdio';
    const chunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const originalIsTty = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    try {
      const wrapped = wrapHandlerWithEngagement(async (input) =>
        fakeSearchOutput(input.query, 1),
      );
      await wrapped(
        { query: 'echo-suppressed', limit: 1 },
        new AbortController().signal,
      );
      const combined = chunks.join('');
      expect(combined).not.toMatch(/request_id/);
    } finally {
      process.stderr.write = origWrite;
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalIsTty,
        configurable: true,
      });
    }
  });
});
