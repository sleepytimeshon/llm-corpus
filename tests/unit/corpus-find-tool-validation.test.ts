// SP-005 T066 — Contract test for corpus-find-tool validation_error envelope.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-004, FR-RETRIEVAL-020,
//     SC-RETRIEVAL-009
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { createCorpusFindHandler } from '../../packages/transport/src/corpus-find-tool.js';
import type { CorpusFindHandlerDeps } from '../../packages/transport/src/corpus-find-tool.js';

const stubDeps = {} as unknown as CorpusFindHandlerDeps;

describe('corpus-find-tool validation_error envelope (FR-RETRIEVAL-004)', () => {
  it('returns validation_error envelope on unknown filter key', async () => {
    const handler = createCorpusFindHandler(stubDeps);
    const out = await handler(
      { query: 'x', filters: { zzz_unknown: 'foo' } } as never,
      new AbortController().signal,
    );
    expect(out.error?.error_code).toBe('validation_error');
    expect(out.hits).toEqual([]);
    expect(out.result_count).toBe(0);
    expect(out.tier_used).toBe('hybrid');
    expect(out.signals_used).toEqual([]);
  });

  it('returns validation_error envelope on query > 2048 chars', async () => {
    const handler = createCorpusFindHandler(stubDeps);
    const big = 'a'.repeat(2049);
    const out = await handler(
      { query: big } as never,
      new AbortController().signal,
    );
    expect(out.error?.error_code).toBe('validation_error');
  });

  it('returns validation_error envelope on limit > 100', async () => {
    const handler = createCorpusFindHandler(stubDeps);
    const out = await handler(
      { query: 'x', limit: 101 } as never,
      new AbortController().signal,
    );
    expect(out.error?.error_code).toBe('validation_error');
  });

  it('envelope is a successful MCP response shape (NOT transport error)', async () => {
    const handler = createCorpusFindHandler(stubDeps);
    const out = await handler(
      { query: 'x', limit: 0 } as never, // invalid (< 1)
      new AbortController().signal,
    );
    // Envelope wrapped in SearchOutput — the MCP server delivers it as a
    // success-shaped tool response per FR-RETRIEVAL-004.
    expect(out.error).toBeDefined();
    expect(out.error?.message).toBeDefined();
    expect(out.error?.hint).toBeDefined();
    expect(out.query).toBe('x');
  });
});
