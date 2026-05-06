// T032 — corpus.find tool handler (SP-001 placeholder).
// Constitution VII (Cancellable IO) + FR-001.
// Contract: specs/001-local-only-mcp-foundation/contracts/mcp-corpus-find.md §"SP-001 handler behavior"
//
// SP-001 returns an empty hits array — ranking lands in SP-005.

import type { CorpusFindInputType, CorpusFindOutputType } from './schemas.js';

export type CorpusFindHandler = (
  input: CorpusFindInputType,
  signal: AbortSignal,
) => Promise<CorpusFindOutputType>;

/**
 * SP-001 handler: respects cancellation, returns empty hits + echoed query.
 * The MCP SDK's tool wrapper provides the AbortSignal; cancellation MUST
 * abort within 2s per ARCHITECTURE-FINAL §11.2.
 */
export const corpusFindHandler: CorpusFindHandler = async (input, signal) => {
  signal.throwIfAborted();
  return {
    hits: [],
    query: input.query,
  };
};
