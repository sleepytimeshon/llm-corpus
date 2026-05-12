// T031 (SP-003) — RED golden test for normalize-html turndown rule-set drift.
//
// References:
//   - specs/003-ingest-pipeline/plan.md R5
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize-html.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalizeHtml golden output (T031 — Phase 2 RED)', () => {
  it('fixture HTML produces expected Markdown (turndown ^7.2.0 frozen rules)', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T063) required — golden test against tests/fixtures/sp003-ingest/valid-html.html; any version bump that changes default rule output breaks this test',
    );
  });
});
