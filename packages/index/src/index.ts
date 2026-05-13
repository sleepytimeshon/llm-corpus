// SP-005 (T049) — @llm-corpus/index — hybrid retrieval surface.
//
// Replaces the SP-001-era `export {};` stub. Re-exports the SP-005
// retrieval primitives:
//   - searchOrchestrator    — the four-signal hybrid orchestrator
//   - fuseRrf               — RRF + confidence-multiplier fusion
//   - Fts5Adapter           — BM25 over documents_fts
//   - VecAdapter            — dense cosine over documents_vec
//   - GraphAdapter          — bidirectional traversal over edges
//   - ConfidenceAdapter     — confidence-weight scoring
//   - buildEdges            — edges materialization helper
//   - DEFAULT_*             — config defaults

export * from './fts5-adapter.js';
export * from './vec-adapter.js';
export * from './graph-adapter.js';
export * from './confidence-adapter.js';
export * from './edges-builder.js';
export * from './fusion.js';
export * from './search.js';
