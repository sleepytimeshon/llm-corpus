// SP-005 T005 — Contract test for the 14 SP-005 telemetry event classes.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-013, FR-RETRIEVAL-023
//   - specs/005-retrieval/data-model.md §"Entity 5"
//   - Constitution Principles I, V, IX, XIII

import { describe, it, expect } from 'vitest';
import {
  TelemetryEvent,
  TELEMETRY_MAX_BYTES,
} from '../../packages/contracts/src/telemetry.js';

const now = new Date().toISOString();
const docId = 'doc-deadbeef';
const queryHash = '0'.repeat(64);

const SP005_EVENTS: ReadonlyArray<unknown> = [
  {
    event: 'embed.started',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    model_name: 'nomic-embed-text',
    input_token_estimate: 100,
  },
  {
    event: 'embed.completed',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    model_name: 'nomic-embed-text',
    dimension: 768,
    duration_ms: 123,
  },
  {
    event: 'embed.failed',
    timestamp: now,
    severity: 'error',
    outcome: 'failed',
    doc_id: docId,
    model_name: 'nomic-embed-text',
    error_code: 'embedding_unavailable',
    message: 'ECONNREFUSED',
  },
  {
    event: 'index.started',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    body_excerpt_word_count: 500,
    frontmatter_fields_present: ['summary', 'facet_topic'],
  },
  {
    event: 'index.completed',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    fts5_inserted: true,
    vec_inserted: true,
    duration_ms: 5,
  },
  {
    event: 'index.failed',
    timestamp: now,
    severity: 'error',
    outcome: 'failed',
    doc_id: docId,
    error_code: 'persist_failed',
    message: 'SQL exception',
  },
  {
    event: 'edges.started',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    candidate_pool_size: 42,
  },
  {
    event: 'edges.completed',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    tag_overlap_count: 3,
    summary_similarity_count: 2,
    explicit_related_count: 1,
    duration_ms: 12,
  },
  {
    event: 'edges.failed',
    timestamp: now,
    severity: 'error',
    outcome: 'failed',
    doc_id: docId,
    error_code: 'edges_build_timeout',
    message: 'timeout',
  },
  {
    event: 'search.started',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    query_hash: queryHash,
    has_filters: false,
    limit: 20,
  },
  {
    event: 'search.query',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    query_hash: queryHash,
    tier_used: 'hybrid',
    result_count: 7,
    signals_used: ['bm25', 'dense', 'graph', 'confidence'],
    duration_ms: 12,
  },
  {
    event: 'search.completed',
    timestamp: now,
    severity: 'info',
    outcome: 'success',
    query_hash: queryHash,
    result_count: 7,
    duration_ms: 12,
  },
  {
    event: 'search.degraded',
    timestamp: now,
    severity: 'warn',
    outcome: 'success',
    query_hash: queryHash,
    degraded_signals: ['dense'],
    error_codes: ['embedding_unavailable'],
  },
  {
    event: 'search.error',
    timestamp: now,
    severity: 'error',
    outcome: 'failed',
    query_hash: queryHash,
    error_code: 'validation_error',
    message: 'bad input',
  },
];

describe('PREREQ-002 — SP-005 telemetry event classes', () => {
  it('exactly 14 SP-005 fixture events', () => {
    expect(SP005_EVENTS).toHaveLength(14);
  });

  it('every SP-005 event round-trips through TelemetryEvent', () => {
    for (const ev of SP005_EVENTS) {
      const r = TelemetryEvent.safeParse(ev);
      expect(r.success).toBe(true);
    }
  });

  it('every SP-005 event serializes within Constitution IX 4096-byte budget', () => {
    for (const ev of SP005_EVENTS) {
      const json = JSON.stringify(ev);
      expect(json.length).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
    }
  });

  it('search.query query_hash MUST be 64-hex (rejects non-hex)', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.query',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: 'not-hex',
      tier_used: 'hybrid',
      result_count: 1,
      signals_used: ['bm25'],
      duration_ms: 1,
    });
    expect(r.success).toBe(false);
  });

  it('search.query tier_used MUST be the literal "hybrid"', () => {
    const r = TelemetryEvent.safeParse({
      event: 'search.query',
      timestamp: now,
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      tier_used: 'keyword',
      result_count: 1,
      signals_used: ['bm25'],
      duration_ms: 1,
    });
    expect(r.success).toBe(false);
  });
});
