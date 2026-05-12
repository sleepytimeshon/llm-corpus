// SP-000-Lite Phase 2 (T017 in user-prompt numbering) — Q3 ratification
// gate contract test.
//
// Asserts that `verifyQ3Ratified(specSource)` returns Ok when the spec
// carries three `<!-- ratified: true -->` markers (one per retrieval
// pattern), and Err otherwise. The harness uses this gate to refuse startup
// against an unratified DRAFT spec (FR-PILOT-012).
//
// TDD: `verifyQ3Ratified` is not exported in Phase 1; assertions fail at
// runtime until Phase 3 (T019) lands.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T013, T019
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-012
//   - specs/000-nfr-008-pilot-lite/contracts/query-set.feature

import { describe, it, expect } from 'vitest';

async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe('SP-000-Lite — Q3 ratification gate (FR-PILOT-012)', () => {
  it('verifyQ3Ratified is exported from @llm-corpus/pipeline (Phase 3 T019)', async () => {
    const mod = await loadHarness();
    expect(mod).toBeDefined();
    expect(mod?.verifyQ3Ratified).toBeDefined();
    expect(typeof mod?.verifyQ3Ratified).toBe('function');
  });

  it('returns Ok when spec carries three <!-- ratified: true --> markers', async () => {
    const mod = await loadHarness();
    const fn = mod?.verifyQ3Ratified as
      | ((specSource: string) => Record<string, unknown>)
      | undefined;
    expect(fn).toBeDefined();
    if (!fn) return;
    const spec = [
      '## Retrieval Pattern Operational Definitions',
      '',
      '### factual_lookup <!-- ratified: true -->',
      '### recall_by_context <!-- ratified: true -->',
      '### multi_doc_synthesis <!-- ratified: true -->',
    ].join('\n');
    const result = fn(spec);
    expect(result.ok).toBe(true);
  });

  it('returns Err when ratification markers are absent (DRAFT spec)', async () => {
    const mod = await loadHarness();
    const fn = mod?.verifyQ3Ratified as
      | ((specSource: string) => Record<string, unknown>)
      | undefined;
    if (!fn) {
      expect(fn).toBeDefined();
      return;
    }
    const spec = '## Retrieval Pattern Operational Definitions (DRAFT)\n';
    const result = fn(spec);
    expect(result.ok).toBe(false);
  });

  it('returns Err when only two of three markers are present', async () => {
    const mod = await loadHarness();
    const fn = mod?.verifyQ3Ratified as
      | ((specSource: string) => Record<string, unknown>)
      | undefined;
    if (!fn) {
      expect(fn).toBeDefined();
      return;
    }
    const spec = [
      '## Retrieval Pattern Operational Definitions',
      '',
      '### factual_lookup <!-- ratified: true -->',
      '### recall_by_context <!-- ratified: true -->',
      '### multi_doc_synthesis',
    ].join('\n');
    const result = fn(spec);
    expect(result.ok).toBe(false);
  });

  it('error citation references FR-PILOT-012 when markers missing', async () => {
    const mod = await loadHarness();
    const fn = mod?.verifyQ3Ratified as
      | ((specSource: string) => Record<string, unknown>)
      | undefined;
    if (!fn) {
      expect(fn).toBeDefined();
      return;
    }
    const result = fn('# spec without markers\n');
    expect(result.ok).toBe(false);
    const errStr = JSON.stringify(result.error ?? result);
    expect(errStr.includes('FR-PILOT-012')).toBe(true);
  });
});
