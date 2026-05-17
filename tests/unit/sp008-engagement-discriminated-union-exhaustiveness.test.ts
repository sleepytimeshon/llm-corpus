// SP-008 T013 — TypeScript-level assertion that the `TelemetryEvent`
// discriminated union remains exhaustive after the 4 SP-008 additions
// (`engagement.corpus_find_invoked`, `engagement.acceptance_event`,
// `engagement.report_generated`, `engagement.report_telemetry_parse_failed`).
//
// A `switch(event.event)` with `default: assertNever(event)` compiles cleanly
// IFF every variant has a `case` — adding a variant without a case produces
// a `not assignable to type 'never'` compile error. This file is checked by
// `tsc --build` AND `vitest run` (the assertNever code paths are exercised
// at runtime for one example of each variant).
//
// References:
//   - specs/008-user-acceptance/plan.md PREREQ-002
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-004, SC-008-003
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  TelemetryEvent,
  type TelemetryEventType,
  SearchQueryEvent,
} from '../../packages/contracts/src/telemetry.js';

const VALID_UUID = 'e53d5aab-5e61-4c8f-b950-fd7b095756ed';
const SHA256_OF_FOO = createHash('sha256').update('foo').digest('hex');
const ISO_NOW = '2026-05-17T10:00:00Z';

/**
 * TypeScript exhaustiveness helper. If the union grows a new variant and
 * `assertNever` is reached at this call site, the compiler emits
 * `argument of type 'X' not assignable to parameter of type 'never'`.
 */
function assertNever(x: never): never {
  throw new Error(
    `unreachable variant in TelemetryEvent discriminated union: ${JSON.stringify(x)}`,
  );
}

/**
 * Returns a small description string for any TelemetryEvent variant. The
 * function MUST have a `case` for every discriminator literal in the union;
 * the `default: assertNever(event)` arm enforces this at compile time.
 *
 * NOTE: this is a long switch by design — the whole point is that adding a
 * new variant to the union without a case here fails `tsc`.
 */
function describeEvent(event: TelemetryEventType): string {
  switch (event.event) {
    // SP-001
    case 'egress.attempted':
    case 'egress.blocked':
    case 'egress.checkpoint':
      return event.event;
    // SP-002
    case 'resource.read':
      return event.event;
    // SP-003
    case 'inbox.allowlist_hit':
    case 'inbox.allowlist_miss':
    case 'inbox.mime_mismatch':
    case 'inbox.size_exceeded':
    case 'inbox.filename_sanity_failed':
    case 'inbox.watcher_resource_exhausted':
    case 'ingest.dedup_hit':
    case 'ingest.dedup_miss':
    case 'ingest.normalized':
    case 'ingest.completed':
    case 'ingest.file_unstable':
    case 'ingest.aborted':
    case 'pipeline.lock_contention':
    case 'persist.failed':
      return event.event;
    // SP-004
    case 'classify.started':
    case 'classify.ollama_request':
    case 'classify.ollama_response':
    case 'classify.schema_invalid':
    case 'classify.vocabulary_violation':
    case 'classify.term_proposed':
    case 'classify.completed':
    case 'classify.failed':
    case 'classify.ollama_unavailable':
    case 'classify.batch_halted':
    case 'classify.frontmatter_incomplete':
      return event.event;
    // SP-005
    case 'embed.started':
    case 'embed.completed':
    case 'embed.failed':
    case 'index.started':
    case 'index.completed':
    case 'index.failed':
    case 'edges.started':
    case 'edges.completed':
    case 'edges.failed':
    case 'search.started':
    case 'search.query':
    case 'search.completed':
    case 'search.degraded':
    case 'search.error':
    case 'search.snippet_fetch_failed':
      return event.event;
    // SP-006
    case 'recovery.scan_started':
    case 'recovery.scan_completed':
    case 'recovery.scan_skipped':
    case 'recovery.scan_reentry':
    case 'recovery.orphan_found':
    case 'recovery.resumed':
    case 'recovery.aborted':
    case 'recovery.telemetry_parse_failed':
    case 'recovery.aborted_scan':
    case 'failures.sidecar_parse_failed':
    case 'search.tier_fallthrough':
    case 'search.tier_skipped':
    case 'search.tier_failed':
    case 'search.tier_budget_exceeded':
    case 'daemon.started':
      return event.event;
    // SP-007
    case 'install.preflight_failed':
    case 'install.step_failed':
    case 'install.completed':
    case 'install.smoke_started':
    case 'install.smoke_completed':
    case 'install.smoke_failed':
    case 'uninstall.preflight_failed':
    case 'uninstall.step_failed':
    case 'uninstall.completed':
    case 'taxonomy.promote_completed':
    case 'taxonomy.promote_lock_contention':
    case 'taxonomy.promote_missing_term':
      return event.event;
    // SP-008 — the new variants under test in this file.
    case 'engagement.corpus_find_invoked':
    case 'engagement.acceptance_event':
    case 'engagement.report_generated':
    case 'engagement.report_telemetry_parse_failed':
      return event.event;
    default:
      return assertNever(event);
  }
}

describe('SP-008 T013 — discriminated-union exhaustiveness', () => {
  it('compiles + dispatches engagement.corpus_find_invoked through the switch', () => {
    const parsed = TelemetryEvent.parse({
      event: 'engagement.corpus_find_invoked',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
      query: 'foo',
      query_hash: SHA256_OF_FOO,
      result_count: 1,
      tier_used: 'hybrid',
      duration_ms: 10,
    });
    expect(describeEvent(parsed)).toBe('engagement.corpus_find_invoked');
  });

  it('compiles + dispatches engagement.acceptance_event through the switch', () => {
    const parsed = TelemetryEvent.parse({
      event: 'engagement.acceptance_event',
      timestamp: ISO_NOW,
      request_id: VALID_UUID,
    });
    expect(describeEvent(parsed)).toBe('engagement.acceptance_event');
  });

  it('compiles + dispatches engagement.report_generated through the switch', () => {
    const parsed = TelemetryEvent.parse({
      event: 'engagement.report_generated',
      timestamp: ISO_NOW,
      window: { since: ISO_NOW, until: ISO_NOW },
      verdict: 'PASS',
      queries_in_window: 5,
      acceptance_events_in_window: 1,
      kill_signal: false,
    });
    expect(describeEvent(parsed)).toBe('engagement.report_generated');
  });

  it('compiles + dispatches engagement.report_telemetry_parse_failed through the switch', () => {
    const parsed = TelemetryEvent.parse({
      event: 'engagement.report_telemetry_parse_failed',
      timestamp: ISO_NOW,
      telemetry_log_path: '/path/to/telemetry.jsonl',
      error_message: 'malformed JSON',
    });
    expect(describeEvent(parsed)).toBe(
      'engagement.report_telemetry_parse_failed',
    );
  });

  it('parses an SP-005-era search.query with NO request_id (Decision A backward-compat)', () => {
    const r = SearchQueryEvent.safeParse({
      event: 'search.query',
      timestamp: ISO_NOW,
      severity: 'info',
      outcome: 'success',
      query_hash: SHA256_OF_FOO,
      tier_used: 'hybrid',
      result_count: 3,
      signals_used: ['bm25'],
      duration_ms: 42,
    });
    expect(r.success).toBe(true);
  });
});
